---
name: printdrop-ci-cd-ota-release
description: Step-by-step release runbook for shipping PrintDrop desktop features, bug fixes, and Admin Portal updates via GitHub Actions CI/CD and Tauri OTA auto-updater.
---

# PrintDrop CI/CD & OTA Release Runbook

Use this skill whenever you need to release a new feature or bug fix for the **PrintDrop Windows Desktop App** (Clean Retail & Virtual Demo editions) and **Admin Portal**.

## Software OTA vs. Supabase Cloud Sync (Two Separate Systems)

- **GitHub CI/CD + Tauri OTA (`latest.json` / `virtual-latest.json`)**: Delivers **application code & UI updates** to all remote shopkeeper PCs without disturbing their SQLite database, HWID, license, or printer setup.
- **Supabase Cloud Sync (`Check Cloud Sync` / Heartbeat)**: Syncs **license state, trial days, commercial upgrades, and provider contact profile** — it does **not** update `.exe` binaries.

## 1. Pre-Release Verification

Before bumping versions or tagging a release:
1. Run Rust unit tests for **both** editions:
   ```powershell
   cargo test --manifest-path src-tauri/Cargo.toml
   cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
   ```
   *(Note: `test_live_supabase_heartbeat_sync` skips automatically when `CI` is set so GitHub Actions runners never register dummy HWIDs in Supabase.)*
2. Verify the frontend TypeScript & Vite production build:
   ```powershell
   npm run build
   ```

## 2. Bump the Version Number (Must Match in All 3 Files)

Update the semantic version (`X.Y.Z`, e.g., `1.0.7`) in all three files:
1. `package.json` → `"version": "X.Y.Z"`
2. `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
3. `src-tauri/Cargo.toml` → `version = "X.Y.Z"`

> **Important**: `tauri-plugin-updater` compares the installed app's `tauri.conf.json` version against the remote manifest. If the version is not incremented, existing stations will not detect an OTA update.

## 3. Commit, Push & Tag to Trigger CI/CD

The workflow `.github/workflows/release.yml` triggers automatically on any tag matching `v*`:

```powershell
git add .
git commit -m "release: vX.Y.Z - <short summary of fix/feature>"
git push origin master
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 4. What GitHub Actions Does Automatically

Once `vX.Y.Z` is pushed, `.github/workflows/release.yml` runs on `windows-latest`:
1. Downloads `cloudflared.exe` and copies `SumatraPDF-settings.txt` into `src-tauri/bin/` (since large/local binaries are `.gitignore`d).
2. Runs Cargo tests for **Clean Retail Edition** (`--no-default-features`) and **Virtual Demo Edition**.
3. Builds & signs the **Clean Retail Edition** (`--ignore-version-mismatches -- --no-default-features`) using `TAURI_SIGNING_PRIVATE_KEY`, creates GitHub Release `PrintDrop vX.Y.Z`, and uploads `latest.json` + `.sig` + `.exe`.
4. Updates `plugins.updater.endpoints` to `virtual-latest.json` in CI, builds the **Virtual Demo Edition** (`npx tauri build -f simulation --ignore-version-mismatches`), generates `virtual-latest.json` from its `.sig`, and attaches `PrintDrop_Demo_Station_Virtual_x64-setup.exe` + `virtual-latest.json` to the same GitHub Release.

## 5. How Remote Shopkeeper Machines Receive the Update

- **Clean Retail Edition stations**: Automatically check `https://github.com/technosoftsolution/printdrop-station/releases/latest/download/latest.json` 5 seconds after startup (or via **Settings > Check for Software Updates**).
- **Virtual Demo Edition stations (`v1.0.6+`)**: Automatically check `https://github.com/technosoftsolution/printdrop-station/releases/latest/download/virtual-latest.json` 5 seconds after startup (or via **Settings > Check for Software Updates**).
- **Zero Data Loss**: `downloadAndInstall()` verifies the cryptographic signature, upgrades the app binary in place, and relaunches without touching SQLite data, HWID, printers, or payment settings.

## 6. Required GitHub Secrets

- `TAURI_SIGNING_PRIVATE_KEY`: Full contents of `C:\Users\satis\.tauri\printdrop-updater.key` (the private key, **not** `.key.pub`).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Only set if the private key was encrypted with a password; omit/delete if the key has no password.
