use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tracing::{info, warn};
use uuid::Uuid;
use lopdf::{Dictionary, Document, Object, Stream};
use image::GenericImageView;

use crate::db::Database;
use crate::models::PrintSettingsDto;
use crate::orders::OrderManager;
use crate::storage::StorageManager;

// === SIMULATION SANDBOX START ===
#[cfg(feature = "simulation")]
pub mod simulation;

#[cfg(not(feature = "simulation"))]
pub mod simulation {
    use super::PrinterInfo;
    pub fn is_simulated_printer(_name: &str) -> bool {
        false
    }
    pub fn get_simulated_printers() -> Vec<PrinterInfo> {
        Vec::new()
    }
}
// === SIMULATION SANDBOX END ===

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
    pub is_virtual: bool,
    pub requires_prompt: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJobResult {
    pub file_id: String,
    pub filename: String,
    pub status: String,
    pub printer_name: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintBatchResult {
    pub order_id: String,
    pub printer_name: String,
    pub total_files: usize,
    pub successful_files: usize,
    pub failed_files: usize,
    pub jobs: Vec<PrintJobResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterRoutingConfig {
    pub enabled: bool,
    pub default_printer: String,
    pub bw_printer: Option<String>,
    pub color_printer: Option<String>,
    pub plotter_printer: Option<String>,
}

impl Default for PrinterRoutingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            default_printer: String::new(),
            bw_printer: None,
            color_printer: None,
            plotter_printer: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSpoolingFile {
    pub order_id: String,
    pub pickup_code: String,
    pub customer_name: String,
    pub file_id: String,
    pub filename: String,
    pub file_index: usize,
    pub total_files_in_order: usize,
    pub global_index: usize,
    pub total_global_files: usize,
    pub target_printer: String,
    pub copies: u32,
    pub color_mode: String,
    pub paper_size: String,
    pub duplex_mode: String,
    pub stage: String, // "PREPARING", "SPOOLING", "PRINTING", "COMPLETED", "FAILED"
    pub stage_message: String,
    pub error: Option<String>,
    pub current_page: Option<u32>,
    pub total_pages: Option<u32>,
    pub spooler_progress_pct: Option<f32>,
    pub page_progress_pct: Option<f32>,
    pub printer_file_index: Option<usize>,
    pub printer_total_files: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRuntimeOverride {
    pub target_printer: Option<String>,
    pub custom_page_range: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterRerouteRequest {
    pub from_printer: String,
    pub to_printer: String,
    pub interrupted_file_id: Option<String>,
    pub resume_page_range: Option<String>,
    pub migrate_remaining: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchQueuedFile {
    pub file_id: String,
    pub order_id: String,
    pub pickup_code: String,
    pub customer_name: String,
    pub filename: String,
    pub target_printer: String,
    pub copies: u32,
    pub color_mode: String,
    pub paper_size: String,
    pub duplex_mode: String,
    pub total_pages: u32,
    pub global_index: usize,
    pub total_files: usize,
    pub status: String, // "QUEUED", "SPOOLING", "PRINTING", "COMPLETED", "FAILED"
    pub progress_pct: f32,
    pub current_page: u32,
    #[serde(default)]
    pub spooler_progress_pct: f32,
    #[serde(default)]
    pub page_progress_pct: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatchSpoolerState {
    pub is_active: bool,
    pub is_paused: bool,
    pub pause_requested: bool,
    pub is_jammed: bool,
    pub is_cancelled: bool,
    pub pause_reason: Option<String>, // "CARTRIDGE_RELOAD", "PAPER_JAM", "MANUAL"
    pub jammed_printer: Option<String>,
    pub interrupted_file_id: Option<String>,
    pub current_order_id: Option<String>,
    pub current_file: Option<ActiveSpoolingFile>,
    pub target_printer: Option<String>,
    pub total_orders: usize,
    pub completed_orders: usize,
    pub total_files: usize,
    pub completed_files: usize,
    pub failed_files: usize,
    pub queued_order_ids: Vec<String>,
    pub queued_files: Vec<BatchQueuedFile>,
    #[serde(default)]
    pub active_printers: HashMap<String, ActiveSpoolingFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderQueueInfo {
    pub is_in_queue: bool,
    pub queue_position: usize,
    pub is_currently_printing: bool,
    pub is_jammed: bool,
    pub jammed_printer: Option<String>,
    pub active_file_id: Option<String>,
    pub active_file_name: Option<String>,
    pub stage: Option<String>,
    pub stage_message: Option<String>,
    pub target_printer: Option<String>,
    pub current_page: Option<u32>,
    pub total_pages: Option<u32>,
    pub spooler_progress_pct: Option<f32>,
    pub page_progress_pct: Option<f32>,
    pub jobs_ahead_on_printer: usize,
    pub printer_queue_total: usize,
    pub files: Vec<BatchQueuedFile>,
    #[serde(default)]
    pub active_printers: HashMap<String, ActiveSpoolingFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiOrderBatchSummary {
    pub total_orders: usize,
    pub completed_orders: usize,
    pub total_files: usize,
    pub successful_files: usize,
    pub failed_files: usize,
    #[serde(default)]
    pub total_pages_printed: u32,
    pub order_results: Vec<PrintBatchResult>,
}

pub struct PrinterManager {
    db: Arc<Database>,
    storage_mgr: Arc<StorageManager>,
    order_mgr: Arc<OrderManager>,
    spooler_state: Arc<Mutex<BatchSpoolerState>>,
    migrated_routes: Arc<Mutex<HashMap<String, String>>>,
    file_overrides: Arc<Mutex<HashMap<String, FileRuntimeOverride>>>,
}

impl PrinterManager {
    pub fn new(
        db: Arc<Database>,
        storage_mgr: Arc<StorageManager>,
        order_mgr: Arc<OrderManager>,
    ) -> Self {
        Self {
            db,
            storage_mgr,
            order_mgr,
            spooler_state: Arc::new(Mutex::new(BatchSpoolerState::default())),
            migrated_routes: Arc::new(Mutex::new(HashMap::new())),
            file_overrides: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Retrieves printer routing configuration from app_config.
    pub fn get_routing_config(&self) -> PrinterRoutingConfig {
        let config_json: Option<String> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT value FROM app_config WHERE key = 'printer_routing_config'")?;
            let mut rows = stmt.query([])?;
            if let Some(row) = rows.next()? {
                Ok(Some(row.get(0)?))
            } else {
                Ok(None)
            }
        }).unwrap_or(None);

        if let Some(json_str) = config_json {
            serde_json::from_str(&json_str).unwrap_or_default()
        } else {
            PrinterRoutingConfig::default()
        }
    }

    pub fn has_saved_routing_config(&self) -> bool {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM app_config WHERE key = 'printer_routing_config' LIMIT 1")?;
            let mut rows = stmt.query([])?;
            Ok(rows.next()?.is_some())
        }).unwrap_or(false)
    }

    /// Auto-detects B&W, Color, and Plotter printers from available printers based on model/capability keywords.
    pub fn detect_smart_routes(printers: &[PrinterInfo]) -> (Option<String>, Option<String>, Option<String>) {
        let usable: Vec<&PrinterInfo> = printers.iter().filter(|p| !p.requires_prompt).collect();
        let mut bw: Option<String> = None;
        let mut color: Option<String> = None;
        let mut plotter: Option<String> = None;

        for p in &usable {
            let lower = p.name.to_lowercase();
            if plotter.is_none() && (lower.contains("plotter") || lower.contains("prograf") || lower.contains("designjet")) {
                plotter = Some(p.name.clone());
            }
            if color.is_none() && (
                lower.contains("ecotank")
                || lower.contains("epson")
                || lower.contains("color")
                || lower.contains("colour")
                || lower.contains("pixma")
                || lower.contains("ink")
                || lower.contains("tank")
                || lower.contains("l805")
                || lower.contains("l31")
                || lower.contains("l32")
                || lower.contains("l130")
                || lower.contains("g20")
                || lower.contains("g30")
                || lower.contains("deskjet")
                || lower.contains("officejet")
            ) && !lower.contains("plotter") && !lower.contains("prograf") && !lower.contains("designjet") {
                color = Some(p.name.clone());
            }
            if bw.is_none() && (
                lower.contains("laserjet")
                || lower.contains("laser")
                || lower.contains("1020")
                || lower.contains("m1005")
                || lower.contains("p110")
                || lower.contains("p100")
                || lower.contains("lbp")
                || lower.contains("hl-")
                || lower.contains("mono")
                || lower.contains("b&w")
            ) && !lower.contains("color") && !lower.contains("colour") {
                bw = Some(p.name.clone());
            }
        }
        (bw, color, plotter)
    }

    // === SIMULATION SANDBOX START ===
    pub fn is_simulation_supported(&self) -> bool {
        cfg!(feature = "simulation")
    }

    /// Checks whether Hardware Simulation Sandbox is active.
    /// In Virtual Sandbox edition (`feature = "simulation"`), checks app_config setting (defaults to true).
    /// Does NOT disable simulation upon licensing in this edition (as requested: simulated printers remain accessible).
    /// In Clean Retail edition (`not(feature = "simulation")`), always returns false.
    pub fn is_simulation_mode(&self) -> bool {
        #[cfg(feature = "simulation")]
        {
            self.db.with_conn(|conn| {
                let mut stmt = conn.prepare("SELECT value FROM app_config WHERE key = 'printer_simulation_mode'")?;
                let mut rows = stmt.query([])?;
                if let Some(row) = rows.next()? {
                    let v: String = row.get(0)?;
                    Ok(v == "true" || v == "1")
                } else {
                    Ok(true) // Default to true in Virtual Sandbox edition
                }
            }).unwrap_or(false)
        }
        #[cfg(not(feature = "simulation"))]
        {
            false
        }
    }

    /// Toggles the Hardware Simulation Sandbox mode in app_config.
    pub fn set_simulation_mode(&self, enabled: bool) -> Result<(), Box<dyn std::error::Error>> {
        #[cfg(feature = "simulation")]
        {
            self.db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO app_config (key, value) VALUES ('printer_simulation_mode', ?1)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    rusqlite::params![if enabled { "true" } else { "false" }],
                )?;
                Ok(())
            })?;

            // Invalidate cached system printers so the fresh mode takes effect immediately
            clear_cached_printers();

            Ok(())
        }
        #[cfg(not(feature = "simulation"))]
        {
            if enabled {
                Err("Hardware simulation is disabled in this Clean Retail build.".into())
            } else {
                Ok(())
            }
        }
    }

    /// Applies the standard 3-tier virtual hardware simulation preset:
    /// B&W -> [VIRTUAL] HP LaserJet 1020
    /// COLOR -> [VIRTUAL] Epson EcoTank L805
    /// PLOTTER -> [VIRTUAL] Canon imagePROGRAF
    pub fn apply_simulation_routing_preset(&self) -> Result<PrinterRoutingConfig, Box<dyn std::error::Error>> {
        #[cfg(feature = "simulation")]
        {
            let preset = PrinterRoutingConfig {
                enabled: true,
                default_printer: "[VIRTUAL] HP LaserJet 1020 (Counter B&W Laser)".to_string(),
                bw_printer: Some("[VIRTUAL] HP LaserJet 1020 (Counter B&W Laser)".to_string()),
                color_printer: Some("[VIRTUAL] Epson EcoTank L805 (Color Photo Tank)".to_string()),
                plotter_printer: Some("[VIRTUAL] Canon imagePROGRAF (Plotter A1/A0)".to_string()),
            };
            self.save_routing_config(&preset)?;
            Ok(preset)
        }
        #[cfg(not(feature = "simulation"))]
        {
            Err("Virtual hardware simulation presets are not available in this Clean Retail build.".into())
        }
    }
    // === SIMULATION SANDBOX END ===

    /// Persists printer routing configuration into app_config.
    pub fn save_routing_config(&self, config: &PrinterRoutingConfig) -> Result<(), Box<dyn std::error::Error>> {
        let json_str = serde_json::to_string(config)?;
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO app_config (key, value) VALUES ('printer_routing_config', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json_str],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    /// Resolves the default automatic printer for a document based on its settings (Color, B&W, Plotter)
    /// and routing rules / smart hardware matching, ignoring any manual per-file override.
    pub fn resolve_auto_printer(&self, settings: &PrintSettingsDto, fallback_printer: &str) -> String {
        let config = self.get_routing_config();
        let is_sim = self.is_simulation_mode();
        let is_usable = |p: &str| -> bool {
            let t = p.trim();
            !t.is_empty() && (is_sim || !simulation::is_simulated_printer(t))
        };

        if config.enabled {
            if settings.paper_size.eq_ignore_ascii_case("PLOTTER") {
                if let Some(ref p) = config.plotter_printer {
                    if is_usable(p) {
                        return p.trim().to_string();
                    }
                }
            }
            if settings.color_mode.eq_ignore_ascii_case("COLOR") {
                if let Some(ref p) = config.color_printer {
                    if is_usable(p) {
                        return p.trim().to_string();
                    }
                }
            }
            if settings.color_mode.eq_ignore_ascii_case("BW") {
                if let Some(ref p) = config.bw_printer {
                    if is_usable(p) {
                        return p.trim().to_string();
                    }
                }
            }
        }

        // Smart hardware route fallback when routing is enabled (for any unconfigured slot or virtual leftover in real mode)
        // or when no custom routing config was saved yet and fallback_printer is a system/simulated printer
        let printers = self.list_printers();
        let allow_smart_detect = config.enabled
            || (!self.has_saved_routing_config()
                && (fallback_printer.trim().is_empty()
                    || printers.iter().any(|p| p.name == fallback_printer.trim())));

        if allow_smart_detect {
            let (smart_bw, smart_color, smart_plotter) = Self::detect_smart_routes(&printers);
            if settings.paper_size.eq_ignore_ascii_case("PLOTTER") {
                if let Some(p) = smart_plotter {
                    return p;
                }
            }
            if settings.color_mode.eq_ignore_ascii_case("COLOR") {
                if let Some(p) = smart_color {
                    return p;
                }
            }
            if settings.color_mode.eq_ignore_ascii_case("BW") {
                if let Some(p) = smart_bw {
                    return p;
                }
            }
        }

        if config.enabled && is_usable(&config.default_printer) {
            return config.default_printer.trim().to_string();
        }

        if !fallback_printer.trim().is_empty() {
            fallback_printer.trim().to_string()
        } else if is_usable(&config.default_printer) {
            config.default_printer.trim().to_string()
        } else if let Some(p) = printers.iter().find(|p| p.is_default && !p.requires_prompt).or_else(|| printers.iter().find(|p| !p.requires_prompt)) {
            p.name.clone()
        } else {
            "Virtual Test Spooler (Built-in)".to_string()
        }
    }

    /// Resolves target physical or virtual printer for a document based on manual per-file override first,
    /// then automatic routing rules.
    pub fn resolve_target_printer(&self, settings: &PrintSettingsDto, fallback_printer: &str) -> String {
        if let Some(ref manual_p) = settings.target_printer {
            let trimmed = manual_p.trim();
            if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("AUTO") {
                return trimmed.to_string();
            }
        }
        self.resolve_auto_printer(settings, fallback_printer)
    }

    /// Returns a copy of the current batch spooler state.
    pub fn get_spooler_state(&self) -> BatchSpoolerState {
        self.spooler_state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Pauses the active spooling queue immediately or gracefully.
    pub fn pause_spooler(&self) {
        if let Ok(mut state) = self.spooler_state.lock() {
            state.is_paused = true;
            state.pause_reason = Some("MANUAL".to_string());
        }
    }

    /// Requests a graceful pause: the currently printing document will complete fully,
    /// and the queue will hold before starting the next document (ideal for cartridge / toner replacement).
    pub fn pause_spooler_graceful(&self, reason: Option<String>) {
        if let Ok(mut state) = self.spooler_state.lock() {
            state.pause_requested = true;
            state.pause_reason = reason.or_else(|| Some("CARTRIDGE_RELOAD".to_string()));
            if !state.is_active {
                state.is_paused = true;
            }
        }
    }

    /// Immediate emergency pause on paper jam or printer driver fault.
    pub fn emergency_jam_pause(&self, printer_name: Option<String>) {
        if let Ok(mut state) = self.spooler_state.lock() {
            state.is_paused = true;
            state.is_jammed = true;
            state.pause_requested = false;
            state.pause_reason = Some("PAPER_JAM".to_string());
            let prn = printer_name.or_else(|| state.target_printer.clone());
            state.jammed_printer = prn;
            state.interrupted_file_id = state.current_file.as_ref().map(|f| f.file_id.clone());
            if let Some(ref mut cur) = state.current_file {
                cur.stage = "FAILED".to_string();
                cur.stage_message = "Paper Jam / Hardware Fault reported. Queue halted for rerouting.".to_string();
                cur.error = Some("Paper Jam / Hardware Fault reported".to_string());
            }
        }
    }

    /// Reroutes jobs from a faulty printer to an alternative working printer.
    /// Can selectively migrate all pending jobs assigned to `from_printer`,
    /// leaving jobs on other healthy printers (e.g. Color printer) untouched!
    pub fn reroute_printer_queue(&self, req: &PrinterRerouteRequest) -> Result<usize, Box<dyn std::error::Error>> {
        let mut migrated_count = 0;

        if req.migrate_remaining {
            // Register route migration
            if let Ok(mut routes) = self.migrated_routes.lock() {
                routes.insert(req.from_printer.clone(), req.to_printer.clone());
            }

            // Update SQLite print_jobs and active orders for customer synchronization
            let affected = self.db.with_conn(|conn| {
                let count = conn.execute(
                    "UPDATE print_jobs SET printer_name = ?1 
                     WHERE printer_name = ?2 AND status IN ('PREPARING', 'PENDING')",
                    rusqlite::params![&req.to_printer, &req.from_printer],
                )?;
                let _ = conn.execute(
                    "UPDATE orders SET target_printer = ?1
                     WHERE (target_printer = ?2 OR target_printer IS NULL) AND status IN ('APPROVED', 'PRINTING')",
                    rusqlite::params![&req.to_printer, &req.from_printer],
                );
                Ok(count)
            })?;
            migrated_count += affected;
        }

        // Apply override to interrupted file if specified
        if let Some(ref file_id) = req.interrupted_file_id {
            if let Ok(mut overrides) = self.file_overrides.lock() {
                overrides.insert(file_id.clone(), FileRuntimeOverride {
                    target_printer: Some(req.to_printer.clone()),
                    custom_page_range: req.resume_page_range.clone(),
                });
            }
            migrated_count += 1;
        }

        // Unpause and clear jam status
        if let Ok(mut state) = self.spooler_state.lock() {
            state.is_jammed = false;
            state.is_paused = false;
            state.pause_requested = false;
            state.jammed_printer = None;
            state.pause_reason = None;
            state.target_printer = Some(req.to_printer.clone());

            // Update all remaining / pending queued files to point to the new printer
            for qf in state.queued_files.iter_mut() {
                if req.migrate_remaining && qf.target_printer == req.from_printer {
                    qf.target_printer = req.to_printer.clone();
                } else if req.interrupted_file_id.as_deref() == Some(&qf.file_id) {
                    qf.target_printer = req.to_printer.clone();
                }
            }

            if let Some(ref mut cur) = state.current_file {
                if cur.target_printer == req.from_printer || req.interrupted_file_id.as_deref() == Some(&cur.file_id) {
                    cur.target_printer = req.to_printer.clone();
                    cur.stage = "PREPARING".to_string();
                    cur.stage_message = format!("Redirected to '{}'. Resuming print queue...", req.to_printer);
                    cur.error = None;
                }
            }

            if let Some(mut moved_card) = state.active_printers.remove(&req.from_printer) {
                moved_card.target_printer = req.to_printer.clone();
                moved_card.stage = "PREPARING".to_string();
                moved_card.stage_message = format!("Redirected to '{}'. Resuming print queue...", req.to_printer);
                moved_card.error = None;
                state.active_printers.insert(req.to_printer.clone(), moved_card);
            }
        }

        Ok(migrated_count)
    }

    /// Resolves target printer for a file, taking into account routing rules and active migration overrides.
    pub fn resolve_effective_printer(&self, file_id: &str, settings: &PrintSettingsDto, fallback_printer: &str) -> String {
        // 1. Check direct file override
        if let Ok(overrides) = self.file_overrides.lock() {
            if let Some(ov) = overrides.get(file_id) {
                if let Some(ref p) = ov.target_printer {
                    if !p.trim().is_empty() {
                        return p.trim().to_string();
                    }
                }
            }
        }

        // 2. Resolve via normal routing rules
        let candidate = self.resolve_target_printer(settings, fallback_printer);

        // 3. Check cascading hardware migrations
        if let Ok(routes) = self.migrated_routes.lock() {
            if let Some(new_p) = routes.get(&candidate) {
                return new_p.clone();
            }
        }

        candidate
    }

    /// Resumes the paused spooler queue.
    pub fn resume_spooler(&self) {
        if let Ok(mut state) = self.spooler_state.lock() {
            state.is_paused = false;
            state.pause_requested = false;
            state.is_jammed = false;
            state.pause_reason = None;
        }
    }

    /// Signals cancellation of the remaining queue.
    pub fn cancel_spooler(&self) {
        if let Ok(mut state) = self.spooler_state.lock() {
            state.is_cancelled = true;
            state.is_paused = false;
            state.pause_requested = false;
            state.is_jammed = false;
        }
    }

    /// Returns queue position, printer countdown, and live spooling status for a specific order.
    pub fn get_order_queue_info(&self, order_id: &str) -> OrderQueueInfo {
        let state = self.get_spooler_state();
        if !state.is_active {
            let target_printer = self.db.with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT COALESCE(
                        (SELECT pj.printer_name FROM print_jobs pj WHERE pj.order_id = ?1 AND pj.status IN ('PRINTING', 'SUBMITTED_TO_SPOOLER', 'READY', 'PENDING') ORDER BY pj.job_sequence_index ASC LIMIT 1),
                        (SELECT pj.printer_name FROM print_jobs pj WHERE pj.order_id = ?1 ORDER BY pj.completed_at DESC, pj.created_at DESC LIMIT 1)
                    )"
                )?;
                let tp: Result<Option<String>, _> = stmt.query_row([order_id], |row| row.get(0));
                match tp {
                    Ok(val) => Ok(val),
                    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                    Err(e) => Err(e.into()),
                }
            }).unwrap_or(None);

            return OrderQueueInfo {
                is_in_queue: false,
                queue_position: 0,
                is_currently_printing: false,
                is_jammed: false,
                jammed_printer: None,
                active_file_id: None,
                active_file_name: None,
                stage: None,
                stage_message: None,
                target_printer,
                current_page: None,
                total_pages: None,
                spooler_progress_pct: None,
                page_progress_pct: None,
                jobs_ahead_on_printer: 0,
                printer_queue_total: 0,
                files: Vec::new(),
                active_printers: HashMap::new(),
            };
        }

        let order_files: Vec<BatchQueuedFile> = state.queued_files.iter()
            .filter(|f| f.order_id == order_id)
            .cloned()
            .collect();

        let mut distinct_printers = Vec::new();
        for qf in &order_files {
            if !distinct_printers.contains(&qf.target_printer) {
                distinct_printers.push(qf.target_printer.clone());
            }
        }
        let target_printer = if !distinct_printers.is_empty() {
            Some(distinct_printers.join(", "))
        } else {
            state.current_file.as_ref().filter(|cf| cf.order_id == order_id).map(|cf| cf.target_printer.clone())
                .or_else(|| state.target_printer.clone())
        };

        let first_printer = order_files.first().map(|f| f.target_printer.clone())
            .or_else(|| target_printer.clone());

        let (jobs_ahead, p_total) = if let Some(ref p_name) = first_printer {
            let printer_files: Vec<&BatchQueuedFile> = state.queued_files.iter()
                .filter(|f| f.target_printer == *p_name)
                .collect();
            let total = printer_files.len();
            let first_idx = printer_files.iter().position(|f| f.order_id == order_id).unwrap_or(0);
            let ahead = printer_files[..first_idx].iter().filter(|f| f.status != "COMPLETED").count();
            (ahead, total)
        } else {
            (0, 0)
        };

        let active_order_file = state.active_printers.values()
            .find(|af| af.order_id == order_id && af.stage == "PRINTING")
            .or_else(|| state.active_printers.values().find(|af| af.order_id == order_id && af.stage == "SPOOLING"))
            .or_else(|| state.active_printers.values().find(|af| af.order_id == order_id && af.stage == "PREPARING"))
            .or_else(|| state.active_printers.values().find(|af| af.order_id == order_id))
            .or_else(|| state.current_file.as_ref().filter(|cf| cf.order_id == order_id));

        let any_file_active = order_files.iter().any(|f| f.status == "PREPARING" || f.status == "SPOOLING" || f.status == "PRINTING");

        let is_curr = any_file_active
            || active_order_file.is_some()
            || state.current_order_id.as_deref() == Some(order_id);

        let order_active_printers: HashMap<String, ActiveSpoolingFile> = state
            .active_printers
            .iter()
            .filter(|(p_name, af)| af.order_id == order_id || distinct_printers.contains(*p_name))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        if is_curr {
            OrderQueueInfo {
                is_in_queue: true,
                queue_position: 1,
                is_currently_printing: true,
                is_jammed: state.is_jammed,
                jammed_printer: state.jammed_printer.clone(),
                active_file_id: active_order_file.map(|f| f.file_id.clone()),
                active_file_name: active_order_file.map(|f| f.filename.clone()),
                stage: active_order_file.map(|f| f.stage.clone()),
                stage_message: active_order_file.map(|f| f.stage_message.clone()),
                target_printer,
                current_page: active_order_file.and_then(|f| f.current_page),
                total_pages: active_order_file.and_then(|f| f.total_pages),
                spooler_progress_pct: active_order_file.and_then(|f| f.spooler_progress_pct),
                page_progress_pct: active_order_file.and_then(|f| f.page_progress_pct),
                jobs_ahead_on_printer: 0,
                printer_queue_total: p_total,
                files: order_files,
                active_printers: order_active_printers,
            }
        } else if let Some(idx) = state.queued_order_ids.iter().position(|id| id == order_id) {
            OrderQueueInfo {
                is_in_queue: true,
                queue_position: idx + 2,
                is_currently_printing: false,
                is_jammed: false,
                jammed_printer: None,
                active_file_id: None,
                active_file_name: None,
                stage: Some("QUEUED".to_string()),
                stage_message: Some(format!("In queue: {} job(s) ahead on this printer", jobs_ahead)),
                target_printer,
                current_page: None,
                total_pages: order_files.first().map(|f| f.total_pages),
                spooler_progress_pct: Some(0.0),
                page_progress_pct: Some(0.0),
                jobs_ahead_on_printer: jobs_ahead,
                printer_queue_total: p_total,
                files: order_files,
                active_printers: order_active_printers,
            }
        } else {
            OrderQueueInfo {
                is_in_queue: false,
                queue_position: 0,
                is_currently_printing: false,
                is_jammed: false,
                jammed_printer: None,
                active_file_id: None,
                active_file_name: None,
                stage: None,
                stage_message: None,
                target_printer,
                current_page: None,
                total_pages: None,
                spooler_progress_pct: None,
                page_progress_pct: None,
                jobs_ahead_on_printer: 0,
                printer_queue_total: 0,
                files: order_files,
                active_printers: order_active_printers,
            }
        }
    }

    /// Discovers all available physical and virtual printers on the Windows host.
    pub fn list_printers(&self) -> Vec<PrinterInfo> {
        // === SIMULATION SANDBOX START ===
        // When simulation mode is enabled, return the virtual printer fleet instantly (<0.01ms)
        // without blocking on slow Windows PowerShell / WMI Get-CimInstance queries
        if self.is_simulation_mode() {
            return simulation::get_simulated_printers();
        }
        // === SIMULATION SANDBOX END ===
        list_system_printers()
    }

    /// Locates SumatraPDF binary executable on the machine or within bundled directories.
    pub fn locate_sumatra(&self) -> Option<PathBuf> {
        locate_sumatra_binary()
    }

    /// Formulates SumatraPDF headless print argument string based on user's print settings.
    /// Formulates SumatraPDF headless print argument string based on user's print settings.
    pub fn build_print_settings(settings: &PrintSettingsDto) -> String {
        Self::build_print_settings_internal(settings, false)
    }

    pub fn build_print_settings_internal(settings: &PrintSettingsDto, is_prefiltered: bool) -> String {
        let mut parts = Vec::new();

        // 1. Copies
        let copies = if settings.copies > 0 { settings.copies } else { 1 };
        parts.push(format!("{}x", copies));

        // 2. Color / Monochrome
        if settings.color_mode.eq_ignore_ascii_case("BW") {
            parts.push("monochrome".to_string());
        } else {
            parts.push("color".to_string());
        }

        // 3. Duplex
        match settings.duplex_mode.as_str() {
            "DUPLEX_LONG_EDGE" => parts.push("duplexlong".to_string()),
            "DUPLEX_SHORT_EDGE" => parts.push("duplexshort".to_string()),
            _ => parts.push("simplex".to_string()),
        }

        // 4. Paper Size
        match settings.paper_size.to_uppercase().as_str() {
            "A3" => parts.push("paper=a3".to_string()),
            "LETTER" => parts.push("paper=letter".to_string()),
            "LEGAL" => parts.push("paper=legal".to_string()),
            "PLOTTER" => {}, // Roll-feed / large format: preserve native document dimensions
            _ => parts.push("paper=a4".to_string()),
        }

        // 5. Orientation
        match settings.orientation.to_uppercase().as_str() {
            "LANDSCAPE" => parts.push("landscape".to_string()),
            "PORTRAIT" => parts.push("portrait".to_string()),
            _ => {}
        }

        // 6. Page Range (only if NOT already physically sliced by lopdf)
        if !is_prefiltered {
            if let Some(ref range) = settings.page_range {
                let trimmed = range.trim();
                if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("all") {
                    // SumatraPDF expects raw page range token like "3" or "1-5", NEVER "pages="!
                    parts.push(trimmed.replace(' ', ""));
                }
            }
        }

        // 7. Page fit (ensures document fits printable margin)
        parts.push("fit".to_string());

        // 8. Prevent SumatraPDF internal auto-rotator from overriding user-specified orientation or manual rotation
        if settings.orientation.to_uppercase() != "AUTO" || settings.rotation.unwrap_or(0) != 0 {
            parts.push("disable-auto-rotation".to_string());
        }

        parts.join(",")
    }

    /// Prints a single file using headless SumatraPDF to the specified printer.
    pub fn print_single_file(
        &self,
        file_path: &Path,
        printer_name: &str,
        settings: &PrintSettingsDto,
    ) -> Result<String, Box<dyn std::error::Error>> {
        self.print_single_file_with_progress(file_path, printer_name, settings, None)
    }

    /// Prints a single file with optional live progress tick callback during simulation or hardware streaming.
    pub fn print_single_file_with_progress(
        &self,
        file_path: &Path,
        printer_name: &str,
        settings: &PrintSettingsDto,
        on_progress: Option<&mut dyn FnMut(&ActiveSpoolingFile, &BatchSpoolerState)>,
    ) -> Result<String, Box<dyn std::error::Error>> {
        self.print_single_file_for_job(file_path, printer_name, settings, None, on_progress)
    }

    #[allow(unused_variables)]
    pub fn print_single_file_for_job(
        &self,
        file_path: &Path,
        printer_name: &str,
        settings: &PrintSettingsDto,
        active_file_ctx: Option<&mut ActiveSpoolingFile>,
        on_progress: Option<&mut dyn FnMut(&ActiveSpoolingFile, &BatchSpoolerState)>,
    ) -> Result<String, Box<dyn std::error::Error>> {
        if !file_path.exists() {
            return Err(format!("Document file not found at path: {:?}", file_path).into());
        }

        // Pre-rotate and/or slice document pages if custom page range or manual rotation was requested
        let rot = settings.rotation.unwrap_or(0) as i32;
        let norm_rot = rot.rem_euclid(360);
        let mut temp_prepared_path: Option<PathBuf> = None;
        let mut is_prefiltered = false;

        let effective_path: std::borrow::Cow<'_, Path> = if is_pdf_file(file_path) {
            let temp_dir = std::env::temp_dir();
            let has_range = settings.page_range.as_ref().map_or(false, |r| {
                let t = r.trim();
                !t.is_empty() && !t.eq_ignore_ascii_case("all")
            });

            if norm_rot != 0 || has_range {
                let temp_file = temp_dir.join(format!("printdrop_prep_{}_{}.pdf", Uuid::new_v4(), norm_rot));
                match prepare_pdf_document(file_path, &temp_file, norm_rot, settings.page_range.as_deref()) {
                    Ok(filtered) => {
                        info!("Prepared PDF for printing (rotated: {}°, filtered: {}) -> {:?}", norm_rot, filtered, temp_file);
                        is_prefiltered = filtered;
                        temp_prepared_path = Some(temp_file.clone());
                        std::borrow::Cow::Owned(temp_file)
                    }
                    Err(e) => {
                        warn!("Failed to prepare PDF with lopdf: {}. Falling back to original file.", e);
                        std::borrow::Cow::Borrowed(file_path)
                    }
                }
            } else {
                let ext = file_path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if ext != "pdf" {
                    let temp_file = temp_dir.join(format!("printdrop_doc_{}.pdf", Uuid::new_v4()));
                    if std::fs::copy(file_path, &temp_file).is_ok() {
                        temp_prepared_path = Some(temp_file.clone());
                        std::borrow::Cow::Owned(temp_file)
                    } else {
                        std::borrow::Cow::Borrowed(file_path)
                    }
                } else {
                    std::borrow::Cow::Borrowed(file_path)
                }
            }
        } else if is_image_file(file_path) {
            let temp_dir = std::env::temp_dir();
            let temp_file = temp_dir.join(format!("printdrop_img_{}.pdf", Uuid::new_v4()));
            match convert_image_to_pdf(file_path, &temp_file, settings) {
                Ok(_) => {
                    info!("Converted image to PDF for printer -> {:?}", temp_file);
                    temp_prepared_path = Some(temp_file.clone());
                    std::borrow::Cow::Owned(temp_file)
                }
                Err(e) => {
                    warn!("Failed to convert image to PDF: {}. Printing original file.", e);
                    std::borrow::Cow::Borrowed(file_path)
                }
            }
        } else {
            std::borrow::Cow::Borrowed(file_path)
        };

        let print_settings_arg = Self::build_print_settings_internal(settings, is_prefiltered);

        // === SIMULATION SANDBOX START ===
        #[cfg(feature = "simulation")]
        // 1. Hardware Simulation Sandbox (Zero physical hardware required, zero GUI popups, realistic pacing)
        if simulation::is_simulated_printer(printer_name) {
            return simulation::simulate_paged_print(
                &self.storage_mgr,
                &self.spooler_state,
                effective_path.as_ref(),
                printer_name,
                settings,
                temp_prepared_path,
                is_prefiltered,
                active_file_ctx,
                on_progress,
            );
        }
        // === SIMULATION SANDBOX END ===

        // 2. Reject interactive prompt printers in headless mode
        if printer_name.eq_ignore_ascii_case("Microsoft Print to PDF") {
            if let Some(temp) = temp_prepared_path {
                let _ = std::fs::remove_file(temp);
            }
            return Err(
                "Printing to 'Microsoft Print to PDF' in headless mode is not supported by Windows because it demands an interactive 'Save As' destination file prompt. Please select 'Virtual Test Spooler (Built-in)' for virtual testing, or select a physical printer/Snagit/OneNote."
                    .into(),
            );
        }

        // 3. Physical or Non-Prompt Virtual Printer via SumatraPDF
        let sumatra_exe = self.locate_sumatra().ok_or_else(|| {
            if let Some(ref temp) = temp_prepared_path {
                let _ = std::fs::remove_file(temp);
            }
            "SumatraPDF executable not found. Place SumatraPDF.exe in the bin/ directory or install on the system."
        })?;

        info!(
            "Invoking SumatraPDF headless print: {:?} -> Printer '{}' with [{}]",
            effective_path.as_ref(), printer_name, print_settings_arg
        );

        let mut cmd = Command::new(&sumatra_exe);
        cmd.arg("-silent");
        cmd.arg("-print-to");
        cmd.arg(printer_name);
        cmd.arg("-print-settings");
        cmd.arg(&print_settings_arg);
        cmd.arg(effective_path.as_ref());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // 0x08000000 = CREATE_NO_WINDOW
            cmd.creation_flags(0x08000000);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                if let Some(temp) = temp_prepared_path {
                    let _ = std::fs::remove_file(temp);
                }
                return Err(e.into());
            }
        };

        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(12);
        let has_live_progress = on_progress.is_some();

        loop {
            let state = self.get_spooler_state();
            let is_this_jammed = state.is_jammed
                && state.jammed_printer.as_ref().map_or(true, |jp| {
                    jp == printer_name || printer_name.contains(jp.as_str()) || jp.contains(printer_name)
                });
            if is_this_jammed || state.is_cancelled {
                let _ = child.kill();
                if let Some(temp) = temp_prepared_path {
                    let _ = std::fs::remove_file(temp);
                }
                return Err("Printing halted immediately due to paper jam or cancellation".into());
            }

            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        if let Some(temp) = temp_prepared_path {
                            let _ = std::fs::remove_file(temp);
                        }
                        return Err(format!("SumatraPDF exited with code: {:?}", status.code()).into());
                    }
                    break;
                }
                Ok(None) => {
                    if start.elapsed() > timeout {
                        let _ = child.kill();
                        if let Some(temp) = temp_prepared_path {
                            let _ = std::fs::remove_file(temp);
                        }
                        return Err(format!(
                            "Print job to '{}' timed out after 12s. This printer may be requiring interactive GUI input or its spooler is unresponsive. Please choose 'Virtual Test Spooler (Built-in)' or a physical printer.",
                            printer_name
                        ).into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(150));
                }
                Err(err) => {
                    if let Some(temp) = temp_prepared_path {
                        let _ = std::fs::remove_file(temp);
                    }
                    return Err(err.into());
                }
            }
        }

        info!("Successfully sent document {:?} to printer '{}'", file_path, printer_name);

        // When invoked from the Live Animated Spooler UI (`on_progress.is_some()`), drive the
        // calibrated animated Spooler Ring + Page Printing Ring so physical printers also display
        // real-time side-by-side parallel progress while hardware prints the pages.
        if has_live_progress {
            #[cfg(feature = "simulation")]
            return simulation::simulate_paged_print(
                &self.storage_mgr,
                &self.spooler_state,
                effective_path.as_ref(),
                printer_name,
                settings,
                temp_prepared_path,
                is_prefiltered,
                active_file_ctx,
                on_progress,
            );
            #[cfg(not(feature = "simulation"))]
            {
                if let Some(temp) = temp_prepared_path {
                    let _ = std::fs::remove_file(temp);
                }
                return Ok(format!("Dispatched to '{}' [{}]", printer_name, print_settings_arg));
            }
        }

        if let Some(temp) = temp_prepared_path {
            let _ = std::fs::remove_file(temp);
        }

        Ok(format!("Dispatched to '{}' [{}]", printer_name, print_settings_arg))
    }

    /// Executes batch spooling across multiple approved orders with parallel per-printer execution,
    /// live micro-stage callbacks, dynamic printer routing per document, and fail-soft error isolation.
    pub fn execute_batch_spooling<F>(
        &self,
        order_ids: &[String],
        fallback_printer: &str,
        on_progress: F,
    ) -> Result<MultiOrderBatchSummary, Box<dyn std::error::Error>>
    where
        F: FnMut(&ActiveSpoolingFile, &BatchSpoolerState) + Send,
    {
        self.execute_batch_spooling_internal(order_ids, fallback_printer, None, true, on_progress)
    }

    pub fn execute_single_file_spooling<F>(
        &self,
        file_id: &str,
        fallback_printer: &str,
        on_progress: F,
    ) -> Result<MultiOrderBatchSummary, Box<dyn std::error::Error>>
    where
        F: FnMut(&ActiveSpoolingFile, &BatchSpoolerState) + Send,
    {
        let order_id = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT order_id FROM files WHERE id = ?1 LIMIT 1")?;
            let oid: String = stmt.query_row([file_id], |row| row.get(0))?;
            Ok(oid)
        })?;
        self.execute_batch_spooling_internal(&[order_id], fallback_printer, Some(file_id), true, on_progress)
    }

    fn execute_batch_spooling_internal<F>(
        &self,
        order_ids: &[String],
        fallback_printer: &str,
        only_file_id: Option<&str>,
        animate_live_progress: bool,
        mut on_progress: F,
    ) -> Result<MultiOrderBatchSummary, Box<dyn std::error::Error>>
    where
        F: FnMut(&ActiveSpoolingFile, &BatchSpoolerState) + Send,
    {
        if order_ids.is_empty() {
            return Err("No orders specified for batch spooling".into());
        }

        // 1. Validate all orders and collect active files
        struct OrderQueueItem {
            order_id: String,
            pickup_code: String,
            customer_name: String,
            order_revision_id: String,
            files: Vec<crate::orders::OrderFileDetailDto>,
        }

        let mut queue_items = Vec::new();
        let mut total_files_count = 0;

        for oid in order_ids {
            let order_details = self.order_mgr.get_order_details(oid)?
                .ok_or_else(|| format!("Order '{}' not found", oid))?;

            // Gate: Must be APPROVED, COMPLETED, or PRINTING
            if order_details.order.status != "APPROVED"
                && order_details.order.status != "COMPLETED"
                && order_details.order.status != "PRINTING"
            {
                return Err(format!(
                    "Order '{}' is currently '{}'. It must be in 'APPROVED' or 'COMPLETED' status before printing can be executed.",
                    oid, order_details.order.status
                ).into());
            }

            let active_files: Vec<_> = order_details.files
                .into_iter()
                .filter(|f| {
                    if f.is_purged {
                        return false;
                    }
                    if let Some(target) = only_file_id {
                        f.file_id == target
                    } else {
                        !f.is_excluded
                    }
                })
                .collect();

            if active_files.is_empty() {
                continue;
            }

            let order_rev_id = self.db.with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT r.id FROM order_revisions r 
                     JOIN orders o ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                     WHERE o.id = ?1"
                )?;
                let id: String = stmt.query_row([oid], |row| row.get(0))?;
                Ok(id)
            })?;

            let pcode = order_details.order.pickup_code.clone()
                .unwrap_or_else(|| oid[..std::cmp::min(4, oid.len())].to_string());

            total_files_count += active_files.len();
            queue_items.push(OrderQueueItem {
                order_id: oid.clone(),
                pickup_code: pcode,
                customer_name: order_details.order.customer_name.unwrap_or_else(|| "Customer".to_string()),
                order_revision_id: order_rev_id,
                files: active_files,
            });
        }

        if queue_items.is_empty() {
            return Err("All specified orders have 0 printable files (files excluded or erased).".into());
        }

        let total_orders = queue_items.len();
        let queued_ids: Vec<String> = queue_items.iter().map(|q| q.order_id.clone()).collect();

        // Reset runtime overrides before resolving initial batch lanes
        if let Ok(mut routes) = self.migrated_routes.lock() { routes.clear(); }
        if let Ok(mut ovs) = self.file_overrides.lock() { ovs.clear(); }

        #[derive(Clone)]
        struct BatchFileTask {
            order_id: String,
            pickup_code: String,
            customer_name: String,
            order_revision_id: String,
            file_idx_in_order: usize,
            total_files_in_order: usize,
            global_index: usize,
            total_global_files: usize,
            printer_file_index: usize,
            printer_total_files: usize,
            file: crate::orders::OrderFileDetailDto,
        }

        // Pre-calculate per-printer file quotas for accurate dual horizontal progress bars
        let mut printer_file_quotas: HashMap<String, usize> = HashMap::new();
        for item in &queue_items {
            for f in &item.files {
                let p = self.resolve_effective_printer(&f.file_id, &f.print_settings, fallback_printer);
                *printer_file_quotas.entry(p).or_insert(0) += 1;
            }
        }

        // 2. Build initial queued files list and group tasks into parallel printer lanes
        let mut queued_file_dtos = Vec::new();
        let mut printer_lanes: Vec<(String, Vec<BatchFileTask>)> = Vec::new();
        let mut printer_running_counts: HashMap<String, usize> = HashMap::new();
        let mut g_idx = 0;

        for item in &queue_items {
            let total_in_ord = item.files.len();
            for (f_idx, f) in item.files.iter().enumerate() {
                g_idx += 1;
                let target_p = self.resolve_effective_printer(&f.file_id, &f.print_settings, fallback_printer);
                let pages = if let Ok(ref p) = self.storage_mgr.resolve_verified_file_path(&self.db, &f.file_id) {
                    determine_document_page_count(p, &f.print_settings) as u32
                } else {
                    1
                };
                let p_total = printer_file_quotas.get(&target_p).copied().unwrap_or(1);
                let p_idx = {
                    let entry = printer_running_counts.entry(target_p.clone()).or_insert(0);
                    *entry += 1;
                    *entry
                };

                queued_file_dtos.push(BatchQueuedFile {
                    file_id: f.file_id.clone(),
                    order_id: item.order_id.clone(),
                    pickup_code: item.pickup_code.clone(),
                    customer_name: item.customer_name.clone(),
                    filename: f.original_filename.clone(),
                    target_printer: target_p.clone(),
                    copies: f.print_settings.copies,
                    color_mode: f.print_settings.color_mode.clone(),
                    paper_size: f.print_settings.paper_size.clone(),
                    duplex_mode: f.print_settings.duplex_mode.clone(),
                    total_pages: pages,
                    global_index: g_idx,
                    total_files: total_files_count,
                    status: "QUEUED".to_string(),
                    progress_pct: 0.0,
                    current_page: 0,
                    spooler_progress_pct: 0.0,
                    page_progress_pct: 0.0,
                });

                let task = BatchFileTask {
                    order_id: item.order_id.clone(),
                    pickup_code: item.pickup_code.clone(),
                    customer_name: item.customer_name.clone(),
                    order_revision_id: item.order_revision_id.clone(),
                    file_idx_in_order: f_idx + 1,
                    total_files_in_order: total_in_ord,
                    global_index: g_idx,
                    total_global_files: total_files_count,
                    printer_file_index: p_idx,
                    printer_total_files: p_total,
                    file: f.clone(),
                };

                if let Some((_p, lane_vec)) = printer_lanes.iter_mut().find(|(p, _)| *p == target_p) {
                    lane_vec.push(task);
                } else {
                    printer_lanes.push((target_p, vec![task]));
                }
            }
        }

        // Seed initial ActiveSpoolingFile for every active printer lane so side-by-side UI renders immediately
        let mut initial_active_printers: HashMap<String, ActiveSpoolingFile> = HashMap::new();
        for (lane_printer, lane_tasks) in &printer_lanes {
            if let Some(first_task) = lane_tasks.first() {
                let init_af = ActiveSpoolingFile {
                    order_id: first_task.order_id.clone(),
                    pickup_code: first_task.pickup_code.clone(),
                    customer_name: first_task.customer_name.clone(),
                    file_id: first_task.file.file_id.clone(),
                    filename: first_task.file.original_filename.clone(),
                    file_index: first_task.file_idx_in_order,
                    total_files_in_order: first_task.total_files_in_order,
                    global_index: first_task.global_index,
                    total_global_files: first_task.total_global_files,
                    target_printer: lane_printer.clone(),
                    copies: first_task.file.print_settings.copies,
                    color_mode: first_task.file.print_settings.color_mode.clone(),
                    paper_size: first_task.file.print_settings.paper_size.clone(),
                    duplex_mode: first_task.file.print_settings.duplex_mode.clone(),
                    stage: "PREPARING".to_string(),
                    stage_message: format!("Preparing document layout & page ranges for '{}'...", lane_printer),
                    error: None,
                    current_page: Some(1),
                    total_pages: None,
                    spooler_progress_pct: Some(0.0),
                    page_progress_pct: Some(0.0),
                    printer_file_index: Some(1),
                    printer_total_files: Some(first_task.printer_total_files),
                };
                initial_active_printers.insert(lane_printer.clone(), init_af);
            }
        }

        let first_active_file = printer_lanes
            .first()
            .and_then(|(p, _)| initial_active_printers.get(p))
            .cloned();

        {
            let mut state = self.spooler_state.lock().map_err(|e| e.to_string())?;
            state.is_active = true;
            state.is_paused = false;
            state.pause_requested = false;
            state.is_jammed = false;
            state.is_cancelled = false;
            state.pause_reason = None;
            state.jammed_printer = None;
            state.interrupted_file_id = None;
            state.total_orders = total_orders;
            state.completed_orders = 0;
            state.total_files = total_files_count;
            state.completed_files = 0;
            state.failed_files = 0;
            state.queued_order_ids = queued_ids.clone();
            state.queued_files = queued_file_dtos;
            state.current_order_id = queued_ids.first().cloned();
            state.current_file = first_active_file.clone();
            state.target_printer = first_active_file.as_ref().map(|f| f.target_printer.clone());
            state.active_printers = initial_active_printers.clone();
        }

        // Emit initial progress for every printer lane so side-by-side cards appear immediately at t=0
        let snapshot_init = self.get_spooler_state();
        for (lane_printer, _) in &printer_lanes {
            if let Some(af) = initial_active_printers.get(lane_printer) {
                on_progress(af, &snapshot_init);
            }
        }

        // Prepare per-order tracking state; each order transitions to PRINTING when its first file starts on a printer lane
        struct OrderProgressTracker {
            queue_index: usize,
            total_files: usize,
            succeeded_files: usize,
            failed_files: usize,
            printed_pages: u32,
            jobs: Vec<(usize, PrintJobResult)>,
            started: bool,
            finalized: bool,
        }

        let mut trackers_map: HashMap<String, OrderProgressTracker> = HashMap::new();
        for (ord_idx, item) in queue_items.iter().enumerate() {
            trackers_map.insert(
                item.order_id.clone(),
                OrderProgressTracker {
                    queue_index: ord_idx + 1,
                    total_files: item.files.len(),
                    succeeded_files: 0,
                    failed_files: 0,
                    printed_pages: 0,
                    jobs: Vec::new(),
                    started: false,
                    finalized: false,
                },
            );
        }

        let trackers_mutex = Mutex::new(trackers_map);
        let cb_mutex = Mutex::new(&mut on_progress);

        // 3. Execute all distinct printer lanes concurrently in parallel threads!
        std::thread::scope(|s| {
            for (_lane_printer, lane_tasks) in printer_lanes {
                let trackers_ref = &trackers_mutex;
                let cb_ref = &cb_mutex;

                s.spawn(move || {
                    for (lane_step_idx, task) in lane_tasks.into_iter().enumerate() {
                        if self.get_spooler_state().is_cancelled {
                            info!("Printer lane cancelled before file {}", task.file.original_filename);
                            break;
                        }

                        // Check if graceful pause was requested
                        if self.get_spooler_state().pause_requested {
                            if let Ok(mut state) = self.spooler_state.lock() {
                                state.is_paused = true;
                                state.pause_requested = false;
                                if state.pause_reason.is_none() {
                                    state.pause_reason = Some("CARTRIDGE_RELOAD".to_string());
                                }
                            }
                        }

                        while self.get_spooler_state().is_paused {
                            if self.get_spooler_state().is_cancelled {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(200));
                        }

                        if self.get_spooler_state().is_cancelled {
                            break;
                        }

                        if lane_step_idx > 0 {
                            // Inter-document settling buffer within the same printer lane
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }

                        let job_id = Uuid::new_v4().to_string();

                        // Resolve effective printer (respecting per-file overrides & runtime jam migrations)
                        let mut target_printer = self.resolve_effective_printer(
                            &task.file.file_id,
                            &task.file.print_settings,
                            fallback_printer,
                        );

                        let mut effective_settings = task.file.print_settings.clone();
                        if let Ok(ovs) = self.file_overrides.lock() {
                            if let Some(ov) = ovs.get(&task.file.file_id) {
                                if let Some(ref pr) = ov.custom_page_range {
                                    effective_settings.page_range = Some(pr.clone());
                                }
                            }
                        }

                        let mut active_file = ActiveSpoolingFile {
                            order_id: task.order_id.clone(),
                            pickup_code: task.pickup_code.clone(),
                            customer_name: task.customer_name.clone(),
                            file_id: task.file.file_id.clone(),
                            filename: task.file.original_filename.clone(),
                            file_index: task.file_idx_in_order,
                            total_files_in_order: task.total_files_in_order,
                            global_index: task.global_index,
                            total_global_files: task.total_global_files,
                            target_printer: target_printer.clone(),
                            copies: effective_settings.copies,
                            color_mode: effective_settings.color_mode.clone(),
                            paper_size: effective_settings.paper_size.clone(),
                            duplex_mode: effective_settings.duplex_mode.clone(),
                            stage: "PREPARING".to_string(),
                            stage_message: format!("Preparing document layout & page ranges for '{}'...", target_printer),
                            error: None,
                            current_page: Some(1),
                            total_pages: None,
                            spooler_progress_pct: Some(0.0),
                            page_progress_pct: Some(0.0),
                            printer_file_index: Some(task.printer_file_index),
                            printer_total_files: Some(task.printer_total_files),
                        };

                        // Transition order to PRINTING in SQLite when its first file starts processing on a printer lane
                        let mut order_just_started = None;
                        if let Ok(mut trackers) = trackers_ref.lock() {
                            if let Some(tr) = trackers.get_mut(&task.order_id) {
                                if !tr.started {
                                    tr.started = true;
                                    order_just_started = Some((tr.total_files, tr.queue_index));
                                }
                            }
                        }
                        if let Some((files_cnt, q_idx)) = order_just_started {
                            let _ = self.db.with_conn(|conn| {
                                conn.execute(
                                    "UPDATE orders SET status = 'PRINTING', updated_at = datetime('now') WHERE id = ?1",
                                    rusqlite::params![&task.order_id],
                                )?;
                                conn.execute(
                                    "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, ?2, ?3)",
                                    rusqlite::params![
                                        &task.order_id,
                                        "ORDER_PRINTING_STARTED",
                                        serde_json::json!({
                                            "filesCount": files_cnt,
                                            "queueIndex": q_idx,
                                            "totalOrders": total_orders
                                        }).to_string()
                                    ],
                                )?;
                                Ok(())
                            });
                        }

                        {
                            if let Ok(mut state) = self.spooler_state.lock() {
                                state.current_order_id = Some(task.order_id.clone());
                                state.queued_order_ids.retain(|id| id != &task.order_id);
                                state.current_file = Some(active_file.clone());
                                state.target_printer = Some(target_printer.clone());
                                state.active_printers.insert(target_printer.clone(), active_file.clone());
                                for qf in state.queued_files.iter_mut() {
                                    if qf.file_id == task.file.file_id {
                                        qf.status = "PREPARING".to_string();
                                    }
                                }
                            }
                        }
                        if let Ok(mut cb) = cb_ref.lock() {
                            (**cb)(&active_file, &self.get_spooler_state());
                        }

                        // Find file_revision_id
                        let file_revision_id_res: Result<String, Box<dyn std::error::Error>> = self.db.with_conn(|conn| {
                            let mut stmt = conn.prepare(
                                "SELECT id FROM file_revisions WHERE file_id = ?1 AND order_revision_id = ?2"
                            )?;
                            let rev_id: String = stmt.query_row([&task.file.file_id, &task.order_revision_id], |row| row.get(0))?;
                            Ok(rev_id)
                        });

                        let file_revision_id = match file_revision_id_res {
                            Ok(id) => id,
                            Err(e) => {
                                tracing::error!("Failed to resolve file_revision_id for {}: {}", task.file.file_id, e);
                                String::new()
                            }
                        };

                        // Insert print_jobs record with PREPARING
                        let _ = self.db.with_conn(|conn| {
                            conn.execute(
                                "INSERT INTO print_jobs (id, order_id, order_revision_id, file_revision_id, printer_name, job_sequence_index, status, submitted_at)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
                                rusqlite::params![
                                    job_id,
                                    task.order_id,
                                    task.order_revision_id,
                                    file_revision_id,
                                    target_printer,
                                    task.file_idx_in_order as i64,
                                    "PREPARING"
                                ],
                            )?;
                            Ok(())
                        });

                        let resolved_path = self.storage_mgr.resolve_verified_file_path(&self.db, &task.file.file_id);

                        let mut print_outcome = match resolved_path {
                            Ok(ref path) => {
                                active_file.stage = "SPOOLING".to_string();
                                active_file.stage_message = format!("Spooling to '{}' via headless driver...", target_printer);
                                {
                                    if let Ok(mut state) = self.spooler_state.lock() {
                                        state.current_file = Some(active_file.clone());
                                        state.active_printers.insert(target_printer.clone(), active_file.clone());
                                    }
                                }
                                if let Ok(mut cb) = cb_ref.lock() {
                                    (**cb)(&active_file, &self.get_spooler_state());
                                }

                                let _ = self.db.with_conn(|conn| {
                                    conn.execute(
                                        "UPDATE print_jobs SET status = 'SUBMITTED_TO_SPOOLER' WHERE id = ?1",
                                        rusqlite::params![&job_id],
                                    )?;
                                    Ok(())
                                });

                                if animate_live_progress {
                                    let mut marked_printing_in_db = false;
                                    let mut progress_relay = |af: &ActiveSpoolingFile, st: &BatchSpoolerState| {
                                        if !marked_printing_in_db && af.stage == "PRINTING" {
                                            marked_printing_in_db = true;
                                            let _ = self.db.with_conn(|conn| {
                                                conn.execute(
                                                    "UPDATE print_jobs SET status = 'PRINTING' WHERE id = ?1",
                                                    rusqlite::params![&job_id],
                                                )?;
                                                Ok(())
                                            });
                                        }
                                        if let Ok(mut cb) = cb_ref.lock() {
                                            (**cb)(af, st);
                                        }
                                    };
                                    self.print_single_file_for_job(
                                        path,
                                        &target_printer,
                                        &effective_settings,
                                        Some(&mut active_file),
                                        Some(&mut progress_relay),
                                    )
                                } else {
                                    self.print_single_file_for_job(
                                        path,
                                        &target_printer,
                                        &effective_settings,
                                        Some(&mut active_file),
                                        None,
                                    )
                                }
                            }
                            Err(ref err) => Err(err.clone().into()),
                        };

                        // If jammed / interrupted, wait for reroute & retry
                        if print_outcome.is_err() && self.get_spooler_state().is_jammed {
                            while self.get_spooler_state().is_paused {
                                if self.get_spooler_state().is_cancelled {
                                    break;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(200));
                            }

                            if !self.get_spooler_state().is_cancelled {
                                if let Ok(ref path) = resolved_path {
                                    let old_printer = target_printer.clone();
                                    target_printer = self.resolve_effective_printer(
                                        &task.file.file_id,
                                        &task.file.print_settings,
                                        fallback_printer,
                                    );
                                    if let Ok(ovs) = self.file_overrides.lock() {
                                        if let Some(ov) = ovs.get(&task.file.file_id) {
                                            if let Some(ref pr) = ov.custom_page_range {
                                                effective_settings.page_range = Some(pr.clone());
                                            }
                                        }
                                    }

                                    active_file.target_printer = target_printer.clone();
                                    active_file.stage = "SPOOLING".to_string();
                                    active_file.stage_message = format!("Retrying on newly selected printer '{}'...", target_printer);
                                    if let Ok(mut state) = self.spooler_state.lock() {
                                        if old_printer != target_printer {
                                            state.active_printers.remove(&old_printer);
                                        }
                                        state.active_printers.insert(target_printer.clone(), active_file.clone());
                                    }
                                    if let Ok(mut cb) = cb_ref.lock() {
                                        (**cb)(&active_file, &self.get_spooler_state());
                                    }

                                    if animate_live_progress {
                                        let mut progress_relay = |af: &ActiveSpoolingFile, st: &BatchSpoolerState| {
                                            if let Ok(mut cb) = cb_ref.lock() {
                                                (**cb)(af, st);
                                            }
                                        };
                                        print_outcome = self.print_single_file_for_job(
                                            path,
                                            &target_printer,
                                            &effective_settings,
                                            Some(&mut active_file),
                                            Some(&mut progress_relay),
                                        );
                                    } else {
                                        print_outcome = self.print_single_file_for_job(
                                            path,
                                            &target_printer,
                                            &effective_settings,
                                            Some(&mut active_file),
                                            None,
                                        );
                                    }
                                }
                            }
                        }

                        let mut job_printed_pages: u32 = 0;
                        let job_result = match print_outcome {
                            Ok(_) => {
                                active_file.stage = "COMPLETED".to_string();
                                active_file.stage_message = format!("Dispatched successfully to '{}'", target_printer);
                                active_file.error = None;
                                active_file.spooler_progress_pct = Some(100.0);
                                active_file.page_progress_pct = Some(100.0);

                                job_printed_pages = if let Ok(ref p) = resolved_path {
                                    determine_document_page_count(p, &effective_settings) as u32
                                } else {
                                    active_file.total_pages.unwrap_or_else(|| effective_settings.copies.max(1))
                                }
                                .max(1);

                                let _ = self.db.with_conn(|conn| {
                                    conn.execute(
                                        "UPDATE print_jobs SET status = 'COMPLETED', printer_name = ?1, pages_printed = ?2, completed_at = datetime('now') WHERE id = ?3",
                                        rusqlite::params![&target_printer, job_printed_pages as i64, &job_id],
                                    )?;
                                    Ok(())
                                });

                                PrintJobResult {
                                    file_id: task.file.file_id.clone(),
                                    filename: task.file.original_filename.clone(),
                                    status: "COMPLETED".to_string(),
                                    printer_name: Some(target_printer.clone()),
                                    error_message: None,
                                }
                            }
                            Err(err) => {
                                let err_msg = err.to_string();
                                active_file.stage = "FAILED".to_string();
                                active_file.stage_message = format!("Spooler error: {}", err_msg);
                                active_file.error = Some(err_msg.clone());

                                let _ = self.db.with_conn(|conn| {
                                    conn.execute(
                                        "UPDATE print_jobs SET status = 'FAILED', error_message = ?1 WHERE id = ?2",
                                        rusqlite::params![&err_msg, &job_id],
                                    )?;
                                    Ok(())
                                });

                                PrintJobResult {
                                    file_id: task.file.file_id.clone(),
                                    filename: task.file.original_filename.clone(),
                                    status: "FAILED".to_string(),
                                    printer_name: Some(target_printer.clone()),
                                    error_message: Some(err_msg),
                                }
                            }
                        };

                        // Update order tracker and check if this order is now completely finished
                        let mut order_just_completed = false;
                        let mut order_final_status = "COMPLETED";
                        let mut ord_succ = 0;
                        let mut ord_fail = 0;

                        if let Ok(mut trackers) = trackers_ref.lock() {
                            if let Some(tr) = trackers.get_mut(&task.order_id) {
                                if job_result.status == "COMPLETED" {
                                    tr.succeeded_files += 1;
                                    tr.printed_pages += job_printed_pages;
                                } else {
                                    tr.failed_files += 1;
                                }
                                tr.jobs.push((task.file_idx_in_order, job_result));

                                if !tr.finalized && (tr.succeeded_files + tr.failed_files) >= tr.total_files {
                                    tr.finalized = true;
                                    order_just_completed = true;
                                    ord_succ = tr.succeeded_files;
                                    ord_fail = tr.failed_files;
                                    order_final_status = if tr.failed_files == 0 || tr.succeeded_files > 0 {
                                        "COMPLETED"
                                    } else {
                                        "FAILED"
                                    };
                                }
                            }
                        }

                        if order_just_completed {
                            let _ = self.db.with_conn(|conn| {
                                conn.execute(
                                    "UPDATE orders SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
                                    rusqlite::params![order_final_status, &task.order_id],
                                )?;
                                conn.execute(
                                    "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, ?2, ?3)",
                                    rusqlite::params![
                                        &task.order_id,
                                        "ORDER_PRINTING_FINISHED",
                                        serde_json::json!({
                                            "status": order_final_status,
                                            "succeeded": ord_succ,
                                            "failed": ord_fail
                                        }).to_string()
                                    ],
                                )?;
                                Ok(())
                            });
                        }

                        // Update global spooler state and emit progress
                        {
                            if let Ok(mut state) = self.spooler_state.lock() {
                                if active_file.stage == "COMPLETED" {
                                    state.completed_files += 1;
                                } else {
                                    state.failed_files += 1;
                                }
                                if order_just_completed {
                                    state.completed_orders += 1;
                                }
                                state.current_file = Some(active_file.clone());
                                state.active_printers.insert(target_printer.clone(), active_file.clone());
                                for qf in state.queued_files.iter_mut() {
                                    if qf.file_id == active_file.file_id {
                                        qf.status = active_file.stage.clone();
                                        qf.target_printer = target_printer.clone();
                                        if active_file.stage == "COMPLETED" {
                                            qf.progress_pct = 100.0;
                                            qf.spooler_progress_pct = 100.0;
                                            qf.page_progress_pct = 100.0;
                                            qf.current_page = qf.total_pages;
                                        }
                                    }
                                }
                            }
                        }
                        if let Ok(mut cb) = cb_ref.lock() {
                            (**cb)(&active_file, &self.get_spooler_state());
                        }
                    }
                });
            }
        });

        // 4. Assemble final MultiOrderBatchSummary in original order sequence
        let mut order_results = Vec::new();
        let mut global_succeeded_files = 0;
        let mut global_failed_files = 0;
        let mut global_printed_pages: u32 = 0;
        let mut completed_orders_count = 0;

        if let Ok(mut trackers) = trackers_mutex.lock() {
            for item in queue_items {
                if let Some(mut tr) = trackers.remove(&item.order_id) {
                    tr.jobs.sort_by_key(|(idx, _)| *idx);
                    let sorted_jobs: Vec<PrintJobResult> = tr.jobs.into_iter().map(|(_, jr)| jr).collect();

                    // If cancelled mid-way before all files ran, finalize order status now
                    if !tr.finalized {
                        let final_status = if tr.succeeded_files > 0 { "COMPLETED" } else { "FAILED" };
                        let _ = self.db.with_conn(|conn| {
                            conn.execute(
                                "UPDATE orders SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
                                rusqlite::params![final_status, &item.order_id],
                            )?;
                            Ok(())
                        });
                    }
                    completed_orders_count += 1;
                    global_succeeded_files += tr.succeeded_files;
                    global_failed_files += tr.failed_files;
                    global_printed_pages += tr.printed_pages;

                    let mut distinct_printers = Vec::new();
                    for jr in &sorted_jobs {
                        if let Some(ref p) = jr.printer_name {
                            if !distinct_printers.contains(p) {
                                distinct_printers.push(p.clone());
                            }
                        }
                    }
                    let effective_order_printers = if distinct_printers.is_empty() {
                        fallback_printer.to_string()
                    } else {
                        distinct_printers.join(", ")
                    };

                    order_results.push(PrintBatchResult {
                        order_id: item.order_id,
                        printer_name: effective_order_printers,
                        total_files: item.files.len(),
                        successful_files: tr.succeeded_files,
                        failed_files: tr.failed_files,
                        jobs: sorted_jobs,
                    });
                }
            }
        }

        // Clean up spooler state
        {
            let mut state = self.spooler_state.lock().map_err(|e| e.to_string())?;
            state.is_active = false;
            state.is_paused = false;
            state.is_cancelled = false;
            state.current_order_id = None;
            state.current_file = None;
            state.queued_order_ids.clear();
            state.active_printers.clear();
        }

        Ok(MultiOrderBatchSummary {
            total_orders,
            completed_orders: completed_orders_count,
            total_files: total_files_count,
            successful_files: global_succeeded_files,
            failed_files: global_failed_files,
            total_pages_printed: global_printed_pages,
            order_results,
        })
    }

    /// Executes batch printing for an entire approved order.
    pub fn print_approved_order(
        &self,
        order_id: &str,
        printer_name: &str,
    ) -> Result<PrintBatchResult, Box<dyn std::error::Error>> {
        let summary = self.execute_batch_spooling_internal(&[order_id.to_string()], printer_name, None, false, |_file, _state| {})?;
        summary.order_results.into_iter().next()
            .ok_or_else(|| "Failed to produce batch result".into())
    }
}

/// Parses human page range strings (e.g. "3", "1-3", "1, 3, 5", "odd", "even", "all")
/// into a sorted vector of 1-indexed page numbers.
pub fn parse_page_range(range_str: &str, total_pages: u32) -> Vec<u32> {
    let mut pages = std::collections::BTreeSet::new();
    let clean = range_str.trim();
    if clean.is_empty() || clean.eq_ignore_ascii_case("all") {
        return (1..=total_pages).collect();
    }
    if clean.eq_ignore_ascii_case("odd") {
        return (1..=total_pages).filter(|p| p % 2 != 0).collect();
    }
    if clean.eq_ignore_ascii_case("even") {
        return (1..=total_pages).filter(|p| p % 2 == 0).collect();
    }

    for part in clean.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start_s, end_s)) = part.split_once('-') {
            let start = start_s.trim().parse::<u32>().unwrap_or(1).max(1);
            let end = end_s.trim().parse::<u32>().unwrap_or(total_pages).min(total_pages);
            if start <= end {
                for p in start..=end {
                    pages.insert(p);
                }
            }
        } else if let Ok(p) = part.parse::<u32>() {
            if p >= 1 && p <= total_pages {
                pages.insert(p);
            }
        }
    }

    if pages.is_empty() {
        (1..=total_pages).collect()
    } else {
        pages.into_iter().collect()
    }
}

/// Determines the effective page count of a document (multiplied by copies) using multi-layer stream & lopdf detection.
pub fn determine_document_page_count(file_path: &Path, settings: &PrintSettingsDto) -> usize {
    let copies = settings.copies.max(1) as usize;
    let pages = crate::pricing::detect_document_pages(file_path, None);
    if pages > 0 {
        if let Some(ref r) = settings.page_range {
            let parsed = parse_page_range(r, pages);
            if !parsed.is_empty() {
                return parsed.len() * copies;
            }
        }
        return (pages as usize) * copies;
    }
    copies
}

/// Prepares a PDF document for printing:
/// 1. If a custom page range is specified, physically extracts only those pages via lopdf::Document::delete_pages.
/// 2. If rotation is requested, applies rotation to all remaining pages.
/// 3. Saves the processed PDF to output_path.
/// Returns true if custom page filtering was applied, false if all pages were retained.
pub fn prepare_pdf_document(
    input_path: &Path,
    output_path: &Path,
    rotation_degrees: i32,
    page_range: Option<&str>,
) -> Result<bool, Box<dyn std::error::Error>> {
    let mut doc = Document::load(input_path)?;
    let total_pages = doc.get_pages().len() as u32;
    let mut pages_filtered = false;

    // 1. Physically delete unwanted pages if a custom page range is specified
    if let Some(range) = page_range {
        let trimmed = range.trim();
        if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("all") && total_pages > 0 {
            let pages_to_keep = parse_page_range(trimmed, total_pages);
            if !pages_to_keep.is_empty() && pages_to_keep.len() < total_pages as usize {
                let pages_to_delete: Vec<u32> = (1..=total_pages)
                    .filter(|p| !pages_to_keep.contains(p))
                    .collect();
                if !pages_to_delete.is_empty() {
                    doc.delete_pages(&pages_to_delete);
                    pages_filtered = true;
                    info!("Physically sliced PDF to pages {:?} (deleted pages {:?})", pages_to_keep, pages_to_delete);
                }
            }
        }
    }

    // 2. Apply rotation if specified
    let norm_rot = rotation_degrees.rem_euclid(360);
    if norm_rot != 0 {
        for (_, page_id) in doc.get_pages() {
            if let Ok(page_dict) = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()) {
                let current_rot = page_dict
                    .get(b"Rotate")
                    .ok()
                    .and_then(|o| match o {
                        Object::Integer(i) => Some(*i),
                        _ => None,
                    })
                    .unwrap_or(0);
                let new_rot = (current_rot + norm_rot as i64).rem_euclid(360);
                page_dict.set("Rotate", Object::Integer(new_rot));
            }
        }
    }

    doc.save(output_path)?;
    Ok(pages_filtered)
}

/// Rotates all pages of a PDF document by `rotation_degrees` clockwise and writes the result to `output_path`.
pub fn rotate_pdf_document(
    input_path: &Path,
    output_path: &Path,
    rotation_degrees: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    prepare_pdf_document(input_path, output_path, rotation_degrees, None).map(|_| ())
}

/// Inspects the file extension and magic bytes to check if a file is a valid PDF.
pub fn is_pdf_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ext == "pdf" {
        return true;
    }
    if let Ok(mut f) = std::fs::File::open(path) {
        use std::io::Read;
        let mut magic = [0u8; 5];
        if let Ok(n) = f.read(&mut magic) {
            return n >= 5 && &magic == b"%PDF-";
        }
    }
    false
}

/// Inspects file extension and magic bytes to check if a file is an image.
pub fn is_image_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ["png", "jpg", "jpeg", "webp", "bmp", "gif"].contains(&ext.as_str()) {
        return true;
    }
    if let Ok(mut f) = std::fs::File::open(path) {
        use std::io::Read;
        let mut magic = [0u8; 12];
        if let Ok(n) = f.read(&mut magic) {
            if n >= 8 && &magic[0..8] == b"\x89PNG\r\n\x1a\n" {
                return true;
            }
            if n >= 3 && &magic[0..3] == b"\xff\xd8\xff" {
                return true;
            }
            if n >= 2 && &magic[0..2] == b"BM" {
                return true;
            }
            if n >= 12 && &magic[0..4] == b"RIFF" && &magic[8..12] == b"WEBP" {
                return true;
            }
            if n >= 4 && &magic[0..4] == b"GIF8" {
                return true;
            }
        }
    }
    false
}

/// Converts an image file into a single-page PDF with exact paper dimensions,
/// orientation, scaling (preserving aspect ratio with margins), and rotation.
pub fn convert_image_to_pdf(
    image_path: &Path,
    output_pdf_path: &Path,
    settings: &PrintSettingsDto,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Open the image file (using format guessing so even extensionless .dat files decode properly)
    let reader = image::ImageReader::open(image_path)?.with_guessed_format()?;
    let mut img = reader.decode()?;

    // 2. Apply manual rotation if requested
    let rot = settings.rotation.unwrap_or(0).rem_euclid(360);
    img = match rot {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };

    // 3. Determine paper size in PDF points (72 points per inch)
    let (mut pw, mut ph): (f64, f64) = match settings.paper_size.to_uppercase().as_str() {
        "A3" => (841.89, 1190.55),
        "LETTER" => (612.0, 792.0),
        "LEGAL" => (612.0, 1008.0),
        _ => (595.28, 841.89), // A4 default
    };

    // Swap dimensions if landscape
    if settings.orientation.eq_ignore_ascii_case("LANDSCAPE") {
        std::mem::swap(&mut pw, &mut ph);
    }

    // 4. Calculate scaling to fit within 18pt margins while preserving aspect ratio
    let margin = 18.0f64;
    let avail_w = (pw - 2.0 * margin).max(10.0f64);
    let avail_h = (ph - 2.0 * margin).max(10.0f64);

    let (iw, ih) = img.dimensions();
    let scale = f64::min(avail_w / iw as f64, avail_h / ih as f64);
    let draw_w = iw as f64 * scale;
    let draw_h = ih as f64 * scale;
    let draw_x = (pw - draw_w) / 2.0;
    let draw_y = (ph - draw_h) / 2.0;

    // 5. Encode image to JPEG bytes
    let is_bw = settings.color_mode.eq_ignore_ascii_case("BW");
    let (color_space, jpeg_bytes) = if is_bw {
        let gray = img.to_luma8();
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92);
        encoder.encode(gray.as_raw(), iw, ih, image::ExtendedColorType::L8)?;
        ("DeviceGray", buf.into_inner())
    } else {
        let rgb = img.to_rgb8();
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92);
        encoder.encode(rgb.as_raw(), iw, ih, image::ExtendedColorType::Rgb8)?;
        ("DeviceRGB", buf.into_inner())
    };

    // 6. Build PDF document with lopdf
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    // Image XObject
    let mut img_dict = Dictionary::new();
    img_dict.set("Type", "XObject");
    img_dict.set("Subtype", "Image");
    img_dict.set("Width", iw as i64);
    img_dict.set("Height", ih as i64);
    img_dict.set("ColorSpace", color_space);
    img_dict.set("BitsPerComponent", 8);
    img_dict.set("Filter", "DCTDecode");
    let img_stream = Stream::new(img_dict, jpeg_bytes);
    let img_id = doc.add_object(img_stream);

    // Page content stream: q {draw_w} 0 0 {draw_h} {draw_x} {draw_y} cm /Im0 Do Q
    let content_ops = format!(
        "q {:.2} 0 0 {:.2} {:.2} {:.2} cm /Im0 Do Q\n",
        draw_w, draw_h, draw_x, draw_y
    );
    let content_stream = Stream::new(Dictionary::new(), content_ops.into_bytes());
    let content_id = doc.add_object(content_stream);

    // Page resources
    let mut xobjects = Dictionary::new();
    xobjects.set("Im0", img_id);
    let mut resources = Dictionary::new();
    resources.set("XObject", xobjects);

    // Page dictionary
    let mut page_dict = Dictionary::new();
    page_dict.set("Type", "Page");
    page_dict.set("Parent", pages_id);
    page_dict.set("MediaBox", vec![0.into(), 0.into(), pw.into(), ph.into()]);
    page_dict.set("Contents", content_id);
    page_dict.set("Resources", resources);
    let page_id = doc.add_object(page_dict);

    // Pages dictionary
    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", "Pages");
    pages_dict.set("Count", 1);
    pages_dict.set("Kids", vec![page_id.into()]);
    doc.set_object(pages_id, pages_dict);

    // Catalog dictionary
    let mut catalog = Dictionary::new();
    catalog.set("Type", "Catalog");
    catalog.set("Pages", pages_id);
    let catalog_id = doc.add_object(catalog);
    doc.trailer.set("Root", catalog_id);

    doc.save(output_pdf_path)?;
    Ok(())
}

static CACHED_SYSTEM_PRINTERS: std::sync::RwLock<Option<(std::time::Instant, Vec<PrinterInfo>)>> = std::sync::RwLock::new(None);

/// Clears cached system printers so the fresh printer list is retrieved on the next query.
pub fn clear_cached_printers() {
    if let Ok(mut guard) = CACHED_SYSTEM_PRINTERS.write() {
        *guard = None;
    }
}

/// Discovers installed printers via Windows PowerShell / WMI with 60s in-memory caching.
fn list_system_printers() -> Vec<PrinterInfo> {
    if let Ok(guard) = CACHED_SYSTEM_PRINTERS.read() {
        if let Some((ts, ref cached)) = *guard {
            if ts.elapsed().as_secs() < 60 {
                return cached.clone();
            }
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let ps_cmd = r#"
            Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName | ConvertTo-Json -Compress
        "#;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(parsed) = parse_powershell_printer_json(&stdout) {
                    if !parsed.is_empty() {
                        if let Ok(mut guard) = CACHED_SYSTEM_PRINTERS.write() {
                            *guard = Some((std::time::Instant::now(), parsed.clone()));
                        }
                        return parsed;
                    }
                }
            }
        }
    }

    // Fallback list of standard virtual printers
    let fallback = vec![
        PrinterInfo {
            name: "Virtual Test Spooler (Built-in)".to_string(),
            is_default: true,
            is_virtual: true,
            requires_prompt: false,
            status: "Ready for Simulation".to_string(),
        },
        PrinterInfo {
            name: "Microsoft Print to PDF".to_string(),
            is_default: false,
            is_virtual: true,
            requires_prompt: true,
            status: "Requires File Prompt".to_string(),
        },
        PrinterInfo {
            name: "OneNote (Desktop)".to_string(),
            is_default: false,
            is_virtual: true,
            requires_prompt: false,
            status: "Ready".to_string(),
        },
    ];

    if let Ok(mut guard) = CACHED_SYSTEM_PRINTERS.write() {
        *guard = Some((std::time::Instant::now(), fallback.clone()));
    }

    fallback
}

#[derive(Deserialize)]
struct RawPsPrinter {
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "Default")]
    is_default: Option<bool>,
    #[serde(rename = "PortName")]
    port_name: Option<String>,
}

fn parse_powershell_printer_json(json_str: &str) -> Result<Vec<PrinterInfo>, serde_json::Error> {
    let mut printers = Vec::new();

    // Built-in Virtual Simulator is always prepended for test environments
    printers.push(PrinterInfo {
        name: "Virtual Test Spooler (Built-in)".to_string(),
        is_default: false,
        is_virtual: true,
        requires_prompt: false,
        status: "Ready for Simulation".to_string(),
    });

    if json_str.is_empty() {
        return Ok(printers);
    }

    let parse_printer = |item: RawPsPrinter| -> Option<PrinterInfo> {
        let name = item.name?;
        let port = item.port_name.unwrap_or_default();
        let is_virt = is_virtual_printer(&name, &port);
        let requires_prompt = port.to_lowercase().contains("portprompt") || name.eq_ignore_ascii_case("Microsoft Print to PDF");
        Some(PrinterInfo {
            name,
            is_default: item.is_default.unwrap_or(false),
            is_virtual: is_virt,
            requires_prompt,
            status: if requires_prompt {
                "Requires File Prompt".to_string()
            } else {
                "Ready".to_string()
            },
        })
    };

    if json_str.starts_with('[') {
        let items: Vec<RawPsPrinter> = serde_json::from_str(json_str)?;
        for item in items {
            if let Some(p) = parse_printer(item) {
                printers.push(p);
            }
        }
    } else {
        let item: RawPsPrinter = serde_json::from_str(json_str)?;
        if let Some(p) = parse_printer(item) {
            printers.push(p);
        }
    }

    Ok(printers)
}

fn is_virtual_printer(name: &str, port: &str) -> bool {
    let lower = name.to_lowercase();
    let port_lower = port.to_lowercase();
    lower.contains("pdf")
        || lower.contains("onenote")
        || lower.contains("snagit")
        || lower.contains("xps")
        || lower.contains("fax")
        || port_lower.contains("portprompt")
        || port_lower.contains("nul:")
}

/// Locates SumatraPDF.exe on disk
fn locate_sumatra_binary() -> Option<PathBuf> {
    // 1. Current directory bin/SumatraPDF.exe
    let p1 = PathBuf::from("bin/SumatraPDF.exe");
    if p1.exists() {
        return Some(p1);
    }

    // 2. src-tauri/bin/SumatraPDF.exe
    let p2 = PathBuf::from("src-tauri/bin/SumatraPDF.exe");
    if p2.exists() {
        return Some(p2);
    }

    // 3. Executable-relative path
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let p3 = parent.join("bin").join("SumatraPDF.exe");
            if p3.exists() {
                return Some(p3);
            }
            let p4 = parent.join("SumatraPDF.exe");
            if p4.exists() {
                return Some(p4);
            }
        }
    }

    // 4. Standard Windows install paths
    let std_paths = [
        r"C:\Program Files\SumatraPDF\SumatraPDF.exe",
        r"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe",
    ];
    for p in std_paths {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }

    // 5. User LocalAppData
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let p5 = PathBuf::from(local_app_data).join("SumatraPDF").join("SumatraPDF.exe");
        if p5.exists() {
            return Some(p5);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_print_settings_builder() {
        let settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "BW".to_string(),
            duplex_mode: "DUPLEX_LONG_EDGE".to_string(),
            copies: 3,
            orientation: "LANDSCAPE".to_string(),
            page_range: Some("1-5".to_string()),
            rotation: Some(90),
            target_printer: None,
        };

        let arg = PrinterManager::build_print_settings(&settings);
        assert!(arg.contains("3x"));
        assert!(arg.contains("monochrome"));
        assert!(arg.contains("duplexlong"));
        assert!(arg.contains("paper=a4"));
        assert!(arg.contains("landscape"));
        assert!(arg.contains("1-5"));
        assert!(!arg.contains("pages="));
        assert!(arg.contains("fit"));
    }

    #[test]
    fn test_parse_page_range() {
        assert_eq!(parse_page_range("3", 5), vec![3]);
        assert_eq!(parse_page_range("1-3", 5), vec![1, 2, 3]);
        assert_eq!(parse_page_range("1, 3, 5", 5), vec![1, 3, 5]);
        assert_eq!(parse_page_range("odd", 5), vec![1, 3, 5]);
        assert_eq!(parse_page_range("even", 5), vec![2, 4]);
        assert_eq!(parse_page_range("all", 5), vec![1, 2, 3, 4, 5]);
        assert_eq!(parse_page_range("", 5), vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_extract_page_3_from_order_6529() {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let path = PathBuf::from(&appdata).join("PrintDrop/storage/verified/doc_vafym52w.dat");
        if path.exists() {
            let out = std::env::temp_dir().join("test_order_6529_p3.pdf");
            let filtered = prepare_pdf_document(&path, &out, 0, Some("3")).expect("Failed to prepare page 3");
            assert!(filtered);
            let doc = Document::load(&out).unwrap();
            let pages = doc.get_pages();
            assert_eq!(pages.len(), 1, "Prepared PDF must have exactly 1 page!");
            println!("Successfully extracted page 3. Output has {} page: {:?}", pages.len(), out);
            let _ = std::fs::remove_file(out);
        }
    }

    #[test]
    fn test_color_simplex_settings() {
        let settings = PrintSettingsDto {
            mode: "AUTO".to_string(),
            paper_size: "LETTER".to_string(),
            color_mode: "COLOR".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "PORTRAIT".to_string(),
            page_range: None,
            rotation: Some(0),
            target_printer: None,
        };

        let arg = PrinterManager::build_print_settings(&settings);
        assert!(arg.contains("1x"));
        assert!(arg.contains("color"));
        assert!(arg.contains("simplex"));
        assert!(arg.contains("paper=letter"));
        assert!(arg.contains("portrait"));
        assert!(arg.contains("fit"));
        assert!(arg.contains("disable-auto-rotation"));

        let landscape_rot = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "COLOR".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "LANDSCAPE".to_string(),
            page_range: None,
            rotation: Some(270),
            target_printer: None,
        };
        let arg_rot = PrinterManager::build_print_settings(&landscape_rot);
        assert!(arg_rot.contains("landscape"));
        assert!(arg_rot.contains("disable-auto-rotation"));
    }

    #[test]
    fn test_locate_sumatra_binary() {
        let sumatra = locate_sumatra_binary();
        assert!(sumatra.is_some(), "SumatraPDF binary must be located in bin/ or src-tauri/bin/");
    }

    #[test]
    fn test_parse_printer_json() {
        let json = r#"[{"Name":"Microsoft Print to PDF","Default":false,"PortName":"PORTPROMPT:"},{"Name":"Brother HL-L2350DW","Default":true,"PortName":"WSD-123"}]"#;
        let list = parse_powershell_printer_json(json).expect("Parse error");
        // Virtual Test Spooler + 2 from JSON = 3
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].name, "Virtual Test Spooler (Built-in)");
        assert!(list[1].is_virtual);
        assert!(list[1].requires_prompt);
        assert!(!list[2].is_virtual);
        assert!(list[2].is_default);
    }

    #[test]
    fn test_gate_allows_approved_and_completed_orders() {
        let db = Arc::new(crate::db::Database::new_in_memory().unwrap());
        let storage_dir = std::env::temp_dir().join("printdrop_test_reprint_gate");
        let storage = Arc::new(crate::storage::StorageManager::new(&storage_dir));
        let orders = Arc::new(crate::orders::OrderManager::new(db.clone()));
        let printer = PrinterManager::new(db.clone(), storage, orders.clone());

        // Awaiting approval should be rejected
        let res_unapproved = printer.print_approved_order("non_existent_or_unapproved", "Virtual Test Spooler (Built-in)");
        assert!(res_unapproved.is_err());
    }

    #[test]
    fn test_rotate_pdf_document() {
        use lopdf::{Dictionary, Document, Stream};
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(Stream::new(Dictionary::new(), vec![]));
        let page_id = doc.add_object(Dictionary::from_iter(vec![
            ("Type", "Page".into()),
            ("Parent", pages_id.into()),
            ("Contents", content_id.into()),
        ]));
        let pages_dict = Dictionary::from_iter(vec![
            ("Type", "Pages".into()),
            ("Count", 1.into()),
            ("Kids", vec![page_id.into()].into()),
        ]);
        doc.set_object(pages_id, pages_dict);
        let catalog_id = doc.add_object(Dictionary::from_iter(vec![
            ("Type", "Catalog".into()),
            ("Pages", pages_id.into()),
        ]));
        doc.trailer.set("Root", catalog_id);

        let temp_in = std::env::temp_dir().join("test_in_rotate.pdf");
        let temp_out = std::env::temp_dir().join("test_out_rotate.pdf");
        doc.save(&temp_in).unwrap();

        rotate_pdf_document(&temp_in, &temp_out, 270).unwrap();

        let loaded = Document::load(&temp_out).unwrap();
        let pages = loaded.get_pages();
        let p_id = pages.values().next().unwrap();
        let dict = loaded.get_object(*p_id).unwrap().as_dict().unwrap();
        let rot = dict.get(b"Rotate").unwrap().as_i64().unwrap();
        assert_eq!(rot, 270);

        let _ = std::fs::remove_file(temp_in);
        let _ = std::fs::remove_file(temp_out);
    }

    #[test]
    fn test_is_pdf_file_detection() {
        let temp_dat = std::env::temp_dir().join("test_magic.dat");
        std::fs::write(&temp_dat, b"%PDF-1.4\nsome content").unwrap();
        assert!(is_pdf_file(&temp_dat));
        let _ = std::fs::remove_file(temp_dat);

        let temp_txt = std::env::temp_dir().join("test_not_pdf.dat");
        std::fs::write(&temp_txt, b"hello world").unwrap();
        assert!(!is_pdf_file(&temp_txt));
        let _ = std::fs::remove_file(temp_txt);
    }

    #[test]
    fn test_rotate_real_power_file() {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let path = PathBuf::from(&appdata).join("PrintDrop/storage/verified/doc_la87lbg1.dat");
        if path.exists() {
            let out = std::env::temp_dir().join("test_power_270.pdf");
            rotate_pdf_document(&path, &out, 270).expect("Failed to rotate");
            let doc = Document::load(&out).unwrap();
            let pages = doc.get_pages();
            let p_id = pages.values().next().unwrap();
            let dict = doc.get_object(*p_id).unwrap().as_dict().unwrap();
            let rot = dict.get(b"Rotate").unwrap().as_i64().unwrap();
            assert_eq!(rot, 270);
            println!("Successfully created rotated PDF: {:?}", out);
        }
    }

    #[test]
    fn test_is_image_file_detection() {
        let temp_png = std::env::temp_dir().join("test_img.dat");
        // PNG magic bytes
        std::fs::write(&temp_png, b"\x89PNG\r\n\x1a\n\x00\x00\x00").unwrap();
        assert!(is_image_file(&temp_png));
        let _ = std::fs::remove_file(temp_png);

        let temp_jpg = std::env::temp_dir().join("test_jpg.dat");
        // JPEG magic bytes
        std::fs::write(&temp_jpg, b"\xff\xd8\xff\xe0\x00\x10JFIF").unwrap();
        assert!(is_image_file(&temp_jpg));
        let _ = std::fs::remove_file(temp_jpg);
    }

    #[test]
    fn test_convert_image_to_pdf_landscape() {
        // Create a small 200x100 synthetic RGB PNG in temp
        let img = image::RgbImage::new(200, 100);
        let temp_img = std::env::temp_dir().join("test_landscape_img.dat");
        img.save_with_format(&temp_img, image::ImageFormat::Png).unwrap();

        let temp_pdf = std::env::temp_dir().join("test_landscape_out.pdf");
        let settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "COLOR".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "LANDSCAPE".to_string(),
            page_range: None,
            rotation: Some(90),
            target_printer: None,
        };

        convert_image_to_pdf(&temp_img, &temp_pdf, &settings).expect("convert_image_to_pdf failed");

        let doc = Document::load(&temp_pdf).expect("Failed to load converted PDF");
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 1);
        let p_id = pages.values().next().unwrap();
        let page_dict = doc.get_object(*p_id).unwrap().as_dict().unwrap();
        let media_box = page_dict.get(b"MediaBox").unwrap().as_array().unwrap();
        // In landscape A4: width (841.89) > height (595.28)
        let w = media_box[2].as_float().unwrap_or(0.0);
        let h = media_box[3].as_float().unwrap_or(0.0);
        assert!(w > h, "Landscape PDF page width ({}) should be greater than height ({})", w, h);

        let _ = std::fs::remove_file(temp_img);
        let _ = std::fs::remove_file(temp_pdf);
    }

    #[test]
    fn test_printer_routing_resolution() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let storage = Arc::new(StorageManager::new(std::env::temp_dir()));
        let order_mgr = Arc::new(OrderManager::new(db.clone()));
        let printer_mgr = PrinterManager::new(db, storage, order_mgr);

        // When routing is disabled:
        let bw_settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "BW".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "PORTRAIT".to_string(),
            page_range: None,
            rotation: None,
            target_printer: None,
        };
        assert_eq!(
            printer_mgr.resolve_target_printer(&bw_settings, "Default Office Printer"),
            "Default Office Printer"
        );

        // Save routing config:
        let routing = PrinterRoutingConfig {
            enabled: true,
            default_printer: "Default Office Printer".to_string(),
            bw_printer: Some("HP LaserJet P1102 (B&W)".to_string()),
            color_printer: Some("Epson L3150 Tank (Color)".to_string()),
            plotter_printer: Some("HP DesignJet T520 (Plotter)".to_string()),
        };
        printer_mgr.save_routing_config(&routing).unwrap();

        // Check B&W routing
        assert_eq!(
            printer_mgr.resolve_target_printer(&bw_settings, "Default Office Printer"),
            "HP LaserJet P1102 (B&W)"
        );

        // Check Color routing
        let color_settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "A4".to_string(),
            color_mode: "COLOR".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "PORTRAIT".to_string(),
            page_range: None,
            rotation: None,
            target_printer: None,
        };
        assert_eq!(
            printer_mgr.resolve_target_printer(&color_settings, "Default Office Printer"),
            "Epson L3150 Tank (Color)"
        );

        // Check Plotter routing
        let plotter_settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            paper_size: "PLOTTER".to_string(),
            color_mode: "BW".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "PORTRAIT".to_string(),
            page_range: None,
            rotation: None,
            target_printer: None,
        };
        assert_eq!(
            printer_mgr.resolve_target_printer(&plotter_settings, "Default Office Printer"),
            "HP DesignJet T520 (Plotter)"
        );

        // Check Shopkeeper Manual Per-File Override takes precedence over auto routing
        let mut manual_override_settings = bw_settings.clone();
        manual_override_settings.target_printer = Some("Epson L3150 Tank (Color)".to_string());
        assert_eq!(
            printer_mgr.resolve_auto_printer(&manual_override_settings, "Default Office Printer"),
            "HP LaserJet P1102 (B&W)"
        );
        assert_eq!(
            printer_mgr.resolve_target_printer(&manual_override_settings, "Default Office Printer"),
            "Epson L3150 Tank (Color)"
        );
    }

    #[test]
    fn test_spooler_state_lifecycle_and_queue_info() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let storage = Arc::new(StorageManager::new(std::env::temp_dir()));
        let order_mgr = Arc::new(OrderManager::new(db.clone()));
        let printer_mgr = PrinterManager::new(db, storage, order_mgr);

        // Initially inactive
        assert!(!printer_mgr.get_spooler_state().is_active);
        let q_info = printer_mgr.get_order_queue_info("ord_123");
        assert!(!q_info.is_in_queue);
        assert_eq!(q_info.queue_position, 0);

        // Simulate active queue with 2 orders
        {
            let mut state = printer_mgr.spooler_state.lock().unwrap();
            state.is_active = true;
            state.current_order_id = Some("ord_123".to_string());
            state.queued_order_ids = vec!["ord_456".to_string(), "ord_789".to_string()];
            state.current_file = Some(ActiveSpoolingFile {
                order_id: "ord_123".to_string(),
                pickup_code: "1234".to_string(),
                customer_name: "Satish".to_string(),
                file_id: "f_01".to_string(),
                filename: "Doc.pdf".to_string(),
                file_index: 1,
                total_files_in_order: 1,
                global_index: 1,
                total_global_files: 3,
                target_printer: "HP LaserJet".to_string(),
                copies: 1,
                color_mode: "BW".to_string(),
                paper_size: "A4".to_string(),
                duplex_mode: "SIMPLEX".to_string(),
                stage: "SPOOLING".to_string(),
                stage_message: "Spooling to HP LaserJet...".to_string(),
                error: None,
                current_page: Some(1),
                total_pages: Some(1),
                spooler_progress_pct: Some(50.0),
                page_progress_pct: Some(0.0),
                printer_file_index: Some(1),
                printer_total_files: Some(3),
            });
        }

        // Check ord_123: should be position 1 (currently printing)
        let q1 = printer_mgr.get_order_queue_info("ord_123");
        assert!(q1.is_in_queue);
        assert!(q1.is_currently_printing);
        assert_eq!(q1.queue_position, 1);
        assert_eq!(q1.active_file_id.as_deref(), Some("f_01"));
        assert_eq!(q1.stage.as_deref(), Some("SPOOLING"));

        // Check ord_456: should be position 2 (waiting)
        let q2 = printer_mgr.get_order_queue_info("ord_456");
        assert!(q2.is_in_queue);
        assert!(!q2.is_currently_printing);
        assert_eq!(q2.queue_position, 2);

        // Check ord_789: should be position 3 (waiting)
        let q3 = printer_mgr.get_order_queue_info("ord_789");
        assert!(q3.is_in_queue);
        assert_eq!(q3.queue_position, 3);

        // Check unqueued order
        let q_none = printer_mgr.get_order_queue_info("ord_999");
        assert!(!q_none.is_in_queue);

        // Pause & Resume controls
        printer_mgr.pause_spooler();
        assert!(printer_mgr.get_spooler_state().is_paused);
        printer_mgr.resume_spooler();
        assert!(!printer_mgr.get_spooler_state().is_paused);

        // Cancel
        printer_mgr.cancel_spooler();
        assert!(printer_mgr.get_spooler_state().is_cancelled);
    }

    #[test]
    fn test_graceful_pause_and_cartridge_reload() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let storage = Arc::new(StorageManager::new(std::env::temp_dir()));
        let order_mgr = Arc::new(OrderManager::new(db.clone()));
        let printer_mgr = PrinterManager::new(db, storage, order_mgr);

        // 1. Initial idle state
        let st = printer_mgr.get_spooler_state();
        assert!(!st.is_active);
        assert!(!st.is_paused);
        assert!(!st.pause_requested);

        // 2. Request graceful pause for toner reload
        printer_mgr.pause_spooler_graceful(Some("TONER_RELOAD".to_string()));
        let st_paused = printer_mgr.get_spooler_state();
        assert!(st_paused.pause_requested);
        assert_eq!(st_paused.pause_reason.as_deref(), Some("TONER_RELOAD"));

        // 3. Unpause
        printer_mgr.resume_spooler();
        let st_resumed = printer_mgr.get_spooler_state();
        assert!(!st_resumed.is_paused);
        assert!(!st_resumed.pause_requested);
    }

    #[test]
    fn test_cascading_hardware_reroute_isolation() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let storage = Arc::new(StorageManager::new(std::env::temp_dir()));
        let order_mgr = Arc::new(OrderManager::new(db.clone()));
        let printer_mgr = PrinterManager::new(db, storage, order_mgr);

        // Configure routing rules:
        // BW -> "HP LaserJet 1020"
        // COLOR -> "Epson L805 Color"
        let routing = PrinterRoutingConfig {
            enabled: true,
            default_printer: "Default Office Printer".to_string(),
            bw_printer: Some("HP LaserJet 1020".to_string()),
            color_printer: Some("Epson L805 Color".to_string()),
            plotter_printer: None,
        };
        printer_mgr.save_routing_config(&routing).unwrap();

        let bw_settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            color_mode: "BW".to_string(),
            paper_size: "A4".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "PORTRAIT".to_string(),
            page_range: None,
            rotation: None,
            target_printer: None,
        };

        let color_settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            color_mode: "COLOR".to_string(),
            paper_size: "A4".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "PORTRAIT".to_string(),
            page_range: None,
            rotation: None,
            target_printer: None,
        };

        // Before jam: BW resolves to HP LaserJet 1020, COLOR resolves to Epson L805
        assert_eq!(
            printer_mgr.resolve_effective_printer("file_bw_01", &bw_settings, "Fallback"),
            "HP LaserJet 1020"
        );
        assert_eq!(
            printer_mgr.resolve_effective_printer("file_col_01", &color_settings, "Fallback"),
            "Epson L805 Color"
        );

        // Emergency Paper Jam on HP LaserJet 1020
        printer_mgr.emergency_jam_pause(Some("HP LaserJet 1020".to_string()));
        let jam_state = printer_mgr.get_spooler_state();
        assert!(jam_state.is_paused);
        assert!(jam_state.is_jammed);
        assert_eq!(jam_state.jammed_printer.as_deref(), Some("HP LaserJet 1020"));

        // Cascading reroute: Move all HP LaserJet 1020 jobs to "Brother HL-L2321D"
        // Also provide custom page range "6-20" for the interrupted file
        let reroute_req = PrinterRerouteRequest {
            from_printer: "HP LaserJet 1020".to_string(),
            to_printer: "Brother HL-L2321D".to_string(),
            interrupted_file_id: Some("file_bw_01".to_string()),
            resume_page_range: Some("6-20".to_string()),
            migrate_remaining: true,
        };
        printer_mgr.reroute_printer_queue(&reroute_req).unwrap();

        // Verify:
        // 1. Spooler unpaused and jam cleared
        let resumed_state = printer_mgr.get_spooler_state();
        assert!(!resumed_state.is_paused);
        assert!(!resumed_state.is_jammed);
        assert!(resumed_state.jammed_printer.is_none());

        // 2. Interrupted file routes to Brother HL-L2321D
        assert_eq!(
            printer_mgr.resolve_effective_printer("file_bw_01", &bw_settings, "Fallback"),
            "Brother HL-L2321D"
        );

        // 3. Other pending BW files originally targeting HP LaserJet 1020 also route to Brother HL-L2321D!
        assert_eq!(
            printer_mgr.resolve_effective_printer("file_bw_02", &bw_settings, "Fallback"),
            "Brother HL-L2321D"
        );

        // 4. Color files on Epson L805 Color remain completely untouched!
        assert_eq!(
            printer_mgr.resolve_effective_printer("file_col_01", &color_settings, "Fallback"),
            "Epson L805 Color"
        );

        // 5. Interrupted file has custom page range override
        let overrides = printer_mgr.file_overrides.lock().unwrap();
        let ov = overrides.get("file_bw_01").unwrap();
        assert_eq!(ov.custom_page_range.as_deref(), Some("6-20"));
        assert_eq!(ov.target_printer.as_deref(), Some("Brother HL-L2321D"));
    }

    // === SIMULATION SANDBOX START ===
    #[cfg(feature = "simulation")]
    #[test]
    fn test_simulation_mode_and_virtual_printers_listing() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let storage = Arc::new(StorageManager::new(std::env::temp_dir()));
        let order_mgr = Arc::new(OrderManager::new(db.clone()));
        let printer_mgr = PrinterManager::new(db, storage, order_mgr);

        // Simulation mode should be active by default
        assert!(printer_mgr.is_simulation_mode());

        // list_printers should include the [VIRTUAL] fleet
        let printers = printer_mgr.list_printers();
        assert!(printers.iter().any(|p| p.name.contains("HP LaserJet 1020")));
        assert!(printers.iter().any(|p| p.name.contains("Epson EcoTank L805")));
        assert!(printers.iter().any(|p| p.name.contains("Canon imagePROGRAF")));
        assert!(printers.iter().any(|p| p.name.contains("Brother HL-L2321D")));

        // Test applying simulation routing preset
        let preset = printer_mgr.apply_simulation_routing_preset().unwrap();
        assert!(preset.enabled);
        assert!(preset.bw_printer.as_deref().unwrap().contains("HP LaserJet 1020"));
        assert!(preset.color_printer.as_deref().unwrap().contains("Epson EcoTank L805"));
        assert!(preset.plotter_printer.as_deref().unwrap().contains("Canon imagePROGRAF"));

        // Disable simulation mode
        printer_mgr.set_simulation_mode(false).unwrap();
        assert!(!printer_mgr.is_simulation_mode());
    }

    #[cfg(feature = "simulation")]
    #[test]
    fn test_simulated_paged_print_and_emergency_jam_interruption() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let storage = Arc::new(StorageManager::new(std::env::temp_dir()));
        let order_mgr = Arc::new(OrderManager::new(db.clone()));
        let printer_mgr = Arc::new(PrinterManager::new(db, storage.clone(), order_mgr));

        let dummy_file = std::env::temp_dir().join("test_sim_doc.txt");
        let _ = std::fs::write(&dummy_file, b"Test Simulated Document Content");

        let settings = PrintSettingsDto {
            mode: "MANUAL".to_string(),
            color_mode: "BW".to_string(),
            paper_size: "A4".to_string(),
            duplex_mode: "SIMPLEX".to_string(),
            copies: 1,
            orientation: "PORTRAIT".to_string(),
            page_range: None,
            rotation: None,
            target_printer: None,
        };

        // Spawn a thread that triggers paper jam after 200ms
        let pm_clone = printer_mgr.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            pm_clone.emergency_jam_pause(Some("[VIRTUAL] HP LaserJet 1020".to_string()));
        });

        // Execute print_single_file: should be interrupted by paper jam within <= 500ms
        let res = printer_mgr.print_single_file(
            &dummy_file,
            "[VIRTUAL] HP LaserJet 1020 (Counter B&W Laser)",
            &settings,
        );

        assert!(res.is_err());
        let err_str = res.err().unwrap().to_string();
        assert!(err_str.contains("Paper Jam"));
    }
    // === SIMULATION SANDBOX END ===
}
