use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tracing::info;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use super::crypto::{decrypt_backup_payload, encrypt_backup_payload};
use super::manifest::BackupManifest;

/// Creates an encrypted system backup archive (.pdropbak)
pub fn create_encrypted_backup(
    src_conn: &mut Connection,
    target_path: &Path,
    password: &str,
    include_documents: bool,
    storage_dir: &Path,
) -> Result<BackupManifest, Box<dyn std::error::Error>> {
    let temp_dir = std::env::temp_dir().join(format!("printdrop_backup_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir)?;

    let temp_db_path = temp_dir.join("database.db");

    // 1. Perform atomic SQLite online backup
    {
        let mut backup_conn = Connection::open(&temp_db_path)?;
        let backup = rusqlite::backup::Backup::new(src_conn, &mut backup_conn)?;
        backup.run_to_completion(100, std::time::Duration::from_millis(10), None)?;
    }

    // 2. Compute SHA-256 hash of backed-up SQLite file
    let mut db_bytes = Vec::new();
    {
        let mut file = File::open(&temp_db_path)?;
        file.read_to_end(&mut db_bytes)?;
    }
    let mut hasher = Sha256::new();
    hasher.update(&db_bytes);
    let db_hash = hex::encode(hasher.finalize());

    // 3. Query high-level stats for manifest
    let total_orders: i64 = src_conn.query_row("SELECT count(*) FROM orders", [], |r| r.get(0)).unwrap_or(0);
    let completed_orders: i64 = src_conn.query_row("SELECT count(*) FROM orders WHERE status = 'COMPLETED'", [], |r| r.get(0)).unwrap_or(0);
    let total_revenue: f64 = src_conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status = 'PAID'",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let total_cash: f64 = src_conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status = 'PAID' AND payment_method = 'CASH'",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let total_upi: f64 = src_conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status = 'PAID' AND payment_method = 'ONLINE'",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let total_credit: f64 = src_conn.query_row(
        "SELECT coalesce(sum(total_amount), 0.0) FROM order_billings WHERE payment_status IN ('UNPAID', 'CREDIT')",
        [],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let corporate_count: i64 = src_conn.query_row("SELECT count(*) FROM corporate_clients", [], |r| r.get(0)).unwrap_or(0);

    let machine_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PrintDrop Host".to_string());

    let manifest = BackupManifest {
        backup_version: "1.0".to_string(),
        created_at: chrono::Local::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        machine_name,
        total_orders_count: total_orders as usize,
        completed_orders_count: completed_orders as usize,
        total_revenue,
        total_cash,
        total_upi,
        total_credit_due: total_credit,
        corporate_clients_count: corporate_count as usize,
        includes_documents: include_documents,
        database_sha256: db_hash,
    };

    let manifest_json = serde_json::to_vec_pretty(&manifest)?;

    // 4. Construct in-memory ZIP package
    let mut zip_buffer = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut zip_buffer);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // A. Add manifest.json
        zip.start_file("manifest.json", options)?;
        zip.write_all(&manifest_json)?;

        // B. Add database.db
        zip.start_file("database.db", options)?;
        zip.write_all(&db_bytes)?;

        // C. Optionally add verified document files
        if include_documents {
            let verified_dir = storage_dir.join("verified");
            if verified_dir.exists() {
                if let Ok(entries) = fs::read_dir(&verified_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                                if let Ok(doc_bytes) = fs::read(&path) {
                                    zip.start_file(format!("documents/{}", file_name), options)?;
                                    zip.write_all(&doc_bytes)?;
                                }
                            }
                        }
                    }
                }
            }
        }

        zip.finish()?;
    }

    let raw_zip_bytes = zip_buffer.into_inner();

    // 5. Encrypt zip bytes with AES-256-GCM + PBKDF2
    let encrypted_payload = encrypt_backup_payload(&raw_zip_bytes, password)
        .map_err(|e| format!("Cryptographic encryption failed: {}", e))?;

    // 6. Write final .pdropbak file
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target_path, encrypted_payload)?;

    // 7. Cleanup temp dir
    let _ = fs::remove_dir_all(&temp_dir);

    info!("PrintDrop encrypted backup saved successfully to: {:?}", target_path);

    Ok(manifest)
}

/// Inspects and decrypts an encrypted backup archive to preview its manifest without altering database
pub fn inspect_encrypted_backup(
    file_path: &Path,
    password: &str,
) -> Result<BackupManifest, Box<dyn std::error::Error>> {
    let encrypted_bytes = fs::read(file_path)?;

    // Decrypt payload
    let decrypted_zip = decrypt_backup_payload(&encrypted_bytes, password)
        .map_err(|e| format!("{}", e))?;

    let cursor = Cursor::new(decrypted_zip);
    let mut zip = ZipArchive::new(cursor)?;

    let mut manifest_file = zip.by_name("manifest.json")
        .map_err(|_| "Invalid backup archive: manifest.json is missing")?;

    let mut manifest_str = String::new();
    manifest_file.read_to_string(&mut manifest_str)?;

    let manifest: BackupManifest = serde_json::from_str(&manifest_str)?;
    Ok(manifest)
}

/// Restores an encrypted backup archive into the active database with an automatic pre-restore safety rollback checkpoint
pub fn restore_encrypted_backup(
    file_path: &Path,
    password: &str,
    live_db_path: &Path,
    storage_dir: &Path,
    active_conn: &mut Connection,
) -> Result<BackupManifest, Box<dyn std::error::Error>> {
    let encrypted_bytes = fs::read(file_path)?;

    // 1. Decrypt payload
    let decrypted_zip = decrypt_backup_payload(&encrypted_bytes, password)
        .map_err(|e| format!("{}", e))?;

    let cursor = Cursor::new(decrypted_zip);
    let mut zip = ZipArchive::new(cursor)?;

    // 2. Extract and parse manifest.json
    let manifest: BackupManifest = {
        let mut manifest_file = zip.by_name("manifest.json")
            .map_err(|_| "Backup file is missing manifest.json")?;
        let mut s = String::new();
        manifest_file.read_to_string(&mut s)?;
        serde_json::from_str(&s)?
    };

    // 3. Extract database.db to temp file
    let temp_restore_dir = std::env::temp_dir().join(format!("printdrop_restore_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_restore_dir)?;
    let temp_db_file = temp_restore_dir.join("restored.db");

    {
        let mut db_file = zip.by_name("database.db")
            .map_err(|_| "Backup file is missing database.db")?;
        let mut out_file = File::create(&temp_db_file)?;
        std::io::copy(&mut db_file, &mut out_file)?;
    }

    // 4. Verify integrity of extracted SQLite database
    {
        let test_conn = Connection::open(&temp_db_file)?;
        let integrity_check: String = test_conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if integrity_check != "ok" {
            let _ = fs::remove_dir_all(&temp_restore_dir);
            return Err(format!("Restored database failed integrity check: {}", integrity_check).into());
        }
    }

    // 5. CRITICAL SAFETY CHECKPOINT: Create pre-restore safety rollback snapshot of current live database
    let db_parent = live_db_path.parent().unwrap_or_else(|| Path::new("."));
    let timestamp_tag = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let safety_snapshot_path = db_parent.join(format!("safety_snapshot_before_restore_{}.db", timestamp_tag));

    {
        let mut safety_conn = Connection::open(&safety_snapshot_path)?;
        let backup = rusqlite::backup::Backup::new(active_conn, &mut safety_conn)?;
        backup.run_to_completion(100, std::time::Duration::from_millis(10), None)?;
        info!("Created pre-restore safety snapshot at: {:?}", safety_snapshot_path);
    }

    // 6. Overwrite active database using SQLite backup API (zero file-locking errors)
    {
        let restored_conn = Connection::open(&temp_db_file)?;
        let backup = rusqlite::backup::Backup::new(&restored_conn, active_conn)?;
        backup.run_to_completion(100, std::time::Duration::from_millis(10), None)?;
        info!("Active SQLite database successfully overwritten with restored data.");
    }

    // 7. Optionally restore document files if present in zip
    let verified_dir = storage_dir.join("verified");
    fs::create_dir_all(&verified_dir)?;

    for i in 0..zip.len() {
        let mut file = zip.by_index(i)?;
        let name = file.name().to_string();
        if name.starts_with("documents/") && !file.is_dir() {
            if let Some(clean_name) = Path::new(&name).file_name() {
                let dest = verified_dir.join(clean_name);
                let mut out = File::create(&dest)?;
                std::io::copy(&mut file, &mut out)?;
            }
        }
    }

    // 8. Cleanup temp files
    let _ = fs::remove_dir_all(&temp_restore_dir);

    Ok(manifest)
}

/// Rolls back to the latest safety snapshot if one exists
pub fn rollback_safety_snapshot(
    live_db_path: &Path,
    active_conn: &mut Connection,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let db_parent = live_db_path.parent().unwrap_or_else(|| Path::new("."));
    let mut snapshots = Vec::new();

    if let Ok(entries) = fs::read_dir(db_parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("safety_snapshot_before_restore_") && name.ends_with(".db") {
                    snapshots.push(path);
                }
            }
        }
    }

    snapshots.sort_by(|a, b| b.cmp(a)); // Latest first

    let latest = snapshots.first()
        .ok_or("No safety rollback snapshot found")?;

    let snap_conn = Connection::open(latest)?;
    let backup = rusqlite::backup::Backup::new(&snap_conn, active_conn)?;
    backup.run_to_completion(100, std::time::Duration::from_millis(10), None)?;

    info!("Successfully rolled back database to safety snapshot: {:?}", latest);
    Ok(latest.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    #[test]
    fn test_backup_and_restore_lifecycle() {
        let temp_dir = std::env::temp_dir().join(format!("printdrop_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();

        let live_db_path = temp_dir.join("live.db");
        let backup_file = temp_dir.join("test_backup.pdropbak");
        let storage_dir = temp_dir.join("storage");
        fs::create_dir_all(&storage_dir).unwrap();

        let mut conn = Connection::open(&live_db_path).unwrap();
        let migrations = migrations::get_migrations();
        migrations.to_latest(&mut conn).unwrap();

        // Seed sample order
        conn.execute(
            "INSERT INTO transfer_sessions (id, token, lan_ip, port, status, expires_at)
             VALUES ('sess-bk', 'token-bk', '127.0.0.1', 8080, 'ACTIVE', datetime('now', '+1 hour'))",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO orders (id, session_id, current_revision_number, status, customer_name, pickup_code)
             VALUES ('ord-bk-1', 'sess-bk', 1, 'COMPLETED', 'Backup Test User', '9999')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO order_billings (id, order_id, subtotal, total_amount, payment_status, payment_method, billing_details_json)
             VALUES ('bill-bk-1', 'ord-bk-1', 50.0, 50.0, 'PAID', 'CASH', '{}')",
            [],
        ).unwrap();

        let password = "SecureBackupPassword!2026";

        // 1. Create encrypted backup
        let manifest = create_encrypted_backup(
            &mut conn,
            &backup_file,
            password,
            false,
            &storage_dir,
        ).expect("Failed to create encrypted backup");

        assert_eq!(manifest.total_orders_count, 1);
        assert_eq!(manifest.completed_orders_count, 1);
        assert_eq!(manifest.total_revenue, 50.0);
        assert_eq!(manifest.total_cash, 50.0);
        assert!(backup_file.exists());

        // 2. Inspect manifest with password
        let preview = inspect_encrypted_backup(&backup_file, password)
            .expect("Failed to inspect backup");
        assert_eq!(preview.total_orders_count, 1);
        assert_eq!(preview.database_sha256, manifest.database_sha256);

        // Inspect with wrong password MUST fail
        let wrong_pw = inspect_encrypted_backup(&backup_file, "WrongPass");
        assert!(wrong_pw.is_err());

        // 3. Mutate live database to simulate data loss
        conn.execute("DELETE FROM orders", []).unwrap();
        conn.execute("DELETE FROM order_billings", []).unwrap();
        let count_after_delete: i64 = conn.query_row("SELECT count(*) FROM orders", [], |r| r.get(0)).unwrap();
        assert_eq!(count_after_delete, 0);

        // 4. Restore from backup
        let restored_manifest = restore_encrypted_backup(
            &backup_file,
            password,
            &live_db_path,
            &storage_dir,
            &mut conn,
        ).expect("Failed to restore backup");

        assert_eq!(restored_manifest.total_orders_count, 1);

        // Verify data was restored
        let restored_count: i64 = conn.query_row("SELECT count(*) FROM orders WHERE id = 'ord-bk-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(restored_count, 1);

        let restored_name: String = conn.query_row("SELECT customer_name FROM orders WHERE id = 'ord-bk-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(restored_name, "Backup Test User");

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }
}

