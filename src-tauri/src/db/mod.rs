pub mod migrations;

use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::info;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error>> {
        let mut conn = Connection::open(path)?;
        
        // Optimize for performance & concurrency
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;

        let migrations = migrations::get_migrations();
        migrations.to_latest(&mut conn)?;

        // Upgrade legacy schema if orders table CHECK constraint lacks PURGED_BY_CUSTOMER
        let needs_upgrade: bool = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'",
                [],
                |row| {
                    let sql: String = row.get(0)?;
                    Ok(!sql.contains("PURGED_BY_CUSTOMER"))
                },
            )
            .unwrap_or(false);

        if needs_upgrade {
            info!("Upgrading orders schema: Adding PURGED_BY_CUSTOMER to status CHECK constraint...");
            conn.pragma_update(None, "foreign_keys", "OFF")?;
            conn.execute_batch(r#"
                CREATE TABLE orders_upgrade_v2 (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    current_revision_number INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL CHECK(status IN (
                        'UPLOADING', 'RECEIVED', 'AWAITING_APPROVAL', 
                        'APPROVED', 'PREPARING', 'PRINTING', 
                        'COMPLETED', 'FAILED', 'UNCERTAIN', 'REJECTED', 'CANCELLED', 'PURGED_BY_CUSTOMER'
                    )),
                    customer_notes TEXT,
                    customer_name TEXT,
                    device_model TEXT,
                    device_token TEXT,
                    pickup_code TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES transfer_sessions(id) ON DELETE CASCADE
                );
                INSERT INTO orders_upgrade_v2 (id, session_id, current_revision_number, status, customer_notes, created_at, updated_at)
                    SELECT id, session_id, current_revision_number, status, customer_notes, created_at, updated_at FROM orders;
                DROP TABLE orders;
                ALTER TABLE orders_upgrade_v2 RENAME TO orders;
                CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
                CREATE INDEX IF NOT EXISTS idx_orders_device_token ON orders(device_token);
                CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code);
            "#)?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            info!("Orders table successfully upgraded with PURGED_BY_CUSTOMER status.");
        }

        // Check if customer_name and device fields exist in orders table
        let columns: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(orders)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        if !columns.contains(&"customer_name".to_string()) {
            info!("Adding customer_name, device_model, device_token, pickup_code columns to orders table...");
            conn.execute_batch(r#"
                ALTER TABLE orders ADD COLUMN customer_name TEXT;
                ALTER TABLE orders ADD COLUMN device_model TEXT;
                ALTER TABLE orders ADD COLUMN device_token TEXT;
                ALTER TABLE orders ADD COLUMN pickup_code TEXT;
                CREATE INDEX IF NOT EXISTS idx_orders_device_token ON orders(device_token);
                CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code);
            "#)?;
            info!("Orders table successfully updated with customer and device tracking columns.");
        }

        if !columns.contains(&"corporate_client_id".to_string()) {
            info!("Ensuring corporate_client_id and corporate_person_name columns on orders table...");
            let _ = conn.execute_batch(r#"
                ALTER TABLE orders ADD COLUMN corporate_client_id TEXT REFERENCES corporate_clients(id) ON DELETE SET NULL;
                ALTER TABLE orders ADD COLUMN corporate_person_name TEXT;
            "#);
        }

        // Check if rotation column exists in print_settings table
        let ps_columns: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(print_settings)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        if !ps_columns.contains(&"rotation".to_string()) {
            info!("Adding rotation column to print_settings table...");
            conn.execute_batch("ALTER TABLE print_settings ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;")?;
            info!("print_settings table successfully updated with rotation column.");
        }

        // Check if authenticated_pin_hash exists in corporate_devices table
        let cd_columns: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(corporate_devices)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        if !cd_columns.contains(&"authenticated_pin_hash".to_string()) {
            info!("Adding authenticated_pin_hash column to corporate_devices table...");
            let _ = conn.execute_batch("ALTER TABLE corporate_devices ADD COLUMN authenticated_pin_hash TEXT;");
        }

        // Safely ensure payment_claim columns exist on order_billings
        let _ = conn.execute_batch(
            "ALTER TABLE order_billings ADD COLUMN payment_claim TEXT DEFAULT NULL;
             ALTER TABLE order_billings ADD COLUMN payment_claim_at DATETIME DEFAULT NULL;"
        );

        // Safely heal any legacy orders where files were purged or where payment was verified but total_amount was zeroed out
        let _ = conn.execute_batch(
            "UPDATE orders 
             SET status = 'COMPLETED' 
             WHERE status = 'PURGED_BY_CUSTOMER' 
               AND id IN (SELECT order_id FROM print_jobs WHERE status = 'COMPLETED');

             UPDATE file_revisions 
             SET is_deleted = 0 
             WHERE id IN (SELECT file_revision_id FROM print_jobs WHERE status = 'COMPLETED');

             UPDATE order_billings 
             SET total_amount = 10.0, subtotal = 10.0
             WHERE total_amount <= 0.0 AND payment_status = 'PAID';"
        );

        info!("SQLite database initialized and migrations applied successfully.");

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        
        let migrations = migrations::get_migrations();
        migrations.to_latest(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn with_conn<F, R>(&self, f: F) -> Result<R, Box<dyn std::error::Error>>
    where
        F: FnOnce(&mut Connection) -> Result<R, Box<dyn std::error::Error>>,
    {
        let mut guard = self.conn.lock().map_err(|e| format!("DB lock error: {}", e))?;
        f(&mut *guard)
    }

    pub fn check_health(&self) -> Result<String, Box<dyn std::error::Error>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT count(*) FROM sqlite_master WHERE type='table'")?;
            let count: i64 = stmt.query_row([], |row| row.get(0))?;
            Ok(format!("SQLite WAL Active ({} tables registered)", count))
        })
    }

    pub fn get_config(&self, key: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT value FROM app_config WHERE key = ?1")?;
            let mut rows = stmt.query(rusqlite::params![key])?;
            if let Some(row) = rows.next()? {
                let val: String = row.get(0)?;
                Ok(Some(val))
            } else {
                Ok(None)
            }
        })
    }

    pub fn set_config(&self, key: &str, value: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO app_config (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                rusqlite::params![key, value],
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrations_and_health() {
        let db = Database::new_in_memory().expect("Failed to initialize in-memory DB");
        let health = db.check_health().expect("Health check failed");
        assert!(health.contains("tables registered"));

        // Test app_config
        db.set_config("test_key", "test_val").expect("Failed to set config");
        let val = db.get_config("test_key").expect("Failed to get config");
        assert_eq!(val, Some("test_val".to_string()));

        // Test update
        db.set_config("test_key", "updated_val").expect("Failed to update config");
        let val2 = db.get_config("test_key").expect("Failed to get config");
        assert_eq!(val2, Some("updated_val".to_string()));
    }

    #[test]
    fn test_session_and_order_persistence() {
        let db = Database::new_in_memory().expect("Failed to initialize in-memory DB");
        
        db.with_conn(|conn| {
            // Insert session
            conn.execute(
                "INSERT INTO transfer_sessions (id, token, lan_ip, port, status, expires_at) 
                 VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+30 minutes'))",
                ("sess-1", "secret-token-123", "192.168.1.50", 8080, "ACTIVE"),
            ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            // Insert order
            conn.execute(
                "INSERT INTO orders (id, session_id, current_revision_number, status)
                 VALUES (?1, ?2, ?3, ?4)",
                ("order-1", "sess-1", 1, "UPLOADING"),
            ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            // Query order
            let mut stmt = conn.prepare("SELECT status FROM orders WHERE id = ?1")
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            let status: String = stmt.query_row(["order-1"], |row| row.get(0))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            assert_eq!(status, "UPLOADING");

            // Update to PURGED_BY_CUSTOMER
            conn.execute(
                "UPDATE orders SET status = 'PURGED_BY_CUSTOMER' WHERE id = ?1",
                ["order-1"],
            ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            let status_purged: String = stmt.query_row(["order-1"], |row| row.get(0))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            assert_eq!(status_purged, "PURGED_BY_CUSTOMER");

            Ok(())
        }).expect("DB operations failed");
    }
}
