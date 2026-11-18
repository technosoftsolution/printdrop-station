use crate::db::Database;
use crate::models::PrintSettingsDto;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmittedFileDto {
    pub file_id: String,
    pub filename: String,
    pub file_size_bytes: u64,
    pub sha256_hash: String,
    pub settings: PrintSettingsDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitOrderRequest {
    pub session_token: String,
    pub order_id: Option<String>,
    pub customer_notes: Option<String>,
    pub customer_name: Option<String>,
    pub device_model: Option<String>,
    pub device_token: Option<String>,
    pub corporate_token: Option<String>,
    pub corporate_auth_token: Option<String>,
    pub corporate_person_name: Option<String>,
    pub corporate_device_fingerprint: Option<String>,
    pub files: Vec<SubmittedFileDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderFileSummaryDto {
    pub file_id: String,
    pub original_filename: String,
    pub file_size_bytes: u64,
    pub document_pages: u32,
    pub copies: u32,
    pub paper_size: String,
    pub color_mode: String,
    pub duplex_mode: String,
    pub is_excluded: bool,
    pub is_purged: bool,
    pub is_printed: bool,
    pub printed_at: Option<String>,
    pub printed_on: Option<String>,
    pub target_printer: Option<String>,
    pub auto_printer: Option<String>,
    pub subtotal: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderSummaryDto {
    pub id: String,
    pub session_id: String,
    pub revision_number: u32,
    pub status: String,
    pub total_files: u32,
    pub total_bytes: u64,
    pub customer_notes: Option<String>,
    pub customer_name: Option<String>,
    pub device_model: Option<String>,
    pub device_token: Option<String>,
    pub pickup_code: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub printed_files_count: u32,
    pub target_printer: Option<String>,
    pub active_files_count: u32,
    pub is_all_purged: bool,
    pub corporate_client_name: Option<String>,
    pub corporate_person_name: Option<String>,
    pub total_amount: Option<f64>,
    pub payment_status: Option<String>,
    pub payment_method: Option<String>,
    pub customer_type: Option<String>,
    pub payment_claim: Option<String>,
    pub paid_at: Option<String>,
    #[serde(default)]
    pub files: Vec<OrderFileSummaryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderFileDetailDto {
    pub file_id: String,
    pub original_filename: String,
    pub file_size_bytes: u64,
    pub sha256_hash: String,
    pub print_settings: PrintSettingsDto,
    pub settings_summary: String,
    pub is_excluded: bool,
    pub is_printed: bool,
    pub is_purged: bool,
    pub printed_at: Option<String>,
    pub printed_on: Option<String>,
    pub auto_printer: Option<String>,
    pub resolved_printer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDetailDto {
    pub order: OrderSummaryDto,
    pub files: Vec<OrderFileDetailDto>,
}

pub struct OrderManager {
    db: Arc<Database>,
}

fn safe_lossy_str(r: &rusqlite::Row, idx: usize) -> rusqlite::Result<String> {
    match r.get_ref(idx)? {
        rusqlite::types::ValueRef::Text(b) => Ok(String::from_utf8_lossy(b).to_string()),
        rusqlite::types::ValueRef::Blob(b) => Ok(String::from_utf8_lossy(b).to_string()),
        rusqlite::types::ValueRef::Null => Ok(String::new()),
        rusqlite::types::ValueRef::Integer(i) => Ok(i.to_string()),
        rusqlite::types::ValueRef::Real(f) => Ok(f.to_string()),
    }
}

fn safe_opt_lossy_str(r: &rusqlite::Row, idx: usize) -> rusqlite::Result<Option<String>> {
    match r.get_ref(idx)? {
        rusqlite::types::ValueRef::Text(b) => Ok(Some(String::from_utf8_lossy(b).to_string())),
        rusqlite::types::ValueRef::Blob(b) => Ok(Some(String::from_utf8_lossy(b).to_string())),
        rusqlite::types::ValueRef::Null => Ok(None),
        rusqlite::types::ValueRef::Integer(i) => Ok(Some(i.to_string())),
        rusqlite::types::ValueRef::Real(f) => Ok(Some(f.to_string())),
    }
}

impl OrderManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn submit_order(
        &self,
        session_id: &str,
        notes: Option<&str>,
        customer_name: Option<&str>,
        device_model: Option<&str>,
        device_token: Option<&str>,
        files: &[SubmittedFileDto],
        corporate_client_id: Option<&str>,
        corporate_person_name: Option<&str>,
    ) -> Result<(String, String), Box<dyn std::error::Error>> {
        if files.is_empty() {
            return Err("Cannot submit an empty order without files".into());
        }

        let order_id = Uuid::new_v4().to_string();
        let revision_id = Uuid::new_v4().to_string();
        let total_files = files.len() as u32;
        let total_bytes: u64 = files.iter().map(|f| f.file_size_bytes).sum();

        // Generate a 4-digit numeric pickup code (e.g. 1000 - 9999)
        let u = Uuid::new_v4();
        let b = u.as_bytes();
        let num = ((b[0] as u32) << 8 | (b[1] as u32)) % 9000 + 1000;
        let pickup_code = format!("{:04}", num);

        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;

            // 1. Insert Order
            tx.execute(
                "INSERT INTO orders (id, session_id, current_revision_number, status, customer_notes, customer_name, device_model, device_token, pickup_code, corporate_client_id, corporate_person_name, created_at, updated_at) 
                 VALUES (?1, ?2, 1, 'AWAITING_APPROVAL', ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'))",
                params![&order_id, session_id, notes, customer_name, device_model, device_token, &pickup_code, corporate_client_id, corporate_person_name],
            )?;

            // 2. Insert Order Revision 1
            tx.execute(
                "INSERT INTO order_revisions (id, order_id, revision_number, total_files, total_bytes, is_approved, created_at) 
                 VALUES (?1, ?2, 1, ?3, ?4, 0, datetime('now'))",
                params![&revision_id, &order_id, total_files, total_bytes as i64],
            )?;

            // 3. Insert each file, its revision, and print settings
            for f in files {
                f.settings.validate().map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, e))))?;

                let ext = f.filename.split('.').last().unwrap_or("dat");
                let file_record_id = Uuid::new_v4().to_string();
                let file_rev_id = Uuid::new_v4().to_string();
                let setting_id = Uuid::new_v4().to_string();
                let storage_rel_path = format!("verified/{}.dat", f.file_id);

                // File base record
                tx.execute(
                    "INSERT INTO files (id, order_id, original_filename, sanitized_filename, detected_mime_type, file_extension) 
                     VALUES (?1, ?2, ?3, ?4, 'application/octet-stream', ?5)",
                    params![&file_record_id, &order_id, &f.filename, &f.file_id, ext],
                )?;

                // File Revision record
                tx.execute(
                    "INSERT INTO file_revisions (id, file_id, order_revision_id, file_size_bytes, sha256_hash, storage_relative_path, is_deleted, transfer_status) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'VERIFIED')",
                    params![&file_rev_id, &file_record_id, &revision_id, f.file_size_bytes as i64, &f.sha256_hash, &storage_rel_path],
                )?;

                // Print Settings record
                let summary = f.settings.to_summary();
                let rot = f.settings.rotation.unwrap_or(0);
                let target_printer = f.settings.target_printer.as_ref().map(|p| p.trim().to_string()).filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("AUTO"));
                tx.execute(
                    "INSERT INTO print_settings (id, file_revision_id, mode, paper_size, color_mode, duplex_mode, copies, page_range, orientation, rotation, resolved_summary, target_printer) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        &setting_id,
                        &file_rev_id,
                        &f.settings.mode,
                        &f.settings.paper_size,
                        &f.settings.color_mode,
                        &f.settings.duplex_mode,
                        f.settings.copies,
                        &f.settings.page_range,
                        &f.settings.orientation,
                        rot,
                        &summary,
                        &target_printer
                    ],
                )?;
            }

            // 4. Record audit event
            tx.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) 
                 VALUES (?1, 'ORDER_SUBMITTED', ?2)",
                params![&order_id, format!("{{\"totalFiles\": {}, \"totalBytes\": {}}}", total_files, total_bytes)],
            )?;

            tx.commit()?;
            Ok(())
        })?;

        info!("Order '{}' (Rev 1, PIN #{}) persisted in SQLite with {} files.", order_id, pickup_code, total_files);
        Ok((order_id, pickup_code))
    }

    pub fn append_files_to_order(
        &self,
        order_id: &str,
        new_files: &[SubmittedFileDto],
    ) -> Result<(String, u32, u32), Box<dyn std::error::Error>> {
        if new_files.is_empty() {
            return Err("No new files provided to append".into());
        }

        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;

            // 1. Fetch current order info & verify state
            let (canonical_order_id, cur_rev, status): (String, u32, String) = tx.query_row(
                "SELECT id, current_revision_number, status FROM orders WHERE id = ?1 OR id LIKE ?1 || '%' ORDER BY (id = ?1) DESC LIMIT 1",
                [order_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).map_err(|_| format!("Order '{}' not found", order_id))?;

            if status != "AWAITING_APPROVAL" {
                return Err(format!("Cannot add files: Order is already '{}'. Files can only be added while awaiting review.", status).into());
            }

            // 2. Locate previous revision ID
            let prev_rev_id: String = tx.query_row(
                "SELECT id FROM order_revisions WHERE order_id = ?1 AND revision_number = ?2",
                rusqlite::params![&canonical_order_id, cur_rev],
                |row| row.get(0),
            )?;

            let new_rev = cur_rev + 1;
            let new_rev_id = Uuid::new_v4().to_string();

            // 3. Fetch existing files from previous revision that were not deleted
            let mut existing_files_stmt = tx.prepare(
                "SELECT fr.file_id, fr.file_size_bytes, fr.sha256_hash, fr.storage_relative_path,
                        ps.mode, ps.paper_size, ps.color_mode, ps.duplex_mode, ps.copies, ps.orientation, ps.page_range, ps.resolved_summary, ps.rotation, ps.target_printer
                 FROM file_revisions fr
                 JOIN print_settings ps ON fr.id = ps.file_revision_id
                 WHERE fr.order_revision_id = ?1 AND fr.is_deleted = 0"
            )?;

            let existing_files = existing_files_stmt.query_map([&prev_rev_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, u32>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, u32>(12).unwrap_or(0),
                    row.get::<_, Option<String>>(13).ok().flatten(),
                ))
            })?.collect::<Result<Vec<_>, _>>()?;
            drop(existing_files_stmt);

            let mut total_files = existing_files.len() as u32;
            let mut total_bytes: i64 = existing_files.iter().map(|f| f.1).sum();

            for nf in new_files {
                total_files += 1;
                total_bytes += nf.file_size_bytes as i64;
            }

            // 4. Insert new Order Revision record
            tx.execute(
                "INSERT INTO order_revisions (id, order_id, revision_number, total_files, total_bytes, is_approved, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, datetime('now'))",
                rusqlite::params![&new_rev_id, &canonical_order_id, new_rev, total_files, total_bytes],
            )?;

            // 5. Carry forward existing files into new revision
            for ef in &existing_files {
                let new_file_rev_id = Uuid::new_v4().to_string();
                let new_ps_id = Uuid::new_v4().to_string();

                tx.execute(
                    "INSERT INTO file_revisions (id, file_id, order_revision_id, file_size_bytes, sha256_hash, storage_relative_path, is_deleted, transfer_status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'VERIFIED')",
                    rusqlite::params![&new_file_rev_id, &ef.0, &new_rev_id, ef.1, &ef.2, &ef.3],
                )?;

                tx.execute(
                    "INSERT INTO print_settings (id, file_revision_id, mode, paper_size, color_mode, duplex_mode, copies, orientation, page_range, rotation, resolved_summary, target_printer)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![&new_ps_id, &new_file_rev_id, &ef.4, &ef.5, &ef.6, &ef.7, ef.8, &ef.9, &ef.10, ef.12, &ef.11, &ef.13],
                )?;
            }

            // 6. Insert new files
            for f in new_files {
                f.settings.validate().map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, e))))?;

                let ext = f.filename.split('.').last().unwrap_or("dat");
                let file_record_id = Uuid::new_v4().to_string();
                let file_rev_id = Uuid::new_v4().to_string();
                let setting_id = Uuid::new_v4().to_string();
                let storage_rel_path = format!("verified/{}.dat", f.file_id);

                tx.execute(
                    "INSERT INTO files (id, order_id, original_filename, sanitized_filename, detected_mime_type, file_extension)
                     VALUES (?1, ?2, ?3, ?4, 'application/octet-stream', ?5)",
                    rusqlite::params![&file_record_id, &canonical_order_id, &f.filename, &f.file_id, ext],
                )?;

                tx.execute(
                    "INSERT INTO file_revisions (id, file_id, order_revision_id, file_size_bytes, sha256_hash, storage_relative_path, is_deleted, transfer_status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 'VERIFIED')",
                    rusqlite::params![&file_rev_id, &file_record_id, &new_rev_id, f.file_size_bytes as i64, &f.sha256_hash, &storage_rel_path],
                )?;

                let summary = f.settings.to_summary();
                let rot = f.settings.rotation.unwrap_or(0);
                let target_printer = f.settings.target_printer.as_ref().map(|p| p.trim().to_string()).filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("AUTO"));
                tx.execute(
                    "INSERT INTO print_settings (id, file_revision_id, mode, paper_size, color_mode, duplex_mode, copies, page_range, orientation, rotation, resolved_summary, target_printer)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![
                        &setting_id,
                        &file_rev_id,
                        &f.settings.mode,
                        &f.settings.paper_size,
                        &f.settings.color_mode,
                        &f.settings.duplex_mode,
                        f.settings.copies,
                        &f.settings.page_range,
                        &f.settings.orientation,
                        rot,
                        &summary,
                        &target_printer
                    ],
                )?;
            }

            // 7. Update orders table
            tx.execute(
                "UPDATE orders SET current_revision_number = ?1, updated_at = datetime('now') WHERE id = ?2",
                rusqlite::params![new_rev, &canonical_order_id],
            )?;

            // 8. Audit event
            tx.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'ORDER_REVISION_CREATED', ?2)",
                rusqlite::params![
                    &canonical_order_id,
                    serde_json::json!({
                        "previousRevision": cur_rev,
                        "newRevision": new_rev,
                        "addedFiles": new_files.len(),
                        "totalFiles": total_files
                    }).to_string()
                ],
            )?;

            tx.commit()?;
            Ok((canonical_order_id, new_rev, total_files))
        })
    }

    pub fn list_orders(&self) -> Result<Vec<OrderSummaryDto>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT o.id, o.session_id, o.current_revision_number, o.status, r.total_files, r.total_bytes, o.customer_notes, o.created_at,
                        (SELECT MAX(pj.completed_at) FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status = 'COMPLETED') AS completed_at,
                        (SELECT COUNT(DISTINCT pj.file_revision_id) FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status = 'COMPLETED') AS printed_files_count,
                        COALESCE(
                            (SELECT REPLACE(GROUP_CONCAT(DISTINCT pj.printer_name), ',', ', ') FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status = 'COMPLETED'),
                            (SELECT REPLACE(GROUP_CONCAT(DISTINCT pj.printer_name), ',', ', ') FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status IN ('PRINTING', 'SUBMITTED_TO_SPOOLER', 'READY', 'PENDING')),
                            (SELECT pj.printer_name FROM print_jobs pj WHERE pj.order_id = o.id ORDER BY pj.completed_at DESC, pj.created_at DESC LIMIT 1)
                        ) AS target_printer,
                        o.customer_name, o.device_model, o.device_token, o.pickup_code,
                        (
                            SELECT COUNT(*) FROM files f
                            JOIN file_revisions fr ON f.id = fr.file_id
                            WHERE fr.order_revision_id = r.id
                              AND o.status != 'PURGED_BY_CUSTOMER'
                              AND NOT EXISTS (
                                  SELECT 1 FROM order_events oe
                                  WHERE oe.order_id = o.id
                                    AND (
                                        oe.event_type = 'CUSTOMER_PURGED_ALL_FILES'
                                        OR (oe.event_type = 'CUSTOMER_PURGED_FILE' AND oe.payload_json LIKE '%' || f.id || '%')
                                    )
                              )
                        ) AS active_files_count,
                        (SELECT cc.name FROM corporate_clients cc WHERE cc.id = o.corporate_client_id) AS corporate_client_name,
                        o.corporate_person_name,
                        (SELECT ob.total_amount FROM order_billings ob WHERE ob.order_id = o.id) AS total_amount,
                        (SELECT ob.payment_status FROM order_billings ob WHERE ob.order_id = o.id) AS payment_status,
                        (SELECT ob.payment_method FROM order_billings ob WHERE ob.order_id = o.id) AS payment_method,
                        (SELECT ob.customer_type FROM order_billings ob WHERE ob.order_id = o.id) AS customer_type,
                        (SELECT ob.payment_claim FROM order_billings ob WHERE ob.order_id = o.id) AS payment_claim,
                        (SELECT ob.paid_at FROM order_billings ob WHERE ob.order_id = o.id) AS paid_at,
                        r.id AS revision_id,
                        (SELECT ob.billing_details_json FROM order_billings ob WHERE ob.order_id = o.id) AS billing_details_json
                 FROM orders o 
                 JOIN order_revisions r ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                 ORDER BY o.created_at DESC"
            )?;

            struct RawOrder {
                id: String,
                session_id: String,
                revision_number: u32,
                status: String,
                total_files: u32,
                total_bytes: u64,
                customer_notes: Option<String>,
                created_at: String,
                completed_at: Option<String>,
                printed_count: i64,
                target_printer: Option<String>,
                customer_name: Option<String>,
                device_model: Option<String>,
                device_token: Option<String>,
                pickup_code: Option<String>,
                active_count: i64,
                corporate_client_name: Option<String>,
                corporate_person_name: Option<String>,
                total_amount: Option<f64>,
                payment_status: Option<String>,
                payment_method: Option<String>,
                customer_type: Option<String>,
                payment_claim: Option<String>,
                paid_at: Option<String>,
                rev_id: String,
                billing_details_json: Option<String>,
            }

            let rows = stmt.query_map([], |row| {
                Ok(RawOrder {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    revision_number: row.get(2)?,
                    status: row.get(3)?,
                    total_files: row.get(4)?,
                    total_bytes: row.get(5)?,
                    customer_notes: row.get(6)?,
                    created_at: row.get(7)?,
                    completed_at: row.get(8)?,
                    printed_count: row.get(9).unwrap_or(0),
                    target_printer: row.get(10)?,
                    customer_name: row.get(11)?,
                    device_model: row.get(12)?,
                    device_token: row.get(13)?,
                    pickup_code: row.get(14)?,
                    active_count: row.get(15).unwrap_or(0),
                    corporate_client_name: row.get(16)?,
                    corporate_person_name: row.get(17)?,
                    total_amount: row.get(18).ok(),
                    payment_status: row.get(19).ok(),
                    payment_method: row.get(20).ok(),
                    customer_type: row.get(21).ok(),
                    payment_claim: row.get(22).ok(),
                    paid_at: row.get(23).ok(),
                    rev_id: row.get(24)?,
                    billing_details_json: row.get(25).ok(),
                })
            })?;

            let mut raw_orders = Vec::new();
            for r in rows {
                raw_orders.push(r?);
            }

            let mut file_stmt = conn.prepare(
                "SELECT f.id, f.original_filename, fr.file_size_bytes, 
                        ps.paper_size, ps.color_mode, ps.duplex_mode, ps.copies,
                        fr.is_deleted,
                        (SELECT MAX(pj.completed_at) FROM print_jobs pj WHERE pj.file_revision_id = fr.id AND pj.status = 'COMPLETED') AS printed_at,
                        (SELECT COUNT(*) FROM order_events oe WHERE oe.order_id = ?1 AND (oe.event_type = 'CUSTOMER_PURGED_ALL_FILES' OR (oe.event_type = 'CUSTOMER_PURGED_FILE' AND oe.payload_json LIKE '%' || f.id || '%'))) AS is_purged,
                        (SELECT pj.printer_name FROM print_jobs pj WHERE pj.file_revision_id = fr.id AND pj.status = 'COMPLETED' ORDER BY pj.completed_at DESC, pj.rowid DESC LIMIT 1) AS printed_on,
                        ps.target_printer
                 FROM files f 
                 JOIN file_revisions fr ON f.id = fr.file_id 
                 JOIN print_settings ps ON fr.id = ps.file_revision_id 
                 WHERE fr.order_revision_id = ?2
                 ORDER BY f.created_at ASC"
            )?;

            let mut list = Vec::new();
            for raw in raw_orders {
                let is_all_purged = raw.status == "PURGED_BY_CUSTOMER" || raw.active_count == 0;

                // Parse billing items map if available
                let billing_map: std::collections::HashMap<String, (u32, f64)> = if let Some(ref json_str) = raw.billing_details_json {
                    if let Ok(details) = serde_json::from_str::<Vec<crate::pricing::FileBillingDetailDto>>(json_str) {
                        details.into_iter().map(|b| (b.file_id, (b.document_pages, b.subtotal))).collect()
                    } else {
                        std::collections::HashMap::new()
                    }
                } else {
                    std::collections::HashMap::new()
                };

                let f_rows = file_stmt.query_map(rusqlite::params![&raw.id, &raw.rev_id], |r| {
                    let file_id: String = r.get(0)?;
                    let original_filename: String = r.get(1)?;
                    let file_size_bytes: u64 = r.get(2)?;
                    let paper_size: String = r.get(3)?;
                    let color_mode: String = r.get(4)?;
                    let duplex_mode: String = r.get(5)?;
                    let copies: u32 = r.get(6)?;
                    let is_deleted: i64 = r.get(7)?;
                    let printed_at: Option<String> = r.get(8).ok().flatten();
                    let is_printed = printed_at.is_some();
                    let purged_count: i64 = r.get(9).unwrap_or(0);
                    let is_purged = is_all_purged || purged_count > 0;
                    let printed_on: Option<String> = r.get(10).ok().flatten();
                    let target_printer: Option<String> = r.get::<_, Option<String>>(11).ok().flatten().filter(|s| !s.trim().is_empty() && !s.eq_ignore_ascii_case("AUTO"));

                    let (doc_pages, subtotal) = billing_map.get(&file_id).copied().map(|(p, s)| (p, Some(s))).unwrap_or((1, None));

                    Ok(OrderFileSummaryDto {
                        file_id,
                        original_filename,
                        file_size_bytes,
                        document_pages: doc_pages,
                        copies,
                        paper_size,
                        color_mode,
                        duplex_mode,
                        is_excluded: is_deleted != 0,
                        is_purged,
                        is_printed,
                        printed_at,
                        printed_on,
                        target_printer,
                        auto_printer: None,
                        subtotal,
                    })
                })?;

                let mut files = Vec::new();
                for f in f_rows {
                    if let Ok(file_dto) = f {
                        files.push(file_dto);
                    }
                }

                list.push(OrderSummaryDto {
                    id: raw.id,
                    session_id: raw.session_id,
                    revision_number: raw.revision_number,
                    status: raw.status,
                    total_files: raw.total_files,
                    total_bytes: raw.total_bytes,
                    customer_notes: raw.customer_notes,
                    created_at: raw.created_at,
                    completed_at: raw.completed_at,
                    printed_files_count: raw.printed_count as u32,
                    target_printer: raw.target_printer,
                    customer_name: raw.customer_name,
                    device_model: raw.device_model,
                    device_token: raw.device_token,
                    pickup_code: raw.pickup_code,
                    active_files_count: raw.active_count as u32,
                    is_all_purged,
                    corporate_client_name: raw.corporate_client_name,
                    corporate_person_name: raw.corporate_person_name,
                    total_amount: raw.total_amount,
                    payment_status: raw.payment_status,
                    payment_method: raw.payment_method,
                    customer_type: raw.customer_type,
                    payment_claim: raw.payment_claim,
                    paid_at: raw.paid_at,
                    files,
                });
            }
            Ok(list)
        })
    }

    pub fn get_order_details(&self, order_id: &str) -> Result<Option<OrderDetailDto>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            // Get order header
            let mut stmt = conn.prepare(
                "SELECT o.id, o.session_id, o.current_revision_number, o.status, r.total_files, r.total_bytes, o.customer_notes, o.created_at, r.id,
                        (SELECT MAX(pj.completed_at) FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status = 'COMPLETED') AS completed_at,
                        (SELECT COUNT(DISTINCT pj.file_revision_id) FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status = 'COMPLETED') AS printed_files_count,
                        COALESCE(
                            (SELECT REPLACE(GROUP_CONCAT(DISTINCT pj.printer_name), ',', ', ') FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status = 'COMPLETED'),
                            (SELECT REPLACE(GROUP_CONCAT(DISTINCT pj.printer_name), ',', ', ') FROM print_jobs pj WHERE pj.order_id = o.id AND pj.status IN ('PRINTING', 'SUBMITTED_TO_SPOOLER', 'READY', 'PENDING')),
                            (SELECT pj.printer_name FROM print_jobs pj WHERE pj.order_id = o.id ORDER BY pj.completed_at DESC, pj.created_at DESC LIMIT 1)
                        ) AS target_printer,
                        o.customer_name, o.device_model, o.device_token, o.pickup_code,
                        (SELECT cc.name FROM corporate_clients cc WHERE cc.id = o.corporate_client_id) AS corporate_client_name,
                        o.corporate_person_name,
                        (SELECT ob.total_amount FROM order_billings ob WHERE ob.order_id = o.id) AS total_amount,
                        (SELECT ob.payment_status FROM order_billings ob WHERE ob.order_id = o.id) AS payment_status,
                        (SELECT ob.payment_method FROM order_billings ob WHERE ob.order_id = o.id) AS payment_method,
                        (SELECT ob.customer_type FROM order_billings ob WHERE ob.order_id = o.id) AS customer_type,
                        (SELECT ob.payment_claim FROM order_billings ob WHERE ob.order_id = o.id) AS payment_claim,
                        (SELECT ob.paid_at FROM order_billings ob WHERE ob.order_id = o.id) AS paid_at
                 FROM orders o 
                 JOIN order_revisions r ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                 WHERE o.id = ?1 OR o.id LIKE ?1 || '%' 
                 ORDER BY (o.id = ?1) DESC LIMIT 1"
            )?;

            let mut rows = stmt.query([order_id])?;
            if let Some(row) = rows.next()? {
                let printed_count: i64 = row.get(10).unwrap_or(0);
                let order_status = safe_lossy_str(&row, 3)?;
                let order_canonical_id = safe_lossy_str(&row, 0)?;
                let rev_id: String = safe_lossy_str(&row, 8)?;

                // Get files for this revision
                let mut file_stmt = conn.prepare(
                    "SELECT f.id, f.original_filename, fr.file_size_bytes, fr.sha256_hash, 
                            ps.mode, ps.paper_size, ps.color_mode, ps.duplex_mode, ps.copies, ps.orientation, ps.page_range, ps.resolved_summary,
                            fr.is_deleted,
                            (SELECT MAX(pj.completed_at) FROM print_jobs pj WHERE pj.file_revision_id = fr.id AND pj.status = 'COMPLETED') AS printed_at,
                            (SELECT pj.printer_name FROM print_jobs pj WHERE pj.file_revision_id = fr.id AND pj.status = 'COMPLETED' ORDER BY pj.completed_at DESC, pj.rowid DESC LIMIT 1) AS printed_on,
                            (SELECT COUNT(*) FROM order_events oe WHERE oe.order_id = ?1 AND (oe.event_type = 'CUSTOMER_PURGED_ALL_FILES' OR (oe.event_type = 'CUSTOMER_PURGED_FILE' AND oe.payload_json LIKE '%' || f.id || '%'))) AS is_purged,
                            ps.rotation,
                            ps.target_printer
                     FROM files f 
                     JOIN file_revisions fr ON f.id = fr.file_id 
                     JOIN print_settings ps ON fr.id = ps.file_revision_id 
                     WHERE fr.order_revision_id = ?2"
                )?;

                let is_order_purged = order_status == "PURGED_BY_CUSTOMER";
                let f_rows = file_stmt.query_map(rusqlite::params![&order_canonical_id, rev_id], |r| {
                    let is_del: i64 = r.get(12)?;
                    let printed_at: Option<String> = safe_opt_lossy_str(r, 13)?;
                    let printed_on: Option<String> = safe_opt_lossy_str(r, 14)?;
                    let is_printed = printed_at.is_some();
                    let purged_count: i64 = r.get(15).unwrap_or(0);
                    let is_purged = purged_count > 0 || is_order_purged;
                    let rot: u32 = r.get(16).unwrap_or(0);
                    let target_printer: Option<String> = safe_opt_lossy_str(r, 17)?
                        .map(|p| p.trim().to_string())
                        .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("AUTO"));
                    Ok(OrderFileDetailDto {
                        file_id: safe_lossy_str(r, 0)?,
                        original_filename: safe_lossy_str(r, 1)?,
                        file_size_bytes: r.get(2)?,
                        sha256_hash: safe_lossy_str(r, 3)?,
                        print_settings: PrintSettingsDto {
                            mode: safe_lossy_str(r, 4)?,
                            paper_size: safe_lossy_str(r, 5)?,
                            color_mode: safe_lossy_str(r, 6)?,
                            duplex_mode: safe_lossy_str(r, 7)?,
                            copies: r.get(8)?,
                            orientation: safe_lossy_str(r, 9)?,
                            page_range: safe_opt_lossy_str(r, 10)?,
                            rotation: Some(rot),
                            target_printer,
                        },
                        settings_summary: safe_lossy_str(r, 11)?,
                        is_excluded: is_del != 0,
                        is_printed,
                        is_purged,
                        printed_at,
                        printed_on,
                        auto_printer: None,
                        resolved_printer: None,
                    })
                })?;

                let mut files = Vec::new();
                for f in f_rows {
                    files.push(f?);
                }

                let active_files_count = files.iter().filter(|f| !f.is_purged).count() as u32;
                let is_all_purged = files.is_empty() || active_files_count == 0 || is_order_purged;

                let summary = OrderSummaryDto {
                    id: order_canonical_id,
                    session_id: safe_lossy_str(&row, 1)?,
                    revision_number: row.get(2)?,
                    status: order_status,
                    total_files: row.get(4)?,
                    total_bytes: row.get(5)?,
                    customer_notes: safe_opt_lossy_str(&row, 6)?,
                    created_at: safe_lossy_str(&row, 7)?,
                    completed_at: safe_opt_lossy_str(&row, 9)?,
                    printed_files_count: printed_count as u32,
                    target_printer: safe_opt_lossy_str(&row, 11)?,
                    customer_name: safe_opt_lossy_str(&row, 12)?,
                    device_model: safe_opt_lossy_str(&row, 13)?,
                    device_token: safe_opt_lossy_str(&row, 14)?,
                    pickup_code: safe_opt_lossy_str(&row, 15)?,
                    active_files_count,
                    is_all_purged,
                    corporate_client_name: safe_opt_lossy_str(&row, 16)?,
                    corporate_person_name: safe_opt_lossy_str(&row, 17)?,
                    total_amount: row.get(18).ok(),
                    payment_status: row.get(19).ok(),
                    payment_method: row.get(20).ok(),
                    customer_type: row.get(21).ok(),
                    payment_claim: row.get(22).ok(),
                    paid_at: row.get(23).ok(),
                    files: files.iter().map(|f| OrderFileSummaryDto {
                        file_id: f.file_id.clone(),
                        original_filename: f.original_filename.clone(),
                        file_size_bytes: f.file_size_bytes,
                        document_pages: 1,
                        copies: f.print_settings.copies,
                        paper_size: f.print_settings.paper_size.clone(),
                        color_mode: f.print_settings.color_mode.clone(),
                        duplex_mode: f.print_settings.duplex_mode.clone(),
                        is_excluded: f.is_excluded,
                        is_purged: f.is_purged,
                        is_printed: f.is_printed,
                        printed_at: f.printed_at.clone(),
                        printed_on: f.printed_on.clone(),
                        target_printer: f.print_settings.target_printer.clone(),
                        auto_printer: f.auto_printer.clone(),
                        subtotal: None,
                    }).collect(),
                };

                return Ok(Some(OrderDetailDto {
                    order: summary,
                    files,
                }));
            }
            Ok(None)
        })
    }

    pub fn update_file_print_settings(
        &self,
        file_id: &str,
        settings: &PrintSettingsDto,
    ) -> Result<String, Box<dyn std::error::Error>> {
        settings.validate().map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, e)) as Box<dyn std::error::Error>)?;
        let summary = settings.to_summary();

        self.db.with_conn(|conn| {
            // Find the active file_revision_id for this file_id
            let mut stmt = conn.prepare(
                "SELECT fr.id FROM file_revisions fr 
                 JOIN order_revisions ord_r ON fr.order_revision_id = ord_r.id 
                 JOIN orders o ON ord_r.order_id = o.id AND ord_r.revision_number = o.current_revision_number 
                 WHERE fr.file_id = ?1"
            )?;
            let file_rev_id: String = stmt.query_row([file_id], |row| row.get(0))?;

            let rot = settings.rotation.unwrap_or(0);
            let target_printer = settings.target_printer.as_ref().map(|p| p.trim().to_string()).filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("AUTO"));
            conn.execute(
                "UPDATE print_settings 
                 SET mode = ?1, paper_size = ?2, color_mode = ?3, duplex_mode = ?4, 
                     copies = ?5, page_range = ?6, orientation = ?7, rotation = ?8, resolved_summary = ?9,
                     target_printer = COALESCE(?10, target_printer)
                 WHERE file_revision_id = ?11",
                params![
                    &settings.mode,
                    &settings.paper_size,
                    &settings.color_mode,
                    &settings.duplex_mode,
                    settings.copies,
                    &settings.page_range,
                    &settings.orientation,
                    rot,
                    &summary,
                    &target_printer,
                    &file_rev_id
                ],
            )?;

            Ok(summary)
        })
    }

    /// Sets or clears a manual target printer override for a specific file (`None` or `"AUTO"` reverts to automatic routing).
    pub fn set_file_target_printer(
        &self,
        file_id: &str,
        target_printer: Option<&str>,
    ) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let normalized = target_printer
            .map(|p| p.trim())
            .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("AUTO"))
            .map(|p| p.to_string());

        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT fr.id FROM file_revisions fr 
                 JOIN order_revisions ord_r ON fr.order_revision_id = ord_r.id 
                 JOIN orders o ON ord_r.order_id = o.id AND ord_r.revision_number = o.current_revision_number 
                 WHERE fr.file_id = ?1"
            )?;
            let file_rev_id: String = stmt.query_row([file_id], |row| row.get(0))?;

            conn.execute(
                "UPDATE print_settings SET target_printer = ?1 WHERE file_revision_id = ?2",
                params![&normalized, &file_rev_id],
            )?;

            info!("File '{}' target_printer override updated to: {:?}", file_id, normalized);
            Ok(normalized)
        })
    }

    pub fn approve_order(&self, order_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;

            // Get current revision id
            let rev_id: String = {
                let mut stmt = tx.prepare(
                    "SELECT r.id FROM order_revisions r 
                     JOIN orders o ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                     WHERE o.id = ?1"
                )?;
                stmt.query_row([order_id], |row| row.get(0))?
            };

            // 1. Update orders table status to APPROVED
            tx.execute(
                "UPDATE orders SET status = 'APPROVED', updated_at = datetime('now') WHERE id = ?1",
                params![order_id],
            )?;

            // 2. Mark revision as approved
            tx.execute(
                "UPDATE order_revisions SET is_approved = 1 WHERE id = ?1",
                params![&rev_id],
            )?;

            // 3. Record in approval_records table
            let approval_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO approval_records (id, order_id, order_revision_id, approved_by, status, created_at) 
                 VALUES (?1, ?2, ?3, 'SHOPKEEPER', 'APPROVED', datetime('now'))",
                params![&approval_id, order_id, &rev_id],
            )?;

            // 4. Record audit event
            tx.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) 
                 VALUES (?1, 'ORDER_APPROVED', '{\"approved_by\":\"SHOPKEEPER\"}')",
                params![order_id],
            )?;

            tx.commit()?;
            info!("Order {} successfully APPROVED by shopkeeper.", order_id);
            Ok(())
        })
    }

    pub fn reject_order(&self, order_id: &str, reason: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let tx = conn.transaction()?;

            // Get current revision id
            let rev_id: String = {
                let mut stmt = tx.prepare(
                    "SELECT r.id FROM order_revisions r 
                     JOIN orders o ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                     WHERE o.id = ?1"
                )?;
                stmt.query_row([order_id], |row| row.get(0))?
            };

            // 1. Update orders table status to REJECTED
            tx.execute(
                "UPDATE orders SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?1",
                params![order_id],
            )?;

            // 2. Mark revision as unapproved
            tx.execute(
                "UPDATE order_revisions SET is_approved = 0 WHERE id = ?1",
                params![&rev_id],
            )?;

            // 3. Record in approval_records table
            let approval_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO approval_records (id, order_id, order_revision_id, approved_by, status, rejection_reason, created_at) 
                 VALUES (?1, ?2, ?3, 'SHOPKEEPER', 'REJECTED', ?4, datetime('now'))",
                params![&approval_id, order_id, &rev_id, reason],
            )?;

            // 4. Record audit event
            let payload = serde_json::json!({
                "rejected_by": "SHOPKEEPER",
                "reason": reason.unwrap_or("No reason provided")
            }).to_string();
            tx.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) 
                 VALUES (?1, 'ORDER_REJECTED', ?2)",
                params![order_id, &payload],
            )?;

            tx.commit()?;
            info!("Order {} REJECTED by shopkeeper. Reason: {:?}", order_id, reason);
            Ok(())
        })
    }

    pub fn toggle_file_exclusion(
        &self,
        file_id: &str,
        is_excluded: bool,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            // Find active file_revision_id
            let mut stmt = conn.prepare(
                "SELECT fr.id FROM file_revisions fr 
                 JOIN order_revisions ord_r ON fr.order_revision_id = ord_r.id 
                 JOIN orders o ON ord_r.order_id = o.id AND ord_r.revision_number = o.current_revision_number 
                 WHERE fr.file_id = ?1"
            )?;
            let file_rev_id: String = stmt.query_row([file_id], |row| row.get(0))?;

            conn.execute(
                "UPDATE file_revisions SET is_deleted = ?1 WHERE id = ?2",
                params![if is_excluded { 1 } else { 0 }, &file_rev_id],
            )?;

            info!("File {} exclusion status set to {} by shopkeeper", file_id, is_excluded);
            Ok(is_excluded)
        })
    }

    pub fn restore_order(&self, order_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE orders SET status = 'AWAITING_APPROVAL', updated_at = datetime('now') WHERE id = ?1",
                params![order_id],
            )?;
            conn.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) 
                 VALUES (?1, 'ORDER_RESTORED', '{\"restored_by\":\"SHOPKEEPER\"}')",
                params![order_id],
            )?;
            info!("Order {} restored from trash to AWAITING_APPROVAL", order_id);
            Ok(())
        })
    }

    pub fn purge_order(&self, order_id: &str, storage_base_dir: Option<&std::path::Path>) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            if let Some(base) = storage_base_dir {
                let paths: Vec<String> = {
                    let mut f_stmt = conn.prepare(
                        "SELECT fr.storage_relative_path FROM file_revisions fr
                         JOIN files f ON fr.file_id = f.id
                         WHERE f.order_id = ?1"
                    )?;
                    let res: Vec<String> = f_stmt
                        .query_map([order_id], |r| r.get::<_, String>(0))?
                        .filter_map(Result::ok)
                        .collect();
                    res
                };
                for p in paths {
                    let full = base.join(&p);
                    let _ = crate::storage::StorageManager::secure_shred_file(&full);
                }
            }
            conn.execute("DELETE FROM orders WHERE id = ?1", params![order_id])?;
            info!("Order {} permanently purged and shredded from database and disk", order_id);
            Ok(())
        })
    }

    /// Automatically clears rejected orders created on any day prior to today (local date)
    /// that are in the Dustbin (status = 'REJECTED'), securely shredding any files on disk.
    /// Completed and customer-purged financial orders in the ledger are NEVER deleted.
    pub fn clean_dustbin_previous_days(&self, storage_base_dir: &std::path::Path) -> Result<usize, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM orders 
                 WHERE date(created_at, 'localtime') < date('now', 'localtime')
                   AND status = 'REJECTED'"
            )?;
            let order_ids: Vec<String> = stmt.query_map([], |row| row.get(0))?
                .filter_map(Result::ok)
                .collect();

            let count = order_ids.len();
            for oid in &order_ids {
                let paths: Vec<String> = {
                    let mut f_stmt = conn.prepare(
                        "SELECT fr.storage_relative_path FROM file_revisions fr
                         JOIN files f ON fr.file_id = f.id
                         WHERE f.order_id = ?1"
                    )?;
                    let res: Vec<String> = f_stmt
                        .query_map([oid], |r| r.get::<_, String>(0))?
                        .filter_map(Result::ok)
                        .collect();
                    res
                };
                for p in paths {
                    let full = storage_base_dir.join(&p);
                    let _ = crate::storage::StorageManager::secure_shred_file(&full);
                }
                let _ = conn.execute("DELETE FROM orders WHERE id = ?1", [oid]);
            }
            if count > 0 {
                info!("Cleaned {} previous day's rejected dustbin orders from database and disk", count);
            }
            Ok(count)
        })
    }

    /// Empties all orders currently in the Dustbin (status REJECTED by shopkeeper)
    /// regardless of date, along with securely shredding any lingering files on disk.
    pub fn empty_dustbin(&self, storage_base_dir: &std::path::Path) -> Result<usize, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM orders WHERE status = 'REJECTED'"
            )?;
            let order_ids: Vec<String> = stmt.query_map([], |row| row.get(0))?
                .filter_map(Result::ok)
                .collect();

            let count = order_ids.len();
            for oid in &order_ids {
                let paths: Vec<String> = {
                    let mut f_stmt = conn.prepare(
                        "SELECT fr.storage_relative_path FROM file_revisions fr
                         JOIN files f ON fr.file_id = f.id
                         WHERE f.order_id = ?1"
                    )?;
                    let res: Vec<String> = f_stmt
                        .query_map([oid], |r| r.get::<_, String>(0))?
                        .filter_map(Result::ok)
                        .collect();
                    res
                };
                for p in paths {
                    let full = storage_base_dir.join(&p);
                    let _ = crate::storage::StorageManager::secure_shred_file(&full);
                }
                let _ = conn.execute("DELETE FROM orders WHERE id = ?1", [oid]);
            }
            info!("Emptied all {} orders from Dustbin", count);
            Ok(count)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_order_creation_and_query() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        
        // Seed transfer session
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO transfer_sessions (id, token, lan_ip, port, status, expires_at) 
                 VALUES ('sess-test', 'tok-123', '127.0.0.1', 8080, 'ACTIVE', datetime('now', '+30 minutes'))",
                [],
            )?;
            Ok(())
        }).unwrap();

        let mgr = OrderManager::new(db.clone());

        let files = vec![
            SubmittedFileDto {
                file_id: "doc-1".to_string(),
                filename: "resume.pdf".to_string(),
                file_size_bytes: 45000,
                sha256_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
                settings: PrintSettingsDto {
                    mode: "MANUAL".to_string(),
                    paper_size: "A4".to_string(),
                    color_mode: "BW".to_string(),
                    duplex_mode: "DUPLEX_LONG_EDGE".to_string(),
                    copies: 2,
                    orientation: "AUTO".to_string(),
                    page_range: None,
                    rotation: Some(0),
                    target_printer: None,
                },
            },
            SubmittedFileDto {
                file_id: "doc-2".to_string(),
                filename: "photo.jpg".to_string(),
                file_size_bytes: 3200000,
                sha256_hash: "ca978112ca1bbdcafac231b39a23dc4da786081cd1e14b54e28729485f8f9d33".to_string(),
                settings: PrintSettingsDto::default(),
            },
        ];

        let (order_id, pickup_code) = mgr.submit_order(
            "sess-test",
            Some("Please print quickly"),
            Some("Rahul"),
            Some("Samsung S23"),
            Some("dev-123"),
            &files,
            None,
            None,
        ).expect("Submit failed");
        assert!(!order_id.is_empty());
        assert!(!pickup_code.is_empty());

        let orders = mgr.list_orders().expect("List failed");
        assert_eq!(orders.len(), 1);
        assert_eq!(orders[0].id, order_id);
        assert_eq!(orders[0].customer_name.as_deref(), Some("Rahul"));
        assert_eq!(orders[0].pickup_code.as_deref(), Some(pickup_code.as_str()));
        assert_eq!(orders[0].total_files, 2);
        assert_eq!(orders[0].status, "AWAITING_APPROVAL");

        let details = mgr.get_order_details(&order_id).expect("Details failed").expect("Order not found");
        assert_eq!(details.files.len(), 2);
        assert_eq!(details.files[0].original_filename, "resume.pdf");
        assert_eq!(details.files[0].print_settings.copies, 2);
        assert_eq!(details.files[0].print_settings.duplex_mode, "DUPLEX_LONG_EDGE");
        assert_eq!(details.files[1].original_filename, "photo.jpg");

        // Test updating file print settings by shopkeeper
        let updated_settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "COLOR".to_string(),
            duplex_mode: "DUPLEX_SHORT_EDGE".to_string(),
            copies: 5,
            orientation: "LANDSCAPE".to_string(),
            page_range: Some("1-2".to_string()),
            rotation: Some(90),
            target_printer: None,
        };
        let new_summary = mgr.update_file_print_settings(&details.files[0].file_id, &updated_settings).expect("Update failed");
        assert!(new_summary.contains("5 copies"));
        assert!(new_summary.contains("Rotated 90°"));

        let updated_details = mgr.get_order_details(&order_id).expect("Details failed").unwrap();
        assert_eq!(updated_details.files[0].print_settings.copies, 5);
        assert_eq!(updated_details.files[0].print_settings.color_mode, "COLOR");
        assert_eq!(updated_details.files[0].print_settings.duplex_mode, "DUPLEX_SHORT_EDGE");

        // Test Approval
        mgr.approve_order(&order_id).expect("Approve failed");
        let approved_details = mgr.get_order_details(&order_id).expect("Details failed").unwrap();
        assert_eq!(approved_details.order.status, "APPROVED");

        // Test Rejection
        mgr.reject_order(&order_id, Some("File corrupted")).expect("Reject failed");
        let rejected_details = mgr.get_order_details(&order_id).expect("Details failed").unwrap();
        assert_eq!(rejected_details.order.status, "REJECTED");

        // Test Dustbin cleaning: verify only REJECTED orders are cleaned, COMPLETED ledger orders remain permanent
        let temp_dir = std::env::temp_dir();
        // Create a completed order from yesterday to verify it is NOT cleaned
        let completed_order_id = "test_completed_ledger_order";
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO orders (id, session_id, current_revision_number, status, created_at, updated_at)
                 VALUES (?1, 'sess-test', 1, 'COMPLETED', datetime('now', '-2 days'), datetime('now', '-2 days'))",
                params![completed_order_id],
            )?;
            conn.execute(
                "INSERT INTO order_revisions (id, order_id, revision_number, total_files, total_bytes, is_approved, created_at)
                 VALUES ('rev_test_comp', ?1, 1, 1, 100, 1, datetime('now', '-2 days'))",
                params![completed_order_id],
            )?;
            // Manually backdate the rejected order to yesterday in DB to test clean_dustbin_previous_days
            conn.execute("UPDATE orders SET created_at = datetime('now', '-2 days') WHERE id = ?1", [&order_id])?;
            Ok(())
        }).unwrap();

        let cleaned = mgr.clean_dustbin_previous_days(&temp_dir).expect("Clean failed");
        assert_eq!(cleaned, 1);
        let post_clean_rejected = mgr.get_order_details(&order_id).expect("Details failed");
        assert!(post_clean_rejected.is_none(), "Rejected order must be cleaned from dustbin");

        let post_clean_completed = mgr.get_order_details(completed_order_id).expect("Details failed");
        assert!(post_clean_completed.is_some(), "Completed ledger order from previous day must NEVER be deleted");
    }
}
