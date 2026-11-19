# PrintDrop CI/CD & OTA Update Release Guide

This guide explains how to ship any new feature, bug fix, or Admin Portal update to PrintDrop Windows stations using the automated GitHub Actions CI/CD pipeline and Tauri OTA updater.

---

## Overview

- **CI/CD Workflow**: `.github/workflows/release.yml`
- **OTA Updater Endpoint** (`src-tauri/tauri.conf.json`):
  `https://github.com/technosoftsolution/printdrop-station/releases/latest/download/latest.json`
- **Release Trigger**: Pushing a Git tag starting with `v` (e.g., `v1.0.2`).

---

## Step-by-Step Release Checklist

### Step 1: Test Locally First
Run the Rust test suite for both editions and verify the frontend build:
```powershell
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
npm run build
```

### Step 2: Bump Version in All 3 Files
Increment the version (e.g., `1.0.1` → `1.0.2`) in:
1. `package.json` (`"version"`)
2. `src-tauri/tauri.conf.json` (`"version"`)
3. `src-tauri/Cargo.toml` (`version`)

### Step 3: Commit & Push Changes
```powershell
git add .
git commit -m "release: v1.0.2 - <brief description>"
git push origin HEAD
```

### Step 4: Create & Push the Release Tag
```powershell
git tag v1.0.2
git push origin v1.0.2
```

### Step 5: Monitor GitHub Actions
1. Open the **Actions** tab in your GitHub repository (`technosoftsolution/printdrop-station`).
2. Watch the **PrintDrop Windows Release & Auto-Updater** workflow complete:
   - Tests pass for both Clean Retail and Virtual Demo editions.
   - Clean Retail `.exe`, `.sig`, and `latest.json` are published to **Releases**.
   - `PrintDrop_Demo_Station_Virtual_x64-setup.exe` is attached to the same release.

### Step 6: Update on Shopkeeper / Test Windows Machines
- **Clean Retail Edition**: Open or restart PrintDrop (or trigger Check for Updates). The Tauri updater reads `latest.json` and installs `v1.0.2` over the air.
- **Virtual Demo Edition**: Download `PrintDrop_Demo_Station_Virtual_x64-setup.exe` from the `v1.0.2` GitHub Release page and run it.

---

## Troubleshooting

- **OTA update not detected**: Confirm `version` was bumped in `src-tauri/tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml`, and that `latest.json` is present on the GitHub Release.
- **Workflow fails during signing**: Verify `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are configured in GitHub Repository Secrets.
