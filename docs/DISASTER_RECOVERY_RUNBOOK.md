# PrintDrop 3-Layer Disaster Recovery & Rollback Runbook

This runbook documents the exact procedures for **Software Providers (Admin)** and **Shopkeepers (Desktop POS)** to prevent, pause, and recover from a buggy OTA release without reinstalling the software.

---

## Layer 3: Staged Canary Rollout & Cloud Recall (Prevention First)

**Where**: Admin Web Portal (`admin-portal/index.html`) → **Settings → OTA Rollout & Rollback**

1. **Canary Release (Before Rolling Out to 100%)**:
   - Set **Staged Fleet Rollout Percentage** to `1%` (or `0% — PAUSED`) and add your test station HWIDs to **Canary Test HWIDs**.
   - Publish the release (`npm run release`). Only Canary HWIDs and the 1% bucket see the update.
   - Increase `1%` → `10%` → `50%` → `100%` only after verifying zero issues.
2. **If a Bug Is Discovered During Rollout**:
   - Immediately set **Staged Fleet Rollout Percentage** to **`0% — PAUSED`**.
   - Add the buggy version (e.g. `1.0.15`) to **Blocked / Recalled Versions** and click **Save & Publish Rollout Policy**.
   - All stations not yet updated will stop seeing the update; any station already on `1.0.15` will immediately display a red **Emergency Rollback Banner** (`Restore Previous Version Now`).

---

## Layer 2: Local Binary + DB Snapshot & Outside-App Recovery (Instant Offline Fix)

Every PrintDrop station automatically maintains a snapshot of the last known-good binary (`printdrop.exe`) and SQLite database (`printdrop.db`) before any OTA update installs (and on initial startup if missing).

### Snapshot Locations on Windows 11 / 10
- **Recovery Script**: `%APPDATA%\PrintDrop\rollback\Restore_PrintDrop.bat`
- **Previous Working Snapshot**: `%APPDATA%\PrintDrop\rollback\prev\`
  - `printdrop.exe` (previous working binary)
  - `printdrop.db` (WAL-checkpointed SQLite database & settings)
  - `metadata.json` (records `previousVersion`, `exePath`, `dbPath`, `createdAt`)
- **Start Menu Launcher**: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\PrintDrop\PrintDrop - Emergency Restore Previous Version.lnk`

### Method A: Inside the App (If UI Opens)
- Click **`Restore vX.Y.Z Now`** on the red Emergency Rollback Banner, **OR**
- Go to **Settings → `Restore Previous Version (vX.Y.Z)`**.

### Method B: Start Menu Recovery (If App Crashes on Startup)
- Open **Windows Start Menu → PrintDrop → `PrintDrop - Emergency Restore Previous Version`**.
- It stops any hung `printdrop.exe`, restores `prev\printdrop.exe`, asks whether to also restore `prev\printdrop.db` (`Y/N`, defaults to `N` after 6s), and launches PrintDrop.

### Method C: Worst-Case Manual Recovery (No Shortcut Found & App Won't Start)
Open **Command Prompt (`cmd.exe`)** or **PowerShell** (`Win + R` → `cmd` → Enter) and run:

1. **Direct Recovery Script Execution (Recommended)**:
   ```bat
   "%APPDATA%\PrintDrop\rollback\Restore_PrintDrop.bat"
   ```
   *(Or pass `--auto` to restore the previous `printdrop.exe` immediately without the database prompt:)*
   ```bat
   "%APPDATA%\PrintDrop\rollback\Restore_PrintDrop.bat" --auto
   ```

2. **Fully Manual Step-by-Step Commands (If `.bat` is missing or blocked)**:
   ```bat
   :: 1. Force-stop any stuck PrintDrop process
   taskkill /F /IM printdrop.exe

   :: 2. Check metadata.json to confirm the exact installed exePath
   type "%APPDATA%\PrintDrop\rollback\prev\metadata.json"

   :: 3. Restore previous printdrop.exe (replace <TARGET_EXE_PATH> with exePath from step 2,
   ::    typically "%LOCALAPPDATA%\PrintDrop\printdrop.exe" or "C:\Program Files\PrintDrop\printdrop.exe")
   copy /Y "%APPDATA%\PrintDrop\rollback\prev\printdrop.exe" "<TARGET_EXE_PATH>"

   :: 4. (OPTIONAL — only if a database migration caused the crash) Restore pre-update database:
   copy /Y "%APPDATA%\PrintDrop\rollback\prev\printdrop.db" "%APPDATA%\PrintDrop\printdrop.db"

   :: 5. Relaunch the restored working PrintDrop
   start "" "<TARGET_EXE_PATH>"
   ```

---

## Layer 1: Fleet-Wide Emergency Forward-Rollback (Nullify Bad OTA via GitHub)

Because Tauri's updater only installs versions with a higher SemVer (`remote > local`), you nullify a bad release (e.g. `v1.0.15`) across all online machines by publishing a higher version number (`v1.0.16`) containing the last known-good code (`v1.0.14`).

**Where**: Developer machine in `C:\Flutter_src\PrintDrop`

1. Run:
   ```powershell
   npm run rollback-release
   ```
2. Enter the **Last Known-Good Tag** (e.g. `v1.0.14`) and the **New Forward-Rollback Version** (e.g. `1.0.16`).
3. The script (`scripts/rollback-release.ps1`) automatically:
   - Restores `src/` and `src-tauri/` from the good tag
   - Bumps `package.json`, `Cargo.toml`, and `tauri.conf.json` to `1.0.16`
   - Runs `npm run build` and `cargo test`
   - Commits, tags `v1.0.16`, and pushes to GitHub Actions to publish `latest.json` and `virtual-latest.json`.
4. All online stations immediately receive the `v1.0.16` OTA update and return to the clean `v1.0.14` codebase.
