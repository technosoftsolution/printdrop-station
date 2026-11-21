# PrintDrop Remote Support Hub Launcher (MeshCentral + Cloudflare Quick Tunnel + Supabase)
# Runs a white-labeled MeshCentral server locally on 127.0.0.1:4430, exposes it over a free
# Cloudflare Quick Tunnel (https://*.trycloudflare.com), and publishes the live agent endpoint
# to Supabase system_config (key: provider_remote_support_tunnel) so any shopkeeper can connect
# in 1 click from PrintDrop Desktop -> Settings / Contact Us -> Connect to PrintDrop Support.

param(
    [int]$Port = 4430,
    [string]$SupabaseUrl = "https://nslcrlvuulgqtrdqrkgv.supabase.co",
    [string]$SupabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGNybHZ1dWxncXRyZHFya2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTI4NzEsImV4cCI6MjEwOTcyODg3MX0.lpRc097A_PFCD-eJVhyQZmPFxexhSGjM2dhCE0LNdxk"
)

$ErrorActionPreference = "Stop"

$hubDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $hubDir
$dataDir = Join-Path $hubDir "meshcentral-data"
$configPath = Join-Path $dataDir "config.json"
$templateConfig = Join-Path $hubDir "config.template.json"
$mshTemplatePath = Join-Path $hubDir "station-template.msh"

function Publish-SupportTunnelState {
    param(
        [bool]$Active,
        [string]$TunnelUrl = "",
        [string]$MeshServerWss = "",
        [string]$ServerId = "",
        [string]$MeshId = "",
        [string]$MeshName = "PrintDrop Stations",
        [string]$MeshType = "2"
    )

    $payload = @{
        key   = "provider_remote_support_tunnel"
        value = @{
            active        = $Active
            tunnelUrl     = $TunnelUrl
            meshServerWss = $MeshServerWss
            serverId      = $ServerId
            meshId        = $MeshId
            meshName      = $MeshName
            meshType      = $MeshType
            updatedAt     = (Get-Date).ToUniversalTime().ToString("o")
        }
    } | ConvertTo-Json -Depth 5

    try {
        Invoke-RestMethod `
            -Uri "$($SupabaseUrl.TrimEnd('/'))/rest/v1/system_config?on_conflict=key" `
            -Method Post `
            -Headers @{
                apikey         = $SupabaseAnonKey
                Authorization  = "Bearer $SupabaseAnonKey"
                "Content-Type" = "application/json"
                Prefer         = "resolution=merge-duplicates"
            } `
            -Body $payload | Out-Null
        return $true
    } catch {
        Write-Host "  [WARN] Failed to update Supabase system_config: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

function Parse-MshFile {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $idx = $line.IndexOf("=")
            $k = $line.Substring(0, $idx).Trim()
            $v = $line.Substring($idx + 1).Trim()
            $map[$k] = $v
        }
    }
    return $map
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   PrintDrop Remote Support Hub (MeshCentral + Cloudflare)  " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Locate cloudflared.exe
$cloudflaredCandidates = @(
    (Join-Path $repoRoot "bin\cloudflared.exe"),
    (Join-Path $repoRoot "src-tauri\bin\cloudflared.exe")
)
$cloudflaredExe = $cloudflaredCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $cloudflaredExe) {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { $cloudflaredExe = $cmd.Source }
}
if (-not $cloudflaredExe) {
    throw "cloudflared.exe not found in bin/, src-tauri/bin/, or PATH."
}

# 2. Install MeshCentral dependencies if needed
$meshBin = Join-Path $hubDir "node_modules\meshcentral\meshcentral.js"
if (-not (Test-Path $meshBin)) {
    Write-Host ">>> [1/4] Installing MeshCentral in support-hub/ (first run only)..." -ForegroundColor Yellow
    Push-Location $hubDir
    try {
        npm install --omit=dev
        if ($LASTEXITCODE -ne 0) { throw "npm install failed in support-hub/" }
    } finally {
        Pop-Location
    }
}

# 3. Ensure meshcentral-data/config.json exists
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
}
if (-not (Test-Path $configPath)) {
    Copy-Item $templateConfig $configPath
    Write-Host ">>> Created initial $configPath from template." -ForegroundColor Green
}

# 4. Start MeshCentral in background
$meshLogOut = Join-Path $hubDir "meshcentral-out.log"
$meshLogErr = Join-Path $hubDir "meshcentral-err.log"
Write-Host ">>> [2/4] Starting PrintDrop Support Hub (MeshCentral on 127.0.0.1:$Port)..." -ForegroundColor Cyan
$meshProc = Start-Process -FilePath "node" `
    -ArgumentList @("node_modules\meshcentral\meshcentral.js", "--datapath", $dataDir) `
    -WorkingDirectory $hubDir `
    -RedirectStandardOutput $meshLogOut `
    -RedirectStandardError $meshLogErr `
    -NoNewWindow -PassThru

# Wait for local HTTP port to listen (up to 30s)
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    if ($meshProc.HasExited) {
        Write-Host "MeshCentral exited unexpectedly. Last log lines:" -ForegroundColor Red
        if (Test-Path $meshLogErr) { Get-Content $meshLogErr -Tail 20 }
        if (Test-Path $meshLogOut) { Get-Content $meshLogOut -Tail 20 }
        exit 1
    }
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
if (-not $ready) {
    Stop-Process -Id $meshProc.Id -Force -ErrorAction SilentlyContinue
    throw "MeshCentral did not start listening on 127.0.0.1:$Port within 30 seconds."
}
Write-Host "    MeshCentral is listening on http://127.0.0.1:$Port" -ForegroundColor Green

# 5. Start Cloudflare Quick Tunnel
$cfLogErr = Join-Path $hubDir "cloudflared-err.log"
$cfLogOut = Join-Path $hubDir "cloudflared-out.log"
if (Test-Path $cfLogErr) { Remove-Item $cfLogErr -Force }
if (Test-Path $cfLogOut) { Remove-Item $cfLogOut -Force }

Write-Host ">>> [3/4] Starting Cloudflare Quick Tunnel..." -ForegroundColor Cyan
$cfProc = Start-Process -FilePath $cloudflaredExe `
    -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port") `
    -WorkingDirectory $hubDir `
    -RedirectStandardOutput $cfLogOut `
    -RedirectStandardError $cfLogErr `
    -NoNewWindow -PassThru

$tunnelUrl = ""
for ($i = 0; $i -lt 25; $i++) {
    if ($cfProc.HasExited) { break }
    if (Test-Path $cfLogErr) {
        $txt = Get-Content $cfLogErr -Raw -ErrorAction SilentlyContinue
        if ($txt -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $tunnelUrl = $Matches[0]
            break
        }
    }
    Start-Sleep -Seconds 1
}

if (-not $tunnelUrl) {
    Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $meshProc.Id -Force -ErrorAction SilentlyContinue
    throw "Failed to obtain trycloudflare.com URL. Check $cfLogErr."
}

$tunnelHost = $tunnelUrl -replace '^https://', ''
$meshServerWss = "wss://${tunnelHost}:443/agent.ashx"
Write-Host "    Live Tunnel URL : $tunnelUrl" -ForegroundColor Green
Write-Host "    Agent Endpoint  : $meshServerWss" -ForegroundColor Green

# 6. Read station-template.msh and publish to Supabase
$msh = Parse-MshFile -Path $mshTemplatePath
$serverId = $msh["ServerID"]
$meshId = $msh["MeshID"]
$meshName = if ($msh["MeshName"]) { $msh["MeshName"] } else { "PrintDrop Stations" }
$meshType = if ($msh["MeshType"]) { $msh["MeshType"] } else { "2" }

if ($serverId -and $meshId) {
    Write-Host ">>> [4/4] Publishing live Support Hub tunnel to Supabase..." -ForegroundColor Cyan
    $ok = Publish-SupportTunnelState -Active $true -TunnelUrl $tunnelUrl -MeshServerWss $meshServerWss -ServerId $serverId -MeshId $meshId -MeshName $meshName -MeshType $meshType
    if ($ok) {
        Write-Host "    Published! Shopkeepers can now click 'Connect to PrintDrop Support' in 1 click." -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host "  FIRST-TIME ONE-OFF SETUP REQUIRED (Takes ~30 seconds)     " -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host "  1. Open http://127.0.0.1:$Port in your browser." -ForegroundColor White
    Write-Host "  2. Create your Provider Admin account & enable 2FA." -ForegroundColor White
    Write-Host "  3. Create a Device Group named 'PrintDrop Stations'." -ForegroundColor White
    Write-Host "  4. Click 'Add Agent' -> 'Windows (.msh settings file)'" -ForegroundColor White
    Write-Host "     and save it as:" -ForegroundColor White
    Write-Host "     $mshTemplatePath" -ForegroundColor Cyan
    Write-Host "  5. Set `"newAccounts`": false in $configPath to lock signups." -ForegroundColor White
    Write-Host "  6. Press Ctrl+C and re-run 'npm run support:hub' to publish!" -ForegroundColor White
    Write-Host "============================================================" -ForegroundColor Yellow
}

# Open local Support Hub UI in browser
Start-Process "http://127.0.0.1:$Port"

Write-Host ""
Write-Host "PrintDrop Support Hub is RUNNING. Keep this window open during support sessions." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop Support Hub and mark it Offline in Supabase..." -ForegroundColor Gray
Write-Host ""

try {
    while (-not $meshProc.HasExited -and -not $cfProc.HasExited) {
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host ""
    Write-Host ">>> Shutting down PrintDrop Support Hub..." -ForegroundColor Yellow
    if ($serverId -and $meshId) {
        Publish-SupportTunnelState -Active $false | Out-Null
    }
    if (-not $cfProc.HasExited) { Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue }
    if (-not $meshProc.HasExited) { Stop-Process -Id $meshProc.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "✓ Support Hub stopped and marked Offline." -ForegroundColor Green
}
