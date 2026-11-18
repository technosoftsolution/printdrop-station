//! Virtual Printer Hardware Simulation & Testing Sandbox
//! 
//! Provides a zero-dependency, zero-popup virtual printing fleet with realistic
//! hardware pacing (10 seconds per page with 500ms tick loops) for verifying:
//! 1. Multi-order sequential spooling
//! 2. Graceful manual pause (for cartridge/paper reload)
//! 3. Emergency paper jam immediate halts
//! 4. 1-click cascading hardware rerouting (Printer-1 -> Printer-2)
//! 5. Dual-sided real-time mobile customer status synchronization
//!
//! NOTE: To cleanly uninstall/remove this simulation environment for production release,
//! refer to `.agents/skills/printdrop-printer-simulation-uninstall/SKILL.md`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing::info;

use crate::models::PrintSettingsDto;
use crate::storage::StorageManager;
use super::{parse_page_range, ActiveSpoolingFile, BatchSpoolerState, PrinterInfo, PrinterManager};

/// Constant prefix identifying virtual simulated printers
pub const VIRTUAL_PRINTER_PREFIX: &str = "[VIRTUAL]";

/// Returns the standard fleet of virtual simulated printers for testing.
pub fn get_simulated_printers() -> Vec<PrinterInfo> {
    vec![
        PrinterInfo {
            name: "[VIRTUAL] HP LaserJet 1020 (Counter B&W Laser)".to_string(),
            is_default: true,
            is_virtual: true,
            requires_prompt: false,
            status: "Online (Simulated Hardware)".to_string(),
        },
        PrinterInfo {
            name: "[VIRTUAL] Epson EcoTank L805 (Color Photo Tank)".to_string(),
            is_default: false,
            is_virtual: true,
            requires_prompt: false,
            status: "Online (Simulated Hardware)".to_string(),
        },
        PrinterInfo {
            name: "[VIRTUAL] Canon imagePROGRAF (Plotter A1/A0)".to_string(),
            is_default: false,
            is_virtual: true,
            requires_prompt: false,
            status: "Online (Simulated Hardware)".to_string(),
        },
        PrinterInfo {
            name: "[VIRTUAL] Brother HL-L2321D (Backup B&W Printer)".to_string(),
            is_default: false,
            is_virtual: true,
            requires_prompt: false,
            status: "Online (Simulated Hardware)".to_string(),
        },
        PrinterInfo {
            name: "[VIRTUAL] Ricoh MP 2014D (A3/A4 High-Speed Copier)".to_string(),
            is_default: false,
            is_virtual: true,
            requires_prompt: false,
            status: "Online (Simulated Hardware)".to_string(),
        },
    ]
}

/// Checks whether a given printer name corresponds to a simulated virtual printer.
pub fn is_simulated_printer(name: &str) -> bool {
    name.starts_with(VIRTUAL_PRINTER_PREFIX) || name.starts_with("Virtual Test Spooler")
}

pub use super::determine_document_page_count;

/// Determines the exact list of page numbers to print and the document's total pages,
/// properly respecting custom ranges without double-filtering pre-sliced temporary PDFs.
pub fn determine_pages_to_simulate(
    file_path: &Path,
    settings: &PrintSettingsDto,
    is_prefiltered: bool,
) -> (Vec<u32>, u32) {
    let detected = crate::pricing::detect_document_pages(file_path, None).max(1);

    if is_prefiltered {
        // The file was already sliced to the exact requested pages by lopdf!
        // `detected` is the count of remaining sliced pages in this file.
        if let Some(ref r) = settings.page_range {
            let clean = r.trim();
            if !clean.is_empty() && !clean.eq_ignore_ascii_case("all") {
                let parsed = parse_page_range(clean, 9999);
                if !parsed.is_empty() {
                    let doc_total = parsed.iter().max().copied().unwrap_or(detected).max(detected);
                    return (parsed, doc_total);
                }
            }
        }
        let pages: Vec<u32> = (1..=detected).collect();
        (pages, detected)
    } else {
        let doc_total = detected;
        if let Some(ref r) = settings.page_range {
            let clean = r.trim();
            if !clean.is_empty() && !clean.eq_ignore_ascii_case("all") {
                let parsed = parse_page_range(clean, doc_total);
                if !parsed.is_empty() {
                    return (parsed, doc_total);
                }
            }
        }
        let pages: Vec<u32> = (1..=doc_total).collect();
        (pages, doc_total)
    }
}

/// Executes a realistic simulated document print with calibrated hardware pacing:
/// - Initial document spooling phase: 5.0 seconds (10 ticks × 500ms, Spooler circular ring 0% -> 100%)
/// - Hardware page printing phase: 20.0 seconds per page (40 ticks × 500ms, Printing circular ring 0s -> 20s)
/// Total for 1st page: 25.0 seconds (5s spool + 20s print). Subsequent pages: 20.0 seconds each.
/// 
/// Each 500ms tick actively checks `is_jammed`, `is_cancelled`, and `is_paused` to guarantee
/// immediate reaction to paper jams (<500ms) and clean graceful pause completion.
pub fn simulate_paged_print(
    storage_mgr: &StorageManager,
    spooler_state: &Arc<Mutex<BatchSpoolerState>>,
    file_path: &Path,
    printer_name: &str,
    settings: &PrintSettingsDto,
    temp_prepared_path: Option<PathBuf>,
    is_prefiltered: bool,
    mut active_file_ctx: Option<&mut ActiveSpoolingFile>,
    mut on_tick: Option<&mut dyn FnMut(&ActiveSpoolingFile, &BatchSpoolerState)>,
) -> Result<String, Box<dyn std::error::Error>> {
    let print_settings_arg = PrinterManager::build_print_settings_internal(settings, is_prefiltered);

    // 1. Determine actual page numbers to print and document total pages (accounting for copies > 1)
    let (single_copy_pages, single_copy_doc_total) = determine_pages_to_simulate(file_path, settings, is_prefiltered);
    let copies = settings.copies.max(1);
    let mut pages_to_simulate: Vec<(u32, u32, u32)> = Vec::new(); // (overall_page_num, copy_num, doc_page_num)
    if copies > 1 {
        let mut seq = 0u32;
        for c in 1..=copies {
            for &p in &single_copy_pages {
                seq += 1;
                pages_to_simulate.push((seq, c, p));
            }
        }
    } else {
        for &p in &single_copy_pages {
            pages_to_simulate.push((p, 1, p));
        }
    }
    let total_pages_in_job = pages_to_simulate.len().max(1);
    let doc_total_pages = if copies > 1 {
        total_pages_in_job as u32
    } else {
        single_copy_doc_total
    };

    // 2. Save a copy of the processed document to test_spooler/ on local disk for inspection
    let spool_dir = storage_mgr.base_dir().join("test_spooler");
    let _ = std::fs::create_dir_all(&spool_dir);
    if let Some(filename) = file_path.file_name() {
        let dest = spool_dir.join(filename);
        let _ = std::fs::copy(file_path, dest);
    }

    let is_virtual = is_simulated_printer(printer_name);
    let is_color = settings.color_mode.eq_ignore_ascii_case("COLOR");

    // Dynamic Speed Calibration:
    // Virtual Testing Sandbox: 5.0s spool (10 ticks x 500ms) + 20.0s/page (40 ticks x 500ms) for comfortable manual jam/pause testing.
    // Real Physical Printer:
    //   - Spooler: ~1.5s (6 ticks x 250ms) matching fast Windows spooler handoff.
    //   - Color Inkjet: ~5.0s/page (20 ticks x 250ms) matching ~12 PPM physical inkjet ejection.
    //   - B&W Laser: ~2.5s/page (10 ticks x 250ms) matching ~24 PPM physical laser ejection.
    let (spool_ticks, spool_tick_ms, spool_total_sec) = if is_virtual {
        (10u32, 500u64, 5.0f32)
    } else {
        (6u32, 250u64, 1.5f32)
    };

    let (page_ticks, page_tick_ms, page_total_sec) = if is_virtual {
        (40u32, 500u64, 20.0f32)
    } else if is_color {
        (20u32, 250u64, 5.0f32)
    } else {
        (10u32, 250u64, 2.5f32)
    };

    info!(
        "[SIMULATION] Starting calibrated print of {:?} ({} page(s) across {} cop(ies), total {}) on '{}' (spool: {:.1}s, page: {:.1}s/p) with [{}]",
        file_path, total_pages_in_job, copies, doc_total_pages, printer_name, spool_total_sec, page_total_sec, print_settings_arg
    );

    let first_page_num = pages_to_simulate.first().map(|t| t.0).unwrap_or(1);

    let is_printer_jammed = |state: &BatchSpoolerState| -> bool {
        state.is_jammed
            && state.jammed_printer.as_ref().map_or(true, |jp| {
                jp == printer_name || printer_name.contains(jp.as_str()) || jp.contains(printer_name)
            })
    };

    // ==========================================
    // STAGE 1: Spooler Phase
    // ==========================================
    for tick in 1..=spool_ticks {
        let spool_pct = (tick as f32 / spool_ticks as f32) * 100.0;
        let elapsed_sec = (tick as f32 * (spool_tick_ms as f32 / 1000.0)).round() as u32;

        if let Some(ref mut af) = active_file_ctx {
            af.stage = "SPOOLING".to_string();
            af.stage_message = format!(
                "Spooling document to '{}' (SumatraPDF engine {}s / {:.1}s)...",
                printer_name, elapsed_sec, spool_total_sec
            );
            af.current_page = Some(first_page_num);
            af.total_pages = Some(doc_total_pages);
            af.spooler_progress_pct = Some(spool_pct);
            af.page_progress_pct = Some(0.0);
        }

        let (active_file_opt, state_clone) = {
            if let Ok(mut state) = spooler_state.lock() {
                let target_fid = if let Some(ref af) = active_file_ctx {
                    state.active_printers.insert(printer_name.to_string(), (*af).clone());
                    state.current_file = Some((*af).clone());
                    Some(af.file_id.clone())
                } else if let Some(ref mut cur) = state.current_file {
                    cur.stage = "SPOOLING".to_string();
                    cur.stage_message = format!(
                        "Spooling document to '{}' (SumatraPDF engine {}s / {:.1}s)...",
                        printer_name, elapsed_sec, spool_total_sec
                    );
                    cur.current_page = Some(first_page_num);
                    cur.total_pages = Some(doc_total_pages);
                    cur.spooler_progress_pct = Some(spool_pct);
                    cur.page_progress_pct = Some(0.0);
                    let fid = cur.file_id.clone();
                    let cur_clone = cur.clone();
                    state.active_printers.insert(printer_name.to_string(), cur_clone);
                    Some(fid)
                } else {
                    None
                };

                if let Some(ref fid) = target_fid {
                    for qf in state.queued_files.iter_mut() {
                        if qf.file_id == *fid {
                            qf.status = "SPOOLING".to_string();
                            qf.total_pages = doc_total_pages;
                            qf.current_page = first_page_num;
                            qf.progress_pct = (spool_pct * 0.1).min(10.0);
                            qf.spooler_progress_pct = spool_pct;
                            qf.page_progress_pct = 0.0;
                        }
                    }
                }
                let emitted_file = active_file_ctx
                    .as_ref()
                    .map(|af| (*af).clone())
                    .or_else(|| state.current_file.clone());
                (emitted_file, state.clone())
            } else {
                (None, Default::default())
            }
        };

        if let (Some(ref cur), Some(ref mut cb)) = (active_file_opt.as_ref(), on_tick.as_deref_mut()) {
            cb(cur, &state_clone);
        }

        std::thread::sleep(std::time::Duration::from_millis(spool_tick_ms));

        // Immediate check for paper jam, pause or cancellation during spooling
        if let Ok(state) = spooler_state.lock() {
            if is_printer_jammed(&state) {
                if let Some(temp) = temp_prepared_path {
                    let _ = std::fs::remove_file(temp);
                }
                info!("[SIMULATION] Interrupted by Emergency Paper Jam during spooling for '{}'", printer_name);
                return Err(format!("Simulated Paper Jam detected on '{}'! Queue halted immediately for rerouting.", printer_name).into());
            }
            if state.is_cancelled {
                if let Some(temp) = temp_prepared_path {
                    let _ = std::fs::remove_file(temp);
                }
                return Err("Print batch cancelled by shopkeeper.".into());
            }
            if state.is_paused && (!state.is_jammed || is_printer_jammed(&state)) {
                drop(state);
                while spooler_state.lock().map_or(false, |st| st.is_paused && (!st.is_jammed || is_printer_jammed(&st))) {
                    if spooler_state.lock().map_or(false, |st| is_printer_jammed(&st)) {
                        if let Some(temp) = temp_prepared_path {
                            let _ = std::fs::remove_file(temp);
                        }
                        return Err(format!("Simulated Paper Jam detected on '{}'! Queue halted immediately for rerouting.", printer_name).into());
                    }
                    if spooler_state.lock().map_or(false, |st| st.is_cancelled) {
                        if let Some(temp) = temp_prepared_path {
                            let _ = std::fs::remove_file(temp);
                        }
                        return Err("Print batch cancelled by shopkeeper.".into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            }
        }
    }

    // Check if graceful Cartridge / Toner pause was requested during spooler phase
    let should_hold_spool_pause = {
        if let Ok(mut state) = spooler_state.lock() {
            if state.pause_requested {
                state.is_paused = true;
                state.pause_requested = false;
                if state.pause_reason.is_none() {
                    state.pause_reason = Some("CARTRIDGE_RELOAD".to_string());
                }
                true
            } else {
                false
            }
        } else {
            false
        }
    };
    if should_hold_spool_pause {
        let (active_file_opt, state_clone) = {
            if let Ok(state) = spooler_state.lock() {
                let emitted_file = active_file_ctx
                    .as_ref()
                    .map(|af| (*af).clone())
                    .or_else(|| state.current_file.clone());
                (emitted_file, state.clone())
            } else {
                (None, Default::default())
            }
        };
        if let (Some(ref cur), Some(ref mut cb)) = (active_file_opt.as_ref(), on_tick.as_deref_mut()) {
            cb(cur, &state_clone);
        }
        while spooler_state.lock().map_or(false, |st| st.is_paused) {
            if spooler_state.lock().map_or(false, |st| st.is_cancelled) {
                if let Some(temp) = temp_prepared_path {
                    let _ = std::fs::remove_file(temp);
                }
                return Err("Print batch cancelled by shopkeeper.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }

    // ==========================================
    // STAGE 2: Hardware Page Printing Phase
    // ==========================================
    for (page_idx, &(actual_page_num, copy_num, doc_page_num)) in pages_to_simulate.iter().enumerate() {
        for tick in 1..=page_ticks {
            let page_pct = (tick as f32 / page_ticks as f32) * 100.0;
            let elapsed_sec = (tick as f32 * (page_tick_ms as f32 / 1000.0)).round() as u32;
            let overall_file_pct = (((page_idx as f32) + (tick as f32 / page_ticks as f32)) / total_pages_in_job as f32) * 100.0;
            let stage_msg = if copies > 1 {
                format!(
                    "Printing Copy {} of {} (Page {}/{}, Doc P-{}) on '{}' ({}s / {:.1}s)...",
                    copy_num, copies, actual_page_num, doc_total_pages, doc_page_num, printer_name, elapsed_sec, page_total_sec
                )
            } else {
                format!(
                    "Printing Page {} of {} on '{}' ({}s / {:.1}s)...",
                    actual_page_num, doc_total_pages, printer_name, elapsed_sec, page_total_sec
                )
            };

            if let Some(ref mut af) = active_file_ctx {
                af.stage = "PRINTING".to_string();
                af.stage_message = stage_msg.clone();
                af.current_page = Some(actual_page_num);
                af.total_pages = Some(doc_total_pages);
                af.spooler_progress_pct = Some(100.0);
                af.page_progress_pct = Some(page_pct);
            }

            let (active_file_opt, state_clone) = {
                if let Ok(mut state) = spooler_state.lock() {
                    let target_fid = if let Some(ref af) = active_file_ctx {
                        state.active_printers.insert(printer_name.to_string(), (*af).clone());
                        state.current_file = Some((*af).clone());
                        Some(af.file_id.clone())
                    } else if let Some(ref mut cur) = state.current_file {
                        cur.stage = "PRINTING".to_string();
                        cur.stage_message = stage_msg.clone();
                        cur.current_page = Some(actual_page_num);
                        cur.total_pages = Some(doc_total_pages);
                        cur.spooler_progress_pct = Some(100.0);
                        cur.page_progress_pct = Some(page_pct);
                        let fid = cur.file_id.clone();
                        let cur_clone = cur.clone();
                        state.active_printers.insert(printer_name.to_string(), cur_clone);
                        Some(fid)
                    } else {
                        None
                    };

                    if let Some(ref fid) = target_fid {
                        for qf in state.queued_files.iter_mut() {
                            if qf.file_id == *fid {
                                qf.status = "PRINTING".to_string();
                                qf.total_pages = doc_total_pages;
                                qf.current_page = actual_page_num;
                                qf.progress_pct = overall_file_pct.min(99.0);
                                qf.spooler_progress_pct = 100.0;
                                qf.page_progress_pct = page_pct;
                            }
                        }
                    }
                    let emitted_file = active_file_ctx
                        .as_ref()
                        .map(|af| (*af).clone())
                        .or_else(|| state.current_file.clone());
                    (emitted_file, state.clone())
                } else {
                    (None, Default::default())
                }
            };

            if let (Some(ref cur), Some(ref mut cb)) = (active_file_opt.as_ref(), on_tick.as_deref_mut()) {
                cb(cur, &state_clone);
            }

            std::thread::sleep(std::time::Duration::from_millis(page_tick_ms));

            // Immediate check for emergency paper jam or user cancellation
            if let Ok(state) = spooler_state.lock() {
                if is_printer_jammed(&state) {
                    if let Some(temp) = temp_prepared_path {
                        let _ = std::fs::remove_file(temp);
                    }
                    info!(
                        "[SIMULATION] Interrupted by Emergency Paper Jam on page {}/{} (tick {}/{}) for printer '{}'",
                        actual_page_num, doc_total_pages, tick, page_ticks, printer_name
                    );
                    return Err(format!(
                        "Simulated Paper Jam detected on '{}' (Page {}/{})! Queue halted immediately for rerouting.",
                        printer_name, actual_page_num, doc_total_pages
                    ).into());
                }

                if state.is_cancelled {
                    if let Some(temp) = temp_prepared_path {
                        let _ = std::fs::remove_file(temp);
                    }
                    info!("[SIMULATION] Interrupted by Cancel command on page {}/{}", actual_page_num, doc_total_pages);
                    return Err("Print batch cancelled by shopkeeper.".into());
                }

                if state.is_paused && (!state.is_jammed || is_printer_jammed(&state)) {
                    drop(state);
                    while spooler_state.lock().map_or(false, |st| st.is_paused && (!st.is_jammed || is_printer_jammed(&st))) {
                        if spooler_state.lock().map_or(false, |st| is_printer_jammed(&st)) {
                            if let Some(temp) = temp_prepared_path {
                                let _ = std::fs::remove_file(temp);
                            }
                            return Err(format!(
                                "Simulated Paper Jam detected on '{}' (Page {}/{})! Queue halted immediately for rerouting.",
                                printer_name, actual_page_num, doc_total_pages
                            ).into());
                        }
                        if spooler_state.lock().map_or(false, |st| st.is_cancelled) {
                            if let Some(temp) = temp_prepared_path {
                                let _ = std::fs::remove_file(temp);
                            }
                            return Err("Print batch cancelled by shopkeeper.".into());
                        }
                        std::thread::sleep(std::time::Duration::from_millis(200));
                    }
                }
            }
        }

        info!(
            "[SIMULATION] Page {} of {} completed for '{}'",
            actual_page_num, doc_total_pages, printer_name
        );

        // Check if Cartridge / Toner pause was requested - hold after completing the current page cleanly
        let should_hold_page_pause = {
            if let Ok(mut state) = spooler_state.lock() {
                if state.pause_requested || (state.is_paused && !state.is_jammed) {
                    state.is_paused = true;
                    state.pause_requested = false;
                    if state.pause_reason.is_none() {
                        state.pause_reason = Some("CARTRIDGE_RELOAD".to_string());
                    }
                    let msg = format!(
                        "PAUSED after Page {}/{} for Cartridge / Toner Replacement. Click 'Continue' to resume.",
                        actual_page_num, doc_total_pages
                    );
                    if let Some(ref mut af) = active_file_ctx {
                        af.stage_message = msg.clone();
                        state.active_printers.insert(printer_name.to_string(), (*af).clone());
                    }
                    if let Some(ref mut cur) = state.current_file {
                        cur.stage_message = msg;
                    }
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };

        if should_hold_page_pause {
            info!(
                "[SIMULATION] Graceful Cartridge Pause active after Page {}/{} on '{}'. Holding queue...",
                actual_page_num, doc_total_pages, printer_name
            );

            // Notify UI with PAUSED state immediately
            let (active_file_opt, state_clone) = {
                if let Ok(state) = spooler_state.lock() {
                    let emitted_file = active_file_ctx
                        .as_ref()
                        .map(|af| (*af).clone())
                        .or_else(|| state.current_file.clone());
                    (emitted_file, state.clone())
                } else {
                    (None, Default::default())
                }
            };
            if let (Some(ref cur), Some(ref mut cb)) = (active_file_opt.as_ref(), on_tick.as_deref_mut()) {
                cb(cur, &state_clone);
            }

            // Wait until shopkeeper clicks "Continue" (or cancels)
            while spooler_state.lock().map_or(false, |st| st.is_paused) {
                if spooler_state.lock().map_or(false, |st| st.is_cancelled) {
                    if let Some(temp) = temp_prepared_path {
                        let _ = std::fs::remove_file(temp);
                    }
                    return Err("Print batch cancelled by shopkeeper.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }

            info!(
                "[SIMULATION] Resumed from Cartridge Pause on '{}'. Continuing print...",
                printer_name
            );
        }
    }

    // Clean up temporary rotated/filtered PDF if present only at the end
    if let Some(temp) = temp_prepared_path {
        let _ = std::fs::remove_file(temp);
    }

    info!(
        "[SIMULATION] Completed virtual print of {:?} (all {} pages out of doc total {}) on '{}' [100% cleanly]",
        file_path, total_pages_in_job, doc_total_pages, printer_name
    );

    Ok(format!(
        "Dispatched to {} [{} pages @ 20s/page + 5s spool] [{}]",
        printer_name, total_pages_in_job, print_settings_arg
    ))
}
