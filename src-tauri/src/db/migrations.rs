use rusqlite_migration::{Migrations, M};

pub fn get_migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(
            r#"
            PRAGMA foreign_keys = ON;

            -- 1. Transfer Sessions
            CREATE TABLE IF NOT EXISTS transfer_sessions (
                id TEXT PRIMARY KEY,
                token TEXT NOT NULL UNIQUE,
                lan_ip TEXT NOT NULL,
                port INTEGER NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
                max_file_size_bytes INTEGER NOT NULL DEFAULT 52428800,
                max_order_size_bytes INTEGER NOT NULL DEFAULT 209715200,
                max_files_count INTEGER NOT NULL DEFAULT 20,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL
            );

            -- 2. Orders
            CREATE TABLE IF NOT EXISTS orders (
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
            CREATE INDEX IF NOT EXISTS idx_orders_device_token ON orders(device_token);
            CREATE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code);

            -- 3. Order Revisions (Immutable)
            CREATE TABLE IF NOT EXISTS order_revisions (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                revision_number INTEGER NOT NULL,
                total_files INTEGER NOT NULL,
                total_bytes INTEGER NOT NULL,
                is_approved BOOLEAN NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(order_id, revision_number),
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
            );

            -- 4. Files
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                sanitized_filename TEXT NOT NULL,
                detected_mime_type TEXT NOT NULL,
                file_extension TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
            );

            -- 5. File Revisions (Immutable)
            CREATE TABLE IF NOT EXISTS file_revisions (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                order_revision_id TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                sha256_hash TEXT NOT NULL,
                storage_relative_path TEXT NOT NULL,
                is_deleted BOOLEAN NOT NULL DEFAULT 0,
                transfer_status TEXT NOT NULL CHECK(transfer_status IN ('PENDING', 'UPLOADING', 'VERIFIED', 'FAILED')),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
                FOREIGN KEY (order_revision_id) REFERENCES order_revisions(id) ON DELETE CASCADE
            );

            -- 6. Print Settings (Per File Revision)
            CREATE TABLE IF NOT EXISTS print_settings (
                id TEXT PRIMARY KEY,
                file_revision_id TEXT NOT NULL UNIQUE,
                mode TEXT NOT NULL CHECK(mode IN ('AUTO', 'MANUAL')),
                paper_size TEXT NOT NULL DEFAULT 'A4',
                color_mode TEXT NOT NULL DEFAULT 'BW',
                duplex_mode TEXT NOT NULL DEFAULT 'SIMPLEX',
                copies INTEGER NOT NULL DEFAULT 1,
                page_range TEXT,
                orientation TEXT NOT NULL DEFAULT 'AUTO',
                rotation INTEGER NOT NULL DEFAULT 0,
                resolved_summary TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (file_revision_id) REFERENCES file_revisions(id) ON DELETE CASCADE
            );

            -- 7. Upload Chunks (Resumable Tracking)
            CREATE TABLE IF NOT EXISTS upload_chunks (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                total_chunks INTEGER NOT NULL,
                chunk_size_bytes INTEGER NOT NULL,
                sha256_chunk_hash TEXT NOT NULL,
                is_received BOOLEAN NOT NULL DEFAULT 0,
                received_at DATETIME,
                UNIQUE(file_id, chunk_index),
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            );

            -- 8. Approval Records (Immutable Audit)
            CREATE TABLE IF NOT EXISTS approval_records (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                order_revision_id TEXT NOT NULL,
                approved_by TEXT NOT NULL DEFAULT 'SHOPKEEPER',
                status TEXT NOT NULL CHECK(status IN ('APPROVED', 'INVALIDATED', 'REJECTED')),
                rejection_reason TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                FOREIGN KEY (order_revision_id) REFERENCES order_revisions(id) ON DELETE CASCADE
            );

            -- 9. Print Jobs
            CREATE TABLE IF NOT EXISTS print_jobs (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                order_revision_id TEXT NOT NULL,
                file_revision_id TEXT NOT NULL,
                printer_name TEXT NOT NULL,
                job_sequence_index INTEGER NOT NULL,
                status TEXT NOT NULL CHECK(status IN (
                    'PENDING', 'PREPARING', 'READY', 
                    'SUBMITTED_TO_SPOOLER', 'PRINTING', 
                    'COMPLETED', 'FAILED', 'UNCERTAIN', 'CANCELLED'
                )),
                spooler_job_id INTEGER,
                error_message TEXT,
                submitted_at DATETIME,
                completed_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                FOREIGN KEY (order_revision_id) REFERENCES order_revisions(id) ON DELETE CASCADE,
                FOREIGN KEY (file_revision_id) REFERENCES file_revisions(id) ON DELETE CASCADE
            );

            -- 10. Order Status Events
            CREATE TABLE IF NOT EXISTS order_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
            );

            -- 11. App Configuration
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            -- Performance Indexes
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON transfer_sessions(token);
            CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
            CREATE INDEX IF NOT EXISTS idx_revisions_order ON order_revisions(order_id);
            CREATE INDEX IF NOT EXISTS idx_files_order ON files(order_id);
            CREATE INDEX IF NOT EXISTS idx_file_revisions_file ON file_revisions(file_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_file ON upload_chunks(file_id, chunk_index);
            CREATE INDEX IF NOT EXISTS idx_print_jobs_order ON print_jobs(order_id);
            CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
            "#,
        ),
        M::up(
            r#"
            -- 12. Corporate Clients
            CREATE TABLE IF NOT EXISTS corporate_clients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                static_token TEXT NOT NULL UNIQUE,
                pin_hash TEXT NOT NULL,
                billing_account TEXT,
                notes TEXT,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_corporate_clients_token ON corporate_clients(static_token);

            -- 13. Corporate Devices (Whitelisted / Bound Devices)
            CREATE TABLE IF NOT EXISTS corporate_devices (
                id TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                device_fingerprint TEXT NOT NULL,
                person_name TEXT NOT NULL,
                device_type TEXT NOT NULL DEFAULT 'mobile',
                auth_token TEXT NOT NULL UNIQUE,
                authenticated_pin_hash TEXT,
                is_revoked BOOLEAN NOT NULL DEFAULT 0,
                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES corporate_clients(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_corporate_devices_client ON corporate_devices(client_id);
            CREATE INDEX IF NOT EXISTS idx_corporate_devices_token ON corporate_devices(auth_token);
            CREATE INDEX IF NOT EXISTS idx_corporate_devices_fp ON corporate_devices(client_id, device_fingerprint);

            -- 14. Corporate Attribution in Orders
            ALTER TABLE orders ADD COLUMN corporate_client_id TEXT REFERENCES corporate_clients(id) ON DELETE SET NULL;
            ALTER TABLE orders ADD COLUMN corporate_person_name TEXT;
            "#,
        ),
        M::up(
            r#"
            -- 15. Order Billings (Financial Accounting & Printing Charges)
            CREATE TABLE IF NOT EXISTS order_billings (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
                corporate_client_id TEXT REFERENCES corporate_clients(id) ON DELETE SET NULL,
                customer_type TEXT NOT NULL DEFAULT 'WALK_IN' CHECK(customer_type IN ('WALK_IN', 'REMOTE')),
                subtotal REAL NOT NULL DEFAULT 0.0,
                total_amount REAL NOT NULL DEFAULT 0.0,
                currency TEXT NOT NULL DEFAULT '₹',
                payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID', 'PAID', 'CREDIT')),
                payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('CASH', 'ONLINE')),
                paid_at DATETIME,
                billing_details_json TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_order_billings_order ON order_billings(order_id);
            CREATE INDEX IF NOT EXISTS idx_order_billings_status ON order_billings(payment_status);
            CREATE INDEX IF NOT EXISTS idx_order_billings_cust_type ON order_billings(customer_type);
            CREATE INDEX IF NOT EXISTS idx_order_billings_corp ON order_billings(corporate_client_id);
            "#,
        ),
        M::up(
            r#"
            -- 16. Payment Claim Tracking on Order Billings
            ALTER TABLE order_billings ADD COLUMN payment_claim TEXT DEFAULT NULL;
            ALTER TABLE order_billings ADD COLUMN payment_claim_at DATETIME DEFAULT NULL;
            "#,
        ),
        M::up(
            r#"
            -- 17. Per-File Manual Target Printer Override in Print Settings
            ALTER TABLE print_settings ADD COLUMN target_printer TEXT DEFAULT NULL;
            "#,
        ),
    ])
}
