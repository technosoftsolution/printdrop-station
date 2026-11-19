# PrintDrop CI/CD & OTA Update Release Guide

This guide explains how to ship any new feature, bug fix, or Admin Portal update to all remote PrintDrop Windows stations using the automated GitHub Actions CI/CD pipeline and Tauri OTA auto-updater.

---

## OTA Software Updates vs. Supabase Cloud Sync

- **GitHub CI/CD + Tauri OTA (`latest.json` / `virtual-latest.json`)**: Pushes **new app code, bug fixes, and UI features** to all remote shopkeeper PCs automatically.
- **Supabase Cloud Sync (`Check Cloud Sync` / Heartbeat)**: Syncs **license status, trial days, paid upgrades, and provider contact details** — it does **not** update the desktop `.exe`.

---

## Step-by-Step Release Checklist (For 10,000+ Shopkeeper PCs)

### Step 1: Test Locally First
Run the Rust test suite for both editions and verify the frontend build:
```powershell
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
npm run build
```

### Step 2: Bump Version in All 3 Files
Increment the version (e.g., `1.0.6` → `1.0.7`) in:
1. `package.json` (`"version"`)
2. `src-tauri/tauri.conf.json` (`"version"`)
3. `src-tauri/Cargo.toml` (`version`)

### Step 3: Commit, Push & Tag
```powershell
git add .
git commit -m "release: v1.0.7 - <brief description>"
git push origin master
git tag v1.0.7
git push origin v1.0.7
```

### Step 4: Wait for GitHub Actions (~15–20 Minutes)
1. Open the **Actions** tab in `technosoftsolution/printdrop-station`.
2. Wait for the **PrintDrop Windows Release & Auto-Updater** workflow to show a green checkmark.
3. Confirm that `latest.json` (Clean Retail) and `virtual-latest.json` (Virtual Demo) are attached to the new GitHub Release.

### Step 5: Automatic Delivery to All Shopkeeper Machines
Once the GitHub Release is live, **no manual action is required from you**:
- Every shopkeeper PC automatically checks for updates **5 seconds after launching PrintDrop** (or anytime via **Settings > Check for Software Updates**):
  - **Clean Retail Edition** checks `.../releases/latest/download/latest.json`.
  - **Virtual Demo Edition (`v1.0.6+`)** checks `.../releases/latest/download/virtual-latest.json`.
- Shopkeepers see an in-app **Update Available** banner, click **Install**, and the app downloads, verifies the cryptographic signature, updates in place, and relaunches — **without disturbing their SQLite database, HWID, license, printers, or payment settings**.

---

## Troubleshooting

- **OTA update not detected**: Confirm `version` was bumped in `src-tauri/tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml`, and that `latest.json` / `virtual-latest.json` exist on the GitHub Release.
- **Signing error in CI (`incorrect updater private key password`)**: Ensure `TAURI_SIGNING_PRIVATE_KEY` contains the contents of `printdrop-updater.key` (not `printdrop-updater.key.pub`), and delete `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has no password.
