# PrintDrop Dual-Edition Windows Installer Build Script
# Builds Edition A (Virtual Simulation Fleet) and/or Edition B (Clean Production Retail)
param(
    [ValidateSet("Virtual", "Retail", "All")]
    [string]$Edition = "All"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $defaultKeyPath = Join-Path $env:USERPROFILE ".tauri\printdrop-updater.key"
    if (Test-Path $defaultKeyPath) {
        $env:TAURI_SIGNING_PRIVATE_KEY = $defaultKeyPath
    }
}

$distDir = Join-Path $root "dist-installer"
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

$nsisSource = Join-Path $root "src-tauri\target\release\bundle\nsis\PrintDrop Demo Station_1.0.1_x64-setup.exe"

function Build-Edition {
    param(
        [string]$Name,
        [string]$TargetExeName,
        [string[]]$TauriArgs
    )

    Write-Host "`n========================================================" -ForegroundColor Cyan
    Write-Host "   BUILDING: $Name" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Cyan

    # 1. Clean previous build artifacts if present
    if (Test-Path $nsisSource) {
        Remove-Item $nsisSource -Force
    }

    # 2. Build Frontend
    Write-Host ">>> [1/3] Building React + Tailwind Frontend (Vite)..." -ForegroundColor Yellow
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE"
    }

    # 3. Build Tauri / Cargo Release Bundle
    Write-Host ">>> [2/3] Compiling Tauri Application & Packaging NSIS Installer ($Name)..." -ForegroundColor Yellow
    Write-Host "Executing: npx tauri build $($TauriArgs -join ' ')" -ForegroundColor DarkGray
    & npx tauri build @TauriArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build for $Name failed with exit code $LASTEXITCODE"
    }

    # 4. Verify and Copy Artifact
    Write-Host ">>> [3/3] Verifying and Staging NSIS Installer to dist-installer/..." -ForegroundColor Yellow
    if (-not (Test-Path $nsisSource)) {
        throw "Expected installer was not found at $nsisSource"
    }

    $destPath = Join-Path $distDir $TargetExeName
    Copy-Item -Path $nsisSource -Destination $destPath -Force

    $fileItem = Get-Item $destPath
    $sizeMb = [math]::Round($fileItem.Length / 1MB, 2)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($destPath)
    try {
        $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
    } finally {
        $stream.Dispose()
        $sha.Dispose()
    }

    Write-Host "`n✅ Successfully generated: $TargetExeName" -ForegroundColor Green
    Write-Host "   Size: $sizeMb MB ($($fileItem.Length) bytes)" -ForegroundColor Green
    Write-Host "   SHA-256: $hash" -ForegroundColor DarkGray
    Write-Host "   Location: $destPath`n" -ForegroundColor Green
}

$startTime = Get-Date

if ($Edition -eq "Virtual" -or $Edition -eq "All") {
    Build-Edition `
        -Name "Edition A: Virtual Hardware Sandbox & Testing Edition" `
        -TargetExeName "PrintDrop_Demo_Station_Virtual_1.0.1_x64-setup.exe" `
        -TauriArgs @("-f", "simulation")
}

if ($Edition -eq "Retail" -or $Edition -eq "All") {
    Build-Edition `
        -Name "Edition B: Clean Production Retail Edition (Zero Simulation)" `
        -TargetExeName "PrintDrop_Demo_Station_Retail_1.0.1_x64-setup.exe" `
        -TauriArgs @("--", "--no-default-features")
}

$elapsed = (Get-Date) - $startTime
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host "   ALL REQUESTED INSTALLERS BUILT SUCCESSFULLY!" -ForegroundColor Magenta
Write-Host "   Total time: $([math]::Round($elapsed.TotalMinutes, 2)) minutes" -ForegroundColor Magenta
Write-Host "========================================================`n" -ForegroundColor Magenta
