use crate::db::Database;
use crate::models::PrintSettingsDto;
use crate::storage::StorageManager;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperRate {
    pub bw_single: f64,
    pub bw_duplex_sheet: f64,
    pub color_single: f64,
    pub color_duplex_sheet: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricingRateCard {
    pub currency: String,
    pub a4: PaperRate,
    pub a3: PaperRate,
    pub legal: PaperRate,
    pub plotter: PaperRate,
}

impl Default for PricingRateCard {
    fn default() -> Self {
        Self {
            currency: "₹".to_string(),
            a4: PaperRate {
                bw_single: 3.0,
                bw_duplex_sheet: 5.0,
                color_single: 10.0,
                color_duplex_sheet: 18.0,
            },
            a3: PaperRate {
                bw_single: 10.0,
                bw_duplex_sheet: 18.0,
                color_single: 25.0,
                color_duplex_sheet: 45.0,
            },
            legal: PaperRate {
                bw_single: 4.0,
                bw_duplex_sheet: 7.0,
                color_single: 12.0,
                color_duplex_sheet: 22.0,
            },
            plotter: PaperRate {
                bw_single: 50.0,
                bw_duplex_sheet: 50.0,
                color_single: 120.0,
                color_duplex_sheet: 120.0,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpiPaymentSettings {
    pub enabled: bool,
    pub business_name: String,
    pub upi_id: String,
    pub show_desk_qr: bool,
    #[serde(default)]
    pub razorpay_enabled: bool,
    #[serde(default)]
    pub razorpay_key_id: String,
    #[serde(default)]
    pub razorpay_key_secret: String,
    #[serde(default)]
    pub razorpay_qr_id: String,
    #[serde(default)]
    pub razorpay_qr_image_url: String,
    #[serde(default)]
    pub razorpay_qr_payload: String,
}

impl Default for UpiPaymentSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            business_name: "".to_string(),
            upi_id: "".to_string(),
            show_desk_qr: false,
            razorpay_enabled: false,
            razorpay_key_id: "".to_string(),
            razorpay_key_secret: "".to_string(),
            razorpay_qr_id: "".to_string(),
            razorpay_qr_image_url: "".to_string(),
            razorpay_qr_payload: "".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBillingDetailDto {
    pub file_id: String,
    pub original_filename: String,
    pub is_excluded: bool,
    pub is_purged: bool,
    pub document_pages: u32,
    pub effective_pages: u32,
    pub copies: u32,
    pub paper_size: String,
    pub color_mode: String,
    pub duplex_mode: String,
    pub total_sheets: u32,
    pub duplex_sheets: u32,
    pub simplex_sheets: u32,
    pub unit_rate_description: String,
    pub subtotal: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderBillingDto {
    pub order_id: String,
    pub customer_type: String, // "WALK_IN" | "REMOTE"
    pub payment_status: String, // "UNPAID" | "PAID" | "CREDIT"
    pub payment_method: Option<String>, // "CASH" | "ONLINE"
    pub paid_at: Option<String>,
    pub payment_claim: Option<String>, // "CLAIMED" | "CONFIRMED" | None
    pub payment_claim_at: Option<String>,
    pub corporate_client_id: Option<String>,
    pub currency: String,
    pub subtotal: f64,
    pub total_amount: f64,
    pub total_sheets: u32,
    pub total_pages: u32,
    pub files: Vec<FileBillingDetailDto>,
    pub created_at: String,
    pub updated_at: String,
}

/// Parses page range string (e.g. "1-5", "1-3, 5, 8-10") and clamps to document bounds (1..=max_pages).
pub fn parse_page_range_count(range_str: &str, max_pages: u32) -> u32 {
    let mut selected = HashSet::new();
    for part in range_str.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start_s, end_s)) = part.split_once('-') {
            if let (Ok(start), Ok(end)) = (start_s.trim().parse::<u32>(), end_s.trim().parse::<u32>()) {
                let s = start.max(1);
                let e = end.min(max_pages);
                if s <= e {
                    for p in s..=e {
                        selected.insert(p);
                    }
                }
            }
        } else if let Ok(page) = part.parse::<u32>() {
            if page >= 1 && page <= max_pages {
                selected.insert(page);
            }
        }
    }
    if selected.is_empty() {
        max_pages.max(1)
    } else {
        selected.len() as u32
    }
}

/// Robustly detects page count from an on-disk document file.
/// Handles verified files stored as `.dat` by checking original filename and magic bytes.
pub fn detect_document_pages(path: &Path, original_filename: Option<&str>) -> u32 {
    let lower_orig = original_filename.unwrap_or("").to_lowercase();
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();

    // 1. Check if PDF (by original filename, path extension, or %PDF- magic bytes)
    let is_pdf = lower_orig.ends_with(".pdf") || ext == "pdf" || crate::printer::is_pdf_file(path);

    if is_pdf {
        // Strategy A: parse structured document tree using lopdf
        if let Ok(doc) = lopdf::Document::load(path) {
            let count = doc.get_pages().len() as u32;
            if count > 0 {
                return count;
            }
        }

        // Strategy B: stream scanner for /Type /Page and /Count
        if let Ok(bytes) = std::fs::read(path) {
            let mut best_count = 0u32;
            let mut page_objs = 0u32;
            
            // Search /Count <digits>
            let mut i = 0;
            while i + 7 < bytes.len() {
                if &bytes[i..i+6] == b"/Count" {
                    let mut j = i + 6;
                    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t' || bytes[j] == b'\r' || bytes[j] == b'\n') {
                        j += 1;
                    }
                    let num_start = j;
                    while j < bytes.len() && bytes[j].is_ascii_digit() {
                        j += 1;
                    }
                    if j > num_start {
                        if let Ok(s) = std::str::from_utf8(&bytes[num_start..j]) {
                            if let Ok(n) = s.parse::<u32>() {
                                if n > best_count {
                                    best_count = n;
                                }
                            }
                        }
                    }
                }
                i += 1;
            }

            // Search /Type /Page (excluding /Type /Pages)
            let mut k = 0;
            while k + 11 < bytes.len() {
                if &bytes[k..k+5] == b"/Type" {
                    let mut m = k + 5;
                    while m < bytes.len() && (bytes[m] == b' ' || bytes[m] == b'\t' || bytes[m] == b'\r' || bytes[m] == b'\n') {
                        m += 1;
                    }
                    if m + 5 <= bytes.len() && &bytes[m..m+5] == b"/Page" {
                        // Ensure not /Pages
                        if m + 6 > bytes.len() || bytes[m+5] != b's' {
                            page_objs += 1;
                        }
                    }
                }
                k += 1;
            }

            if best_count > 0 {
                return best_count;
            }
            if page_objs > 0 {
                return page_objs;
            }
        }
        return 1;
    }

    // 2. Check if Excel workbook
    let is_excel = lower_orig.ends_with(".xlsx") || lower_orig.ends_with(".xls") || ext == "xlsx" || ext == "xls";
    if is_excel {
        if let Ok(meta) = crate::documents::excel::inspect_excel_file(path) {
            let active_sheets = meta.sheets.iter().filter(|s| !s.is_empty).count() as u32;
            if active_sheets > 0 {
                return active_sheets;
            }
            if meta.total_sheets > 0 {
                return meta.total_sheets as u32;
            }
        }
        return 1;
    }

    // 3. Images or other documents
    1
}

/// Calculates billing for a single file according to print settings and rates.
pub fn calculate_file_billing(
    file_id: &str,
    original_filename: &str,
    is_excluded: bool,
    is_purged: bool,
    doc_pages: u32,
    settings: &PrintSettingsDto,
    rates: &PricingRateCard,
) -> FileBillingDetailDto {
    if is_excluded {
        return FileBillingDetailDto {
            file_id: file_id.to_string(),
            original_filename: original_filename.to_string(),
            is_excluded: true,
            is_purged,
            document_pages: doc_pages,
            effective_pages: 0,
            copies: settings.copies,
            paper_size: settings.paper_size.clone(),
            color_mode: settings.color_mode.clone(),
            duplex_mode: settings.duplex_mode.clone(),
            total_sheets: 0,
            duplex_sheets: 0,
            simplex_sheets: 0,
            unit_rate_description: "Excluded from print batch".to_string(),
            subtotal: 0.0,
        };
    }

    let eff_pages = match &settings.page_range {
        Some(range) if !range.trim().is_empty() && !range.eq_ignore_ascii_case("all") => {
            parse_page_range_count(range, doc_pages)
        }
        _ => doc_pages.max(1),
    };

    let copies = settings.copies.max(1);
    let paper_key = settings.paper_size.to_uppercase();
    let paper_rate = match paper_key.as_str() {
        "A3" => &rates.a3,
        "LEGAL" => &rates.legal,
        "PLOTTER" => &rates.plotter,
        _ => &rates.a4,
    };

    let is_color = settings.color_mode.eq_ignore_ascii_case("COLOR");
    let is_duplex = (settings.duplex_mode == "DUPLEX_LONG_EDGE" || settings.duplex_mode == "DUPLEX_SHORT_EDGE")
        && paper_key != "PLOTTER"; // Plotters are roll-feed single-sided

    let (duplex_sheets_per_copy, simplex_sheets_per_copy) = if is_duplex {
        let full_duplex = eff_pages / 2;
        let odd_simplex = eff_pages % 2;
        (full_duplex, odd_simplex)
    } else {
        (0, eff_pages)
    };

    let total_duplex_sheets = duplex_sheets_per_copy * copies;
    let total_simplex_sheets = simplex_sheets_per_copy * copies;
    let total_sheets = total_duplex_sheets + total_simplex_sheets;

    let (duplex_unit_rate, simplex_unit_rate) = if is_color {
        (paper_rate.color_duplex_sheet, paper_rate.color_single)
    } else {
        (paper_rate.bw_duplex_sheet, paper_rate.bw_single)
    };

    let subtotal = (total_duplex_sheets as f64 * duplex_unit_rate) + (total_simplex_sheets as f64 * simplex_unit_rate);

    let unit_rate_desc = if is_duplex {
        if simplex_sheets_per_copy > 0 {
            format!(
                "{} Duplex: ₹{:.2}/sheet (2-sided), ₹{:.2}/single page",
                if is_color { "Color" } else { "B&W" },
                duplex_unit_rate,
                simplex_unit_rate
            )
        } else {
            format!(
                "{} Duplex: ₹{:.2}/sheet (2-sided)",
                if is_color { "Color" } else { "B&W" },
                duplex_unit_rate
            )
        }
    } else {
        format!(
            "{} Single: ₹{:.2}/page",
            if is_color { "Color" } else { "B&W" },
            simplex_unit_rate
        )
    };

    FileBillingDetailDto {
        file_id: file_id.to_string(),
        original_filename: original_filename.to_string(),
        is_excluded: false,
        is_purged,
        document_pages: doc_pages,
        effective_pages: eff_pages,
        copies,
        paper_size: settings.paper_size.clone(),
        color_mode: settings.color_mode.clone(),
        duplex_mode: settings.duplex_mode.clone(),
        total_sheets,
        duplex_sheets: total_duplex_sheets,
        simplex_sheets: total_simplex_sheets,
        unit_rate_description: unit_rate_desc,
        subtotal,
    }
}

pub struct PricingManager {
    db: Arc<Database>,
}

impl PricingManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn get_rate_card(&self) -> PricingRateCard {
        match self.db.get_config("print_pricing_rates") {
            Ok(Some(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
            _ => PricingRateCard::default(),
        }
    }

    pub fn save_rate_card(&self, card: &PricingRateCard) -> Result<(), String> {
        let json = serde_json::to_string(card).map_err(|e| e.to_string())?;
        self.db.set_config("print_pricing_rates", &json).map_err(|e| e.to_string())
    }

    pub fn get_upi_settings(&self) -> UpiPaymentSettings {
        match self.db.get_config("upi_payment_settings") {
            Ok(Some(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
            _ => UpiPaymentSettings::default(),
        }
    }

    pub fn save_upi_settings(&self, settings: &UpiPaymentSettings) -> Result<(), String> {
        let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        self.db.set_config("upi_payment_settings", &json).map_err(|e| e.to_string())
    }

    pub fn claim_order_payment(&self, order_id: &str, method: &str) -> Result<(), String> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE order_billings 
                 SET payment_claim = 'CLAIMED', payment_claim_at = CURRENT_TIMESTAMP,
                     payment_method = ?1, updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = ?2",
                params![method, order_id],
            )?;
            conn.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'CUSTOMER_CLAIMED_PAYMENT', ?2)",
                params![order_id, serde_json::json!({ "method": method }).to_string()],
            )?;
            Ok(())
        }).map_err(|e| e.to_string())
    }

    pub fn get_order_billing(&self, order_id: &str) -> Result<Option<OrderBillingDto>, String> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT order_id, customer_type, payment_status, payment_method, paid_at,
                        corporate_client_id, currency, subtotal, total_amount, billing_details_json,
                        created_at, updated_at, payment_claim, payment_claim_at
                 FROM order_billings WHERE order_id = ?1",
            )?;

            let mut rows = stmt.query(params![order_id])?;
            if let Some(row) = rows.next()? {
                let order_id: String = row.get(0)?;
                let customer_type: String = row.get(1)?;
                let payment_status: String = row.get(2)?;
                let payment_method: Option<String> = row.get(3)?;
                let paid_at: Option<String> = row.get(4)?;
                let corporate_client_id: Option<String> = row.get(5)?;
                let currency: String = row.get(6)?;
                let subtotal: f64 = row.get(7)?;
                let total_amount: f64 = row.get(8)?;
                let billing_json: String = row.get(9)?;
                let created_at: String = row.get(10)?;
                let updated_at: String = row.get(11)?;
                let payment_claim: Option<String> = row.get(12).unwrap_or(None);
                let payment_claim_at: Option<String> = row.get(13).unwrap_or(None);

                let files: Vec<FileBillingDetailDto> = serde_json::from_str(&billing_json).unwrap_or_default();
                let total_sheets: u32 = files.iter().map(|f| f.total_sheets).sum();
                let total_pages: u32 = files.iter().map(|f| f.effective_pages * f.copies).sum();

                Ok(Some(OrderBillingDto {
                    order_id,
                    customer_type,
                    payment_status,
                    payment_method,
                    paid_at,
                    payment_claim,
                    payment_claim_at,
                    corporate_client_id,
                    currency,
                    subtotal,
                    total_amount,
                    total_sheets,
                    total_pages,
                    files,
                    created_at,
                    updated_at,
                }))
            } else {
                Ok(None)
            }
        }).map_err(|e| e.to_string())
    }

    /// Calculates order billing, snapshots all items into SQLite `order_billings`, and returns the DTO.
    pub fn calculate_and_save_order_billing(
        &self,
        order_id: &str,
        customer_type_override: Option<&str>,
        storage_mgr: &StorageManager,
    ) -> Result<OrderBillingDto, String> {
        let rates = self.get_rate_card();

        // 1. Fetch order details and files
        let (order_info, files_info) = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT o.id, o.corporate_client_id, o.status
                 FROM orders o WHERE o.id = ?1",
            )?;
            let order_row = stmt.query_row(params![order_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;

            let mut files_stmt = conn.prepare(
                "SELECT f.id, f.original_filename, fr.is_deleted, ps.mode, ps.paper_size,
                        ps.color_mode, ps.duplex_mode, ps.copies, ps.page_range, ps.rotation
                 FROM files f
                 JOIN file_revisions fr ON f.id = fr.file_id
                 JOIN order_revisions ord_r ON fr.order_revision_id = ord_r.id
                 JOIN orders o ON ord_r.order_id = o.id AND ord_r.revision_number = o.current_revision_number
                 JOIN print_settings ps ON ps.file_revision_id = fr.id
                 WHERE o.id = ?1
                 ORDER BY f.created_at ASC",
            )?;

            let files = files_stmt.query_map(params![order_id], |row| {
                let file_id: String = row.get(0)?;
                let original_filename: String = row.get(1)?;
                let is_deleted: bool = row.get(2)?;
                let mode: String = row.get(3)?;
                let paper_size: String = row.get(4)?;
                let color_mode: String = row.get(5)?;
                let duplex_mode: String = row.get(6)?;
                let copies: u32 = row.get(7)?;
                let page_range: Option<String> = row.get(8)?;
                let rotation: Option<u32> = row.get(9)?;

                let settings = PrintSettingsDto {
                    mode,
                    paper_size,
                    color_mode,
                    duplex_mode,
                    copies,
                    orientation: "AUTO".to_string(),
                    page_range,
                    rotation,
                    target_printer: None,
                };

                Ok((file_id, original_filename, is_deleted, settings))
            })?.collect::<Result<Vec<_>, _>>()?;

            Ok((order_row, files))
        }).map_err(|e| format!("Failed to read order data for billing: {}", e))?;

        let (canonical_order_id, corporate_client_id, order_status) = order_info;

        // Check customer purge events
        let purged_ids: HashSet<String> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT payload_json FROM order_events WHERE order_id = ?1 AND event_type = 'CUSTOMER_PURGED_FILE'",
            )?;
            let ids = stmt.query_map(params![order_id], |row| {
                let json_str: String = row.get(0)?;
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    Ok(val.get("fileId").and_then(|v| v.as_str()).unwrap_or("").to_string())
                } else {
                    Ok(String::new())
                }
            })?.filter_map(|r| r.ok()).filter(|s| !s.is_empty()).collect::<HashSet<_>>();
            Ok(ids)
        }).unwrap_or_default();

        let is_all_purged = order_status == "PURGED_BY_CUSTOMER";

        // Pre-fetch any existing billing record to preserve historic page counts and subtotals if files are erased from disk
        let existing_record: Option<(String, String, Option<String>, Option<String>, String, Option<String>, Option<String>, f64, f64, String)> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT customer_type, payment_status, payment_method, paid_at, created_at, payment_claim, payment_claim_at, subtotal, total_amount, billing_details_json
                 FROM order_billings WHERE order_id = ?1",
            )?;
            let row = stmt.query_row(params![order_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                ))
            }).ok();
            Ok(row)
        }).unwrap_or(None);

        let prev_files: HashMap<String, FileBillingDetailDto> = if let Some((_, _, _, _, _, _, _, _, _, ref prev_json)) = existing_record {
            serde_json::from_str::<Vec<FileBillingDetailDto>>(prev_json)
                .unwrap_or_default()
                .into_iter()
                .map(|f| (f.file_id.clone(), f))
                .collect()
        } else {
            HashMap::new()
        };

        // 2. Process each file
        let mut file_billings = Vec::new();
        for (file_id, original_filename, is_deleted, settings) in files_info {
            let is_purged = is_all_purged || purged_ids.contains(&file_id);

            let doc_pages = if let Ok(path) = storage_mgr.resolve_verified_file_path(&self.db, &file_id) {
                if path.exists() {
                    detect_document_pages(&path, Some(&original_filename))
                } else {
                    prev_files.get(&file_id).map(|f| f.document_pages).unwrap_or(1)
                }
            } else {
                prev_files.get(&file_id).map(|f| f.document_pages).unwrap_or(1)
            };

            // If an order is completed, purged by customer for privacy, or paid, the files were NOT excluded from printing
            let effective_excluded = is_deleted && order_status != "COMPLETED" && order_status != "PURGED_BY_CUSTOMER";

            let mut file_billing = calculate_file_billing(
                &file_id,
                &original_filename,
                effective_excluded,
                is_purged,
                doc_pages,
                &settings,
                &rates,
            );

            // If file was previously billed with positive amount and is now purged from disk, preserve historical subtotal
            if let Some(prev) = prev_files.get(&file_id) {
                if file_billing.subtotal <= 0.0 && prev.subtotal > 0.0 && !file_billing.is_excluded {
                    file_billing.subtotal = prev.subtotal;
                    file_billing.total_sheets = prev.total_sheets;
                    file_billing.effective_pages = prev.effective_pages;
                }
            }

            file_billings.push(file_billing);
        }

        let mut subtotal: f64 = file_billings.iter().map(|f| f.subtotal).sum();
        let mut total_amount = subtotal;

        // If order has already been PAID, total_amount and subtotal are immutable financial records!
        if let Some((_, ref p_status, _, _, _, _, _, prev_sub, prev_tot, _)) = existing_record {
            if p_status == "PAID" && prev_tot > 0.0 {
                total_amount = prev_tot;
                subtotal = prev_sub;
                if file_billings.len() == 1 {
                    file_billings[0].subtotal = prev_tot;
                }
            } else if total_amount <= 0.0 && prev_tot > 0.0 {
                total_amount = prev_tot;
                subtotal = prev_sub;
            }
        }

        let total_sheets: u32 = file_billings.iter().map(|f| f.total_sheets).sum();
        let total_pages: u32 = file_billings.iter().map(|f| f.effective_pages * f.copies).sum();

        let billing_json = serde_json::to_string(&file_billings).unwrap_or_else(|_| "[]".to_string());

        // 3. Insert or update order_billings while preserving existing payment_status / method / claim
        let (customer_type, payment_status, payment_method, paid_at, created_at, updated_at, payment_claim, payment_claim_at) = self.db.with_conn(|conn| {
            let now = chrono::Utc::now().to_rfc3339();
            if let Some((cust_type, ref p_status, ref p_method, ref p_at, ref c_at, ref p_claim, ref p_claim_at, prev_sub, prev_tot, _)) = existing_record {
                let resolved_type = customer_type_override.unwrap_or(&cust_type).to_string();
                let final_total = if p_status == "PAID" && prev_tot > 0.0 {
                    prev_tot
                } else if total_amount > 0.0 {
                    total_amount
                } else if prev_tot > 0.0 {
                    prev_tot
                } else {
                    0.0
                };
                let final_subtotal = if p_status == "PAID" && prev_sub > 0.0 {
                    prev_sub
                } else if subtotal > 0.0 {
                    subtotal
                } else if prev_sub > 0.0 {
                    prev_sub
                } else {
                    0.0
                };

                conn.execute(
                    "UPDATE order_billings
                     SET customer_type = ?1, subtotal = ?2, total_amount = ?3,
                         billing_details_json = ?4, updated_at = CURRENT_TIMESTAMP
                     WHERE order_id = ?5",
                    params![resolved_type, final_subtotal, final_total, billing_json, order_id],
                )?;
                Ok((resolved_type, p_status.clone(), p_method.clone(), p_at.clone(), c_at.clone(), now, p_claim.clone(), p_claim_at.clone()))
            } else {
                let default_cust_type = customer_type_override.unwrap_or("WALK_IN").to_string();
                let billing_id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO order_billings
                     (id, order_id, corporate_client_id, customer_type, subtotal, total_amount,
                      currency, payment_status, billing_details_json, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, '₹', 'UNPAID', ?7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                    params![billing_id, order_id, corporate_client_id, default_cust_type, subtotal, total_amount, billing_json],
                )?;
                Ok((default_cust_type, "UNPAID".to_string(), None, None, now.clone(), now, None, None))
            }
        }).map_err(|e| format!("Failed to record order billing: {}", e))?;

        info!("Calculated and saved billing for Order '{}': Total ₹{:.2} ({} files, {} sheets)", canonical_order_id, total_amount, file_billings.len(), total_sheets);

        Ok(OrderBillingDto {
            order_id: canonical_order_id,
            customer_type,
            payment_status,
            payment_method,
            paid_at,
            payment_claim,
            payment_claim_at,
            corporate_client_id,
            currency: "₹".to_string(),
            subtotal,
            total_amount,
            total_sheets,
            total_pages,
            files: file_billings,
            created_at,
            updated_at,
        })
    }

    /// Updates payment state (UNPAID, PAID, CREDIT), method (CASH, ONLINE), and customer type.
    pub fn update_order_payment(
        &self,
        order_id: &str,
        payment_status: &str,
        payment_method: Option<&str>,
        customer_type: Option<&str>,
    ) -> Result<OrderBillingDto, String> {
        let valid_statuses = ["UNPAID", "PAID", "CREDIT"];
        if !valid_statuses.contains(&payment_status) {
            return Err(format!("Invalid payment status: '{}'", payment_status));
        }

        if let Some(m) = payment_method {
            let valid_methods = ["CASH", "ONLINE"];
            if !valid_methods.contains(&m) {
                return Err(format!("Invalid payment method: '{}'. Must be CASH or ONLINE", m));
            }
        }

        let paid_at = if payment_status == "PAID" {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            None
        };

        let payment_claim = if payment_status == "PAID" {
            Some("CONFIRMED")
        } else {
            None
        };

        self.db.with_conn(|conn| {
            if let Some(c_type) = customer_type {
                conn.execute(
                    "UPDATE order_billings
                     SET payment_status = ?1, payment_method = ?2, paid_at = ?3,
                         payment_claim = COALESCE(?4, payment_claim),
                         customer_type = ?5, updated_at = CURRENT_TIMESTAMP
                     WHERE order_id = ?6",
                    params![payment_status, payment_method, paid_at, payment_claim, c_type, order_id],
                )?;
            } else {
                conn.execute(
                    "UPDATE order_billings
                     SET payment_status = ?1, payment_method = ?2, paid_at = ?3,
                         payment_claim = COALESCE(?4, payment_claim),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE order_id = ?5",
                    params![payment_status, payment_method, paid_at, payment_claim, order_id],
                )?;
            }
            Ok(())
        }).map_err(|e| format!("Failed to update order payment: {}", e))?;

        self.get_order_billing(order_id)?
            .ok_or_else(|| format!("Billing record not found for order '{}'", order_id))
    }

    /// Recalculates and updates billing for all active/unpaid orders.
    pub fn recalculate_all_unpaid_orders(&self, storage_mgr: &StorageManager) {
        let order_ids: Vec<String> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id FROM orders WHERE status NOT IN ('REJECTED', 'PURGED_BY_CUSTOMER')",
            )?;
            let ids = stmt.query_map([], |row| row.get(0))?
                .filter_map(|r| r.ok())
                .collect::<Vec<String>>();
            Ok(ids)
        }).unwrap_or_default();

        for oid in order_ids {
            let _ = self.calculate_and_save_order_billing(&oid, None, storage_mgr);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_page_range_count() {
        assert_eq!(parse_page_range_count("1-5", 10), 5);
        assert_eq!(parse_page_range_count("1-3, 5, 8-10", 10), 7);
        assert_eq!(parse_page_range_count("1-20", 5), 5); // Clamped to max_pages
        assert_eq!(parse_page_range_count("all", 8), 8);
        assert_eq!(parse_page_range_count("", 8), 8);
    }

    #[test]
    fn test_simplex_and_duplex_calculation() {
        let rates = PricingRateCard::default();

        // 1. Simplex B&W 4 pages, 2 copies on A4
        let s1 = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "BW".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 2,
            orientation: "AUTO".to_string(),
            page_range: None,
            rotation: Some(0),
            target_printer: None,
        };
        let b1 = calculate_file_billing("f1", "doc1.pdf", false, false, 4, &s1, &rates);
        assert_eq!(b1.total_sheets, 8); // 4 pages * 2 copies
        assert_eq!(b1.subtotal, 24.0); // 8 * 3.0

        // 2. Duplex B&W 3 pages, 1 copy on A4
        let s2 = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "BW".to_string(),
            duplex_mode: "DUPLEX_LONG_EDGE".to_string(),
            copies: 1,
            orientation: "AUTO".to_string(),
            page_range: None,
            rotation: Some(0),
            target_printer: None,
        };
        let b2 = calculate_file_billing("f2", "doc2.pdf", false, false, 3, &s2, &rates);
        assert_eq!(b2.duplex_sheets, 1);
        assert_eq!(b2.simplex_sheets, 1);
        assert_eq!(b2.total_sheets, 2);
        assert_eq!(b2.subtotal, 8.0);

        // 3. Plotter B&W Building Plan (50.0 per sheet)
        let s3 = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "PLOTTER".to_string(),
            color_mode: "BW".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 2,
            orientation: "LANDSCAPE".to_string(),
            page_range: None,
            rotation: Some(0),
            target_printer: None,
        };
        let b3 = calculate_file_billing("f3", "plan.dwg.pdf", false, false, 1, &s3, &rates);
        assert_eq!(b3.subtotal, 100.0); // 2 copies * 50.0

        // 4. Excluded file
        let b4 = calculate_file_billing("f4", "skip.pdf", true, false, 10, &s1, &rates);
        assert_eq!(b4.subtotal, 0.0);
        assert!(b4.is_excluded);
    }

    #[test]
    fn test_detect_pages_with_dat_extension() {
        let app_data = std::env::var_os("APPDATA").map(std::path::PathBuf::from);
        if let Some(app_dir) = app_data {
            let sample = app_dir.join("PrintDrop").join("storage").join("verified").join("doc_u3smaznn.dat");
            if sample.exists() {
                let count = detect_document_pages(&sample, Some("CamScanner..pdf"));
                assert_eq!(count, 5);
            }
        }
    }
}
