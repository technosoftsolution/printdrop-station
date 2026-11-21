# PrintDrop Emergency Forward-Rollback Release Script (Layer 1)
# Restores code from a known-good Git tag, bumps to a higher SemVer version,
# verifies tests, and pushes to GitHub Actions so all OTA stations roll back automatically.
#
# Usage:
#   npm run rollback-release
#   powershell -ExecutionPolicy Bypass -File ./scripts/rollback-release.ps1 -DryRun

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($fullPath, $Content, $utf8NoBom)
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Red
Write-Host "  PrintDrop Emergency Forward-Rollback Release (L1)  " -ForegroundColor Red
if ($DryRun) {
    Write-Host "            [DRY-RUN SIMULATION MODE]                " -ForegroundColor Yellow
}
Write-Host "=====================================================" -ForegroundColor Red
Write-Host ""

if (-not $DryRun) {
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "Working tree has uncommitted changes. Please commit or stash them first." -ForegroundColor Yellow
        git status --short
        exit 1
    }
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

$newVersion = Read-Host "Enter NEW forward-rollback version (must be > $currentVersion, e.g. 1.0.15)"
if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must be in X.Y.Z format (e.g. 1.0.15)."
}

if ([version]$newVersion -le [version]$currentVersion) {
    throw "New forward-rollback version ($newVersion) MUST be strictly greater than current version ($currentVersion) so Tauri OTA updater accepts it."
}

$newTag = "v$newVersion"
$newTagExists = git tag -l $newTag
if ($newTagExists) {
    throw "Git tag '$newTag' already exists! Pick a higher version number."
}

Write-Host ""
Write-Host "Files that differ between HEAD and ${goodTag} (src/, src-tauri/src/, Cargo.toml, tauri.conf.json, package.json):" -ForegroundColor Cyan
git diff --stat HEAD $goodTag -- src/ src-tauri/src/ src-tauri/Cargo.toml src-tauri/tauri.conf.json package.json
Write-Host ""

if ($DryRun) {
    Write-Host "[DRY-RUN] Validation passed! No files were modified, committed, or pushed." -ForegroundColor Green
    Write-Host "[DRY-RUN] Real run would:" -ForegroundColor Gray
    Write-Host "  1. Clean & restore src/, src-tauri/src/, Cargo.toml, tauri.conf.json, package.json from $goodTag" -ForegroundColor Gray
    Write-Host "  2. Bump version to $newVersion (UTF-8 no BOM)" -ForegroundColor Gray
    Write-Host "  3. Run 'npm run build', 'cargo test', and 'cargo test --no-default-features'" -ForegroundColor Gray
    Write-Host "  4. Commit, tag $newTag, and push master + $newTag to GitHub Actions" -ForegroundColor Gray
    exit 0
}

$confirm = Read-Host "This will restore src/ & src-tauri/ from '$goodTag' and release $newTag. Continue? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

Write-Host ">>> [1/4] Clean-restoring source files from $goodTag..." -ForegroundColor Cyan
# Remove files added after $goodTag so no broken/orphaned files remain
git rm -rf --quiet src/ src-tauri/src/
git checkout $goodTag -- src/ src-tauri/src/ src-tauri/Cargo.toml src-tauri/tauri.conf.json package.json
if (git ls-tree -r --name-only $goodTag -- package-lock.json) {
    git checkout $goodTag -- package-lock.json
}

Write-Host ">>> [2/4] Bumping version to $newVersion (UTF-8 without BOM)..." -ForegroundColor Cyan
$pkgJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$pkgJson.version = $newVersion
Write-Utf8NoBom "package.json" (($pkgJson | ConvertTo-Json -Depth 10) + "`n")

$tauriConf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$tauriConf.version = $newVersion
Write-Utf8NoBom "src-tauri/tauri.conf.json" (($tauriConf | ConvertTo-Json -Depth 10) + "`n")

$cargoToml = Get-Content "src-tauri/Cargo.toml" -Raw
$cargoToml = $cargoToml -replace '(?m)^version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+"', "version = `"$newVersion`""
Write-Utf8NoBom "src-tauri/Cargo.toml" $cargoToml

Write-Host ">>> [3/4] Running Frontend Build & Dual-Edition Cargo Tests..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed!" }

cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
if ($LASTEXITCODE -ne 0) { throw "Cargo tests (Retail) failed!" }

cargo test --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "Cargo tests (Virtual) failed!" }

Write-Host ">>> [4/4] Committing, Tagging $newTag & Pushing to GitHub Actions..." -ForegroundColor Cyan
git add -A
git commit -m "chore(rollback): emergency forward-rollback to $goodTag baseline as $newTag"
git tag $newTag
git push origin master
git push origin $newTag

Write-Host ""
Write-Host "✓ Emergency rollback $newTag pushed! GitHub Actions will publish OTA shortly." -ForegroundColor Green
