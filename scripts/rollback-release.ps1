# PrintDrop Emergency Forward-Rollback Release Script (Layer 1)
# Restores code from a known-good Git tag, bumps to a higher SemVer version,
# verifies tests, and pushes to GitHub Actions so all OTA stations roll back automatically.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Red
Write-Host "  PrintDrop Emergency Forward-Rollback Release (L1)  " -ForegroundColor Red
Write-Host "=====================================================" -ForegroundColor Red
Write-Host ""

$dirty = git status --porcelain
if ($dirty) {
    Write-Host "Working tree has uncommitted changes. Please commit or stash them first." -ForegroundColor Yellow
    git status --short
    exit 1
}

Write-Host "Recent release tags:" -ForegroundColor Cyan
git tag -l "v*" --sort=-v:refname | Select-Object -First 8
Write-Host ""

$goodTag = Read-Host "Enter the LAST KNOWN-GOOD tag to restore (e.g. v1.0.12)"
if ([string]::IsNullOrWhiteSpace($goodTag)) { throw "Tag is required." }

$tagExists = git tag -l $goodTag
if (-not $tagExists) { throw "Tag '$goodTag' not found in repository." }

$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$currentVersion = $pkg.version
Write-Host "Current version in package.json: $currentVersion" -ForegroundColor Gray

$newVersion = Read-Host "Enter NEW forward-rollback version (must be > $currentVersion, e.g. 1.0.14)"
if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must be in X.Y.Z format (e.g. 1.0.14)."
}

$confirm = Read-Host "This will restore src/ & src-tauri/ from '$goodTag' and release v$newVersion. Continue? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

Write-Host ">>> [1/4] Restoring source files from $goodTag..." -ForegroundColor Cyan
git checkout $goodTag -- src/ src-tauri/src/ src-tauri/Cargo.toml src-tauri/tauri.conf.json

Write-Host ">>> [2/4] Bumping version to $newVersion..." -ForegroundColor Cyan
$pkgJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$pkgJson.version = $newVersion
$pkgJson | ConvertTo-Json -Depth 10 | Set-Content "package.json" -Encoding UTF8

$tauriConf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$tauriConf.version = $newVersion
$tauriConf | ConvertTo-Json -Depth 10 | Set-Content "src-tauri/tauri.conf.json" -Encoding UTF8

$cargoToml = Get-Content "src-tauri/Cargo.toml" -Raw
$cargoToml = $cargoToml -replace '(?m)^version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+"', "version = `"$newVersion`""
Set-Content "src-tauri/Cargo.toml" $cargoToml -Encoding UTF8

Write-Host ">>> [3/4] Running Frontend Build & Cargo Tests..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed!" }

cargo test --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "Cargo tests failed!" }

Write-Host ">>> [4/4] Committing, Tagging v$newVersion & Pushing to GitHub Actions..." -ForegroundColor Cyan
git add -A
git commit -m "chore(rollback): emergency forward-rollback to $goodTag baseline as v$newVersion"
git tag "v$newVersion"
git push origin master
git push origin "v$newVersion"

Write-Host ""
Write-Host "✓ Emergency rollback v$newVersion pushed! GitHub Actions will publish OTA shortly." -ForegroundColor Green
