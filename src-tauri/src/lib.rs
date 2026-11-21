pub mod db;
pub mod documents;
pub mod models;
pub mod network;
pub mod orders;
pub mod printer;
pub mod server;
pub mod storage;
pub mod commands;
pub mod wifi;
pub mod tunnel;
pub mod corporate;
pub mod pricing;
pub mod backup;
pub mod licensing;

use std::sync::Arc;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

pub struct AppState {
    pub db: Arc<db::Database>,
    pub session_mgr: Arc<server::session::SessionManager>,
    pub storage_mgr: Arc<storage::StorageManager>,
    pub order_mgr: Arc<orders::OrderManager>,
    pub printer_mgr: Arc<printer::PrinterManager>,
    pub wifi_mgr: Arc<wifi::WifiManager>,
    pub tunnel_mgr: Arc<tunnel::TunnelManager>,
    pub corporate_mgr: Arc<corporate::CorporateManager>,
    pub pricing_mgr: Arc<pricing::PricingManager>,
    pub backup_mgr: Arc<backup::BackupManager>,
    pub license_mgr: Arc<licensing::LicenseManager>,
    pub receiver_port: u16,
}

pub fn run() {
    // 1. Initialize structured logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);

    info!("Starting PrintDrop desktop core...");

    // 2. Setup SQLite persistence & storage path under AppData/PrintDrop or local dir
    let app_dir = dirs_fallback();
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data directory");
    let db_path = app_dir.join("printdrop.db");
    let storage_dir = app_dir.join("storage");
    
    info!("Opening SQLite database at: {:?}", db_path);
    let database = Arc::new(db::Database::new(&db_path).expect("Failed to open SQLite database"));
    let session_mgr = Arc::new(server::session::SessionManager::new(database.clone()));
    let storage_mgr = Arc::new(storage::StorageManager::new(&storage_dir));
    let order_mgr = Arc::new(orders::OrderManager::new(database.clone()));
    let printer_mgr = Arc::new(printer::PrinterManager::new(
        database.clone(),
        storage_mgr.clone(),
        order_mgr.clone(),
    ));
    let wifi_mgr = Arc::new(wifi::WifiManager::new(database.clone()));
    let tunnel_mgr = Arc::new(tunnel::TunnelManager::new());
    let corporate_mgr = Arc::new(corporate::CorporateManager::new(database.clone()));
    let pricing_mgr = Arc::new(pricing::PricingManager::new(database.clone()));
    let backup_mgr = Arc::new(backup::BackupManager::new(
        database.clone(),
        db_path.clone(),
        storage_dir.clone(),
    ));
    let license_mgr = Arc::new(
        licensing::LicenseManager::new(database.clone())
            .expect("Failed to initialize LicenseManager"),
    );

    let preferred_port = 8080;
    let ifaces = network::list_available_interfaces();
    let primary_ip = ifaces.first().map(|i| i.ip.clone()).unwrap_or_else(|| "127.0.0.1".to_string());

    // 3. Start embedded HTTP server for mobile customer interface
    info!("Initializing embedded Axum receiver on {}:{}", primary_ip, preferred_port);
    let _server_handle = server::start_server(
        database.clone(), 
        storage_mgr.clone(), 
        order_mgr.clone(), 
        corporate_mgr.clone(),
        pricing_mgr.clone(),
        printer_mgr.clone(),
        &primary_ip, 
        preferred_port
    ).expect("Failed to start embedded HTTP server");

    let app_state = AppState {
        db: database,
        session_mgr,
        storage_mgr,
        order_mgr,
        printer_mgr,
        wifi_mgr,
        tunnel_mgr,
        corporate_mgr,
        pricing_mgr,
        backup_mgr,
        license_mgr,
        receiver_port: preferred_port,
    };

    // Asynchronously clean dustbin and recalculate billing in a background worker
    // so desktop app startup and window layout rendering are instantaneous (<1 sec)
    let bg_order_mgr_startup = app_state.order_mgr.clone();
    let bg_storage_startup = app_state.storage_mgr.clone();
    let bg_pricing_startup = app_state.pricing_mgr.clone();
    let bg_db_startup = app_state.db.clone();
    let _ = std::thread::Builder::new()
        .name("printdrop-startup-worker".to_string())
        .spawn(move || {
            let _ = bg_storage_startup.cleanup_orphaned_staging(std::time::Duration::from_secs(2 * 3600));
            let _ = bg_order_mgr_startup.clean_dustbin_previous_days(bg_storage_startup.base_dir());
            bg_pricing_startup.recalculate_all_unpaid_orders(&bg_storage_startup);
            if !commands::get_ota_rollback_info().available {
                let _ = commands::create_rollback_snapshot_internal(&bg_db_startup);
            } else {
                commands::ensure_start_menu_restore_shortcut();
            }
        });

    // Schedule background periodic check every 30 minutes to automatically empty Dustbin and clean staging chunks
    let bg_order_mgr = app_state.order_mgr.clone();
    let bg_storage_cleaner = app_state.storage_mgr.clone();
    let bg_storage_base = app_state.storage_mgr.base_dir().to_path_buf();
    let _ = std::thread::Builder::new()
        .name("printdrop-dustbin-cleaner".to_string())
        .spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1800));
                let _ = bg_order_mgr.clean_dustbin_previous_days(&bg_storage_base);
                let _ = bg_storage_cleaner.cleanup_orphaned_staging(std::time::Duration::from_secs(2 * 3600));
            }
        });

    // Schedule background periodic check every 30 seconds for shopkeeper-defined daily auto-backup time
    let bg_backup_mgr = app_state.backup_mgr.clone();
    let _ = std::thread::Builder::new()
        .name("printdrop-auto-backup-worker".to_string())
        .spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let _ = bg_backup_mgr.check_and_run_scheduled_backup();
            }
        });

    // Schedule background license heartbeat sync every 6 hours (with 10s startup grace)
    let bg_license_mgr = app_state.license_mgr.clone();
    let bg_license_db = app_state.db.clone();
    let _ = std::thread::Builder::new()
        .name("printdrop-license-heartbeat".to_string())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            if let Ok(runtime) = rt {
                // Startup grace so app starts instantaneously (<1s)
                std::thread::sleep(std::time::Duration::from_secs(10));
                loop {
                    runtime.block_on(crate::licensing::heartbeat::perform_heartbeat(
                        bg_license_mgr.clone(),
                        bg_license_db.clone(),
                    ));
                    std::thread::sleep(std::time::Duration::from_secs(21600)); // 6 hours
                }
            }
        });

    // 4. Build and run Tauri 2 Desktop Application
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_status,
            commands::list_network_interfaces,
            commands::get_active_session,
            commands::switch_network_interface,
            commands::create_new_session,
            commands::list_incoming_orders,
            commands::get_order_details,
            commands::update_file_print_settings,
            commands::set_file_target_printer,
            commands::approve_order,
            commands::reject_order,
            commands::inspect_file_document,
            commands::toggle_file_exclusion,
            commands::restore_order,
            commands::purge_order,
            commands::empty_dustbin,
            commands::get_available_printers,
            commands::print_single_document,
            commands::execute_order_batch_print,
            commands::get_printer_routing_config,
            commands::save_printer_routing_config,
            // === SIMULATION SANDBOX START ===
            commands::is_simulation_supported,
            commands::get_printer_simulation_mode,
            commands::set_printer_simulation_mode,
            commands::apply_simulation_routing_preset,
            // === SIMULATION SANDBOX END ===
            commands::get_spooler_state,
            commands::pause_print_spooler,
            commands::pause_print_spooler_graceful,
            commands::emergency_jam_pause,
            commands::reroute_printer_queue,
            commands::resume_print_spooler,
            commands::cancel_print_spooler,
            commands::start_multi_order_batch_print,
            commands::start_single_file_batch_print,
            commands::get_wifi_info,
            commands::save_wifi_config,
            commands::reset_wifi_to_system,
            commands::start_public_tunnel,
            commands::stop_public_tunnel,
            commands::get_public_tunnel_status,
            commands::check_internet_status,
            commands::list_corporate_clients,
            commands::create_corporate_client,
            commands::update_corporate_client,
            commands::toggle_corporate_client_status,
            commands::delete_corporate_client,
            commands::list_corporate_devices,
            commands::revoke_corporate_device,
            commands::restore_corporate_device,
            commands::get_corporate_qr,
            commands::get_pricing_rates,
            commands::save_pricing_rates,
            commands::get_order_billing,
            commands::recalculate_order_billing,
            commands::update_order_payment,
            commands::get_payment_settings,
            commands::save_payment_settings,
            commands::sync_razorpay_qr,
            commands::generate_standee_qr,
            commands::save_standee_qr_file,
            commands::open_external_url,
            commands::generate_portal_qr,
            commands::get_permanent_portal_url,
            commands::save_permanent_portal_url,
            commands::sync_station_to_gist,
            commands::start_named_public_tunnel,
            commands::get_backup_config,
            commands::save_backup_config,
            commands::create_system_backup,
            commands::export_excel_backup,
            commands::preview_backup_file,
            commands::restore_system_backup,
            commands::rollback_safety_snapshot,
            commands::list_existing_backups,
            commands::pick_backup_folder,
            commands::pick_backup_file,
            commands::export_shop_config_backup,
            commands::import_shop_config_backup,
            commands::get_license_state,
            commands::activate_license_key,
            commands::get_machine_hwid,
            commands::sync_license_cloud,
            commands::get_cloud_license_config,
            commands::save_cloud_license_config,
            commands::update_station_profile,
            commands::activate_plan_with_wallet_credit,
            commands::topup_wallet_credit,
            commands::set_auto_renew_enabled,
            commands::get_ota_rollout_policy,
            commands::prepare_ota_rollback_snapshot,
            commands::get_ota_rollback_info,
            commands::trigger_local_rollback,
            commands::get_provider_payment_config,
            commands::get_commercial_plans_config,
            commands::generate_license_payment_qr,
            commands::submit_license_payment_claim,
            commands::get_license_payment_history,
            commands::record_license_payment,
            commands::get_payment_usage_history,
            commands::get_remote_support_status,
            commands::start_remote_support_session,
            commands::stop_remote_support_session,
        ])
        .setup(|_app| {
            info!("PrintDrop Tauri 2 desktop setup hook completed.");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running PrintDrop desktop application");
}

fn dirs_fallback() -> std::path::PathBuf {
    if let Some(mut base) = std::env::var_os("APPDATA").map(std::path::PathBuf::from) {
        base.push("PrintDrop");
        base
    } else {
        std::path::PathBuf::from("./storage")
    }
}
