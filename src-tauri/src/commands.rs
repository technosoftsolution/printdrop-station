use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use base64::Engine;
use tracing::{info, error};
use crate::documents::excel::ExcelMetadata;
use crate::network::{list_available_interfaces, NetworkInterfaceInfo};
use crate::orders::{OrderDetailDto, OrderSummaryDto};
use crate::server::session::SessionInfo;
use crate::wifi::WifiInfo;
use crate::tunnel::TunnelInfo;
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub db_status: String,
    pub lan_ip: String,
    pub receiver_port: u16,
    pub receiver_status: String,
    pub version: String,
}

#[tauri::command]
pub fn list_network_interfaces() -> Vec<NetworkInterfaceInfo> {
    list_available_interfaces()
}

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let db_status = state.db.check_health().unwrap_or_else(|e| format!("DB Error: {}", e));
    let ifaces = list_available_interfaces();
    let current_ip = ifaces.first().map(|i| i.ip.clone()).unwrap_or_else(|| "127.0.0.1".to_string());

    Ok(AppStatus {
        db_status,
        lan_ip: current_ip,
        receiver_port: state.receiver_port,
        receiver_status: "Active (Listening on all interfaces)".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
pub fn get_active_session(state: State<'_, AppState>, selected_ip: Option<String>) -> Result<SessionInfo, String> {
    let ip = match selected_ip {
        Some(ip) if !ip.trim().is_empty() => ip,
        _ => {
            let ifaces = list_available_interfaces();
            ifaces.first().map(|i| i.ip.clone()).unwrap_or_else(|| "127.0.0.1".to_string())
        }
    };

    state.session_mgr
        .get_or_create_active(&ip, state.receiver_port)
        .map_err(|e| format!("Failed to get session: {}", e))
}

#[tauri::command]
pub fn switch_network_interface(state: State<'_, AppState>, ip: String) -> Result<SessionInfo, String> {
    let session = state.session_mgr
        .switch_session_ip(&ip, state.receiver_port)
        .map_err(|e| format!("Failed to switch session IP: {}", e))?;
    let _ = state.tunnel_mgr.update_session_token(&session.token);
    Ok(session)
}

#[tauri::command]
pub fn create_new_session(state: State<'_, AppState>, selected_ip: Option<String>) -> Result<SessionInfo, String> {
    let ip = match selected_ip {
        Some(ip) if !ip.trim().is_empty() => ip,
        _ => {
            let ifaces = list_available_interfaces();
            ifaces.first().map(|i| i.ip.clone()).unwrap_or_else(|| "127.0.0.1".to_string())
        }
    };

    let session = state.session_mgr
        .create_new_session(&ip, state.receiver_port, 720)
        .map_err(|e| format!("Failed to create new session: {}", e))?;
    let _ = state.tunnel_mgr.update_session_token(&session.token);
    Ok(session)
}

#[tauri::command]
pub fn list_incoming_orders(state: State<'_, AppState>) -> Result<Vec<OrderSummaryDto>, String> {
    let mut orders = state.order_mgr
        .list_orders()
        .map_err(|e| format!("Failed to list orders: {}", e))?;

    for ord in &mut orders {
        for f in &mut ord.files {
            let dummy_settings = crate::models::PrintSettingsDto {
                mode: "MANUAL".to_string(),
                paper_size: f.paper_size.clone(),
                color_mode: f.color_mode.clone(),
                duplex_mode: f.duplex_mode.clone(),
                copies: f.copies,
                orientation: "AUTO".to_string(),
                page_range: None,
                rotation: Some(0),
                target_printer: f.target_printer.clone(),
            };
            let auto_p = state.printer_mgr.resolve_auto_printer(&dummy_settings, "");
            let eff_p = state.printer_mgr.resolve_effective_printer(&f.file_id, &dummy_settings, "");
            f.auto_printer = Some(auto_p);
            f.target_printer = Some(eff_p);
        }
    }

    Ok(orders)
}

#[tauri::command]
pub fn get_order_details(state: State<'_, AppState>, order_id: String) -> Result<Option<OrderDetailDto>, String> {
    let mut details_opt = state.order_mgr
        .get_order_details(&order_id)
        .map_err(|e| format!("Failed to get order details: {}", e))?;

    if let Some(ref mut details) = details_opt {
        for f in &mut details.files {
            let auto_p = state.printer_mgr.resolve_auto_printer(&f.print_settings, "");
            let eff_p = state.printer_mgr.resolve_effective_printer(&f.file_id, &f.print_settings, "");
            f.auto_printer = Some(auto_p);
            f.resolved_printer = Some(eff_p);
        }
        for sf in &mut details.order.files {
            if let Some(df) = details.files.iter().find(|d| d.file_id == sf.file_id) {
                sf.auto_printer = df.auto_printer.clone();
                sf.target_printer = df.resolved_printer.clone();
            }
        }
    }

    Ok(details_opt)
}

#[tauri::command]
pub fn set_file_target_printer(
    state: State<'_, AppState>,
    file_id: String,
    target_printer: Option<String>,
) -> Result<Option<String>, String> {
    state.order_mgr
        .set_file_target_printer(&file_id, target_printer.as_deref())
        .map_err(|e| format!("Failed to update file target printer: {}", e))
}

#[tauri::command]
pub fn update_file_print_settings(
    state: State<'_, AppState>,
    file_id: String,
    settings: crate::models::PrintSettingsDto,
) -> Result<String, String> {
    let res = state.order_mgr
        .update_file_print_settings(&file_id, &settings)
        .map_err(|e| format!("Failed to update settings: {}", e))?;

    if let Ok(Some(order_id)) = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT order_id FROM files WHERE id = ?1")?;
        let mut rows = stmt.query([&file_id])?;
        if let Some(r) = rows.next()? {
            Ok(Some(r.get::<_, String>(0)?))
        } else {
            Ok(None)
        }
    }) {
        let _ = state.pricing_mgr.calculate_and_save_order_billing(&order_id, None, &state.storage_mgr);
        crate::server::notify_order_event(&order_id, "FILE_SETTINGS_UPDATED", None);
    }

    Ok(res)
}

#[tauri::command]
pub fn approve_order(state: State<'_, AppState>, order_id: String) -> Result<(), String> {
    state.order_mgr
        .approve_order(&order_id)
        .map_err(|e| format!("Failed to approve order: {}", e))?;
    crate::server::notify_order_event(&order_id, "ORDER_APPROVED", None);
    Ok(())
}

#[tauri::command]
pub fn reject_order(state: State<'_, AppState>, order_id: String, reason: Option<String>) -> Result<(), String> {
    state.order_mgr
        .reject_order(&order_id, reason.as_deref())
        .map_err(|e| format!("Failed to reject order: {}", e))?;
    crate::server::notify_order_event(&order_id, "ORDER_REJECTED", None);
    Ok(())
}

#[tauri::command]
pub fn toggle_file_exclusion(
    state: State<'_, AppState>,
    file_id: String,
    is_excluded: bool,
) -> Result<bool, String> {
    let res = state.order_mgr
        .toggle_file_exclusion(&file_id, is_excluded)
        .map_err(|e| format!("Failed to toggle file exclusion: {}", e))?;

    if let Ok(Some(order_id)) = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT order_id FROM files WHERE id = ?1")?;
        let mut rows = stmt.query([&file_id])?;
        if let Some(r) = rows.next()? {
            Ok(Some(r.get::<_, String>(0)?))
        } else {
            Ok(None)
        }
    }) {
        let _ = state.pricing_mgr.calculate_and_save_order_billing(&order_id, None, &state.storage_mgr);
        crate::server::notify_order_event(&order_id, "FILE_EXCLUSION_CHANGED", None);
    }

    Ok(res)
}

#[tauri::command]
pub fn restore_order(state: State<'_, AppState>, order_id: String) -> Result<(), String> {
    state.order_mgr
        .restore_order(&order_id)
        .map_err(|e| format!("Failed to restore order: {}", e))?;
    crate::server::notify_order_event(&order_id, "ORDER_RESTORED", None);
    Ok(())
}

#[tauri::command]
pub fn purge_order(state: State<'_, AppState>, order_id: String) -> Result<(), String> {
    state.order_mgr
        .purge_order(&order_id, Some(state.storage_mgr.base_dir()))
        .map_err(|e| format!("Failed to purge order: {}", e))?;
    crate::server::notify_order_event(&order_id, "ORDER_PURGED", None);
    Ok(())
}

#[tauri::command]
pub fn empty_dustbin(state: State<'_, AppState>) -> Result<usize, String> {
    state.order_mgr
        .empty_dustbin(state.storage_mgr.base_dir())
        .map_err(|e| format!("Failed to empty dustbin: {}", e))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInspectionResult {
    pub file_id: String,
    pub original_filename: String,
    pub file_type: String,
    pub file_size_bytes: u64,
    pub page_count: u32,
    pub excel_metadata: Option<ExcelMetadata>,
    pub preview_data_url: Option<String>,
    pub preview_url: String,
}

pub fn inspect_file_path(
    db: &crate::db::Database,
    file_id: &str,
    path: &std::path::Path,
    lan_ip: &str,
    port: u16,
) -> Result<DocumentInspectionResult, String> {
    let filename: String = db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT original_filename FROM files WHERE id = ?1")?;
        let name: String = stmt.query_row([file_id], |row| row.get(0))?;
        Ok(name)
    }).unwrap_or_else(|_| format!("{}.dat", file_id));

    if !path.exists() {
        return Err(format!(
            "Document file '{}' was not found on disk. It may have been erased by the customer for privacy.",
            filename
        ));
    }

    let file_size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if file_size_bytes == 0 {
        return Err(format!(
            "Document file '{}' is empty (0 bytes) or corrupted on disk.",
            filename
        ));
    }

    let lower_name = filename.to_lowercase();

    let (file_type, excel_metadata) = if lower_name.ends_with(".xlsx") || lower_name.ends_with(".xls") {
        let meta = crate::documents::excel::inspect_excel_file(path).ok();
        ("excel".to_string(), meta)
    } else if lower_name.ends_with(".pdf") {
        ("pdf".to_string(), None)
    } else if lower_name.ends_with(".png") || lower_name.ends_with(".jpg") || lower_name.ends_with(".jpeg") || lower_name.ends_with(".webp") {
        ("image".to_string(), None)
    } else if lower_name.ends_with(".doc") || lower_name.ends_with(".docx") {
        ("word".to_string(), None)
    } else if lower_name.ends_with(".ppt") || lower_name.ends_with(".pptx") {
        ("powerpoint".to_string(), None)
    } else {
        ("other".to_string(), None)
    };

    let preview_data_url = if file_type == "image" {
        if let Ok(bytes) = std::fs::read(path) {
            let mime = if lower_name.ends_with(".png") {
                "image/png"
            } else if lower_name.ends_with(".webp") {
                "image/webp"
            } else {
                "image/jpeg"
            };
            Some(format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(&bytes)))
        } else {
            None
        }
    } else if file_type == "pdf" {
        if let Ok(bytes) = std::fs::read(path) {
            Some(format!("data:application/pdf;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
        } else {
            None
        }
    } else {
        None
    };

    let preview_url = format!("http://{}:{}/api/files/{}/content", lan_ip, port, file_id);
    let page_count = crate::pricing::detect_document_pages(path, Some(&filename));

    Ok(DocumentInspectionResult {
        file_id: file_id.to_string(),
        original_filename: filename,
        file_type,
        file_size_bytes,
        page_count,
        excel_metadata,
        preview_data_url,
        preview_url,
    })
}

#[tauri::command]
pub fn inspect_file_document(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<DocumentInspectionResult, String> {
    let path = state.storage_mgr.resolve_verified_file_path(&state.db, &file_id)?;
    let ifaces = list_available_interfaces();
    let primary_ip = ifaces.first().map(|i| i.ip.clone()).unwrap_or_else(|| "127.0.0.1".to_string());
    inspect_file_path(&state.db, &file_id, &path, &primary_ip, state.receiver_port)
}

#[tauri::command]
pub fn get_available_printers(state: State<'_, AppState>) -> Vec<crate::printer::PrinterInfo> {
    state.printer_mgr.list_printers()
}

#[tauri::command]
pub fn print_single_document(
    state: State<'_, AppState>,
    file_id: String,
    printer_name: String,
) -> Result<String, String> {
    let path = state.storage_mgr.resolve_verified_file_path(&state.db, &file_id)?;

    // 1. Fetch file revision info, order info and print settings
    let (order_id, order_status, order_rev_id, file_rev_id, settings) = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT o.id, o.status, ord_r.id, fr.id,
                    ps.mode, ps.paper_size, ps.color_mode, ps.duplex_mode, ps.copies, ps.orientation, ps.page_range, ps.rotation, ps.target_printer
             FROM files f
             JOIN file_revisions fr ON f.id = fr.file_id
             JOIN order_revisions ord_r ON fr.order_revision_id = ord_r.id
             JOIN orders o ON ord_r.order_id = o.id AND ord_r.revision_number = o.current_revision_number
             JOIN print_settings ps ON fr.id = ps.file_revision_id
             WHERE f.id = ?1
             ORDER BY fr.created_at DESC LIMIT 1"
        )?;
        let mut rows = stmt.query([&file_id])?;
        if let Some(r) = rows.next()? {
            let rot: u32 = r.get(11).unwrap_or(0);
            let target_printer: Option<String> = r.get::<_, Option<String>>(12).ok().flatten();
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                crate::models::PrintSettingsDto {
                    mode: r.get(4)?,
                    paper_size: r.get(5)?,
                    color_mode: r.get(6)?,
                    duplex_mode: r.get(7)?,
                    copies: r.get(8)?,
                    orientation: r.get(9)?,
                    page_range: r.get(10)?,
                    rotation: Some(rot),
                    target_printer,
                }
            ))
        } else {
            Err("Print settings not found for this file".into())
        }
    }).map_err(|e| e.to_string())?;

    // 2. Strict Gate: Order must be APPROVED or COMPLETED or PRINTING
    if order_status != "APPROVED" && order_status != "COMPLETED" && order_status != "PRINTING" {
        return Err(format!("Cannot print: Order is '{}'. Please approve the order first.", order_status));
    }

    // Verify file is not erased by customer
    let is_purged = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT COUNT(*) FROM order_events oe
             WHERE oe.order_id = ?1
               AND (oe.event_type = 'CUSTOMER_PURGED_ALL_FILES' OR (oe.event_type = 'CUSTOMER_PURGED_FILE' AND oe.payload_json LIKE '%' || ?2 || '%'))"
        )?;
        let count: i64 = stmt.query_row(rusqlite::params![&order_id, &file_id], |r| r.get(0)).unwrap_or(0);
        Ok(count > 0 || order_status == "PURGED_BY_CUSTOMER")
    }).unwrap_or(false);

    if is_purged {
        return Err("Cannot print: This file was erased from the computer by the customer.".into());
    }

    // Gate: Check license validity and print quota
    let pages_printed = crate::printer::determine_document_page_count(&path, &settings).max(1) as u32;
    state.license_mgr.check_can_print(pages_printed)?;

    // 3. Resolve effective printer (respecting manual per-file override and routing rules) and print
    let effective_printer = state.printer_mgr.resolve_effective_printer(&file_id, &settings, &printer_name);
    let print_summary = state.printer_mgr.print_single_file(&path, &effective_printer, &settings)
        .map_err(|e| e.to_string())?;

    // 4. Record successful print job in SQLite
    let job_id = uuid::Uuid::new_v4().to_string();
    state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO print_jobs (id, order_id, order_revision_id, file_revision_id, printer_name, job_sequence_index, status, pages_printed, submitted_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, 'COMPLETED', ?6, datetime('now'), datetime('now'))",
            rusqlite::params![&job_id, &order_id, &order_rev_id, &file_rev_id, &effective_printer, pages_printed as i64],
        )?;

        // Check if all non-excluded files in this order now have at least 1 COMPLETED print job
        let mut count_stmt = conn.prepare(
            "SELECT COUNT(*) FROM file_revisions fr
             WHERE fr.order_revision_id = ?1 AND fr.is_deleted = 0
               AND fr.id NOT IN (SELECT pj.file_revision_id FROM print_jobs pj WHERE pj.status = 'COMPLETED')"
        )?;
        let unprinted_count: i64 = count_stmt.query_row([&order_rev_id], |row| row.get(0))?;

        if unprinted_count == 0 {
            conn.execute(
                "UPDATE orders SET status = 'COMPLETED', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![&order_id],
            )?;
            conn.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'ORDER_PRINTING_FINISHED', ?2)",
                rusqlite::params![
                    &order_id,
                    serde_json::json!({
                        "status": "COMPLETED",
                        "printerName": effective_printer,
                        "mode": "SINGLE_FILE_COMPLETION"
                    }).to_string()
                ],
            )?;
        } else if order_status != "COMPLETED" {
            conn.execute(
                "UPDATE orders SET status = 'PRINTING', updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![&order_id],
            )?;
        }
        Ok(())
    }).map_err(|e| e.to_string())?;

    let _ = state.license_mgr.get_license_state();
    crate::server::notify_order_event(&order_id, "ORDER_PRINT_PROGRESS", None);

    Ok(print_summary)
}

#[tauri::command]
pub fn execute_order_batch_print(
    state: State<'_, AppState>,
    order_id: String,
    printer_name: String,
) -> Result<crate::printer::PrintBatchResult, String> {
    state.license_mgr.check_can_print(1)?;
    let res = state.printer_mgr.print_approved_order(&order_id, &printer_name)
        .map_err(|e| e.to_string())?;
    let _ = state.license_mgr.get_license_state();
    crate::server::notify_order_event(&order_id, "ORDER_BATCH_PRINTED", None);
    Ok(res)
}

#[tauri::command]
pub fn get_printer_routing_config(
    state: State<'_, AppState>,
) -> Result<crate::printer::PrinterRoutingConfig, String> {
    Ok(state.printer_mgr.get_routing_config())
}

#[tauri::command]
pub fn save_printer_routing_config(
    state: State<'_, AppState>,
    config: crate::printer::PrinterRoutingConfig,
) -> Result<(), String> {
    state.printer_mgr.save_routing_config(&config).map_err(|e| e.to_string())
}

// === SIMULATION SANDBOX START ===
#[tauri::command]
pub fn is_simulation_supported(
    state: State<'_, AppState>,
) -> bool {
    state.printer_mgr.is_simulation_supported()
}

#[tauri::command]
pub fn get_printer_simulation_mode(
    state: State<'_, AppState>,
) -> bool {
    state.printer_mgr.is_simulation_mode()
}

#[tauri::command]
pub fn set_printer_simulation_mode(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.printer_mgr.set_simulation_mode(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_simulation_routing_preset(
    state: State<'_, AppState>,
) -> Result<crate::printer::PrinterRoutingConfig, String> {
    state.printer_mgr.apply_simulation_routing_preset().map_err(|e| e.to_string())
}
// === SIMULATION SANDBOX END ===

#[tauri::command]
pub fn get_spooler_state(
    state: State<'_, AppState>,
) -> Result<crate::printer::BatchSpoolerState, String> {
    Ok(state.printer_mgr.get_spooler_state())
}

#[tauri::command]
pub fn pause_print_spooler(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.printer_mgr.pause_spooler();
    crate::server::notify_order_event("*", "SPOOLER_EVENT", None);
    Ok(())
}

#[tauri::command]
pub fn pause_print_spooler_graceful(
    state: State<'_, AppState>,
    reason: Option<String>,
) -> Result<(), String> {
    state.printer_mgr.pause_spooler_graceful(reason);
    crate::server::notify_order_event("*", "SPOOLER_EVENT", None);
    Ok(())
}

#[tauri::command]
pub fn emergency_jam_pause(
    state: State<'_, AppState>,
    printer_name: Option<String>,
) -> Result<(), String> {
    state.printer_mgr.emergency_jam_pause(printer_name);
    crate::server::notify_order_event("*", "SPOOLER_JAM", None);
    Ok(())
}

#[tauri::command]
pub fn reroute_printer_queue(
    state: State<'_, AppState>,
    req: crate::printer::PrinterRerouteRequest,
) -> Result<usize, String> {
    let count = state.printer_mgr.reroute_printer_queue(&req).map_err(|e| e.to_string())?;
    crate::server::notify_order_event("*", "SPOOLER_REROUTE", None);
    Ok(count)
}

#[tauri::command]
pub fn resume_print_spooler(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.printer_mgr.resume_spooler();
    crate::server::notify_order_event("*", "SPOOLER_RESUMED", None);
    Ok(())
}

#[tauri::command]
pub fn cancel_print_spooler(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.printer_mgr.cancel_spooler();
    crate::server::notify_order_event("*", "SPOOLER_CANCELLED", None);
    Ok(())
}

#[tauri::command]
pub fn start_multi_order_batch_print(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    order_ids: Option<Vec<String>>,
    fallback_printer: Option<String>,
) -> Result<serde_json::Value, String> {
    state.license_mgr.check_can_print(1)?;
    if state.printer_mgr.get_spooler_state().is_active {
        return Err("A batch print job is already actively spooling. Please wait for it to finish or cancel it.".to_string());
    }

    let target_order_ids: Vec<String> = match order_ids {
        Some(ids) if !ids.is_empty() => ids,
        _ => {
            let incoming = state.order_mgr.list_orders().map_err(|e| e.to_string())?;
            incoming.into_iter()
                .filter(|o| o.status == "APPROVED")
                .map(|o| o.id)
                .collect()
        }
    };

    if target_order_ids.is_empty() {
        return Err("No approved orders found to print. Please approve orders before printing.".to_string());
    }

    let default_printer = fallback_printer
        .filter(|p| !p.trim().is_empty())
        .or_else(|| {
            let config = state.printer_mgr.get_routing_config();
            if !config.default_printer.trim().is_empty() {
                Some(config.default_printer)
            } else {
                None
            }
        })
        .unwrap_or_else(|| "Virtual Test Spooler (Built-in)".to_string());

    let printer_mgr = state.printer_mgr.clone();
    let license_mgr = state.license_mgr.clone();
    let app = app_handle.clone();
    let ids = target_order_ids.clone();
    let printer = default_printer.clone();

    std::thread::Builder::new()
        .name("printdrop-batch-spooler".to_string())
        .spawn(move || {
            info!("Starting background batch spooler for {} orders", ids.len());
            let app_cb = app.clone();
            let summary_result = printer_mgr.execute_batch_spooling(&ids, &printer, move |active_file, spooler_state| {
                let _ = app_cb.emit("print://job-progress", active_file);
                let _ = app_cb.emit("print://spooler-state", spooler_state);
                crate::server::notify_order_event(&active_file.order_id, "PRINT_PROGRESS", None);
            });

            match summary_result {
                Ok(summary) => {
                    info!(
                        "Batch spooler finished: {}/{} files printed ({} total pages)",
                        summary.successful_files, summary.total_files, summary.total_pages_printed
                    );
                    if summary.total_pages_printed > 0 {
                        let _ = license_mgr.get_license_state();
                    }
                    for id in &ids {
                        crate::server::notify_order_event(id, "ORDER_PRINTING_FINISHED", None);
                    }
                    let _ = app.emit("print://batch-finished", &summary);
                }
                Err(err) => {
                    error!("Batch spooler error: {}", err);
                    let _ = app.emit("print://batch-error", &serde_json::json!({ "error": err.to_string() }));
                }
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "status": "STARTED",
        "totalOrders": target_order_ids.len(),
        "orderIds": target_order_ids,
        "defaultPrinter": default_printer,
    }))
}

#[tauri::command]
pub fn start_single_file_batch_print(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    file_id: String,
    fallback_printer: Option<String>,
) -> Result<serde_json::Value, String> {
    state.license_mgr.check_can_print(1)?;
    if state.printer_mgr.get_spooler_state().is_active {
        return Err("A print job is already actively spooling. Please wait for it to finish or cancel it.".to_string());
    }

    let default_printer = fallback_printer
        .filter(|p| !p.trim().is_empty())
        .or_else(|| {
            let config = state.printer_mgr.get_routing_config();
            if !config.default_printer.trim().is_empty() {
                Some(config.default_printer)
            } else {
                None
            }
        })
        .unwrap_or_else(|| "Virtual Test Spooler (Built-in)".to_string());

    let printer_mgr = state.printer_mgr.clone();
    let license_mgr = state.license_mgr.clone();
    let app = app_handle.clone();
    let fid = file_id.clone();
    let printer = default_printer.clone();

    std::thread::Builder::new()
        .name("printdrop-single-file-spooler".to_string())
        .spawn(move || {
            info!("Starting background spooler for single file '{}'", fid);
            let app_cb = app.clone();
            let summary_result = printer_mgr.execute_single_file_spooling(&fid, &printer, move |active_file, spooler_state| {
                let _ = app_cb.emit("print://job-progress", active_file);
                let _ = app_cb.emit("print://spooler-state", spooler_state);
                crate::server::notify_order_event(&active_file.order_id, "PRINT_PROGRESS", None);
            });

            match summary_result {
                Ok(summary) => {
                    info!(
                        "Single file spooler finished: {}/{} files printed ({} total pages)",
                        summary.successful_files, summary.total_files, summary.total_pages_printed
                    );
                    if summary.total_pages_printed > 0 {
                        let _ = license_mgr.get_license_state();
                    }
                    crate::server::notify_order_event("*", "ORDER_PRINTING_FINISHED", None);
                    let _ = app.emit("print://batch-finished", &summary);
                }
                Err(err) => {
                    error!("Single file spooler error: {}", err);
                    let _ = app.emit("print://batch-error", &serde_json::json!({ "error": err.to_string() }));
                }
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "status": "STARTED",
        "fileId": file_id,
        "defaultPrinter": default_printer,
    }))
}

#[tauri::command]
pub fn get_wifi_info(state: State<'_, AppState>) -> Result<WifiInfo, String> {
    state.wifi_mgr.get_or_detect_wifi().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_wifi_config(
    state: State<'_, AppState>,
    ssid: String,
    password: String,
    auth_type: Option<String>,
    is_hidden: Option<bool>,
) -> Result<WifiInfo, String> {
    let auth = auth_type.unwrap_or_else(|| "WPA2-Personal".to_string());
    let hidden = is_hidden.unwrap_or(false);
    state.wifi_mgr.save_wifi_settings(&ssid, &password, &auth, hidden).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_wifi_to_system(state: State<'_, AppState>) -> Result<WifiInfo, String> {
    state.wifi_mgr.reset_wifi_to_system().map_err(|e| e.to_string())
}

fn sync_station_registry_background(hwid: String, shop_name: String, url: String, status: &'static str) {
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        // 1. Instant Real-Time PostgREST to Supabase system_config (0s caching, <200ms latency)
        let supabase_url = "https://nslcrlvuulgqtrdqrkgv.supabase.co/rest/v1/system_config";
        let anon_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGNybHZ1dWxncXRyZHFya2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTI4NzEsImV4cCI6MjEwOTcyODg3MX0.lpRc097A_PFCD-eJVhyQZmPFxexhSGjM2dhCE0LNdxk";
        let now_iso = chrono::Utc::now().to_rfc3339();

        // Station-Specific Tunnel Entry (Keyed by HWID) - Bulletproof Multi-Tenant Dynamic Routing
        let station_key = format!("station_tunnel_{}", hwid.trim());
        let station_payload = serde_json::json!({
            "key": station_key,
            "value": {
                "hwid": hwid.trim(),
                "url": url,
                "status": status,
                "stationName": shop_name,
                "updatedAt": now_iso
            },
            "updated_at": now_iso
        });

        let _ = client.post(supabase_url)
            .header("apikey", anon_key)
            .header("Authorization", format!("Bearer {}", anon_key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&station_payload)
            .send()
            .await;

        // Also update legacy global key for backward-compatibility with single-station tests
        let global_payload = serde_json::json!({
            "key": "station_live_registry",
            "value": {
                "hwid": hwid.trim(),
                "url": url,
                "status": status,
                "stationName": shop_name,
                "updatedAt": now_iso
            },
            "updated_at": now_iso
        });

        let _ = client.post(supabase_url)
            .header("apikey", anon_key)
            .header("Authorization", format!("Bearer {}", anon_key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&global_payload)
            .send()
            .await;
    });
}

#[tauri::command]
pub fn start_public_tunnel(state: State<'_, AppState>) -> Result<TunnelInfo, String> {
    let session_token = state.session_mgr.get_active_session()
        .ok()
        .flatten()
        .map(|s| s.token);

    let info = state.tunnel_mgr.start_tunnel(state.receiver_port, session_token.as_deref())
        .map_err(|e| e.to_string())?;

    let hwid = state.license_mgr.get_hwid().to_string();
    let shop_name = state.license_mgr.get_license_state().map(|s| s.shop_name).unwrap_or_else(|_| "PrintDrop Station".to_string());

    if let Some(ref live_url) = info.url {
        sync_station_registry_background(hwid, shop_name, live_url.clone(), "online");
    }

    Ok(info)
}

#[tauri::command]
pub fn stop_public_tunnel(state: State<'_, AppState>) -> Result<TunnelInfo, String> {
    let info = state.tunnel_mgr.stop_tunnel().map_err(|e| e.to_string())?;
    let hwid = state.license_mgr.get_hwid().to_string();
    let shop_name = state.license_mgr.get_license_state().map(|s| s.shop_name).unwrap_or_else(|_| "PrintDrop Station".to_string());
    sync_station_registry_background(hwid, shop_name, "".to_string(), "offline");
    Ok(info)
}

#[tauri::command]
pub fn get_public_tunnel_status(state: State<'_, AppState>) -> TunnelInfo {
    state.tunnel_mgr.get_status()
}

#[tauri::command]
pub fn check_internet_status() -> bool {
    crate::tunnel::check_internet_reachability()
}

#[tauri::command]
pub fn list_corporate_clients(state: State<'_, AppState>) -> Result<Vec<crate::corporate::CorporateClientDto>, String> {
    state.corporate_mgr.list_clients().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_corporate_client(
    state: State<'_, AppState>,
    name: String,
    pin: String,
    billing_account: Option<String>,
    notes: Option<String>,
) -> Result<crate::corporate::CorporateClientDto, String> {
    state.corporate_mgr.create_client(
        &name,
        &pin,
        billing_account.as_deref(),
        notes.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_corporate_client(
    state: State<'_, AppState>,
    client_id: String,
    name: String,
    pin: Option<String>,
    billing_account: Option<String>,
    notes: Option<String>,
) -> Result<crate::corporate::CorporateClientDto, String> {
    state.corporate_mgr.update_client(
        &client_id,
        &name,
        pin.as_deref(),
        billing_account.as_deref(),
        notes.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_corporate_client_status(
    state: State<'_, AppState>,
    client_id: String,
    is_active: bool,
) -> Result<(), String> {
    state.corporate_mgr.toggle_client_status(&client_id, is_active).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_corporate_client(
    state: State<'_, AppState>,
    client_id: String,
) -> Result<(), String> {
    state.corporate_mgr.delete_client(&client_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_corporate_devices(
    state: State<'_, AppState>,
    client_id: String,
) -> Result<Vec<crate::corporate::CorporateDeviceDto>, String> {
    state.corporate_mgr.list_devices(&client_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn revoke_corporate_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<(), String> {
    state.corporate_mgr.revoke_device(&device_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_corporate_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<(), String> {
    state.corporate_mgr.restore_device(&device_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_corporate_qr(
    state: State<'_, AppState>,
    client_id: String,
    target_ip: Option<String>,
) -> Result<crate::corporate::CorporateQrDto, String> {
    // 1. Query real-time available network interfaces from OS
    let ifaces = crate::network::list_available_interfaces();
    let vpn_iface = ifaces.iter().find(|i| (i.is_vpn || i.ip.starts_with("100.")) && !i.ip.starts_with("169.254."));
    let active_vpn_ip = vpn_iface.map(|i| i.ip.clone());

    // 2. Query real-time Cloudflare public tunnel status (cleaned base origin)
    let tunnel_status = state.tunnel_mgr.get_status();
    let active_tunnel_url = if tunnel_status.is_active {
        tunnel_status.url.map(|u| u.split('?').next().unwrap_or(&u).trim_end_matches('/').to_string())
    } else {
        None
    };

    // 3. Dynamic real-time host resolution with auto-fallback:
    let host = match target_ip.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        // Explicit Cloudflare Tunnel requested
        Some(target) if target.starts_with("https://") || target.contains("trycloudflare.com") => {
            if let Some(ref tunnel) = active_tunnel_url {
                tunnel.clone()
            } else {
                target.to_string()
            }
        }
        // Explicit VPN requested: only valid if VPN is ACTUALLY active right now
        Some(target) if target.starts_with("100.") => {
            if let Some(ref vpn) = active_vpn_ip {
                vpn.clone()
            } else if let Some(ref tunnel) = active_tunnel_url {
                info!("Tailscale VPN is offline. Auto-fallback to active Cloudflare tunnel: {}", tunnel);
                tunnel.clone()
            } else {
                target.to_string()
            }
        }
        // Auto mode (target_ip is None, auto, or unroutable LAN IP)
        // Prefer live Tailscale Fixed VPN as primary corporate network, with Cloudflare tunnel fallback
        _ => {
            if let Some(ref vpn) = active_vpn_ip {
                vpn.clone()
            } else if let Some(ref tunnel) = active_tunnel_url {
                info!("Tailscale VPN is offline. Auto-switched to active Cloudflare tunnel: {}", tunnel);
                tunnel.clone()
            } else {
                "100.100.10.51".to_string()
            }
        }
    };

    let is_https = host.starts_with("https://") || host.contains("trycloudflare.com");

    state.corporate_mgr.generate_corporate_qr(
        &client_id,
        &host,
        state.receiver_port,
        is_https,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pricing_rates(state: State<'_, AppState>) -> Result<crate::pricing::PricingRateCard, String> {
    Ok(state.pricing_mgr.get_rate_card())
}

#[tauri::command]
pub fn save_pricing_rates(state: State<'_, AppState>, rates: crate::pricing::PricingRateCard) -> Result<(), String> {
    state.pricing_mgr.save_rate_card(&rates)
}

#[tauri::command]
pub fn get_order_billing(state: State<'_, AppState>, order_id: String) -> Result<Option<crate::pricing::OrderBillingDto>, String> {
    if let Ok(Some(existing)) = state.pricing_mgr.get_order_billing(&order_id) {
        if existing.payment_status == "UNPAID" {
            return state.pricing_mgr.calculate_and_save_order_billing(&order_id, None, &state.storage_mgr).map(Some);
        }
        return Ok(Some(existing));
    }
    state.pricing_mgr.calculate_and_save_order_billing(&order_id, None, &state.storage_mgr).map(Some)
}

#[tauri::command]
pub fn recalculate_order_billing(
    state: State<'_, AppState>,
    order_id: String,
    customer_type: Option<String>,
) -> Result<crate::pricing::OrderBillingDto, String> {
    state.pricing_mgr.calculate_and_save_order_billing(&order_id, customer_type.as_deref(), &state.storage_mgr)
}

#[tauri::command]
pub fn update_order_payment(
    state: State<'_, AppState>,
    order_id: String,
    payment_status: String,
    payment_method: Option<String>,
    customer_type: Option<String>,
) -> Result<crate::pricing::OrderBillingDto, String> {
    let res = state.pricing_mgr.update_order_payment(&order_id, &payment_status, payment_method.as_deref(), customer_type.as_deref())?;
    crate::server::notify_order_event(&order_id, "PAYMENT_UPDATED", None);
    Ok(res)
}

#[tauri::command]
pub fn get_payment_settings(state: State<'_, AppState>) -> Result<crate::pricing::UpiPaymentSettings, String> {
    Ok(state.pricing_mgr.get_upi_settings())
}

#[tauri::command]
pub fn save_payment_settings(state: State<'_, AppState>, mut settings: crate::pricing::UpiPaymentSettings) -> Result<(), String> {
    if settings.razorpay_enabled && settings.razorpay_qr_payload.trim().is_empty() && !settings.razorpay_qr_id.trim().is_empty() && !settings.upi_id.trim().is_empty() {
        let clean_vpa = settings.upi_id.trim();
        let shop_name_encoded = crate::server::url_encode(&settings.business_name);
        settings.razorpay_qr_payload = format!(
            "upi://pay?cu=INR&mc=7338&mode=19&pa={}&tn=Payment%20To%20{}&tr={}",
            clean_vpa,
            shop_name_encoded,
            settings.razorpay_qr_id.trim()
        );
    }
    state.pricing_mgr.save_upi_settings(&settings)
}

#[tauri::command]
pub async fn sync_razorpay_qr(state: State<'_, AppState>) -> Result<crate::pricing::UpiPaymentSettings, String> {
    let mut settings = state.pricing_mgr.get_upi_settings();
    if !settings.razorpay_enabled || settings.razorpay_key_id.trim().is_empty() || settings.razorpay_key_secret.trim().is_empty() {
        return Err("Razorpay is not enabled or API credentials are missing".to_string());
    }

    let client = reqwest::Client::new();
    let res = client
        .get("https://api.razorpay.com/v1/payments/qr_codes?count=10")
        .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Razorpay: {}", e))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Razorpay API error: {}", err_text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| format!("Failed to parse response: {}", e))?;
    let items = json.get("items").and_then(|i| i.as_array()).ok_or("No QR codes returned from Razorpay")?;
    
    let active_qr = items.iter().find(|item| {
        item.get("status").and_then(|s| s.as_str()) == Some("active")
            && item.get("type").and_then(|t| t.as_str()) == Some("upi_qr")
    }).or_else(|| items.first()).ok_or("No active UPI QR code found in your Razorpay account. Please create one in Razorpay Dashboard > QR Codes")?;

    let qr_id = active_qr.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
    let image_url = active_qr.get("image_url").and_then(|s| s.as_str()).unwrap_or("").to_string();
    
    let clean_tr_id = qr_id.replace("qr_", "");
    let clean_vpa = settings.upi_id.trim();
    let shop_name_encoded = crate::server::url_encode(&settings.business_name);
    let payload = format!(
        "upi://pay?cu=INR&mc=7338&mode=19&pa={}&tn=Payment%20To%20{}&tr={}qrv2",
        clean_vpa,
        shop_name_encoded,
        clean_tr_id
    );

    settings.razorpay_qr_id = qr_id;
    settings.razorpay_qr_image_url = image_url;
    settings.razorpay_qr_payload = payload;

    state.pricing_mgr.save_upi_settings(&settings)?;
    Ok(settings)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StandeeQrData {
    pub raw_svg: String,
    pub svg_data_url: String,
    pub png_data_url: String,
    pub upi_uri: String,
}

#[tauri::command]
pub fn generate_standee_qr(state: State<'_, AppState>, upi_id: Option<String>, business_name: Option<String>) -> Result<StandeeQrData, String> {
    let settings = state.pricing_mgr.get_upi_settings();
    let upi_uri = if settings.razorpay_enabled && !settings.razorpay_qr_payload.trim().is_empty() {
        settings.razorpay_qr_payload.trim().to_string()
    } else {
        let vpa = upi_id.as_deref().unwrap_or(&settings.upi_id).trim();
        let bname = business_name.as_deref().unwrap_or(&settings.business_name).trim();
        let clean_name: String = bname.chars().filter(|c| c.is_alphanumeric()).collect();
        let safe_name = if clean_name.is_empty() { "PrintDrop".to_string() } else { clean_name };
        format!("upi://pay?pa={}&pn={}&cu=INR", vpa, safe_name)
    };
    let (raw_svg, svg_data_url) = crate::server::session::generate_qr_svg(&upi_uri)
        .map_err(|e| e.to_string())?;
    let png_data_url = crate::server::session::generate_qr_png_data_url(&upi_uri, 12)
        .unwrap_or_else(|_| svg_data_url.clone());

    Ok(StandeeQrData {
        raw_svg,
        svg_data_url,
        png_data_url,
        upi_uri,
    })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let res = std::process::Command::new("rundll32")
            .args(&["url.dll,FileProtocolHandler", &url])
            .spawn();
        
        if res.is_err() {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                std::process::Command::new("cmd")
                    .args(&["/C", "start", "", &url])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| format!("Failed to open URL in browser: {}", e))?;
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Ok(())
    }
}

#[tauri::command]
pub fn save_standee_qr_file(state: State<'_, AppState>, upi_id: Option<String>, business_name: Option<String>) -> Result<String, String> {
    let settings = state.pricing_mgr.get_upi_settings();
    let upi_uri = if settings.razorpay_enabled && !settings.razorpay_qr_payload.trim().is_empty() {
        settings.razorpay_qr_payload.trim().to_string()
    } else {
        let vpa = upi_id.as_deref().unwrap_or(&settings.upi_id).trim();
        let bname = business_name.as_deref().unwrap_or(&settings.business_name).trim();
        let clean_name: String = bname.chars().filter(|c| c.is_alphanumeric()).collect();
        let safe_name = if clean_name.is_empty() { "PrintDrop".to_string() } else { clean_name };
        format!("upi://pay?pa={}&pn={}&cu=INR", vpa, safe_name)
    };

    let png_bytes = crate::server::session::generate_qr_png_bytes(&upi_uri, 16)
        .map_err(|e| format!("Failed to generate PNG QR: {}", e))?;

    let vpa = upi_id.as_deref().unwrap_or(&settings.upi_id).trim();
    let clean_vpa: String = vpa.chars().map(|c| if c.is_alphanumeric() { c } else { '_' }).collect();
    let filename = format!("PrintDrop_Payment_QR_{}.png", clean_vpa);

    let downloads_dir = std::env::var("USERPROFILE")
        .map(|p| std::path::PathBuf::from(p).join("Downloads"))
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());

    let target_path = downloads_dir.join(&filename);
    std::fs::write(&target_path, &png_bytes)
        .map_err(|e| format!("Failed to save QR file to {}: {}", target_path.display(), e))?;

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", target_path.display()))
            .spawn();
    }

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_permanent_portal_url(state: State<'_, AppState>) -> Result<String, String> {
    let saved = state.db.get_config("permanent_portal_url")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(saved)
}

#[tauri::command]
pub fn save_permanent_portal_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    state.db.set_config("permanent_portal_url", url.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn generate_portal_qr(target_url: Option<String>) -> Result<String, String> {
    let url = target_url
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())
        .ok_or_else(|| "No permanent portal URL configured".to_string())?;
    let (_svg, data_url) = crate::server::session::generate_qr_svg(&url)
        .map_err(|e| e.to_string())?;
    Ok(data_url)
}

#[tauri::command]
pub async fn sync_station_to_gist(
    gist_id: String,
    github_token: String,
    station_url: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("PrintDrop-Desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "description": "TechnoSoft Solution PrintDrop Live Station Registry",
        "files": {
            "station.json": {
                "content": serde_json::json!({
                    "url": station_url,
                    "stationName": "TechnoSoft Solution",
                    "updatedAt": chrono::Utc::now().to_rfc3339()
                }).to_string()
            }
        }
    });

    let res = client
        .patch(format!("https://api.github.com/gists/{}", gist_id.trim()))
        .header("Authorization", format!("Bearer {}", github_token.trim()))
        .header("Accept", "application/vnd.github+json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to GitHub API: {}", e))?;

    if res.status().is_success() {
        Ok("Station URL successfully synced to GitHub Gist!".to_string())
    } else {
        let err_body = res.text().await.unwrap_or_default();
        Err(format!("GitHub API rejected update: {}", err_body))
    }
}

#[tauri::command]
pub fn start_named_public_tunnel(
    state: State<'_, AppState>,
    token: String,
    public_url: String,
) -> Result<TunnelInfo, String> {
    state.tunnel_mgr.start_named_tunnel(&token, &public_url)
        .map_err(|e| e.to_string())
}

// ==========================================
// BACKUP & RESTORE COMMANDS
// ==========================================

#[tauri::command]
pub fn get_backup_config(state: State<'_, AppState>) -> crate::backup::BackupConfig {
    state.backup_mgr.get_config()
}

#[tauri::command]
pub fn save_backup_config(state: State<'_, AppState>, config: crate::backup::BackupConfig) -> Result<(), String> {
    state.backup_mgr.save_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_system_backup(
    state: State<'_, AppState>,
    password: String,
    include_documents: bool,
    custom_path: Option<String>,
) -> Result<crate::backup::BackupResult, String> {
    state.backup_mgr
        .create_backup(&password, include_documents, custom_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_excel_backup(
    state: State<'_, AppState>,
    password: String,
    custom_path: Option<String>,
) -> Result<String, String> {
    state.backup_mgr
        .export_excel(&password, custom_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_backup_file(
    state: State<'_, AppState>,
    file_path: String,
    password: String,
) -> Result<crate::backup::BackupManifest, String> {
    state.backup_mgr
        .preview_backup(&file_path, &password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_system_backup(
    state: State<'_, AppState>,
    file_path: String,
    password: String,
) -> Result<crate::backup::BackupManifest, String> {
    state.backup_mgr
        .restore_backup(&file_path, &password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rollback_safety_snapshot(state: State<'_, AppState>) -> Result<String, String> {
    state.backup_mgr
        .rollback_safety_snapshot()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_existing_backups(state: State<'_, AppState>) -> Vec<crate::backup::BackupFileInfo> {
    state.backup_mgr.list_existing_backups()
}

#[tauri::command]
pub fn pick_backup_folder(state: State<'_, AppState>) -> Option<String> {
    state.backup_mgr.pick_backup_folder()
}

#[tauri::command]
pub fn pick_backup_file(state: State<'_, AppState>) -> Option<String> {
    state.backup_mgr.pick_backup_file()
}

#[tauri::command]
pub fn export_shop_config_backup(state: State<'_, AppState>) -> Result<(String, usize), String> {
    state.backup_mgr
        .export_config_backup()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_shop_config_backup(state: State<'_, AppState>) -> Result<usize, String> {
    state.backup_mgr
        .import_config_backup()
        .map_err(|e| e.to_string())
}

// ==========================================
// COMMERCIAL LICENSING & MONETIZATION
// ==========================================

#[tauri::command]
pub fn get_license_state(
    state: State<'_, AppState>,
) -> Result<crate::licensing::LicenseStateDto, String> {
    state.license_mgr.get_license_state()
}

#[tauri::command]
pub fn activate_license_key(
    state: State<'_, AppState>,
    request: crate::licensing::ActivationRequest,
) -> Result<crate::licensing::LicenseStateDto, String> {
    state.license_mgr.activate_license_key(request)
}

#[tauri::command]
pub fn get_machine_hwid(
    state: State<'_, AppState>,
) -> Result<String, String> {
    Ok(state.license_mgr.get_hwid().to_string())
}

#[tauri::command]
pub async fn sync_license_cloud(
    state: State<'_, AppState>,
) -> Result<crate::licensing::HeartbeatResult, String> {
    Ok(crate::licensing::heartbeat::perform_heartbeat(state.license_mgr.clone(), state.db.clone()).await)
}

#[tauri::command]
pub fn get_cloud_license_config(
    state: State<'_, AppState>,
) -> Result<crate::licensing::CloudConfig, String> {
    Ok(crate::licensing::heartbeat::get_cloud_config(&state.db))
}

#[tauri::command]
pub fn save_cloud_license_config(
    state: State<'_, AppState>,
    config: crate::licensing::CloudConfig,
) -> Result<(), String> {
    crate::licensing::heartbeat::save_cloud_config(&state.db, &config)
}

#[tauri::command]
pub async fn update_station_profile(
    state: State<'_, AppState>,
    shop_name: String,
    owner_name: Option<String>,
    phone: Option<String>,
) -> Result<crate::licensing::LicenseStateDto, String> {
    let updated = state.license_mgr.update_station_profile(&shop_name, owner_name, phone)?;
    let mgr_clone = state.license_mgr.clone();
    let db_clone = state.db.clone();
    tokio::spawn(async move {
        crate::licensing::heartbeat::perform_heartbeat(mgr_clone, db_clone).await;
    });
    Ok(updated)
}

#[tauri::command]
pub async fn get_provider_payment_config(
    state: State<'_, AppState>,
) -> Result<crate::licensing::ProviderPaymentConfig, String> {
    let cloud_config = crate::licensing::heartbeat::get_cloud_config(&state.db);
    let base_url = cloud_config.supabase_url.trim().trim_end_matches('/');
    let anon_key = cloud_config.supabase_anon_key.trim();

    if cloud_config.sync_enabled && !base_url.is_empty() && !anon_key.is_empty() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build();
        if let Ok(client) = client {
            let query_url = format!("{}/rest/v1/system_config?key=eq.provider_payment_config&select=value", base_url);
            let res = client
                .get(&query_url)
                .header("apikey", anon_key)
                .header("Authorization", format!("Bearer {}", anon_key))
                .header("Accept", "application/json")
                .header("Cache-Control", "no-cache, no-store, must-revalidate")
                .header("Pragma", "no-cache")
                .send()
                .await;

            if let Ok(resp) = res {
                if resp.status().is_success() {
                    #[derive(Deserialize)]
                    struct ConfigRow {
                        value: serde_json::Value,
                    }
                    if let Ok(rows) = resp.json::<Vec<ConfigRow>>().await {
                        if let Some(first) = rows.first() {
                            let mut cfg = crate::licensing::ProviderPaymentConfig::from_json_value(&first.value);
                            if cfg.razorpay_key_id.as_deref().unwrap_or("").trim().is_empty() {
                                cfg.razorpay_key_id = Some("rzp_live_TvfyWRnZVTnIbK".to_string());
                            }
                            tracing::info!("get_provider_payment_config: successfully loaded from cloud! key_id = {:?}", cfg.razorpay_key_id);
                            if let Ok(serialized) = serde_json::to_string(&cfg) {
                                let _ = state.db.set_config("provider_payment_config", &serialized);
                            }
                            return Ok(cfg);
                        }
                    }
                }
            }
        }
    }

    if let Ok(Some(cached_str)) = state.db.get_config("provider_payment_config") {
        if let Ok(mut cfg) = serde_json::from_str::<crate::licensing::ProviderPaymentConfig>(&cached_str) {
            if cfg.razorpay_key_id.as_deref().unwrap_or("").trim().is_empty() {
                cfg.razorpay_key_id = Some("rzp_live_TvfyWRnZVTnIbK".to_string());
            }
            return Ok(cfg);
        }
    }

    Ok(crate::licensing::ProviderPaymentConfig::default())
}

#[tauri::command]
pub async fn get_commercial_plans_config(
    state: State<'_, AppState>,
) -> Result<crate::licensing::CommercialPlansCatalogDto, String> {
    let cloud_config = crate::licensing::heartbeat::get_cloud_config(&state.db);
    let base_url = cloud_config.supabase_url.trim().trim_end_matches('/');
    let anon_key = cloud_config.supabase_anon_key.trim();

    if cloud_config.sync_enabled && !base_url.is_empty() && !anon_key.is_empty() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build();
        if let Ok(client) = client {
            let query_url = format!(
                "{}/rest/v1/system_config?key=eq.commercial_plans_config&select=value",
                base_url
            );
            let res = client
                .get(&query_url)
                .header("apikey", anon_key)
                .header("Authorization", format!("Bearer {}", anon_key))
                .header("Accept", "application/json")
                .send()
                .await;

            if let Ok(resp) = res {
                if resp.status().is_success() {
                    #[derive(Deserialize)]
                    struct ConfigRow {
                        value: serde_json::Value,
                    }
                    if let Ok(rows) = resp.json::<Vec<ConfigRow>>().await {
                        if let Some(first) = rows.first() {
                            if let Ok(catalog) = serde_json::from_value::<crate::licensing::CommercialPlansCatalogDto>(first.value.clone()) {
                                if !catalog.plans.is_empty() {
                                    if let Ok(serialized) = serde_json::to_string(&catalog) {
                                        let _ = state.db.set_config("commercial_plans_config", &serialized);
                                    }
                                    return Ok(catalog);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(Some(cached_str)) = state.db.get_config("commercial_plans_config") {
        if let Ok(catalog) = serde_json::from_str::<crate::licensing::CommercialPlansCatalogDto>(&cached_str) {
            if !catalog.plans.is_empty() {
                return Ok(catalog);
            }
        }
    }

    Ok(crate::licensing::CommercialPlansCatalogDto::default())
}

#[tauri::command]
pub async fn generate_license_payment_qr(
    state: State<'_, AppState>,
    amount: f64,
    plan_name: String,
) -> Result<String, String> {
    let _ = plan_name;
    let cfg = get_provider_payment_config(state).await.unwrap_or_default();
    let base_payload = if !cfg.qr_payload.trim().is_empty() {
        cfg.qr_payload.trim().to_string()
    } else {
        format!(
            "upi://pay?cu=INR&mc={}&mode={}&pa={}&pn={}",
            cfg.mcc_code, cfg.qr_mode, cfg.upi_id, crate::server::url_encode(&cfg.business_name)
        )
    };

    let upi_uri = if base_payload.contains("&am=") {
        base_payload
    } else if amount > 0.0 {
        format!("{}&am={:.2}", base_payload, amount)
    } else {
        base_payload
    };

    let (_svg, data_url) = crate::server::session::generate_qr_svg(&upi_uri)
        .map_err(|e| e.to_string())?;
    let png_url = crate::server::session::generate_qr_png_data_url(&upi_uri, 10)
        .unwrap_or(data_url);
    Ok(png_url)
}

#[tauri::command]
pub async fn submit_license_payment_claim(
    state: State<'_, AppState>,
    claim: crate::licensing::LicensePaymentClaim,
) -> Result<String, String> {
    let cloud_config = crate::licensing::heartbeat::get_cloud_config(&state.db);
    let base_url = cloud_config.supabase_url.trim().trim_end_matches('/');
    let anon_key = cloud_config.supabase_anon_key.trim();

    if base_url.is_empty() || anon_key.is_empty() {
        return Err("Cloud registry is not configured. Please verify Cloud settings.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let patch_url = format!("{}/rest/v1/licenses?hwid=eq.{}", base_url, claim.hwid.trim());
    let payload = serde_json::json!({
        "requested_plan": claim.requested_plan,
        "requested_pages": claim.requested_pages,
        "amount_paid": claim.amount_paid,
        "payment_mode": claim.payment_mode,
        "payment_reference": claim.payment_reference,
        "payment_status": "PAYMENT_SUBMITTED"
    });

    let res = client
        .patch(&patch_url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {}", anon_key))
        .header("Content-Type", "application/json")
        .header("Prefer", "return=representation")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Cloud sync rejected claim: {}", err_text));
    }

    let inv_sfx = if claim.hwid.len() >= 4 { &claim.hwid[claim.hwid.len() - 4..] } else { "0001" };
    let now_iso = chrono::Utc::now().to_rfc3339();
    let rec = crate::licensing::LicensePaymentRecord {
        id: format!("claim_{}_{}", claim.hwid.trim(), &claim.payment_reference.trim()),
        hwid: claim.hwid.trim().to_string(),
        plan_code: claim.requested_plan.clone(),
        plan_name: claim.requested_plan.clone(),
        amount_paid: claim.amount_paid,
        pages_granted: claim.requested_pages,
        duration_days: None,
        payment_mode: claim.payment_mode.clone(),
        payment_reference: claim.payment_reference.clone(),
        invoice_number: format!("PD-INV-{}", inv_sfx),
        status: if claim.payment_mode == "RAZORPAY_CHECKOUT" { "VERIFIED_PAID".to_string() } else { "PENDING_VERIFICATION".to_string() },
        created_at: now_iso,
    };
    let _ = state.license_mgr.record_payment(rec);

    let mgr_clone = state.license_mgr.clone();
    let db_clone = state.db.clone();
    tokio::spawn(async move {
        crate::licensing::heartbeat::perform_heartbeat(mgr_clone, db_clone).await;
    });

    Ok(format!(
        "Payment of ₹{:.2} for {} submitted successfully! Reference / UTR: {}",
        claim.amount_paid, claim.requested_plan, claim.payment_reference
    ))
}

#[tauri::command]
pub fn get_license_payment_history(
    state: State<'_, AppState>,
) -> Result<Vec<crate::licensing::LicensePaymentRecord>, String> {
    state.license_mgr.get_payment_history()
}

#[tauri::command]
pub fn record_license_payment(
    state: State<'_, AppState>,
    payment: crate::licensing::LicensePaymentRecord,
) -> Result<(), String> {
    state.license_mgr.record_payment(payment)
}

#[tauri::command]
pub fn get_payment_usage_history(
    state: State<'_, AppState>,
    payment_id: String,
) -> Result<crate::licensing::PaymentUsageSummaryDto, String> {
    state.license_mgr.get_payment_usage_history(payment_id)
}





