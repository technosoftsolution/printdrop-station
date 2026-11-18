use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::info;

use crate::db::Database;
use super::archive::{create_encrypted_backup, inspect_encrypted_backup, restore_encrypted_backup, rollback_safety_snapshot};
use super::excel_export::generate_financial_excel_report;
use super::manifest::{BackupConfig, BackupFileInfo, BackupManifest, BackupResult};

pub struct BackupManager {
    db: Arc<Database>,
    live_db_path: PathBuf,
    storage_dir: PathBuf,
}

impl BackupManager {
    pub fn new(db: Arc<Database>, live_db_path: PathBuf, storage_dir: PathBuf) -> Self {
        Self {
            db,
            live_db_path,
            storage_dir,
        }
    }

    pub fn get_config(&self) -> BackupConfig {
        let custom_path = self.db.get_config("backup_custom_path").ok().flatten();
        let auto_daily = self.db.get_config("backup_auto_daily")
            .ok()
            .flatten()
            .map(|v| v == "true" || v == "1")
            .unwrap_or(true);
        let auto_time = self.db.get_config("backup_auto_time")
            .ok()
            .flatten()
            .unwrap_or_else(|| "21:00".to_string());
        let auto_pw = self.db.get_config("backup_auto_password").ok().flatten();
        let retention = self.db.get_config("backup_retention_count")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(10);
        let last_at = self.db.get_config("backup_last_time").ok().flatten();
        let last_file = self.db.get_config("backup_last_file").ok().flatten();

        BackupConfig {
            custom_backup_path: custom_path,
            auto_backup_daily: auto_daily,
            auto_backup_time: auto_time,
            auto_backup_password: auto_pw,
            retention_count: retention,
            last_backup_at: last_at,
            last_backup_file: last_file,
        }
    }

    pub fn save_config(&self, config: &BackupConfig) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(ref path) = config.custom_backup_path {
            self.db.set_config("backup_custom_path", path)?;
        } else {
            self.db.set_config("backup_custom_path", "")?;
        }
        self.db.set_config("backup_auto_daily", if config.auto_backup_daily { "true" } else { "false" })?;
        self.db.set_config("backup_auto_time", if config.auto_backup_time.trim().is_empty() { "21:00" } else { config.auto_backup_time.trim() })?;
        if let Some(ref pw) = config.auto_backup_password {
            if !pw.trim().is_empty() {
                self.db.set_config("backup_auto_password", pw.trim())?;
            }
        }
        self.db.set_config("backup_retention_count", &config.retention_count.to_string())?;
        Ok(())
    }

    /// Evaluates scheduled daily backup time against system clock.
    /// Triggers an automated encrypted backup if time threshold is reached and no backup has run today.
    pub fn check_and_run_scheduled_backup(&self) -> Result<Option<BackupResult>, Box<dyn std::error::Error>> {
        let config = self.get_config();
        if !config.auto_backup_daily {
            return Ok(None);
        }

        let pw = match config.auto_backup_password {
            Some(ref p) if !p.trim().is_empty() => p.clone(),
            _ => return Ok(None),
        };

        let now = chrono::Local::now();
        let current_time_str = now.format("%H:%M").to_string();
        let today_date_str = now.format("%Y-%m-%d").to_string();

        let target_time = if config.auto_backup_time.trim().is_empty() {
            "21:00"
        } else {
            config.auto_backup_time.trim()
        };

        let last_auto_date = self.db.get_config("backup_last_auto_date").ok().flatten();
        if last_auto_date.as_deref() == Some(&today_date_str) {
            return Ok(None); // Already completed for today
        }

        if current_time_str.as_str() >= target_time {
            info!("Automated Daily Backup: Time threshold reached ({} >= {}). Generating silent snapshot...", current_time_str, target_time);
            let result = self.create_backup(&pw, false, None)?;
            let _ = self.db.set_config("backup_last_auto_date", &today_date_str);
            info!("Automated Daily Backup completed: {:?}", result.file_name);
            return Ok(Some(result));
        }

        Ok(None)
    }

    pub fn resolve_backup_dir(&self, override_path: Option<&str>) -> PathBuf {
        if let Some(p) = override_path {
            if !p.trim().is_empty() {
                return PathBuf::from(p.trim());
            }
        }

        let config = self.get_config();
        if let Some(ref p) = config.custom_backup_path {
            if !p.trim().is_empty() {
                let path = PathBuf::from(p.trim());
                if path.exists() || fs::create_dir_all(&path).is_ok() {
                    return path;
                }
            }
        }

        let default_dir = self.live_db_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("backups");
        let _ = fs::create_dir_all(&default_dir);
        default_dir
    }

    pub fn create_backup(
        &self,
        password: &str,
        include_documents: bool,
        custom_path: Option<String>,
    ) -> Result<BackupResult, Box<dyn std::error::Error>> {
        let backup_dir = self.resolve_backup_dir(custom_path.as_deref());
        fs::create_dir_all(&backup_dir)?;

        let timestamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
        let file_name = format!("PrintDrop_Backup_{}.pdropbak", timestamp);
        let target_path = backup_dir.join(&file_name);

        let manifest = self.db.with_conn(|conn| {
            create_encrypted_backup(
                conn,
                &target_path,
                password,
                include_documents,
                &self.storage_dir,
            )
        })?;

        let file_size_bytes = fs::metadata(&target_path)
            .map(|m| m.len())
            .unwrap_or(0);

        // Update last backup records in app_config
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let _ = self.db.set_config("backup_last_time", &now_str);
        let _ = self.db.set_config("backup_last_file", &target_path.to_string_lossy());

        // Enforce retention policy
        self.enforce_retention_policy(&backup_dir);

        Ok(BackupResult {
            file_path: target_path.to_string_lossy().to_string(),
            file_name,
            file_size_bytes,
            manifest,
        })
    }

    pub fn export_excel(
        &self,
        password: &str,
        custom_path: Option<String>,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let backup_dir = self.resolve_backup_dir(custom_path.as_deref());
        fs::create_dir_all(&backup_dir)?;

        let timestamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
        let file_name = format!("PrintDrop_Financial_Ledger_{}.xlsx", timestamp);
        let target_path = backup_dir.join(&file_name);

        let saved_path = self.db.with_conn(|conn| {
            generate_financial_excel_report(conn, &target_path, password)
        })?;

        // Reveal in explorer
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", target_path.display()))
                .spawn();
        }

        Ok(saved_path)
    }

    pub fn preview_backup(&self, file_path: &str, password: &str) -> Result<BackupManifest, Box<dyn std::error::Error>> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err("Backup file does not exist on disk".into());
        }
        inspect_encrypted_backup(path, password)
    }

    pub fn restore_backup(&self, file_path: &str, password: &str) -> Result<BackupManifest, Box<dyn std::error::Error>> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err("Selected backup file does not exist".into());
        }

        self.db.with_conn(|conn| {
            restore_encrypted_backup(
                path,
                password,
                &self.live_db_path,
                &self.storage_dir,
                conn,
            )
        })
    }

    pub fn rollback_safety_snapshot(&self) -> Result<String, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let path = rollback_safety_snapshot(&self.live_db_path, conn)?;
            Ok(path.to_string_lossy().to_string())
        })
    }

    pub fn list_existing_backups(&self) -> Vec<BackupFileInfo> {
        let backup_dir = self.resolve_backup_dir(None);
        let mut results = Vec::new();

        if let Ok(entries) = fs::read_dir(&backup_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if ext == "pdropbak" || ext == "xlsx" {
                        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        let created_at = entry.metadata()
                            .and_then(|m| m.created().or_else(|_| m.modified()))
                            .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M:%S").to_string())
                            .unwrap_or_else(|_| "Unknown".to_string());

                        results.push(BackupFileInfo {
                            file_name: name,
                            file_path: path.to_string_lossy().to_string(),
                            file_size_bytes: size,
                            created_at,
                            is_excel: ext == "xlsx",
                        });
                    }
                }
            }
        }

        results.sort_by(|a, b| b.file_name.cmp(&a.file_name)); // Latest first
        results
    }

    pub fn pick_backup_folder(&self) -> Option<String> {
        rfd::FileDialog::new()
            .set_title("Select PrintDrop Backup Destination Folder")
            .pick_folder()
            .map(|p| p.to_string_lossy().to_string())
    }

    pub fn pick_backup_file(&self) -> Option<String> {
        rfd::FileDialog::new()
            .set_title("Select PrintDrop Encrypted Backup File (.pdropbak)")
            .add_filter("PrintDrop Backup (*.pdropbak)", &["pdropbak"])
            .pick_file()
            .map(|p| p.to_string_lossy().to_string())
    }

    fn enforce_retention_policy(&self, backup_dir: &Path) {
        let config = self.get_config();
        let limit = config.retention_count;
        if limit == 0 {
            return;
        }

        let mut pdropbak_files = Vec::new();
        if let Ok(entries) = fs::read_dir(backup_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("pdropbak") {
                    if let Ok(meta) = entry.metadata() {
                        let mod_time = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                        pdropbak_files.push((path, mod_time));
                    }
                }
            }
        }

        // Sort latest first
        pdropbak_files.sort_by(|a, b| b.1.cmp(&a.1));

        if pdropbak_files.len() > limit {
            for (old_path, _) in pdropbak_files.into_iter().skip(limit) {
                let _ = fs::remove_file(&old_path);
                info!("Cleaned up old backup exceeding retention limit: {:?}", old_path);
            }
        }
    }

    /// Exports all shopkeeper configuration settings (app_config) as a portable JSON file,
    /// excluding machine-specific cloud sync timestamps, orders, and hardware license bindings.
    pub fn export_config_json_to_path(&self, dest_path: &Path) -> Result<usize, Box<dyn std::error::Error>> {
        let mut config_map = serde_json::Map::new();
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT key, value FROM app_config ORDER BY key ASC")?;
            let rows = stmt.query_map([], |row| {
                let k: String = row.get(0)?;
                let v: String = row.get(1)?;
                Ok((k, v))
            })?;
            for row in rows {
                let (k, v) = row?;
                if k == "cloud_license_last_sync" || k == "backup_last_at" || k == "backup_last_file" {
                    continue;
                }
                config_map.insert(k, serde_json::Value::String(v));
            }
            Ok(())
        })?;

        let count = config_map.len();
        let payload = serde_json::json!({
            "backupType": "PRINTDROP_SHOP_CONFIG",
            "version": "1.0.0",
            "exportedAt": chrono::Utc::now().to_rfc3339(),
            "keyCount": count,
            "config": config_map
        });

        let json_str = serde_json::to_string_pretty(&payload)?;
        fs::write(dest_path, json_str)?;
        info!("Exported {} shop configuration keys to {:?}", count, dest_path);
        Ok(count)
    }

    /// Imports shopkeeper configuration settings from a portable JSON file into app_config.
    pub fn import_config_json_from_path(&self, src_path: &Path) -> Result<usize, Box<dyn std::error::Error>> {
        let raw = fs::read_to_string(src_path)?;
        let parsed: serde_json::Value = serde_json::from_str(&raw)?;
        let btype = parsed.get("backupType").and_then(|v| v.as_str()).unwrap_or("");
        if btype != "PRINTDROP_SHOP_CONFIG" {
            return Err("Invalid configuration backup file (expected PRINTDROP_SHOP_CONFIG).".into());
        }
        let config_obj = parsed
            .get("config")
            .and_then(|v| v.as_object())
            .ok_or("Missing 'config' object in backup file.")?;

        let mut restored = 0usize;
        self.db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            for (k, v) in config_obj {
                if let Some(val_str) = v.as_str() {
                    tx.execute(
                        "INSERT INTO app_config (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
                        rusqlite::params![k, val_str],
                    )?;
                    restored += 1;
                }
            }
            tx.commit()?;
            Ok(())
        })?;

        info!("Restored {} shop configuration keys from {:?}", restored, src_path);
        Ok(restored)
    }

    pub fn export_config_backup(&self) -> Result<(String, usize), Box<dyn std::error::Error>> {
        let default_name = format!(
            "PrintDrop_ShopConfig_{}.json",
            chrono::Local::now().format("%Y-%m-%d")
        );
        let picked = rfd::FileDialog::new()
            .set_title("Save 1-Click Shop Configuration Backup")
            .set_file_name(&default_name)
            .add_filter("PrintDrop Config (*.json)", &["json"])
            .save_file()
            .ok_or("Export cancelled.")?;
        let count = self.export_config_json_to_path(&picked)?;
        Ok((picked.to_string_lossy().to_string(), count))
    }

    pub fn import_config_backup(&self) -> Result<usize, Box<dyn std::error::Error>> {
        let picked = rfd::FileDialog::new()
            .set_title("Select Shop Configuration Backup (.json)")
            .add_filter("PrintDrop Config (*.json)", &["json"])
            .pick_file()
            .ok_or("Import cancelled.")?;
        self.import_config_json_from_path(&picked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_export_import_roundtrip() {
        let db1 = Arc::new(Database::new_in_memory().unwrap());
        db1.set_config("shop_upi_id", "testshop@okaxis").unwrap();
        db1.set_config("bw_rate_per_page", "2.5").unwrap();
        let mgr1 = BackupManager::new(db1, PathBuf::from("db1.sqlite"), PathBuf::from("storage1"));

        let tmp = std::env::temp_dir().join(format!("pd_cfg_test_{}.json", uuid::Uuid::new_v4()));
        let exported = mgr1.export_config_json_to_path(&tmp).unwrap();
        assert!(exported >= 2);

        let db2 = Arc::new(Database::new_in_memory().unwrap());
        let mgr2 = BackupManager::new(db2.clone(), PathBuf::from("db2.sqlite"), PathBuf::from("storage2"));
        let imported = mgr2.import_config_json_from_path(&tmp).unwrap();
        assert_eq!(imported, exported);
        assert_eq!(db2.get_config("shop_upi_id").unwrap().as_deref(), Some("testshop@okaxis"));
        assert_eq!(db2.get_config("bw_rate_per_page").unwrap().as_deref(), Some("2.5"));

        let _ = fs::remove_file(&tmp);
    }
}
