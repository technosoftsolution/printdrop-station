# PrintDrop One-Click CI/CD & OTA Release Script
# Usage: npm run release   (or: powershell -ExecutionPolicy Bypass -File ./scripts/release.ps1)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
Set-Location $root

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "   PrintDrop Automated CI/CD & OTA Release Launcher" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Read current version
$pkgJsonPath = Join-Path $root "package.json"
$tauriConfPath = Join-Path $root "src-tauri\tauri.conf.json"
$cargoTomlPath = Join-Path $root "src-tauri\Cargo.toml"

$pkgJson = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
$currentVersion = $pkgJson.version
Write-Host "Current Version : v$currentVersion" -ForegroundColor Yellow

# 2. Prompt for new version
$newVersion = (Read-Host "Enter NEW version number (e.g. 1.0.8)").Trim()
$newVersion = $newVersion -replace '^[vV]', ''

if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "❌ Invalid version format '$newVersion'. Expected X.Y.Z (e.g. 1.0.8)." -ForegroundColor Red
    exit 1
}

if ($newVersion -eq $currentVersion) {
    Write-Host "❌ New version must be higher than current version ($currentVersion) for OTA to trigger." -ForegroundColor Red
    exit 1
}

$tagName = "v$newVersion"
$existingTag = git tag -l $tagName
if ($existingTag) {
    Write-Host "❌ Git tag '$tagName' already exists locally. Choose a newer version." -ForegroundColor Red
    exit 1
}

$summary = (Read-Host "Enter short release note / commit message (or press Enter for default)").Trim()
if ([string]::IsNullOrWhiteSpace($summary)) {
    $commitMsg = "release: $tagName"
} else {
    $commitMsg = "release: $tagName - $summary"
}

# 3. Run pre-release verification before modifying version files
Write-Host "`n>>> [1/5] Running Frontend Production Build (npm run build)..." -ForegroundColor Yellow
& npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed!" }

Write-Host "`n>>> [2/5] Running Cargo Tests (Virtual Demo Edition)..." -ForegroundColor Yellow
& cargo test --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "Cargo tests (Virtual) failed!" }

Write-Host "`n>>> [3/5] Running Cargo Tests (Clean Retail Edition)..." -ForegroundColor Yellow
& cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
if ($LASTEXITCODE -ne 0) { throw "Cargo tests (Retail) failed!" }

# 4. Bump version in all 3 files (UTF-8 without BOM)
Write-Host "`n>>> [4/5] Updating version to $newVersion in package.json, tauri.conf.json, and Cargo.toml..." -ForegroundColor Yellow
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$pkgContent = [System.IO.File]::ReadAllText($pkgJsonPath)
$pkgUpdated = [regex]::Replace($pkgContent, '"version"\s*:\s*"[^"]+"', "`"version`": `"$newVersion`"", 1)
[System.IO.File]::WriteAllText($pkgJsonPath, $pkgUpdated, $utf8NoBom)

$tauriContent = [System.IO.File]::ReadAllText($tauriConfPath)
$tauriUpdated = [regex]::Replace($tauriContent, '"version"\s*:\s*"[^"]+"', "`"version`": `"$newVersion`"", 1)
[System.IO.File]::WriteAllText($tauriConfPath, $tauriUpdated, $utf8NoBom)

$cargoContent = [System.IO.File]::ReadAllText($cargoTomlPath)
$cargoUpdated = [regex]::Replace($cargoContent, '(?m)^version\s*=\s*"[^"]+"', "version = `"$newVersion`"", 1)
[System.IO.File]::WriteAllText($cargoTomlPath, $cargoUpdated, $utf8NoBom)

Write-Host "`nChanged files ready for release:" -ForegroundColor Cyan
git status -s

$confirm = (Read-Host "`nPush commit & tag '$tagName' to GitHub Actions now? (Y/N)").Trim()
if ($confirm -notin @('Y', 'y', 'YES', 'yes')) {
    Write-Host "⚠️ Aborted before git commit/push. Version files were updated locally." -ForegroundColor Yellow
    exit 0
}

# 5. Commit, push branch, and push tag to trigger GitHub Actions
Write-Host "`n>>> [5/5] Committing, pushing to GitHub, and triggering $tagName CI/CD..." -ForegroundColor Yellow
& git add -A
if ($LASTEXITCODE -ne 0) { throw "git add failed!" }

& git commit -m $commitMsg
if ($LASTEXITCODE -ne 0) { throw "git commit failed!" }

& git push origin HEAD
if ($LASTEXITCODE -ne 0) { throw "git push failed!" }

& git tag $tagName
if ($LASTEXITCODE -ne 0) { throw "git tag failed!" }

& git push origin $tagName
if ($LASTEXITCODE -ne 0) { throw "git push tag failed!" }

Write-Host "`n✅ Release $tagName triggered successfully!" -ForegroundColor Green
Write-Host "   Monitor build progress (~15-20 min):" -ForegroundColor Green
Write-Host "   https://github.com/technosoftsolution/printdrop-station/actions" -ForegroundColor White
Write-Host "`n   Once green, all Clean Retail (latest.json) and Virtual Demo (virtual-latest.json)" -ForegroundColor DarkGray
Write-Host "   stations will automatically see the v$newVersion OTA update notification!`n" -ForegroundColor DarkGray
