---
name: printdrop-ci-cd-ota-release
description: Step-by-step release runbook for shipping PrintDrop desktop features, bug fixes, and Admin Portal updates via GitHub Actions CI/CD and Tauri OTA auto-updater.
---

# PrintDrop CI/CD & OTA Release Runbook

Use this skill whenever you need to release a new feature or bug fix for the **PrintDrop Windows Desktop App** (Clean Retail & Virtual Demo editions) and **Admin Portal**.

## 1. Pre-Release Verification

Before bumping versions or tagging a release:
1. Run Rust unit tests for **both** editions:
   ```powershell
   cargo test --manifest-path src-tauri/Cargo.toml
   cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
   ```
2. Verify the frontend TypeScript & Vite production build:
   ```powershell
   npm run build
   ```

## 2. Bump the Version Number (Must Match in All 3 Files)

Update the semantic version (`X.Y.Z`, e.g., `1.0.2`) in all three files:
1. `package.json` → `"version": "X.Y.Z"`
2. `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
3. `src-tauri/Cargo.toml` → `version = "X.Y.Z"`

> **Important**: `tauri-plugin-updater` compares the installed app's `tauri.conf.json` version against `latest.json`. If the version is not incremented, existing stations will not detect an OTA update.

## 3. Commit, Push & Tag to Trigger CI/CD

The workflow `.github/workflows/release.yml` triggers automatically on any tag matching `v*`:

```powershell
git status
git add .
git commit -m "release: vX.Y.Z - <short summary of fix/feature>"
git push origin HEAD
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 4. What GitHub Actions Does Automatically

Once `vX.Y.Z` is pushed, `.github/workflows/release.yml` runs on `windows-latest`:
1. Installs frontend dependencies (`npm ci`).
2. Runs Cargo tests for **Clean Retail Edition** (`--no-default-features`) and **Virtual Demo Edition**.
3. Builds & signs the **Clean Retail Edition** using `TAURI_SIGNING_PRIVATE_KEY`, creates the GitHub Release `PrintDrop vX.Y.Z`, and uploads `latest.json` + `.sig` + `.exe`.
4. Builds the **Virtual Demo Edition** (`npx tauri build -f simulation`) and attaches `PrintDrop_Demo_Station_Virtual_x64-setup.exe` to the same GitHub Release.

## 5. How Stations Receive the Update

- **Clean Retail Edition stations**: Automatically check `https://github.com/technosoftsolution/printdrop-station/releases/latest/download/latest.json` via `@tauri-apps/plugin-updater` and download/install the signed update OTA.
- **Virtual Demo Edition stations**: Download `PrintDrop_Demo_Station_Virtual_x64-setup.exe` directly from the `vX.Y.Z` GitHub Release page (since `latest.json` points to the Clean Retail updater artifact).
- **Admin Portal (`admin-portal/index.html`)**: Updates immediately once pushed/deployed to hosting.
