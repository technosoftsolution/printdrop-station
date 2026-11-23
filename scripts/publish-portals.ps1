# 1-Command PrintDrop Portals Publisher (GitHub Pages HTTPS)
# Usage: npm run portals:publish
param(
  [string]$Message = "deploy(portals): sync Admin & Partner Sales portals to GitHub Pages"
)

$ErrorActionPreference = "Stop"

Write-Host "`n[1/4] Running PrintDrop Regression Gate..." -ForegroundColor Cyan
npm run test:regression

Write-Host "`n[2/4] Syncing admin-portal/index.html & partner-portal/index.html -> github-pages-site/..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "github-pages-site/admin", "github-pages-site/partner" | Out-Null
Copy-Item -Force "admin-portal/index.html" "github-pages-site/admin/index.html"
Copy-Item -Force "partner-portal/index.html" "github-pages-site/partner/index.html"

Write-Host "`n[3/4] Committing changes in github-pages-site..." -ForegroundColor Cyan
git -C github-pages-site add admin/index.html partner/index.html
$diff = git -C github-pages-site diff --cached --name-only
if (-not $diff) {
  Write-Host "No portal changes to publish — GitHub Pages is already up to date." -ForegroundColor Yellow
  exit 0
}
git -C github-pages-site commit -m $Message

Write-Host "`n[4/4] Pushing to GitHub Pages..." -ForegroundColor Cyan
git -C github-pages-site push

Write-Host "`n✓ Portals published live!" -ForegroundColor Green
Write-Host "  Admin Portal   : https://technosoftsolution.github.io/printdrop-station/admin/" -ForegroundColor White
Write-Host "  Partner Portal : https://technosoftsolution.github.io/printdrop-station/partner/`n" -ForegroundColor White
