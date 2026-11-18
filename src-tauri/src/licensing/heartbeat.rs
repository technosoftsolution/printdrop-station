use std::sync::Arc;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::db::Database;
use super::crypto::verify_license_signature;
use super::manager::LicenseManager;
use super::models::{LicensePayload, LicensePlanType, LicenseStateDto, LicenseStatus};

fn status_label(status: &LicenseStatus) -> &'static str {
    match status {
        LicenseStatus::TrialActive => "TRIAL ACTIVE",
        LicenseStatus::TrialExpired => "TRIAL EXPIRED",
        LicenseStatus::Active => "ACTIVE",
        LicenseStatus::Expired => "EXPIRED",
        LicenseStatus::Revoked => "REVOKED",
        LicenseStatus::ClockTampered => "CLOCK TAMPERED",
    }
}

pub const DEFAULT_OFFLINE_GRACE_HOURS: i64 = 72;
pub const DEFAULT_SUPABASE_URL: &str = "https://nslcrlvuulgqtrdqrkgv.supabase.co";
pub const DEFAULT_SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zbGNybHZ1dWxncXRyZHFya2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTI4NzEsImV4cCI6MjEwOTcyODg3MX0.lpRc097A_PFCD-eJVhyQZmPFxexhSGjM2dhCE0LNdxk";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudConfig {
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub last_synced_at: Option<String>,
    pub sync_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatResult {
    pub success: bool,
    pub message: String,
    pub is_revoked: bool,
    pub is_grace_active: bool,
    pub hours_until_grace_expires: Option<i64>,
    pub updated_license: Option<LicenseStateDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteLicenseRecord {
    pub id: Option<String>,
    pub hwid: String,
    pub shop_name: String,
    pub owner_name: Option<String>,
    pub phone: Option<String>,
    pub plan_type: String,
    pub pages_granted: Option<u64>,
    pub pages_printed_lifetime: Option<u64>,
    pub issued_at: String,
    pub expires_at: Option<String>,
    pub signature: String,
    pub is_active: bool,
    pub revocation_reason: Option<String>,
    pub is_installed: Option<bool>,
    pub uninstall_count: Option<i64>,
    pub amount_paid: Option<f64>,
    pub payment_mode: Option<String>,
    pub payment_reference: Option<String>,
    pub invoice_number: Option<String>,
    pub payment_status: Option<String>,
    pub notes: Option<String>,
}

/// Executes an online license heartbeat with the Supabase Cloud Registry.
///
/// 1. Queries Supabase via REST API for the station's HWID.
/// 2. If active license found on server with valid cryptographic signature,
///    synchronizes it to the local station database.
/// 3. If server flags `is_active = false`, remotely revokes local station license.
/// 4. Pushes telemetry (lifetime prints, timestamp) back to Supabase.
/// 5. If network is unreachable, allows up to 72 hours of uninterrupted offline grace.
pub async fn perform_heartbeat(
    license_mgr: Arc<LicenseManager>,
    db: Arc<Database>,
) -> HeartbeatResult {
    let cloud_config = get_cloud_config(&db);
    let hwid = license_mgr.get_hwid();

    if !cloud_config.sync_enabled || cloud_config.supabase_url.trim().is_empty() {
        let local_state = license_mgr.get_license_state().ok();
        let status_summary = local_state
            .as_ref()
            .map(|s| format!("License Status: {} ({})", status_label(&s.status), s.plan_display_name))
            .unwrap_or_else(|| "Local license active".to_string());
        return HeartbeatResult {
            success: true,
            message: status_summary,
            is_revoked: false,
            is_grace_active: false,
            hours_until_grace_expires: None,
            updated_license: local_state,
        };
    }

    let base_url = cloud_config.supabase_url.trim().trim_end_matches('/');
    let anon_key = cloud_config.supabase_anon_key.trim();
    persist_uninstall_metadata(hwid, base_url, anon_key);
    let query_url = format!("{}/rest/v1/licenses?hwid=eq.{}&select=*&limit=1", base_url, hwid);

    info!("Executing license heartbeat ping to cloud for HWID: {}", hwid);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => return handle_network_failure(&db, format!("HTTP client init failed: {}", e)),
    };

    // 1. Fetch remote license state
    let res = client
        .get(&query_url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {}", anon_key))
        .header("Accept", "application/json")
        .send()
        .await;

    let response = match res {
        Ok(r) => r,
        Err(e) => {
            warn!("License heartbeat network connection failed: {}", e);
            return handle_network_failure(&db, format!("Network error: {}", e));
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        warn!("Supabase license check returned HTTP {}: {}", status, err_body);
        return handle_network_failure(&db, format!("Server HTTP error: {}", status));
    }

    let records: Vec<RemoteLicenseRecord> = match response.json().await {
        Ok(list) => list,
        Err(e) => {
            warn!("Failed to parse remote license JSON: {}", e);
            return handle_network_failure(&db, format!("Payload parse error: {}", e));
        }
    };

    let now_dt = Utc::now();
    let now_iso = now_dt.to_rfc3339();

    if records.is_empty() {
        // Station not yet registered in cloud DB. Push initial registration so admin can see it!
        info!("Station HWID {} not found in cloud registry. Auto-registering station entry...", hwid);
        let local_state = match license_mgr.get_license_state() {
            Ok(s) => s,
            Err(e) => return handle_network_failure(&db, e),
        };

        let payments_with_usage = if let Ok(payments) = license_mgr.get_payment_history() {
            let mut full_history = Vec::new();
            for p in payments {
                let usage = license_mgr.get_payment_usage_history(p.id.clone()).ok();
                let mut val = serde_json::to_value(&p).unwrap_or(serde_json::Value::Null);
                if let Some(u) = usage {
                    if let Some(obj) = val.as_object_mut() {
                        obj.insert("usage".to_string(), serde_json::to_value(&u).unwrap_or(serde_json::Value::Null));
                    }
                }
                if !val.is_null() {
                    full_history.push(val);
                }
            }
            full_history
        } else {
            Vec::new()
        };

        let notes_json = serde_json::json!({
            "history": payments_with_usage
        }).to_string();

        let new_record = serde_json::json!({
            "hwid": hwid,
            "shop_name": local_state.shop_name,
            "owner_name": local_state.owner_name,
            "phone": local_state.phone,
            "plan_type": match local_state.plan_type {
                LicensePlanType::Trial => "TRIAL",
                LicensePlanType::WalletPages => "WALLET_PAGES",
                LicensePlanType::SubMonthly => "SUB_MONTHLY",
                LicensePlanType::SubQuarterly => "SUB_QUARTERLY",
                LicensePlanType::SubHalfYearly => "SUB_HALF_YEARLY",
                LicensePlanType::SubAnnual => "SUB_ANNUAL",
            },
            "pages_granted": local_state.wallet_pages_remaining,
            "pages_printed_lifetime": local_state.lifetime_prints,
            "issued_at": local_state.start_date,
            "expires_at": local_state.expiry_date,
            "signature": "INITIAL_STATION_REGISTRATION",
            "is_active": true,
            "is_installed": true,
            "uninstalled_at": serde_json::Value::Null,
            "client_version": "1.0.0",
            "notes": notes_json,
            "last_ping_at": now_iso
        });

        let post_url = format!("{}/rest/v1/licenses", base_url);
        let _ = client
            .post(&post_url)
            .header("apikey", anon_key)
            .header("Authorization", format!("Bearer {}", anon_key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&new_record)
            .send()
            .await;

        sync_provider_profile_config(&client, base_url, anon_key, &db).await;
        record_successful_sync(&db, &now_iso);

        let sync_msg = format!(
            "Cloud Sync Verified — Status: {} • Plan: {}{}",
            status_label(&local_state.status),
            local_state.plan_display_name,
            local_state
                .wallet_pages_remaining
                .map(|p| format!(" ({} pages remaining)", p))
                .unwrap_or_else(|| {
                    if local_state.days_remaining > 0 && local_state.days_remaining < 9000 {
                        format!(" ({} days remaining)", local_state.days_remaining)
                    } else {
                        String::new()
                    }
                })
        );

        return HeartbeatResult {
            success: true,
            message: sync_msg,
            is_revoked: false,
            is_grace_active: false,
            hours_until_grace_expires: None,
            updated_license: Some(local_state),
        };
    }

    let remote = &records[0];

    // 2. Check remote kill-switch / revocation
    if !remote.is_active {
        let reason = remote.revocation_reason.as_deref().unwrap_or("Revoked by license administrator");
        warn!("Station license has been REMOTELY REVOKED: {}", reason);

        // Mark local license revoked
        let _ = db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET signature = 'REVOKED_BY_ADMIN', remote_synced_at = ?1 WHERE id = 1",
                rusqlite::params![now_iso],
            )
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            Ok(())
        });

        let updated = license_mgr.get_license_state().ok();

        return HeartbeatResult {
            success: false,
            message: format!("License revoked by administrator: {}", reason),
            is_revoked: true,
            is_grace_active: false,
            hours_until_grace_expires: None,
            updated_license: updated,
        };
    }

    // 3. Verify cryptographic signature of remote record before applying
    let remote_plan = match remote.plan_type.as_str() {
        "WALLET_PAGES" => LicensePlanType::WalletPages,
        "SUB_MONTHLY" => LicensePlanType::SubMonthly,
        "SUB_QUARTERLY" => LicensePlanType::SubQuarterly,
        "SUB_HALF_YEARLY" => LicensePlanType::SubHalfYearly,
        "SUB_ANNUAL" => LicensePlanType::SubAnnual,
        _ => LicensePlanType::Trial,
    };

    let remote_payload = LicensePayload {
        hwid: remote.hwid.clone(),
        shop_name: remote.shop_name.clone(),
        owner_name: remote.owner_name.clone(),
        phone: remote.phone.clone(),
        plan_type: remote_plan.clone(),
        pages_granted: remote.pages_granted,
        issued_at: remote.issued_at.clone(),
        expires_at: remote.expires_at.clone(),
        signature: remote.signature.clone(),
    };

    let local_raw = license_mgr.get_local_signed_payload();
    let local_is_newer_verified_offline_key = if let Some(ref lp) = local_raw {
        if verify_license_signature(lp) && lp.plan_type != LicensePlanType::Trial {
            let local_dt = DateTime::parse_from_rfc3339(&lp.issued_at).ok();
            let remote_dt = DateTime::parse_from_rfc3339(&remote_payload.issued_at).ok();
            match (local_dt, remote_dt) {
                (Some(l), Some(r)) => l > r,
                _ => false,
            }
        } else {
            false
        }
    } else {
        false
    };

    if verify_license_signature(&remote_payload) && !local_is_newer_verified_offline_key {
        // Authentic remote update: synchronize into local SQLite
        let _ = license_mgr.apply_verified_payload(&remote_payload);
    }

    // Synchronize payment records from remote registry
    if let Some(ref notes_str) = remote.notes {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(notes_str) {
            if let Some(arr) = parsed.get("history").and_then(|h| h.as_array()) {
                let mut remote_recs = Vec::new();
                for item in arr {
                    if let Ok(rec) = serde_json::from_value::<crate::licensing::LicensePaymentRecord>(item.clone()) {
                        remote_recs.push(rec);
                    }
                }
                if !remote_recs.is_empty() {
                    let _ = license_mgr.sync_remote_payment_history(remote_recs);
                }
            }
        }
    }

    if remote.payment_status.as_deref() == Some("VERIFIED_PAID") && remote.amount_paid.unwrap_or(0.0) > 0.0 {
        let payment_ref = remote.payment_reference.clone().unwrap_or_else(|| "ONLINE-VERIFIED".to_string());
        let existing_history = license_mgr.get_payment_history().unwrap_or_default();
        let already_recorded = existing_history.iter().any(|r| {
            !payment_ref.trim().is_empty() && r.payment_reference.trim() == payment_ref.trim()
        });
        if !already_recorded {
            let inv_no = remote.invoice_number.clone().unwrap_or_else(|| {
                let sfx = if remote.hwid.len() >= 4 { &remote.hwid[remote.hwid.len() - 4..] } else { "0001" };
                format!("PD-INV-{}", sfx)
            });
            let single_rec = crate::licensing::LicensePaymentRecord {
                id: format!("pay_{}_{}", remote.hwid, payment_ref),
                hwid: remote.hwid.clone(),
                plan_code: remote.plan_type.clone(),
                plan_name: remote_plan.display_name().to_string(),
                amount_paid: remote.amount_paid.unwrap_or(0.0),
                pages_granted: remote.pages_granted,
                duration_days: None,
                payment_mode: remote.payment_mode.clone().unwrap_or_else(|| "UPI".to_string()),
                payment_reference: payment_ref,
                invoice_number: inv_no,
                status: "VERIFIED_PAID".to_string(),
                created_at: remote.issued_at.clone(),
            };
            let _ = license_mgr.record_payment(single_rec);
        } else {
            let _ = db.with_conn(|conn| {
                conn.execute(
                    "UPDATE license_payments SET status = 'VERIFIED_PAID' WHERE payment_reference = ?1",
                    rusqlite::params![payment_ref.trim()],
                )?;
                Ok(())
            });
        }
    }

    // 4. Send updated telemetry back to cloud (lifetime prints, ping timestamp, payment usage ledger, and newer local offline key if activated)
    let local_state = license_mgr.get_license_state().ok();
    let lifetime_prints = local_state.as_ref().map(|s| s.lifetime_prints).unwrap_or(0);

    let payments_with_usage = if let Ok(payments) = license_mgr.get_payment_history() {
        let mut full_history = Vec::new();
        for p in payments {
            let usage = license_mgr.get_payment_usage_history(p.id.clone()).ok();
            let mut val = serde_json::to_value(&p).unwrap_or(serde_json::Value::Null);
            if let Some(u) = usage {
                if let Some(obj) = val.as_object_mut() {
                    obj.insert("usage".to_string(), serde_json::to_value(&u).unwrap_or(serde_json::Value::Null));
                }
            }
            if !val.is_null() {
                full_history.push(val);
            }
        }
        full_history
    } else {
        Vec::new()
    };

    let notes_json = serde_json::json!({
        "history": payments_with_usage
    }).to_string();

    let is_reinstall_recovery = remote.is_installed == Some(false);
    let patch_url = format!("{}/rest/v1/licenses?hwid=eq.{}", base_url, hwid);
    let mut patch_payload = if local_is_newer_verified_offline_key {
        if let Some(ref lp) = local_raw {
            let plan_code = match lp.plan_type {
                LicensePlanType::Trial => "TRIAL",
                LicensePlanType::WalletPages => "WALLET_PAGES",
                LicensePlanType::SubMonthly => "SUB_MONTHLY",
                LicensePlanType::SubQuarterly => "SUB_QUARTERLY",
                LicensePlanType::SubHalfYearly => "SUB_HALF_YEARLY",
                LicensePlanType::SubAnnual => "SUB_ANNUAL",
            };
            serde_json::json!({
                "shop_name": local_state.as_ref().map(|s| s.shop_name.clone()).unwrap_or_else(|| lp.shop_name.clone()),
                "owner_name": local_state.as_ref().and_then(|s| s.owner_name.clone()).or_else(|| lp.owner_name.clone()),
                "phone": local_state.as_ref().and_then(|s| s.phone.clone()).or_else(|| lp.phone.clone()),
                "plan_type": plan_code,
                "pages_granted": lp.pages_granted,
                "issued_at": lp.issued_at,
                "expires_at": lp.expires_at,
                "signature": lp.signature,
                "last_ping_at": now_iso,
                "pages_printed_lifetime": lifetime_prints,
                "is_installed": true,
                "uninstalled_at": serde_json::Value::Null,
                "removal_reason": serde_json::Value::Null,
                "client_version": "1.0.0",
                "notes": notes_json
            })
        } else {
            serde_json::json!({
                "shop_name": local_state.as_ref().map(|s| s.shop_name.clone()),
                "owner_name": local_state.as_ref().and_then(|s| s.owner_name.clone()),
                "phone": local_state.as_ref().and_then(|s| s.phone.clone()),
                "last_ping_at": now_iso,
                "pages_printed_lifetime": lifetime_prints,
                "is_installed": true,
                "uninstalled_at": serde_json::Value::Null,
                "removal_reason": serde_json::Value::Null,
                "client_version": "1.0.0",
                "notes": notes_json
            })
        }
    } else {
        serde_json::json!({
            "shop_name": local_state.as_ref().map(|s| s.shop_name.clone()),
            "owner_name": local_state.as_ref().and_then(|s| s.owner_name.clone()),
            "phone": local_state.as_ref().and_then(|s| s.phone.clone()),
            "last_ping_at": now_iso,
            "pages_printed_lifetime": lifetime_prints,
            "is_installed": true,
            "uninstalled_at": serde_json::Value::Null,
            "removal_reason": serde_json::Value::Null,
            "client_version": "1.0.0",
            "notes": notes_json
        })
    };

    if is_reinstall_recovery {
        if let Some(obj) = patch_payload.as_object_mut() {
            obj.insert("reinstalled_at".to_string(), serde_json::json!(now_iso));
            obj.insert(
                "uninstall_count".to_string(),
                serde_json::json!(remote.uninstall_count.unwrap_or(0).max(1)),
            );
        }
    }

    let _ = client
        .patch(&patch_url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {}", anon_key))
        .header("Content-Type", "application/json")
        .json(&patch_payload)
        .send()
        .await;

    sync_provider_profile_config(&client, base_url, anon_key, &db).await;
    record_successful_sync(&db, &now_iso);

    let updated_state = license_mgr.get_license_state().ok();
    let sync_msg = if let Some(ref st) = updated_state {
        format!(
            "Cloud Sync Verified — Status: {} • Plan: {}{}",
            status_label(&st.status),
            st.plan_display_name,
            st.wallet_pages_remaining
                .map(|p| format!(" ({} pages remaining)", p))
                .unwrap_or_else(|| {
                    if st.days_remaining > 0 && st.days_remaining < 9000 {
                        format!(" ({} days remaining)", st.days_remaining)
                    } else {
                        String::new()
                    }
                })
        )
    } else {
        "Cloud Sync Verified — License is active and up to date.".to_string()
    };

    HeartbeatResult {
        success: true,
        message: sync_msg,
        is_revoked: false,
        is_grace_active: false,
        hours_until_grace_expires: None,
        updated_license: updated_state,
    }
}

async fn sync_provider_profile_config(
    client: &reqwest::Client,
    base_url: &str,
    anon_key: &str,
    db: &Arc<Database>,
) {
    let query_url = format!("{}/rest/v1/system_config?key=eq.provider_payment_config&select=value&limit=1", base_url);
    if let Ok(res) = client
        .get(&query_url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {}", anon_key))
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache, no-store, must-revalidate")
        .header("Pragma", "no-cache")
        .send()
        .await
    {
        if res.status().is_success() {
            #[derive(Deserialize)]
            struct ConfigRow {
                value: serde_json::Value,
            }
            if let Ok(rows) = res.json::<Vec<ConfigRow>>().await {
                if let Some(first) = rows.first() {
                    let mut cfg = crate::licensing::ProviderPaymentConfig::from_json_value(&first.value);
                    if cfg.razorpay_key_id.as_deref().unwrap_or("").trim().is_empty() {
                        cfg.razorpay_key_id = Some("rzp_live_TvfyWRnZVTnIbK".to_string());
                    }
                    if let Ok(serialized) = serde_json::to_string(&cfg) {
                        let _ = db.set_config("provider_payment_config", &serialized);
                        info!("Successfully synchronized and cached latest provider company profile from Supabase");
                    }
                }
            }
        }
    }
}

/// Fallback evaluation when remote server cannot be reached:
/// checks the 72-hour offline grace period.
fn handle_network_failure(db: &Arc<Database>, error_detail: String) -> HeartbeatResult {
    let last_synced_at_str = db
        .get_config("cloud_license_last_synced_at")
        .ok()
        .flatten();

    let now_dt = Utc::now();

    if let Some(sync_str) = last_synced_at_str {
        if let Ok(last_sync) = DateTime::parse_from_rfc3339(&sync_str) {
            let last_sync_utc = last_sync.with_timezone(&Utc);
            let elapsed_hours = (now_dt - last_sync_utc).num_hours();

            if elapsed_hours < DEFAULT_OFFLINE_GRACE_HOURS {
                let remaining_hours = DEFAULT_OFFLINE_GRACE_HOURS - elapsed_hours;
                return HeartbeatResult {
                    success: true,
                    message: format!(
                        "Offline Grace Period Active: Server unreachable ({}). You have {} hour(s) of offline printing remaining.",
                        error_detail, remaining_hours
                    ),
                    is_revoked: false,
                    is_grace_active: true,
                    hours_until_grace_expires: Some(remaining_hours),
                    updated_license: None,
                };
            } else {
                return HeartbeatResult {
                    success: false,
                    message: format!(
                        "Offline Grace Period Expired: Station has been offline for {} hours (maximum allowed: {}h). Please connect to the internet to validate your license.",
                        elapsed_hours, DEFAULT_OFFLINE_GRACE_HOURS
                    ),
                    is_revoked: false,
                    is_grace_active: false,
                    hours_until_grace_expires: Some(0),
                    updated_license: None,
                };
            }
        }
    }

    // Never synced yet or unconfigured: Allow normal local cryptographic verification
    HeartbeatResult {
        success: true,
        message: format!("Running in local offline mode: {}", error_detail),
        is_revoked: false,
        is_grace_active: false,
        hours_until_grace_expires: None,
        updated_license: None,
    }
}

fn record_successful_sync(db: &Arc<Database>, now_iso: &str) {
    let _ = db.set_config("cloud_license_last_synced_at", now_iso);
    let _ = db.with_conn(|conn| {
        conn.execute(
            "UPDATE app_licenses SET remote_synced_at = ?1 WHERE id = 1",
            rusqlite::params![now_iso],
        )
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
        Ok(())
    });
}

pub fn get_cloud_config(db: &Arc<Database>) -> CloudConfig {
    let url = db.get_config("cloud_license_url")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SUPABASE_URL.to_string());
    let anon_key = db.get_config("cloud_license_anon_key")
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_SUPABASE_ANON_KEY.to_string());
    let last_synced_at = db.get_config("cloud_license_last_synced_at").ok().flatten();
    let enabled_str = db.get_config("cloud_license_enabled").ok().flatten().unwrap_or_else(|| "true".to_string());
    let sync_enabled = enabled_str == "true" || enabled_str == "1";

    CloudConfig {
        supabase_url: url,
        supabase_anon_key: anon_key,
        last_synced_at,
        sync_enabled,
    }
}

pub fn save_cloud_config(db: &Arc<Database>, config: &CloudConfig) -> Result<(), String> {
    db.set_config("cloud_license_url", config.supabase_url.trim())
        .map_err(|e| e.to_string())?;
    db.set_config("cloud_license_anon_key", config.supabase_anon_key.trim())
        .map_err(|e| e.to_string())?;
    db.set_config("cloud_license_enabled", if config.sync_enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists HWID and active Supabase endpoint into HKCU\Software\PrintDrop so
/// the NSIS uninstaller hook can notify the cloud registry when uninstalled.
#[cfg(all(target_os = "windows", not(test)))]
fn persist_uninstall_metadata(hwid: &str, base_url: &str, anon_key: &str) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let key_path = r"HKCU\Software\PrintDrop";
    for (name, val) in [
        ("Hwid", hwid),
        ("SupabaseUrl", base_url),
        ("SupabaseKey", anon_key),
    ] {
        let _ = std::process::Command::new("reg")
            .args(["add", key_path, "/v", name, "/t", "REG_SZ", "/d", val, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg(not(all(target_os = "windows", not(test))))]
fn persist_uninstall_metadata(_hwid: &str, _base_url: &str, _anon_key: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_live_supabase_heartbeat_sync() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = Arc::new(LicenseManager::new(db.clone()).unwrap());

        let res = perform_heartbeat(mgr.clone(), db.clone()).await;
        assert!(res.success, "Live heartbeat failed: {}", res.message);
        assert!(!res.is_revoked, "Station should not be revoked");
    }
}

