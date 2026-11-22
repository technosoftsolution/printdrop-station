pub mod session;
pub mod upload;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::broadcast;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

use crate::db::Database;
use crate::models::PrintSettingsDto;
use crate::orders::{OrderManager, SubmitOrderRequest};
use crate::storage::StorageManager;
use crate::corporate::CorporateManager;
use session::SessionManager;

// === Phase-J: Server-Sent Events (SSE) Real-Time Order Event Bus ===
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrderEventMessage {
    pub order_id: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

static ORDER_EVENT_BUS: OnceLock<broadcast::Sender<OrderEventMessage>> = OnceLock::new();

pub fn get_order_event_sender() -> broadcast::Sender<OrderEventMessage> {
    ORDER_EVENT_BUS.get_or_init(|| {
        let (tx, _rx) = broadcast::channel(256);
        tx
    }).clone()
}

pub fn notify_order_event(order_id: &str, event_type: &str, payload: Option<serde_json::Value>) {
    let tx = get_order_event_sender();
    let _ = tx.send(OrderEventMessage {
        order_id: order_id.to_string(),
        event_type: event_type.to_string(),
        payload,
    });
}

#[derive(Clone)]
pub struct ServerState {
    pub db: Arc<Database>,
    pub session_mgr: Arc<SessionManager>,
    pub storage_mgr: Arc<StorageManager>,
    pub order_mgr: Arc<OrderManager>,
    pub corporate_mgr: Arc<CorporateManager>,
    pub pricing_mgr: Arc<crate::pricing::PricingManager>,
    pub printer_mgr: Arc<crate::printer::PrinterManager>,
}

#[derive(Deserialize)]
pub struct SessionQuery {
    pub session: Option<String>,
    pub corp: Option<String>,
    pub pwa: Option<String>,
    pub shared: Option<String>,
    pub shared_batch: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
    pub station_name: Option<String>,
    pub station_hwid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResponse {
    pub valid: bool,
    pub message: String,
    pub session: Option<session::SessionInfo>,
}

pub struct HttpServerHandle {
    shutdown_tx: broadcast::Sender<()>,
}

impl HttpServerHandle {
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(());
    }
}

pub fn start_server(
    db: Arc<Database>,
    storage_mgr: Arc<StorageManager>,
    order_mgr: Arc<OrderManager>,
    corporate_mgr: Arc<CorporateManager>,
    pricing_mgr: Arc<crate::pricing::PricingManager>,
    printer_mgr: Arc<crate::printer::PrinterManager>,
    _bind_ip: &str,
    port: u16,
) -> Result<HttpServerHandle, Box<dyn std::error::Error>> {
    let session_mgr = Arc::new(SessionManager::new(db.clone()));
    let state = ServerState {
        db,
        session_mgr,
        storage_mgr,
        order_mgr,
        corporate_mgr,
        pricing_mgr,
        printer_mgr,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(serve_customer_landing))
        .route("/static/icon.svg", get(serve_icon_svg))
        .route("/api/corporate/verify", post(verify_corporate_pin_endpoint))
        .route("/api/corporate/check", get(check_corporate_auth_endpoint))
        .route("/api/health", get(health_check))
        .route("/api/session/stage-shared", post(stage_shared_endpoint))
        .route("/api/session/get-shared/:token", get(get_shared_manifest_endpoint))
        .route("/api/session/get-shared/:token/:index", get(get_shared_file_endpoint))
        .route("/api/session/verify", get(verify_session_endpoint))
        .route("/api/session/recent-orders", get(recent_orders_endpoint))
        .route("/api/pricing/rates", get(get_pricing_rates_endpoint))
        .route("/api/payment/settings", get(get_payment_settings_endpoint))
        .route("/api/payment/qr", get(get_payment_qr_endpoint))
        .route("/api/payment/standee-qr", get(get_standee_qr_endpoint))
        .route("/api/payment/razorpay/create-order", post(create_razorpay_order_endpoint))
        .route("/api/payment/razorpay/verify", post(verify_razorpay_payment_endpoint))
        .route("/api/orders/:order_id/claim-payment", post(claim_payment_endpoint))
        .route("/api/orders/validate-settings", post(validate_settings_endpoint))
        .route("/api/orders/submit", post(submit_order_endpoint))
        .route("/api/orders/:order_id/status", get(get_order_status_endpoint))
        .route("/api/orders/:order_id/events", get(order_events_sse_endpoint))
        .route("/api/orders/:order_id/purge", post(purge_order_endpoint))
        .route("/api/upload/init", post(upload::upload_init))
        .route("/api/upload/chunk", post(upload::upload_chunk))
        .route("/api/upload/status", get(upload::upload_status))
        .route("/api/upload/complete", post(upload::upload_complete))
        .route("/api/files/:file_id/content", get(serve_file_content))
        .route("/api/files/:file_id/inspect", get(inspect_file_endpoint))
        .route("/static/pdf.min.js", get(serve_pdf_js))
        .route("/static/pdf.worker.min.js", get(serve_pdf_worker_js))
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
        .layer(cors)
        .with_state(state);

    let (shutdown_tx, mut shutdown_rx) = broadcast::channel::<()>(1);
    let shutdown_tx_handle = shutdown_tx.clone();

    let addr = SocketAddr::new(
        "0.0.0.0".parse()?,
        port,
    );

    info!("Binding PrintDrop LAN HTTP receiver to {}", addr);

    std::thread::Builder::new()
        .name("printdrop-http-receiver".to_string())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    error!("Failed to create Tokio runtime for HTTP receiver: {}", e);
                    return;
                }
            };

            rt.block_on(async move {
                match tokio::net::TcpListener::bind(addr).await {
                    Ok(listener) => {
                        info!("PrintDrop LAN HTTP receiver successfully listening on port {}", port);
                        let server = axum::serve(listener, app);
                        
                        tokio::select! {
                            res = server => {
                                if let Err(e) = res {
                                    error!("HTTP receiver server error: {}", e);
                                }
                            }
                            _ = shutdown_rx.recv() => {
                                info!("HTTP receiver received shutdown signal.");
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to bind HTTP receiver to {}: {}", addr, e);
                    }
                }
            });
        })?;

    Ok(HttpServerHandle {
        shutdown_tx: shutdown_tx_handle,
    })
}

async fn health_check(State(state): State<ServerState>) -> Json<HealthResponse> {
    let (station_name, station_hwid) = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT shop_name, hwid FROM app_licenses WHERE id = 1")?;
        let row: (String, String) = stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(row)
    }).map(|(name, hwid)| {
        let clean_name = name.replace("(Trial Mode)", "").replace("(Trial)", "").trim().to_string();
        let name_opt = if clean_name.is_empty() || clean_name == "PrintDrop Retail Station" { None } else { Some(clean_name) };
        let clean_hwid = hwid.trim().to_string();
        let hwid_opt = if clean_hwid.is_empty() { None } else { Some(clean_hwid) };
        (name_opt, hwid_opt)
    }).unwrap_or((None, None));
    Json(HealthResponse {
        status: "ok",
        service: "PrintDrop Local Receiver",
        version: env!("CARGO_PKG_VERSION"),
        station_name,
        station_hwid,
    })
}

async fn verify_session_endpoint(
    headers: HeaderMap,
    State(state): State<ServerState>,
    Query(params): Query<SessionQuery>,
) -> Json<VerifyResponse> {
    let raw_token = params.session.as_deref().unwrap_or("").trim();

    // 1. Corporate permanent link verification (?corp=corp_... or token starts with corp_)
    let corp_candidate = if raw_token.starts_with("corp_") {
        Some(raw_token)
    } else {
        params.corp.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty())
    };

    if let Some(corp_id) = corp_candidate {
        let clean_corp = corp_id.trim_end_matches('/');
        if let Ok(Some(client)) = state.corporate_mgr.get_client_by_token(clean_corp) {
            if client.is_active {
                let active = state.session_mgr.get_or_create_active("127.0.0.1", 8080).ok();
                return Json(VerifyResponse {
                    valid: true,
                    message: "Corporate permanent access is active".to_string(),
                    session: active,
                });
            }
        }
    }

    // 2. Regular session token verification
    if !raw_token.is_empty() && raw_token != "demo-session" {
        let clean_token = raw_token.trim_end_matches('/');
        if let Ok(Some(session)) = state.session_mgr.verify_token(clean_token) {
            return Json(VerifyResponse {
                valid: true,
                message: "Session is valid and active".to_string(),
                session: Some(session),
            });
        }
    }

    // 3. Cloudflare Tunnel, Express Mode, or Station active session auto-binding
    let is_cloudflare = headers.get("cf-ray").is_some()
        || headers.get("cf-connecting-ip").is_some()
        || headers.get("host").and_then(|h| h.to_str().ok()).map(|h| h.contains("trycloudflare.com")).unwrap_or(false)
        || headers.get("x-forwarded-host").and_then(|h| h.to_str().ok()).map(|h| h.contains("trycloudflare.com")).unwrap_or(false);

    if is_cloudflare || raw_token.is_empty() || raw_token == "demo-session" {
        if let Ok(active) = state.session_mgr.get_or_create_active("127.0.0.1", 8080) {
            return Json(VerifyResponse {
                valid: true,
                message: "Station active session".to_string(),
                session: Some(active),
            });
        }
    }

    Json(VerifyResponse {
        valid: false,
        message: "Session is expired or invalid".to_string(),
        session: None,
    })
}

#[derive(Deserialize)]
struct RecentOrdersQuery {
    device_token: Option<String>,
    device_fingerprint: Option<String>,
    session_token: Option<String>,
    order_id: Option<String>,
    search: Option<String>,
    all_status: Option<String>,
}

async fn recent_orders_endpoint(
    State(state): State<ServerState>,
    Query(params): Query<RecentOrdersQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let dev_token = params.device_token.as_deref().unwrap_or("").trim();
    let dev_fp = params.device_fingerprint.as_deref().unwrap_or("").trim();
    let sess_token = params.session_token.as_deref().unwrap_or("").trim();
    let order_id = params.order_id.as_deref().unwrap_or("").trim();
    let search_query = params.search.as_deref().unwrap_or("").trim();
    let include_all = params.all_status.as_deref().map(|s| s == "1" || s == "true").unwrap_or(false);

    // If neither device identifier, order id, nor search query is provided, return empty list
    if dev_token.is_empty() && dev_fp.is_empty() && order_id.is_empty() && search_query.is_empty() {
        return Ok(Json(serde_json::json!({
            "success": true,
            "orders": []
        })));
    }

    let recent_orders = state.db.with_conn(|conn| {
        let mut list = Vec::new();

        if !dev_token.is_empty() || !dev_fp.is_empty() || !order_id.is_empty() {
            let sql = if include_all {
                "SELECT o.id, o.status, r.total_files, r.total_bytes, o.created_at, o.customer_name, o.device_model, o.pickup_code,
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
                        ob.payment_status,
                        ob.payment_method,
                        ob.total_amount,
                        ob.customer_type,
                        ob.payment_claim
                 FROM orders o 
                 JOIN order_revisions r ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                 LEFT JOIN order_billings ob ON o.id = ob.order_id
                 WHERE (
                     (?1 != '' AND (o.device_token = ?1 OR o.device_token LIKE ?1 || '%'))
                     OR (?2 != '' AND (o.device_token = ?2 OR o.device_token LIKE '%' || ?2 || '%'))
                     OR (?4 != '' AND o.id = ?4)
                 ) 
                   AND (
                       -- 1) Any order created today
                       date(o.created_at, 'localtime') = date('now', 'localtime')
                       -- 2) Customer still has unpaid dues (never vanishes until paid)
                       OR COALESCE(ob.payment_status, 'UNPAID') != 'PAID'
                       -- 3) Files still exist on Desktop PC (not yet purged by customer)
                       OR (o.status != 'PURGED_BY_CUSTOMER' AND (
                           SELECT COUNT(*) FROM files f
                           JOIN file_revisions fr ON f.id = fr.file_id
                           WHERE fr.order_revision_id = r.id
                             AND NOT EXISTS (
                                 SELECT 1 FROM order_events oe
                                 WHERE oe.order_id = o.id
                                   AND (
                                       oe.event_type = 'CUSTOMER_PURGED_ALL_FILES'
                                       OR (oe.event_type = 'CUSTOMER_PURGED_FILE' AND oe.payload_json LIKE '%' || f.id || '%')
                                   )
                             )
                       ) > 0)
                       -- 4) Explicit order ID query
                       OR (?4 != '' AND o.id = ?4)
                   )
                 ORDER BY o.created_at DESC LIMIT 20"
            } else {
                "SELECT o.id, o.status, r.total_files, r.total_bytes, o.created_at, o.customer_name, o.device_model, o.pickup_code,
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
                        ob.payment_status,
                        ob.payment_method,
                        ob.total_amount,
                        ob.customer_type,
                        ob.payment_claim
                 FROM orders o 
                 JOIN order_revisions r ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                 LEFT JOIN order_billings ob ON o.id = ob.order_id
                 WHERE (
                     (?1 != '' AND (o.device_token = ?1 OR o.device_token LIKE ?1 || '%'))
                     OR (?2 != '' AND (o.device_token = ?2 OR o.device_token LIKE '%' || ?2 || '%'))
                     OR (?4 != '' AND o.id = ?4)
                 ) 
                   AND o.status != 'PURGED_BY_CUSTOMER' 
                   AND o.status != 'REJECTED'
                   AND (
                       -- Active files still exist on desktop
                       (
                           SELECT COUNT(*) FROM files f
                           JOIN file_revisions fr ON f.id = fr.file_id
                           WHERE fr.order_revision_id = r.id
                             AND NOT EXISTS (
                                 SELECT 1 FROM order_events oe
                                 WHERE oe.order_id = o.id
                                   AND (
                                       oe.event_type = 'CUSTOMER_PURGED_ALL_FILES'
                                       OR (oe.event_type = 'CUSTOMER_PURGED_FILE' AND oe.payload_json LIKE '%' || f.id || '%')
                                   )
                             )
                       ) > 0
                       -- OR Customer has unpaid dues
                       OR COALESCE(ob.payment_status, 'UNPAID') != 'PAID'
                   )
                   AND (
                       date(o.created_at, 'localtime') = date('now', 'localtime')
                       OR COALESCE(ob.payment_status, 'UNPAID') != 'PAID'
                       OR (?4 != '' AND o.id = ?4)
                   )
                 ORDER BY o.created_at DESC LIMIT 5"
            };
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(rusqlite::params![dev_token, dev_fp, sess_token, order_id], |row| {
                let id: String = row.get(0)?;
                let status: String = row.get(1)?;
                let total_files: i64 = row.get(2)?;
                let total_bytes: i64 = row.get(3)?;
                let created_at: String = row.get(4)?;
                let customer_name: Option<String> = row.get(5)?;
                let device_model: Option<String> = row.get(6)?;
                let pickup_code: Option<String> = row.get(7)?;
                let active_files: i64 = row.get(8).unwrap_or(0);
                let payment_status: Option<String> = row.get(9).unwrap_or(None);
                let payment_method: Option<String> = row.get(10).unwrap_or(None);
                let total_amount: Option<f64> = row.get(11).unwrap_or(None);
                let customer_type: Option<String> = row.get(12).unwrap_or(None);
                let payment_claim: Option<String> = row.get(13).unwrap_or(None);
                let is_purged = status == "PURGED_BY_CUSTOMER" || active_files == 0;
                let short_id = if id.len() >= 8 {
                    id[..8].to_uppercase()
                } else {
                    id.to_uppercase()
                };
                Ok(serde_json::json!({
                    "orderId": id,
                    "shortId": short_id,
                    "status": status,
                    "totalFiles": total_files,
                    "totalBytes": total_bytes,
                    "createdAt": created_at,
                    "customerName": customer_name,
                    "deviceModel": device_model,
                    "pickupCode": pickup_code,
                    "activeFilesCount": active_files,
                    "isPurged": is_purged,
                    "paymentStatus": payment_status.unwrap_or_else(|| "UNPAID".to_string()),
                    "paymentMethod": payment_method,
                    "paymentClaim": payment_claim,
                    "totalAmount": total_amount.unwrap_or(0.0),
                    "customerType": customer_type.unwrap_or_else(|| "WALK_IN".to_string()),
                }))
            })?;
            for r in rows {
                if let Ok(item) = r {
                    list.push(item);
                }
            }
        }

        if list.is_empty() && !search_query.is_empty() {
            let clean_search = search_query.replace('#', "").trim().to_string();
            let mut stmt = conn.prepare(
                "SELECT o.id, o.status, r.total_files, r.total_bytes, o.created_at, o.customer_name, o.device_model, o.pickup_code,
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
                        ob.payment_status,
                        ob.payment_method,
                        ob.total_amount,
                        ob.customer_type
                 FROM orders o 
                 JOIN order_revisions r ON o.id = r.order_id AND o.current_revision_number = r.revision_number 
                 LEFT JOIN order_billings ob ON o.id = ob.order_id
                 WHERE (o.pickup_code = ?1 OR UPPER(o.customer_name) LIKE '%' || UPPER(?1) || '%' OR o.id LIKE ?1 || '%')
                   AND o.status != 'PURGED_BY_CUSTOMER'
                   AND (
                       date(o.created_at, 'localtime') = date('now', 'localtime')
                       OR COALESCE(ob.payment_status, 'UNPAID') != 'PAID'
                       OR active_files_count > 0
                   )
                 ORDER BY o.created_at DESC LIMIT 5"
            )?;
            let rows = stmt.query_map([&clean_search], |row| {
                let id: String = row.get(0)?;
                let status: String = row.get(1)?;
                let total_files: i64 = row.get(2)?;
                let total_bytes: i64 = row.get(3)?;
                let created_at: String = row.get(4)?;
                let customer_name: Option<String> = row.get(5)?;
                let device_model: Option<String> = row.get(6)?;
                let pickup_code: Option<String> = row.get(7)?;
                let active_files: i64 = row.get(8).unwrap_or(0);
                let payment_status: Option<String> = row.get(9).unwrap_or(None);
                let payment_method: Option<String> = row.get(10).unwrap_or(None);
                let total_amount: Option<f64> = row.get(11).unwrap_or(None);
                let customer_type: Option<String> = row.get(12).unwrap_or(None);
                let is_purged = status == "PURGED_BY_CUSTOMER" || active_files == 0;
                let short_id = if id.len() >= 8 {
                    id[..8].to_uppercase()
                } else {
                    id.to_uppercase()
                };
                Ok(serde_json::json!({
                    "orderId": id,
                    "shortId": short_id,
                    "status": status,
                    "totalFiles": total_files,
                    "totalBytes": total_bytes,
                    "createdAt": created_at,
                    "customerName": customer_name,
                    "deviceModel": device_model,
                    "pickupCode": pickup_code,
                    "activeFilesCount": active_files,
                    "isPurged": is_purged,
                    "paymentStatus": payment_status.unwrap_or_else(|| "UNPAID".to_string()),
                    "paymentMethod": payment_method,
                    "totalAmount": total_amount.unwrap_or(0.0),
                    "customerType": customer_type.unwrap_or_else(|| "WALK_IN".to_string()),
                }))
            })?;
            for r in rows {
                if let Ok(item) = r {
                    list.push(item);
                }
            }
        }

        Ok(list)
    }).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "orders": recent_orders
    })))
}

async fn validate_settings_endpoint(
    Json(settings): Json<PrintSettingsDto>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match settings.validate() {
        Ok(_) => Ok(Json(serde_json::json!({
            "valid": true,
            "summary": settings.to_summary()
        }))),
        Err(err_msg) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "valid": false,
                "error": err_msg
            })),
        )),
    }
}

async fn submit_order_endpoint(
    State(state): State<ServerState>,
    Json(payload): Json<SubmitOrderRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // 1. Resolve corporate client / device attribution
    let (corporate_client_id, corporate_person_name) = if let Some(ref auth_token) = payload.corporate_auth_token {
        if !auth_token.trim().is_empty() {
            let fp = payload.corporate_device_fingerprint.as_deref().unwrap_or("");
            if let Ok(Some((client, dev))) = state.corporate_mgr.validate_device_auth(auth_token, fp) {
                (Some(client.id), Some(dev.person_name))
            } else {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({
                        "error": "Corporate authentication expired or PIN has changed. Please re-authenticate."
                    }))
                ));
            }
        } else {
            (None, payload.corporate_person_name.clone())
        }
    } else if let Some(ref corp_token) = payload.corporate_token {
        if let Ok(Some(client)) = state.corporate_mgr.get_client_by_token(corp_token) {
            (Some(client.id), payload.corporate_person_name.clone())
        } else {
            (None, payload.corporate_person_name.clone())
        }
    } else {
        (None, None)
    };

    // 2. Resolve session ID (regular transfer session, active station session, or corporate fallback)
    let session_id = match state.session_mgr.verify_token(&payload.session_token) {
        Ok(Some(s)) => s.id,
        _ => {
            if let Ok(Some(active)) = state.session_mgr.get_active_session() {
                active.id
            } else if let Ok(active) = state.session_mgr.get_or_create_active("127.0.0.1", 8080) {
                active.id
            } else {
                return Err((StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid or expired session token"}))));
            }
        }
    };

    // Check if client is appending files to an existing in-progress order
    if let Some(ref target_order_id) = payload.order_id {
        if !target_order_id.trim().is_empty() {
            let (canonical_order_id, new_rev, total_files) = state.order_mgr
                .append_files_to_order(target_order_id, &payload.files)
                .map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))))?;

            info!("Appended {} files to Order '{}' -> Revision {}", payload.files.len(), canonical_order_id, new_rev);
            let _ = state.pricing_mgr.calculate_and_save_order_billing(&canonical_order_id, None, &state.storage_mgr);
            notify_order_event(&canonical_order_id, "ORDER_UPDATED", None);
            return Ok(Json(serde_json::json!({
                "orderId": canonical_order_id,
                "revisionNumber": new_rev,
                "status": "AWAITING_APPROVAL",
                "totalFiles": total_files
            })));
        }
    }

    let customer_name = if corporate_person_name.is_some() {
        corporate_person_name.as_deref()
    } else {
        payload.customer_name.as_deref()
    };

    let (order_id, pickup_code) = state.order_mgr.submit_order(
        &session_id,
        payload.customer_notes.as_deref(),
        customer_name,
        payload.device_model.as_deref(),
        payload.device_token.as_deref(),
        &payload.files,
        corporate_client_id.as_deref(),
        corporate_person_name.as_deref(),
    ).map_err(|e| (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))))?;

    let initial_cust_type = if corporate_client_id.is_some() { "REMOTE" } else { "WALK_IN" };
    let _ = state.pricing_mgr.calculate_and_save_order_billing(&order_id, Some(initial_cust_type), &state.storage_mgr);

    info!("Order '{}' (Pickup #{}) successfully submitted via API with {} files", order_id, pickup_code, payload.files.len());
    notify_order_event(&order_id, "ORDER_SUBMITTED", None);

    Ok(Json(serde_json::json!({
        "orderId": order_id,
        "pickupCode": pickup_code,
        "revisionNumber": 1,
        "status": "AWAITING_APPROVAL",
        "totalFiles": payload.files.len()
    })))
}

#[derive(Deserialize)]
struct PurgeOrderRequest {
    file_id: Option<String>,
}

async fn purge_order_endpoint(
    Path(order_id): Path<String>,
    State(state): State<ServerState>,
    Json(payload): Json<PurgeOrderRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // If order has been printed/completed, customer cannot delete files until payment is completed
    if let Ok(Some(details)) = state.order_mgr.get_order_details(&order_id) {
        if details.order.status == "COMPLETED" {
            if let Ok(Some(billing)) = state.pricing_mgr.get_order_billing(&order_id) {
                if billing.payment_status != "PAID" && billing.payment_status != "CREDIT" {
                    return Err((
                        StatusCode::FORBIDDEN,
                        Json(serde_json::json!({
                            "error": "Document deletion is locked until payment is completed at the counter.",
                            "paymentRequired": true,
                            "totalAmount": billing.total_amount
                        }))
                    ));
                }
            }
        }
    }

    if let Some(ref fid) = payload.file_id {
        // Purge single file from disk with zero-fill shredder
        if let Ok(path) = state.storage_mgr.resolve_verified_file_path(&state.db, fid) {
            let _ = crate::storage::StorageManager::secure_shred_file(&path);
        }
        let _ = state.order_mgr.toggle_file_exclusion(fid, true);
        let all_purged = state.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'CUSTOMER_PURGED_FILE', ?2)",
                rusqlite::params![&order_id, serde_json::json!({ "fileId": fid }).to_string()],
            )?;

            // Check if all active files in this order's current revision are now purged
            let mut stmt = conn.prepare(
                "SELECT COUNT(*) FROM files f
                 JOIN file_revisions fr ON f.id = fr.file_id
                 JOIN order_revisions ord_r ON fr.order_revision_id = ord_r.id
                 JOIN orders o ON ord_r.order_id = o.id AND ord_r.revision_number = o.current_revision_number
                 WHERE o.id = ?1
                   AND NOT EXISTS (
                       SELECT 1 FROM order_events oe
                       WHERE oe.order_id = o.id
                         AND (
                             oe.event_type = 'CUSTOMER_PURGED_ALL_FILES'
                             OR (oe.event_type = 'CUSTOMER_PURGED_FILE' AND oe.payload_json LIKE '%' || f.id || '%')
                         )
                   )"
            )?;
            let remaining: i64 = stmt.query_row([&order_id], |r| r.get(0)).unwrap_or(0);
            if remaining == 0 {
                conn.execute(
                    "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'CUSTOMER_PURGED_ALL_FILES', ?2)",
                    rusqlite::params![&order_id, serde_json::json!({ "orderId": &order_id, "source": "ALL_INDIVIDUAL_FILES_PURGED" }).to_string()],
                )?;
                Ok(true)
            } else {
                Ok(false)
            }
        }).unwrap_or(false);

        let _ = state.pricing_mgr.calculate_and_save_order_billing(&order_id, None, &state.storage_mgr);
        notify_order_event(&order_id, "CUSTOMER_PURGED_FILE", None);
        return Ok(Json(serde_json::json!({
            "success": true,
            "message": "File permanently erased from shopkeeper PC",
            "purgedFileId": fid,
            "allPurged": all_purged
        })));
    }

    // Purge all files in this order from physical storage with zero-fill shredder
    if let Ok(Some(details)) = state.order_mgr.get_order_details(&order_id) {
        for f in &details.files {
            if let Ok(path) = state.storage_mgr.resolve_verified_file_path(&state.db, &f.file_id) {
                let _ = crate::storage::StorageManager::secure_shred_file(&path);
            }
        }
    }

    state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'CUSTOMER_PURGED_ALL_FILES', ?2)",
            rusqlite::params![&order_id, serde_json::json!({ "orderId": &order_id }).to_string()],
        )?;
        // Keep status as COMPLETED if already printed or completed, or mark PURGED_BY_CUSTOMER if purged before completion
        conn.execute(
            "UPDATE orders SET status = CASE 
                WHEN status = 'COMPLETED' OR EXISTS (SELECT 1 FROM print_jobs WHERE order_id = ?1 AND status = 'COMPLETED') 
                THEN 'COMPLETED' 
                ELSE 'PURGED_BY_CUSTOMER' 
             END, updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![&order_id],
        )?;
        Ok(())
    }).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))))?;

    let _ = state.pricing_mgr.calculate_and_save_order_billing(&order_id, None, &state.storage_mgr);
    notify_order_event(&order_id, "CUSTOMER_PURGED_ALL_FILES", None);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "All order files permanently wiped from shopkeeper PC",
        "allPurged": true
    })))
}

/// Builds the complete unified order status JSON model for both HTTP polling and SSE streaming.
pub fn build_order_status_json(
    order_id: &str,
    state: &ServerState,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let details = state.order_mgr.get_order_details(order_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Order not found"}))))?;

    let rejection_reason: Option<String> = if details.order.status == "REJECTED" {
        state.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT rejection_reason FROM approval_records WHERE order_id = ?1 ORDER BY created_at DESC LIMIT 1"
            )?;
            let mut rows = stmt.query([order_id])?;
            if let Some(row) = rows.next()? {
                Ok(row.get(0)?)
            } else {
                Ok(None)
            }
        }).unwrap_or(None)
    } else {
        None
    };

    let total = details.files.len();
    let included = details.files.iter().filter(|f| !f.is_excluded && !f.is_purged).count();
    let excluded = details.files.iter().filter(|f| f.is_excluded && !f.is_purged).count();
    let purged_count = details.files.iter().filter(|f| f.is_purged).count();

    let is_all_purged = details.order.status == "PURGED_BY_CUSTOMER" || (total > 0 && purged_count == total);

    let files_json = details.files.iter().map(|f| {
        let is_purged = f.is_purged || details.order.status == "PURGED_BY_CUSTOMER";
        let auto_printer = state.printer_mgr.resolve_auto_printer(&f.print_settings, "");
        let target_printer = state.printer_mgr.resolve_effective_printer(&f.file_id, &f.print_settings, "");
        serde_json::json!({
            "fileId": f.file_id,
            "originalFilename": f.original_filename,
            "fileSizeBytes": f.file_size_bytes,
            "settingsSummary": f.settings_summary,
            "printSettings": f.print_settings,
            "isExcluded": f.is_excluded,
            "isPrinted": f.is_printed,
            "isPurged": is_purged,
            "printedAt": f.printed_at,
            "printedOn": f.printed_on,
            "autoPrinter": auto_printer,
            "targetPrinter": target_printer,
        })
    }).collect::<Vec<_>>();

    let billing = state.pricing_mgr.get_order_billing(order_id).ok().flatten()
        .or_else(|| state.pricing_mgr.calculate_and_save_order_billing(order_id, None, &state.storage_mgr).ok());

    let queue_info = state.printer_mgr.get_order_queue_info(order_id);

    Ok(serde_json::json!({
        "orderId": details.order.id,
        "status": details.order.status,
        "isPurged": is_all_purged,
        "totalFiles": total,
        "includedFiles": included,
        "excludedFiles": excluded,
        "purgedFiles": purged_count,
        "rejectionReason": rejection_reason,
        "customerNotes": details.order.customer_notes,
        "customerName": details.order.customer_name,
        "deviceModel": details.order.device_model,
        "deviceToken": details.order.device_token,
        "pickupCode": details.order.pickup_code,
        "createdAt": details.order.created_at,
        "completedAt": details.order.completed_at,
        "targetPrinter": details.order.target_printer,
        "billing": billing,
        "queueInfo": {
            "isInQueue": queue_info.is_in_queue,
            "queuePosition": queue_info.queue_position,
            "isCurrentlyPrinting": queue_info.is_currently_printing,
            "isJammed": queue_info.is_jammed,
            "jammedPrinter": queue_info.jammed_printer,
            "activeFileId": queue_info.active_file_id,
            "activeFileName": queue_info.active_file_name,
            "stage": queue_info.stage,
            "stageMessage": queue_info.stage_message,
            "targetPrinter": queue_info.target_printer,
            "currentPage": queue_info.current_page,
            "totalPages": queue_info.total_pages,
            "spoolerProgressPct": queue_info.spooler_progress_pct,
            "pageProgressPct": queue_info.page_progress_pct,
            "jobsAheadOnPrinter": queue_info.jobs_ahead_on_printer,
            "printerQueueTotal": queue_info.printer_queue_total,
            "files": queue_info.files,
            "activePrinters": queue_info.active_printers
        },
        "files": files_json
    }))
}

async fn get_order_status_endpoint(
    Path(order_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let json_val = build_order_status_json(&order_id, &state)?;
    Ok(Json(json_val))
}

// === Phase-J: Server-Sent Events (SSE) Live Customer Status Streaming Endpoint ===
async fn order_events_sse_endpoint(
    Path(order_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<(HeaderMap, Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>), (StatusCode, Json<serde_json::Value>)> {
    // 1. Verify order exists and get initial state snapshot
    let initial_status = build_order_status_json(&order_id, &state)?;

    let target_order_id = order_id.clone();
    let mut broadcast_rx = get_order_event_sender().subscribe();
    let state_clone = state.clone();

    // 2. Create MPSC channel stream to yield events to Axum SSE
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);
    let stream = ReceiverStream::new(rx);

    tokio::spawn(async move {
        // Send initial full status immediately upon connection
        let initial_event = Event::default()
            .event("order_status")
            .data(initial_status.to_string());
        if tx.send(Ok(initial_event)).await.is_err() {
            return;
        }

        let mut ticker = tokio::time::interval(Duration::from_millis(250));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut last_status_str = initial_status.to_string();

        loop {
            tokio::select! {
                // Immediate push when shopkeeper modifies order, prints, excludes, or records payment
                broadcast_msg = broadcast_rx.recv() => {
                    match broadcast_msg {
                        Ok(msg) => {
                            if msg.order_id == target_order_id || msg.order_id == "*" {
                                if let Ok(fresh_status) = build_order_status_json(&target_order_id, &state_clone) {
                                    let fresh_str = fresh_status.to_string();
                                    if fresh_str != last_status_str {
                                        last_status_str = fresh_str.clone();
                                        let ev = Event::default()
                                            .event("order_status")
                                            .data(fresh_str);
                                        if tx.send(Ok(ev)).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            if let Ok(fresh_status) = build_order_status_json(&target_order_id, &state_clone) {
                                let fresh_str = fresh_status.to_string();
                                last_status_str = fresh_str.clone();
                                let ev = Event::default()
                                    .event("order_status")
                                    .data(fresh_str);
                                if tx.send(Ok(ev)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            break;
                        }
                    }
                }
                // Periodic micro-progress tick while actively spooling or printing (250ms cadence)
                _ = ticker.tick() => {
                    let is_active_printing = {
                        let q = state_clone.printer_mgr.get_order_queue_info(&target_order_id);
                        q.is_in_queue || q.is_currently_printing
                    };

                    if is_active_printing {
                        if let Ok(fresh_status) = build_order_status_json(&target_order_id, &state_clone) {
                            let fresh_str = fresh_status.to_string();
                            if fresh_str != last_status_str {
                                last_status_str = fresh_str.clone();
                                let ev = Event::default()
                                    .event("order_status")
                                    .data(fresh_str);
                                if tx.send(Ok(ev)).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Cloudflare Quick Tunnel unbuffered streaming headers
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-cache, no-transform"),
    );
    headers.insert(
        axum::http::HeaderName::from_static("x-accel-buffering"),
        axum::http::HeaderValue::from_static("no"),
    );
    headers.insert(
        axum::http::header::CONNECTION,
        axum::http::HeaderValue::from_static("keep-alive"),
    );

    Ok((
        headers,
        Sse::new(stream).keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keep-alive-ping"),
        ),
    ))
}

pub fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            b' ' => encoded.push_str("%20"),
            _ => encoded.push_str(&format!("%{:02X}", b)),
        }
    }
    encoded
}

async fn get_pricing_rates_endpoint(
    State(state): State<ServerState>,
) -> Json<serde_json::Value> {
    let rate_card = state.pricing_mgr.get_rate_card();
    Json(serde_json::json!({
        "success": true,
        "rates": rate_card,
    }))
}

async fn get_payment_settings_endpoint(
    State(state): State<ServerState>,
) -> Json<serde_json::Value> {
    let mut settings = state.pricing_mgr.get_upi_settings();
    settings.razorpay_key_secret = String::new(); // Never expose secret to mobile client
    Json(serde_json::json!({
        "success": true,
        "settings": settings,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRazorpayOrderRequest {
    order_id: String,
    #[serde(default)]
    callback_url: Option<String>,
}

async fn create_razorpay_order_endpoint(
    State(state): State<ServerState>,
    Json(payload): Json<CreateRazorpayOrderRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let settings = state.pricing_mgr.get_upi_settings();
    if !settings.razorpay_enabled || settings.razorpay_key_id.trim().is_empty() || settings.razorpay_key_secret.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Razorpay payment gateway is not enabled or credentials not configured"
            })),
        ));
    }

    let billing = match state.pricing_mgr.get_order_billing(&payload.order_id) {
        Ok(Some(b)) => b,
        Ok(None) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": format!("Order billing record not found for '{}'", payload.order_id)
                })),
            ))
        }
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to fetch billing: {}", e)
                })),
            ))
        }
    };

    if billing.payment_status == "PAID" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Order is already paid"
            })),
        ));
    }

    // Convert total_amount to paise (e.g. ₹25.00 -> 2500 paise)
    let amount_paise = (billing.total_amount * 100.0).round() as u64;
    if amount_paise == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Order amount is 0.00"
            })),
        ));
    }

    let client = reqwest::Client::new();
    let receipt_id = if payload.order_id.len() > 40 {
        payload.order_id[..40].to_string()
    } else {
        payload.order_id.clone()
    };

    // 1. Create Official Standard Razorpay Order (for in-context checkout.js bottom sheet with direct UPI intent)
    let order_payload = serde_json::json!({
        "amount": amount_paise,
        "currency": "INR",
        "receipt": receipt_id,
        "notes": {
            "platform": "PrintDrop Station",
            "order_id": payload.order_id,
            "store": settings.business_name
        }
    });

    let res = client
        .post("https://api.razorpay.com/v1/orders")
        .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
        .json(&order_payload)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": format!("Failed to reach Razorpay API: {}", e)
                })),
            )
        })?;

    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": format!("Failed to parse Razorpay order response: {}", e)
            })),
        )
    })?;

    if !status.is_success() {
        let err_desc = body
            .get("error")
            .and_then(|e| e.get("description"))
            .and_then(|d| d.as_str())
            .unwrap_or("Failed to create Razorpay order");
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": err_desc,
                "details": body
            })),
        ));
    }

    let rzp_order_id = body.get("id").and_then(|id| id.as_str()).unwrap_or("").to_string();

    // 2. Razorpay Direct UPI Link with Animated Flying Rocket Loader
    let mut short_url = String::new();
    let mut plink_id = String::new();

    // Check if an active payment link was already recorded for this order in order_events
    let recorded_plink: Option<(String, String)> = state.db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT payload_json FROM order_events WHERE order_id = ?1 AND event_type = 'RAZORPAY_PLINK_CREATED' ORDER BY id DESC LIMIT 1"
        )?;
        let mut rows = stmt.query(rusqlite::params![payload.order_id])?;
        if let Some(row) = rows.next()? {
            let json_str: String = row.get(0)?;
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
                let u = v.get("shortUrl").and_then(|s| s.as_str()).unwrap_or("").to_string();
                let id = v.get("plinkId").and_then(|s| s.as_str()).unwrap_or("").to_string();
                if !u.is_empty() {
                    return Ok(Some((u, id)));
                }
            }
        }
        Ok(None)
    }).unwrap_or(None);

    if let Some((url, id)) = recorded_plink {
        // Verify with Razorpay that this link is still valid and not expired/cancelled
        let check_url = format!("https://api.razorpay.com/v1/payment_links/{}", id);
        if let Ok(check_res) = client
            .get(&check_url)
            .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
            .send()
            .await
        {
            if let Ok(check_body) = check_res.json::<serde_json::Value>().await {
                let s = check_body.get("status").and_then(|st| st.as_str()).unwrap_or("");
                if s.eq_ignore_ascii_case("created") || s.eq_ignore_ascii_case("partially_paid") {
                    short_url = url;
                    plink_id = id;
                }
            }
        }
    }

    // If no existing valid link, create a new UPI Link with guaranteed collision-free reference_id
    if short_url.is_empty() {
        let unique_ref = format!("{}_{}", &receipt_id[..receipt_id.len().min(26)], chrono::Utc::now().timestamp());
        let mut plink_payload = serde_json::json!({
            "amount": amount_paise,
            "currency": "INR",
            "accept_partial": false,
            "upi_link": true,
            "reference_id": unique_ref,
            "description": format!("PrintDrop Order #{}", receipt_id),
            "notify": {
                "sms": false,
                "email": false
            },
            "notes": {
                "order_id": payload.order_id,
                "store": settings.business_name
            }
        });

        if let Some(ref cb) = payload.callback_url {
            if !cb.trim().is_empty() {
                plink_payload["callback_url"] = serde_json::json!(cb.trim());
                plink_payload["callback_method"] = serde_json::json!("get");
            }
        }

        if let Ok(plink_res) = client
            .post("https://api.razorpay.com/v1/payment_links")
            .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
            .json(&plink_payload)
            .send()
            .await
        {
            if let Ok(plink_body) = plink_res.json::<serde_json::Value>().await {
                if let Some(url) = plink_body.get("short_url").and_then(|u| u.as_str()) {
                    short_url = url.to_string();
                }
                if let Some(id) = plink_body.get("id").and_then(|i| i.as_str()) {
                    plink_id = id.to_string();
                }
            }
        }
    }

    // 3. Record order creation event
    let _ = state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'RAZORPAY_PLINK_CREATED', ?2)",
            rusqlite::params![
                payload.order_id,
                serde_json::json!({
                    "razorpayOrderId": rzp_order_id,
                    "plinkId": plink_id,
                    "shortUrl": short_url,
                    "amount": amount_paise,
                    "createdAt": chrono::Utc::now().to_rfc3339()
                }).to_string()
            ],
        )?;
        Ok(())
    });

    Ok(Json(serde_json::json!({
        "success": true,
        "razorpayOrderId": rzp_order_id,
        "paymentLink": short_url,
        "plinkId": plink_id,
        "keyId": settings.razorpay_key_id.trim(),
        "amount": amount_paise,
        "currency": "INR",
        "businessName": settings.business_name,
        "orderId": payload.order_id
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyRazorpayPaymentRequest {
    #[serde(alias = "order_id")]
    order_id: String,
    #[serde(default, alias = "plink_id")]
    plink_id: Option<String>,
    #[serde(default, alias = "razorpay_order_id")]
    razorpay_order_id: Option<String>,
    #[serde(default, alias = "razorpay_payment_id")]
    razorpay_payment_id: Option<String>,
    #[serde(default, alias = "razorpay_signature")]
    razorpay_signature: Option<String>,
}

async fn verify_razorpay_payment_endpoint(
    State(state): State<ServerState>,
    Json(payload): Json<VerifyRazorpayPaymentRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let settings = state.pricing_mgr.get_upi_settings();
    if settings.razorpay_key_secret.trim().is_empty() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "Razorpay secret key not configured"
            })),
        ));
    }

    let mut is_valid = false;
    let mut verified_payment_id = String::new();
    let mut verified_amount: Option<f64> = None;

    // 1. Direct Razorpay Payment Link status check via API
    if let Some(ref plink) = payload.plink_id {
        if !plink.trim().is_empty() {
            let client = reqwest::Client::new();
            let check_url = format!("https://api.razorpay.com/v1/payment_links/{}", plink.trim());
            if let Ok(res) = client
                .get(&check_url)
                .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
                .send()
                .await
            {
                if let Ok(body) = res.json::<serde_json::Value>().await {
                    let plink_status = body.get("status").and_then(|s| s.as_str()).unwrap_or("");
                    if plink_status.eq_ignore_ascii_case("paid") {
                        is_valid = true;
                        verified_payment_id = plink.clone();
                        if let Some(amt) = body.get("amount_paid").or_else(|| body.get("amount")).and_then(|a| a.as_f64()) {
                            verified_amount = Some(amt / 100.0);
                        }
                    }
                }
            }
        }
    }

    // 1b. Check DB for recorded plink_id if not supplied or not verified yet
    if !is_valid {
        let recorded_plink: Option<String> = state.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT payload_json FROM order_events WHERE order_id = ?1 AND event_type = 'RAZORPAY_PLINK_CREATED' ORDER BY id DESC LIMIT 1"
            )?;
            let mut rows = stmt.query(rusqlite::params![payload.order_id])?;
            if let Some(row) = rows.next()? {
                let json_str: String = row.get(0)?;
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    return Ok(v.get("plinkId").and_then(|p| p.as_str()).map(|s| s.to_string()));
                }
            }
            Ok(None)
        }).unwrap_or(None);

        if let Some(p) = recorded_plink {
            if !p.trim().is_empty() {
                let client = reqwest::Client::new();
                let check_url = format!("https://api.razorpay.com/v1/payment_links/{}", p.trim());
                if let Ok(res) = client
                    .get(&check_url)
                    .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
                    .send()
                    .await
                {
                    if let Ok(body) = res.json::<serde_json::Value>().await {
                        let plink_status = body.get("status").and_then(|s| s.as_str()).unwrap_or("");
                        if plink_status.eq_ignore_ascii_case("paid") {
                            is_valid = true;
                            verified_payment_id = p;
                            if let Some(amt) = body.get("amount_paid").or_else(|| body.get("amount")).and_then(|a| a.as_f64()) {
                                verified_amount = Some(amt / 100.0);
                            }
                        }
                    }
                }
            }
        }
    }

    // 1c. Search Razorpay Payment Links API by reference_id (order_id)
    if !is_valid && !payload.order_id.trim().is_empty() {
        let ref_id = if payload.order_id.len() > 40 {
            payload.order_id[..40].to_string()
        } else {
            payload.order_id.clone()
        };
        let client = reqwest::Client::new();
        let check_url = format!("https://api.razorpay.com/v1/payment_links?reference_id={}", ref_id);
        if let Ok(res) = client
            .get(&check_url)
            .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
            .send()
            .await
        {
            if let Ok(body) = res.json::<serde_json::Value>().await {
                if let Some(items) = body.get("payment_links").and_then(|i| i.as_array()) {
                    for item in items {
                        let status = item.get("status").and_then(|s| s.as_str()).unwrap_or("");
                        if status.eq_ignore_ascii_case("paid") {
                            is_valid = true;
                            verified_payment_id = item.get("id").and_then(|s| s.as_str()).unwrap_or(&ref_id).to_string();
                            if let Some(amt) = item.get("amount_paid").or_else(|| item.get("amount")).and_then(|a| a.as_f64()) {
                                verified_amount = Some(amt / 100.0);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // 1d. Check Razorpay QR Code payments API if order is not yet marked paid
    if !is_valid && !settings.razorpay_qr_id.trim().is_empty() {
        let qr_payments_url = format!("https://api.razorpay.com/v1/payments/qr_codes/{}/payments?count=10", settings.razorpay_qr_id.trim());
        let client = reqwest::Client::new();
        if let Ok(res) = client
            .get(&qr_payments_url)
            .basic_auth(settings.razorpay_key_id.trim(), Some(settings.razorpay_key_secret.trim()))
            .send()
            .await
        {
            if let Ok(body) = res.json::<serde_json::Value>().await {
                if let Some(items) = body.get("items").and_then(|i| i.as_array()) {
                    let billing_opt = state.pricing_mgr.get_order_billing(&payload.order_id).ok().flatten();
                    let expected_paise = billing_opt.as_ref().map(|b| (b.total_amount * 100.0).round() as u64).unwrap_or(0);
                    let order_created_epoch = billing_opt.as_ref().and_then(|b| {
                        chrono::DateTime::parse_from_rfc3339(&b.created_at).ok().map(|dt| dt.timestamp())
                    }).unwrap_or(0);

                    for item in items {
                        let status = item.get("status").and_then(|s| s.as_str()).unwrap_or("");
                        let amount = item.get("amount").and_then(|a| a.as_u64()).unwrap_or(0);
                        let p_created = item.get("created_at").and_then(|c| c.as_i64()).unwrap_or(0);
                        let payment_id = item.get("id").and_then(|s| s.as_str()).unwrap_or("");

                        // Must be captured, expected amount must be > 0 and exact, payment must have occurred after order creation, and not already used
                        if status == "captured" && expected_paise > 0 && amount == expected_paise && p_created >= (order_created_epoch - 60) {
                            let already_used: bool = state.db.with_conn(|conn| {
                                let mut stmt = conn.prepare("SELECT COUNT(*) FROM order_billings WHERE payment_claim = ?1 AND order_id != ?2")?;
                                let count: i64 = stmt.query_row(rusqlite::params![payment_id, payload.order_id], |row| row.get(0))?;
                                Ok(count > 0)
                            }).unwrap_or(false);

                            if !already_used {
                                is_valid = true;
                                verified_payment_id = if !payment_id.is_empty() { payment_id.to_string() } else { "qr_payment".to_string() };
                                verified_amount = Some((amount as f64) / 100.0);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback: HMAC-SHA256 signature verification if standard checkout signature was passed
    if !is_valid {
        if let (Some(ref r_order_id), Some(ref r_payment_id), Some(ref r_sig)) = (
            &payload.razorpay_order_id,
            &payload.razorpay_payment_id,
            &payload.razorpay_signature,
        ) {
            let message = format!("{}|{}", r_order_id, r_payment_id);
            if let Ok(mut mac) = HmacSha256::new_from_slice(settings.razorpay_key_secret.trim().as_bytes()) {
                mac.update(message.as_bytes());
                let expected_bytes = mac.finalize().into_bytes();
                let expected_hex = hex::encode(expected_bytes);
                if expected_hex.eq_ignore_ascii_case(r_sig) {
                    is_valid = true;
                    verified_payment_id = r_payment_id.clone();
                }
            }
        }
    }

    if !is_valid {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Payment verification pending or invalid signature."
            })),
        ));
    }

    // Mark billing record as PAID
    let updated_billing = state
        .pricing_mgr
        .update_order_payment(&payload.order_id, "PAID", Some("ONLINE"), None)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))))?;

    // If verified_amount is available and billing total_amount is 0.0, heal total_amount immediately
    if let Some(paid_val) = verified_amount {
        if paid_val > 0.0 {
            let _ = state.db.with_conn(|conn| {
                conn.execute(
                    "UPDATE order_billings 
                     SET total_amount = CASE WHEN total_amount <= 0.0 THEN ?1 ELSE total_amount END,
                         subtotal = CASE WHEN subtotal <= 0.0 THEN ?1 ELSE subtotal END
                     WHERE order_id = ?2",
                    rusqlite::params![paid_val, &payload.order_id],
                )?;
                Ok(())
            });
        }
    }

    // Record audit event
    let _ = state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO order_events (order_id, event_type, payload_json) VALUES (?1, 'RAZORPAY_PAYMENT_SUCCESS', ?2)",
            rusqlite::params![
                payload.order_id,
                serde_json::json!({
                    "verifiedPaymentId": verified_payment_id,
                    "verifiedAmount": verified_amount,
                    "verifiedAt": chrono::Utc::now().to_rfc3339()
                }).to_string()
            ],
        )?;
        Ok(())
    });

    info!(
        "Razorpay payment verified successfully for order {}: payment_id={}",
        payload.order_id, verified_payment_id
    );
    notify_order_event(&payload.order_id, "PAYMENT_VERIFIED", None);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Payment verified and recorded successfully!",
        "orderId": payload.order_id,
        "paymentId": verified_payment_id,
        "billing": updated_billing
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimPaymentRequest {
    #[serde(alias = "payment_method")]
    payment_method: Option<String>,
    #[serde(alias = "claimed_amount")]
    #[allow(dead_code)]
    claimed_amount: Option<f64>,
}

async fn claim_payment_endpoint(
    Path(order_id): Path<String>,
    State(state): State<ServerState>,
    Json(payload): Json<ClaimPaymentRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let method = payload.payment_method.as_deref().unwrap_or("ONLINE");
    state.pricing_mgr.claim_order_payment(&order_id, method)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))))?;

    notify_order_event(&order_id, "PAYMENT_CLAIMED", None);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Payment claim submitted to shopkeeper",
        "orderId": order_id,
        "paymentClaim": "CLAIMED"
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentQrQuery {
    amount: Option<f64>,
    #[serde(alias = "pickup_code")]
    pickup_code: Option<String>,
}

async fn get_payment_qr_endpoint(
    State(state): State<ServerState>,
    Query(params): Query<PaymentQrQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let upi_settings = state.pricing_mgr.get_upi_settings();
    let amt = params.amount.unwrap_or(0.0);
    let code = params.pickup_code.as_deref().unwrap_or("").trim();
    let note = if code.is_empty() {
        "PrintDrop Order".to_string()
    } else {
        format!("PrintDrop Order {}", code)
    };

    let clean_vpa = upi_settings.upi_id.trim();
    let raw_name = if upi_settings.business_name.trim().is_empty() {
        "TechnoSoft Solution"
    } else {
        upi_settings.business_name.trim()
    };
    let clean_name: String = raw_name.chars().filter(|c| c.is_alphanumeric()).collect();
    let clean_name = if clean_name.is_empty() { "PrintDrop".to_string() } else { clean_name };

    // If Razorpay is enabled and has a valid NPCI merchant payload, use the official merchant payload!
    let (upi_uri, image_url, is_rzp) = if upi_settings.razorpay_enabled && !upi_settings.razorpay_qr_payload.trim().is_empty() {
        let base = upi_settings.razorpay_qr_payload.trim();
        let uri_with_amt = if amt > 0.0 {
            format!("{}&am={:.2}", base, amt)
        } else {
            base.to_string()
        };
        (uri_with_amt, upi_settings.razorpay_qr_image_url.clone(), true)
    } else {
        (
            format!(
                "upi://pay?pa={}&pn={}&am={:.2}&cu=INR&tn={}",
                clean_vpa,
                clean_name,
                amt,
                url_encode(&note)
            ),
            String::new(),
            false,
        )
    };

    let (raw_svg, qr_data_url) = match session::generate_qr_svg(&upi_uri) {
        Ok(res) => res,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))),
    };

    Ok(Json(serde_json::json!({
        "success": true,
        "upiUri": upi_uri,
        "svg": raw_svg,
        "dataUrl": qr_data_url,
        "imageUrl": image_url,
        "isRazorpay": is_rzp,
        "businessName": upi_settings.business_name,
        "upiId": upi_settings.upi_id,
        "amount": amt,
    })))
}

async fn get_standee_qr_endpoint(
    State(state): State<ServerState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let upi_settings = state.pricing_mgr.get_upi_settings();
    let clean_vpa = upi_settings.upi_id.trim();
    let clean_name = if upi_settings.business_name.trim().is_empty() {
        "TechnoSoft Solution".to_string()
    } else {
        upi_settings.business_name.trim().to_string()
    };

    let safe_name: String = clean_name.chars().filter(|c| c.is_alphanumeric()).collect();
    let safe_name = if safe_name.is_empty() { "PrintDrop".to_string() } else { safe_name };

    let (upi_uri, image_url, is_rzp) = if upi_settings.razorpay_enabled && !upi_settings.razorpay_qr_payload.trim().is_empty() {
        (upi_settings.razorpay_qr_payload.trim().to_string(), upi_settings.razorpay_qr_image_url.clone(), true)
    } else {
        (format!("upi://pay?pa={}&pn={}&cu=INR", clean_vpa, safe_name), String::new(), false)
    };

    let (raw_svg, qr_data_url) = match session::generate_qr_svg(&upi_uri) {
        Ok(res) => res,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))),
    };

    Ok(Json(serde_json::json!({
        "success": true,
        "upiUri": upi_uri,
        "svg": raw_svg,
        "dataUrl": qr_data_url,
        "imageUrl": image_url,
        "isRazorpay": is_rzp,
        "businessName": upi_settings.business_name,
        "upiId": upi_settings.upi_id,
    })))
}

fn customer_html_response(html: String) -> Response {
    (
        [
            (axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (axum::http::header::CACHE_CONTROL, "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"),
            (axum::http::header::PRAGMA, "no-cache"),
            (axum::http::header::EXPIRES, "0"),
        ],
        html,
    ).into_response()
}

async fn serve_customer_landing(
    headers: HeaderMap,
    State(state): State<ServerState>,
    Query(params): Query<SessionQuery>,
) -> Response {
    // 1. Defensively extract corp token even if embedded in session param
    let mut corp_token = params.corp.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    if corp_token.is_none() {
        if let Some(ref s) = params.session {
            if let Some(idx) = s.find("corp=") {
                let candidate = &s[idx + 5..];
                let end = candidate.find('&').unwrap_or(candidate.len());
                corp_token = Some(candidate[..end].trim());
            }
        }
    }

    // Check Corporate Permanent Link (?corp=corp_...)
    if let Some(corp) = corp_token {
        let clean_corp = corp.trim().trim_end_matches('/');
        if let Ok(Some(client)) = state.corporate_mgr.get_client_by_token(clean_corp) {
            if client.is_active {
                let active = state.session_mgr.get_or_create_active("127.0.0.1", 8080).ok();
                let active_token = active.map(|a| a.token).unwrap_or_else(|| client.static_token.clone());
                return customer_html_response(render_customer_app_html(&active_token));
            }
        }
    }

    // 2. Regular QR Code / Session (?session=...)
    let session_token = params.session.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    if let Some(token) = session_token {
        let clean_token = token.trim_end_matches('/');
        if let Ok(Some(sess)) = state.session_mgr.verify_token(clean_token) {
            return customer_html_response(render_customer_app_html(&sess.token));
        }
    }

    // 3. Cloudflare Tunnel, PWA, or Android Share Target auto-binding
    let is_cloudflare = headers.get("cf-ray").is_some()
        || headers.get("cf-connecting-ip").is_some()
        || headers.get("host").and_then(|h| h.to_str().ok()).map(|h| h.contains("trycloudflare.com")).unwrap_or(false)
        || headers.get("x-forwarded-host").and_then(|h| h.to_str().ok()).map(|h| h.contains("trycloudflare.com")).unwrap_or(false);

    let is_pwa_or_share = params.pwa.is_some() || params.shared.is_some() || params.shared_batch.is_some();

    if is_cloudflare || is_pwa_or_share {
        if let Ok(active) = state.session_mgr.get_or_create_active("127.0.0.1", 8080) {
            return customer_html_response(render_customer_app_html(&active.token));
        }
    }

    // 4. Any request when active station session exists
    if let Ok(Some(active)) = state.session_mgr.get_active_session() {
        return customer_html_response(render_customer_app_html(&active.token));
    }

    customer_html_response(render_invalid_session_html())
}

async fn stage_shared_endpoint(
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let token = uuid::Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir().join("printdrop_shared").join(&token);
    let _ = tokio::fs::create_dir_all(&temp_dir).await;

    let mut file_index: usize = 0;
    let mut file_entries = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.file_name().unwrap_or("document").to_string();
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        let data = match field.bytes().await {
            Ok(d) => d,
            Err(_) => continue,
        };
        let file_path = temp_dir.join(format!("{}.dat", file_index));
        let _ = tokio::fs::write(&file_path, &data).await;

        file_entries.push(serde_json::json!({
            "index": file_index,
            "name": name,
            "type": content_type,
            "size": data.len()
        }));
        file_index += 1;
    }

    let manifest_path = temp_dir.join("manifest.json");
    let _ = tokio::fs::write(&manifest_path, serde_json::to_string(&file_entries).unwrap_or_default()).await;

    info!("Staged {} shared files for cross-origin PWA handoff (token: {})", file_index, token);

    Ok(Json(serde_json::json!({
        "success": true,
        "shareToken": token,
        "count": file_index
    })))
}

async fn get_shared_manifest_endpoint(
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let temp_dir = std::env::temp_dir().join("printdrop_shared").join(&token);
    let manifest_path = temp_dir.join("manifest.json");
    let manifest_str = tokio::fs::read_to_string(&manifest_path).await
        .map_err(|_| (StatusCode::NOT_FOUND, "Shared session not found or expired".to_string()))?;

    let entries: Vec<serde_json::Value> = serde_json::from_str(&manifest_str).unwrap_or_default();
    let result = entries.into_iter().map(|mut e| {
        if let Some(idx) = e.get("index").and_then(|i| i.as_i64()) {
            e["downloadUrl"] = serde_json::json!(format!("/api/session/get-shared/{}/{}", token, idx));
        }
        e
    }).collect::<Vec<_>>();

    Ok(Json(serde_json::json!(result)))
}

async fn get_shared_file_endpoint(
    Path((token, index)): Path<(String, usize)>,
) -> Result<Response, StatusCode> {
    let temp_dir = std::env::temp_dir().join("printdrop_shared").join(&token);
    let manifest_path = temp_dir.join("manifest.json");
    let manifest_str = tokio::fs::read_to_string(&manifest_path).await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let entries: Vec<serde_json::Value> = serde_json::from_str(&manifest_str).unwrap_or_default();
    let file_meta = entries.get(index).ok_or(StatusCode::NOT_FOUND)?;
    let content_type = file_meta.get("type").and_then(|s| s.as_str()).unwrap_or("application/octet-stream");
    let filename = file_meta.get("name").and_then(|s| s.as_str()).unwrap_or("document");

    let file_path = temp_dir.join(format!("{}.dat", index));
    let bytes = tokio::fs::read(&file_path).await.map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Response::builder()
        .header(axum::http::header::CONTENT_TYPE, content_type)
        .header(axum::http::header::CONTENT_DISPOSITION, format!("inline; filename=\"{}\"", filename))
        .header(axum::http::header::CACHE_CONTROL, "no-store")
        .body(Body::from(bytes))
        .unwrap())
}

async fn serve_icon_svg() -> Response {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="50%" stop-color="#4f46e5" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="24" fill="#090d16" />
  <rect x="2" y="2" width="96" height="96" rx="22" fill="none" stroke="url(#grad)" stroke-width="3" />
  <path d="M30 35 H70 V22 H30 Z" fill="#94a3b8" />
  <rect x="22" y="35" width="56" height="34" rx="8" fill="url(#grad)" />
  <circle cx="70" cy="45" r="3" fill="#34d399" />
  <rect x="32" y="52" width="36" height="30" rx="4" fill="#ffffff" />
  <line x1="38" y1="60" x2="62" y2="60" stroke="#64748b" stroke-width="2.5" stroke-linecap="round" />
  <line x1="38" y1="67" x2="56" y2="67" stroke="#64748b" stroke-width="2.5" stroke-linecap="round" />
  <line x1="38" y1="74" x2="50" y2="74" stroke="#64748b" stroke-width="2.5" stroke-linecap="round" />
</svg>"##;

    Response::builder()
        .header(axum::http::header::CONTENT_TYPE, "image/svg+xml")
        .header(axum::http::header::CACHE_CONTROL, "public, max-age=86400")
        .body(Body::from(svg))
        .unwrap()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyCorporatePinRequest {
    #[serde(alias = "corp_token")]
    corp_token: String,
    pin: String,
    #[serde(alias = "device_fingerprint")]
    device_fingerprint: String,
    #[serde(alias = "person_name")]
    person_name: Option<String>,
    #[serde(alias = "device_type")]
    device_type: Option<String>,
}

async fn verify_corporate_pin_endpoint(
    State(state): State<ServerState>,
    Json(payload): Json<VerifyCorporatePinRequest>,
) -> Result<Json<crate::corporate::VerifyPinResultDto>, (StatusCode, Json<serde_json::Value>)> {
    let result = state.corporate_mgr.verify_pin(
        &payload.corp_token,
        &payload.pin,
        &payload.device_fingerprint,
        payload.person_name.as_deref().unwrap_or(""),
        payload.device_type.as_deref().unwrap_or("mobile"),
    ).map_err(|e| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": e.to_string() }))))?;

    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckCorporateAuthQuery {
    #[serde(alias = "corp_token")]
    corp_token: Option<String>,
    #[serde(alias = "auth_token")]
    auth_token: Option<String>,
    #[serde(alias = "device_fingerprint")]
    fingerprint: Option<String>,
}

async fn check_corporate_auth_endpoint(
    State(state): State<ServerState>,
    Query(query): Query<CheckCorporateAuthQuery>,
) -> Json<serde_json::Value> {
    if let Some(ref auth_token) = query.auth_token {
        if !auth_token.trim().is_empty() {
            let fp = query.fingerprint.as_deref().unwrap_or("");
            if let Ok(Some((client, dev))) = state.corporate_mgr.validate_device_auth(auth_token, fp) {
                return Json(serde_json::json!({
                    "authenticated": true,
                    "clientId": client.id,
                    "clientName": client.name,
                    "staticToken": client.static_token,
                    "personName": dev.person_name,
                    "deviceType": dev.device_type,
                    "billingAccount": client.billing_account
                }));
            }
        }
    }

    // Check if static corp_token exists and is active
    if let Some(ref corp_token) = query.corp_token {
        if let Ok(Some(client)) = state.corporate_mgr.get_client_by_token(corp_token) {
            return Json(serde_json::json!({
                "authenticated": false,
                "needsPin": true,
                "clientId": client.id,
                "clientName": client.name,
                "isActive": client.is_active
            }));
        }
    }

    Json(serde_json::json!({
        "authenticated": false,
        "needsPin": false,
        "error": "Invalid or expired corporate link"
    }))
}

fn render_customer_app_html(token: &str) -> String {
    let raw = include_str!("customer.html");
    raw.replace("/*SERVER_SESSION_TOKEN*/", token)
}

fn render_invalid_session_html() -> String {
    r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PrintDrop - Invalid Session</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: #090d16; color: #f8fafc; min-height: 100vh; padding: 1.5rem; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
    .card { background: #131c2e; border: 1px solid #ef4444; border-radius: 1.25rem; padding: 2rem 1.5rem; max-width: 400px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4); }
    .icon { width: 56px; height: 56px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); color: #ef4444; display: flex; align-items: center; justify-content: center; font-size: 1.75rem; margin: 0 auto 1rem; }
    .title { font-size: 1.25rem; font-weight: 700; color: #ffffff; }
    .message { font-size: 0.875rem; color: #94a3b8; margin-top: 0.75rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1 class="title">Session Expired or Invalid</h1>
    <p class="message">This print session link is either expired or revoked by the shopkeeper. Please scan the fresh QR code displayed on the shop screen.</p>
  </div>
</body>
</html>"#.to_string()
}

async fn serve_file_content(
    Path(file_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<Response, StatusCode> {
    let path = match state.storage_mgr.resolve_verified_file_path(&state.db, &file_id) {
        Ok(p) => p,
        Err(_) => return Err(StatusCode::NOT_FOUND),
    };

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };

    // Determine mime type by magic bytes
    let mime = if bytes.starts_with(b"%PDF") {
        "application/pdf"
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(&[0x50, 0x4B, 0x03, 0x04]) {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    } else {
        "application/octet-stream"
    };

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, mime),
            (axum::http::header::CACHE_CONTROL, "public, max-age=3600"),
        ],
        bytes,
    ).into_response())
}

async fn inspect_file_endpoint(
    Path(file_id): Path<String>,
    State(state): State<ServerState>,
) -> Result<Json<crate::commands::DocumentInspectionResult>, (StatusCode, String)> {
    let path = state.storage_mgr.resolve_verified_file_path(&state.db, &file_id)
        .map_err(|e| (StatusCode::NOT_FOUND, e))?;

    let ifaces = crate::network::list_available_interfaces();
    let primary_ip = ifaces.first().map(|i| i.ip.clone()).unwrap_or_else(|| "127.0.0.1".to_string());

    let inspection = crate::commands::inspect_file_path(&state.db, &file_id, &path, &primary_ip, 8080)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(inspection))
}

async fn serve_pdf_js() -> impl IntoResponse {
    (
        [
            (axum::http::header::CONTENT_TYPE, "application/javascript"),
            (axum::http::header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        &include_bytes!("../../static/pdf.min.js")[..],
    )
}

async fn serve_pdf_worker_js() -> impl IntoResponse {
    (
        [
            (axum::http::header::CONTENT_TYPE, "application/javascript"),
            (axum::http::header::CACHE_CONTROL, "public, max-age=86400"),
        ],
        &include_bytes!("../../static/pdf.worker.min.js")[..],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_order_event_bus_broadcast() {
        let mut rx1 = get_order_event_sender().subscribe();
        let mut rx2 = get_order_event_sender().subscribe();

        notify_order_event("ord_test_123", "ORDER_APPROVED", Some(serde_json::json!({ "reason": "Test" })));

        let msg1 = rx1.recv().await.expect("rx1 should receive broadcast message");
        assert_eq!(msg1.order_id, "ord_test_123");
        assert_eq!(msg1.event_type, "ORDER_APPROVED");

        let msg2 = rx2.recv().await.expect("rx2 should receive broadcast message");
        assert_eq!(msg2.order_id, "ord_test_123");
        assert_eq!(msg2.event_type, "ORDER_APPROVED");
    }
}

