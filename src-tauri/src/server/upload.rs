use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::info;

use super::ServerState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadInitRequest {
    pub session_token: String,
    pub file_id: String,
    pub filename: String,
    pub file_size_bytes: u64,
    pub total_chunks: u32,
    pub mime_type: Option<String>,
    pub corporate_token: Option<String>,
    pub corporate_auth_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStatusQuery {
    pub session_token: String,
    pub file_id: String,
    pub total_chunks: u32,
    pub corporate_token: Option<String>,
    pub corporate_auth_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadCompleteRequest {
    pub session_token: String,
    pub file_id: String,
    pub total_chunks: u32,
    pub file_size_bytes: u64,
    pub expected_sha256: Option<String>,
    pub corporate_token: Option<String>,
    pub corporate_auth_token: Option<String>,
}

pub fn verify_session_or_corporate(
    state: &ServerState,
    token: &str,
    corporate_auth_token: Option<&str>,
    corporate_token: Option<&str>,
    headers: Option<&HeaderMap>,
) -> Result<crate::server::session::SessionInfo, (StatusCode, Json<Value>)> {
    // 1. Regular session token verification
    if let Ok(Some(s)) = state.session_mgr.verify_token(token) {
        return Ok(s);
    }

    // 2. Extract potential corporate auth / token from arguments, token itself, or request headers
    let auth_token = corporate_auth_token
        .or_else(|| headers.and_then(|h| h.get("x-corporate-auth").and_then(|v| v.to_str().ok())))
        .or_else(|| if token.starts_with("cdev_") { Some(token) } else { None });

    let corp_token = corporate_token
        .or_else(|| headers.and_then(|h| h.get("x-corporate-token").and_then(|v| v.to_str().ok())))
        .or_else(|| if token.starts_with("corp_") { Some(token) } else { None });

    if let Some(auth) = auth_token {
        if !auth.trim().is_empty() {
            if let Ok(Some((_client, _dev))) = state.corporate_mgr.validate_device_auth(auth, "") {
                let active_session = state.session_mgr.get_or_create_active("127.0.0.1", 8080)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
                return Ok(active_session);
            } else {
                // If a corporate auth token was sent but failed validation (e.g. PIN was changed on desktop),
                // reject immediately with 401 Unauthorized so client prompts for new PIN!
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"error": "Corporate authentication expired or PIN has changed. Please enter current PIN."}))
                ));
            }
        }
    }

    if let Some(ctok) = corp_token {
        if !ctok.trim().is_empty() {
            let host_header = headers.and_then(|h| h.get("host").and_then(|v| v.to_str().ok())).unwrap_or("");
            let is_tunnel = host_header.contains("trycloudflare.com") || host_header.contains("cloudflare");
            if is_tunnel {
                if let Ok(Some(client)) = state.corporate_mgr.get_client_by_token(ctok) {
                    if client.is_active {
                        let active_session = state.session_mgr.get_or_create_active("127.0.0.1", 8080)
                            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;
                        return Ok(active_session);
                    }
                }
            } else {
                // On VPN or local IP, corporate uploads strictly require verified corporate PIN authentication
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"error": "Corporate PIN authentication required. Please enter your PIN to upload."}))
                ));
            }
        }
    }

    // 3. Station active session fallback (for 4G/5G public tunnel, Express Mode, or valid walk-in)
    if let Ok(Some(active)) = state.session_mgr.get_active_session() {
        return Ok(active);
    }

    Err((StatusCode::UNAUTHORIZED, Json(json!({"error": "Invalid or expired session token"}))))
}

pub async fn upload_init(
    State(state): State<ServerState>,
    Json(payload): Json<UploadInitRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // 1. Verify session or corporate authorization
    let session = verify_session_or_corporate(
        &state,
        &payload.session_token,
        payload.corporate_auth_token.as_deref(),
        payload.corporate_token.as_deref(),
        None,
    )?;

    // 2. Validate limits (100MB per file minimum)
    let max_allowed_bytes = (session.max_file_size_bytes as u64).max(100 * 1024 * 1024);
    if payload.file_size_bytes > max_allowed_bytes {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, Json(json!({
            "error": format!("File exceeds maximum size limit of {} MB", max_allowed_bytes / (1024 * 1024))
        }))));
    }

    if payload.total_chunks == 0 || payload.total_chunks > 1000 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid chunk count"}))));
    }

    // 3. Initialize staging folder
    state.storage_mgr.init_chunk_dir(&payload.file_id)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;

    // 4. Check which chunks are already received (for resume)
    let missing = state.storage_mgr.get_missing_chunks(&payload.file_id, payload.total_chunks)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))))?;

    info!("Upload initiated for file '{}' ({}) with {} chunks", payload.filename, payload.file_id, payload.total_chunks);

    Ok(Json(json!({
        "status": "ready",
        "fileId": payload.file_id,
        "totalChunks": payload.total_chunks,
        "missingChunks": missing
    })))
}

pub async fn upload_chunk(
    State(state): State<ServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let token = headers.get("x-session-token")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(json!({"error": "Missing x-session-token header"}))))?;

    let file_id = headers.get("x-file-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Missing x-file-id header"}))))?;

    let chunk_index: u32 = headers.get("x-chunk-index")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid x-chunk-index header"}))))?;

    // Verify session or corporate authorization
    let _ = verify_session_or_corporate(
        &state,
        token,
        None,
        None,
        Some(&headers),
    )?;

    // Write chunk to staging
    state.storage_mgr.write_chunk(file_id, chunk_index, &body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))))?;

    Ok(Json(json!({
        "received": true,
        "fileId": file_id,
        "chunkIndex": chunk_index,
        "chunkBytes": body.len()
    })))
}

pub async fn upload_status(
    State(state): State<ServerState>,
    Query(query): Query<UploadStatusQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = verify_session_or_corporate(
        &state,
        &query.session_token,
        query.corporate_auth_token.as_deref(),
        query.corporate_token.as_deref(),
        None,
    )?;

    let missing = state.storage_mgr.get_missing_chunks(&query.file_id, query.total_chunks)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))))?;

    Ok(Json(json!({
        "fileId": query.file_id,
        "totalChunks": query.total_chunks,
        "missingChunks": missing,
        "isComplete": missing.is_empty()
    })))
}

pub async fn upload_complete(
    State(state): State<ServerState>,
    Json(payload): Json<UploadCompleteRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = verify_session_or_corporate(
        &state,
        &payload.session_token,
        payload.corporate_auth_token.as_deref(),
        payload.corporate_token.as_deref(),
        None,
    )?;

    let verified = state.storage_mgr.assemble_and_verify(
        &payload.file_id,
        payload.total_chunks,
        payload.file_size_bytes,
        payload.expected_sha256.as_deref(),
    ).map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;

    info!("File verification succeeded: {} (SHA-256: {})", payload.file_id, verified.sha256_hash);

    Ok(Json(json!({
        "verified": true,
        "fileId": verified.file_id,
        "sha256": verified.sha256_hash,
        "sizeBytes": verified.size_bytes
    })))
}
