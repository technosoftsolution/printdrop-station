use std::sync::Arc;
use std::collections::{BTreeMap, HashSet};
use chrono::{DateTime, Utc, NaiveDate, Local};
use rusqlite::params;
use tracing::{info, warn};

use crate::db::Database;
use super::crypto::{
    create_signed_trial_license, parse_and_verify_activation_key, verify_license_signature,
};
use super::hwid::{generate_hardware_id, get_windows_machine_guid};
use super::models::{
    ActivationRequest, DailyPrintUsageRecord, LicensePayload, LicensePaymentRecord, LicensePlanType,
    LicenseStateDto, LicenseStatus, PaymentUsageSummaryDto,
};

pub struct LicenseManager {
    db: Arc<Database>,
    hwid: String,
}

impl LicenseManager {
    /// Initializes the LicenseManager, ensuring the SQLite table exists and
    /// auto-provisions a signed 14-day trial if no license exists yet.
    pub fn new(db: Arc<Database>) -> Result<Self, String> {
        let mut manager = Self {
            db: db.clone(),
            hwid: String::new(),
        };
        manager.init_schema()?;

        let current_guid = get_windows_machine_guid().unwrap_or_default();
        let saved_guid = db.get_config("machine_guid_anchor").ok().flatten();
        let existing_db_hwid: Option<String> = db
            .with_conn(|conn| {
                let mut stmt = conn.prepare("SELECT hwid FROM app_licenses WHERE id = 1")?;
                let res: Option<String> = stmt.query_row([], |r| r.get(0)).ok();
                Ok(res)
            })
            .ok()
            .flatten();

        let is_same_windows_install = match (&saved_guid, current_guid.is_empty()) {
            (Some(sg), false) => sg.eq_ignore_ascii_case(&current_guid),
            (None, _) => true, // Upgrade from older build without anchor: preserve existing station HWID
            _ => true,
        };

        let hwid = if is_same_windows_install {
            if let Some(db_hwid) = existing_db_hwid.filter(|s| s.starts_with("PD-") && s.len() >= 19) {
                db_hwid
            } else {
                generate_hardware_id()
            }
        } else {
            warn!("MachineGuid changed (DB moved to another PC); regenerating HWID.");
            generate_hardware_id()
        };

        if !current_guid.is_empty() && saved_guid.is_none() {
            let _ = db.set_config("machine_guid_anchor", &current_guid);
        }

        info!("Initializing LicenseManager with Hardware ID: {}", hwid);
        manager.hwid = hwid;
        manager.ensure_license_exists()?;

        Ok(manager)
    }

    /// Returns the active machine Hardware ID
    pub fn get_hwid(&self) -> &str {
        &self.hwid
    }

    /// Creates the app_licenses schema if it does not already exist
    fn init_schema(&self) -> Result<(), String> {
        self.db
            .with_conn(|conn| {
                conn.execute_batch(
                    r#"
                    CREATE TABLE IF NOT EXISTS app_licenses (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        hwid TEXT NOT NULL,
                        shop_name TEXT NOT NULL,
                        owner_name TEXT,
                        phone TEXT,
                        plan_type TEXT NOT NULL,
                        pages_granted INTEGER,
                        pages_used INTEGER NOT NULL DEFAULT 0,
                        pages_printed_lifetime INTEGER NOT NULL DEFAULT 0,
                        issued_at TEXT NOT NULL,
                        expires_at TEXT,
                        signature TEXT NOT NULL,
                        last_seen_epoch INTEGER NOT NULL DEFAULT 0,
                        last_verified_at TEXT NOT NULL,
                        remote_synced_at TEXT
                    );

                    CREATE TABLE IF NOT EXISTS license_payments (
                        id TEXT PRIMARY KEY,
                        hwid TEXT NOT NULL,
                        plan_code TEXT NOT NULL,
                        plan_name TEXT NOT NULL,
                        amount_paid REAL NOT NULL,
                        pages_granted INTEGER,
                        duration_days INTEGER,
                        payment_mode TEXT NOT NULL,
                        payment_reference TEXT NOT NULL,
                        invoice_number TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'VERIFIED_PAID',
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_license_payments_created ON license_payments(created_at DESC);
                    "#,
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                let _ = conn.execute_batch("ALTER TABLE print_jobs ADD COLUMN pages_printed INTEGER DEFAULT 0;");
                let _ = conn.execute_batch("ALTER TABLE print_jobs ADD COLUMN is_metered INTEGER DEFAULT 0;");
                let _ = conn.execute_batch("ALTER TABLE app_licenses ADD COLUMN city TEXT;");
                let _ = conn.execute_batch("ALTER TABLE app_licenses ADD COLUMN profile_configured INTEGER NOT NULL DEFAULT 0;");
                let _ = conn.execute_batch("ALTER TABLE app_licenses ADD COLUMN profile_updated_at TEXT;");
                Ok(())
            })
            .map_err(|e| format!("Failed to initialize app_licenses table: {}", e))
    }

    /// Auto-provisions a signed 14-day trial if the database is clean/empty
    fn ensure_license_exists(&self) -> Result<(), String> {
        let exists: bool = self
            .db
            .with_conn(|conn| {
                let mut stmt = conn.prepare("SELECT count(*) FROM app_licenses WHERE id = 1")
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                let count: i64 = stmt.query_row([], |r| r.get(0))
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(count > 0)
            })
            .map_err(|e| format!("DB query error: {}", e))?;

        if !exists {
            info!("No existing license found. Auto-provisioning signed 14-Day Free Trial...");
            let trial = create_signed_trial_license(&self.hwid);
            let now_epoch = Utc::now().timestamp();
            let now_iso = Utc::now().to_rfc3339();

            self.db
                .with_conn(|conn| {
                    conn.execute(
                        r#"
                        INSERT INTO app_licenses (
                            id, hwid, shop_name, owner_name, phone,
                            plan_type, pages_granted, pages_used, pages_printed_lifetime,
                            issued_at, expires_at, signature, last_seen_epoch, last_verified_at
                        ) VALUES (
                            1, ?1, ?2, ?3, ?4,
                            ?5, ?6, 0, 0,
                            ?7, ?8, ?9, ?10, ?11
                        )
                        "#,
                        params![
                            trial.hwid,
                            trial.shop_name,
                            trial.owner_name,
                            trial.phone,
                            "TRIAL",
                            trial.pages_granted,
                            trial.issued_at,
                            trial.expires_at,
                            trial.signature,
                            now_epoch,
                            now_iso,
                        ],
                    )
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                    Ok(())
                })
                .map_err(|e| format!("Failed to insert initial trial license: {}", e))?;
            info!("Signed 14-Day Free Trial successfully provisioned for HWID {}", self.hwid);
        }

        Ok(())
    }

    /// Reads and cryptographically audits the current license state
    pub fn get_license_state(&self) -> Result<LicenseStateDto, String> {
        let (
            db_hwid,
            shop_name,
            owner_name,
            phone,
            plan_str,
            pages_granted,
            mut pages_used,
            mut lifetime_prints,
            issued_at_str,
            expires_at_str,
            signature,
            last_seen_epoch,
            city,
            profile_configured_int,
            profile_updated_at,
        ) = self
            .db
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    r#"
                    SELECT 
                        hwid, shop_name, owner_name, phone,
                        plan_type, pages_granted, pages_used, pages_printed_lifetime,
                        issued_at, expires_at, signature, last_seen_epoch,
                        city, COALESCE(profile_configured, 0), profile_updated_at
                    FROM app_licenses WHERE id = 1
                    "#,
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                let res = stmt.query_row([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<u64>>(5)?,
                        row.get::<_, u64>(6)?,
                        row.get::<_, u64>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, i64>(11)?,
                        row.get::<_, Option<String>>(12)?,
                        row.get::<_, i64>(13)?,
                        row.get::<_, Option<String>>(14)?,
                    ))
                })
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                Ok(res)
            })
            .map_err(|e| format!("Failed to read license record: {}", e))?;

        // 1. Parse plan type
        let plan_type = match plan_str.as_str() {
            "TRIAL" => LicensePlanType::Trial,
            "WALLET_PAGES" => LicensePlanType::WalletPages,
            "SUB_MONTHLY" => LicensePlanType::SubMonthly,
            "SUB_QUARTERLY" => LicensePlanType::SubQuarterly,
            "SUB_HALF_YEARLY" => LicensePlanType::SubHalfYearly,
            "SUB_ANNUAL" => LicensePlanType::SubAnnual,
            _ => LicensePlanType::Trial,
        };

        // 2. Cryptographic signature verification
        let payload = LicensePayload {
            hwid: db_hwid.clone(),
            shop_name: shop_name.clone(),
            owner_name: owner_name.clone(),
            city: city.clone(),
            phone: phone.clone(),
            plan_type: plan_type.clone(),
            pages_granted,
            issued_at: issued_at_str.clone(),
            expires_at: expires_at_str.clone(),
            signature: signature.clone(),
            plan_name: None,
            amount_paid: None,
            payment_mode: None,
            payment_reference: None,
            invoice_number: None,
        };

        let is_signature_valid = verify_license_signature(&payload);
        let is_hwid_match = db_hwid.trim().eq_ignore_ascii_case(self.hwid.trim());

        // 3. Anti-clock-rollback monotonic high-water mark verification
        let now_dt = Utc::now();
        let now_epoch = now_dt.timestamp();
        // Allow up to 3600s (1 hour) backward tolerance for standard NTP sync or timezone jumps
        let is_clock_tampered = now_epoch < (last_seen_epoch - 3600);

        if is_clock_tampered {
            warn!(
                "CLOCK ROLLBACK DETECTED! Current epoch: {}, Last seen high-water mark: {}",
                now_epoch, last_seen_epoch
            );
        } else if now_epoch > last_seen_epoch {
            // Advance the high-water mark
            let _ = self.db.with_conn(|conn| {
                conn.execute(
                    "UPDATE app_licenses SET last_seen_epoch = ?1, last_verified_at = ?2 WHERE id = 1",
                    params![now_epoch, now_dt.to_rfc3339()],
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(())
            });
        }

        // 4. Compute days and remaining metrics (calendar-day aligned at local midnight 12:00 AM)
        let today_local = Local::now().date_naive();
        let issued_dt = DateTime::parse_from_rfc3339(&issued_at_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(now_dt);
        let issued_local = issued_dt.with_timezone(&Local).date_naive();
        let active_tenure_days = (today_local - issued_local).num_days().max(0);

        let expiry_dt = expires_at_str.as_deref().and_then(|exp| {
            DateTime::parse_from_rfc3339(exp)
                .map(|dt| dt.with_timezone(&Utc))
                .ok()
        });

        let days_remaining = if let Some(exp) = expiry_dt {
            let expiry_local = exp.with_timezone(&Local).date_naive();
            (expiry_local - today_local).num_days()
        } else {
            9999 // Unlimited duration (e.g. Wallet pack without expiry)
        };

        let is_unlimited_subscription_active = match plan_type {
            LicensePlanType::SubMonthly
            | LicensePlanType::SubQuarterly
            | LicensePlanType::SubHalfYearly
            | LicensePlanType::SubAnnual => days_remaining > 0,
            _ => false,
        };

        // 5. Query today's and lifetime printed pages count (summing effective_pages * copies across COMPLETED print_jobs)
        //    and atomically reconcile any unmetered COMPLETED print_jobs from today into pages_used & pages_printed_lifetime.
        let (today_prints, computed_lifetime_pages, unmetered_today_pages): (u64, u64, u64) = self
            .db
            .with_conn(|conn| {
                let mut stmt = conn
                    .prepare(
                        r#"
                        SELECT 
                            pj.id,
                            COALESCE(fr.file_id, '') AS file_id,
                            COALESCE(ps.copies, 1) AS copies,
                            COALESCE(pj.pages_printed, 0) AS recorded_pages,
                            COALESCE(pj.is_metered, 0) AS is_metered,
                            ob.billing_details_json,
                            CASE WHEN date(COALESCE(pj.completed_at, pj.created_at), 'localtime') = date('now', 'localtime')
                                   OR date(COALESCE(pj.completed_at, pj.created_at)) = date('now')
                                 THEN 1 ELSE 0 END AS is_today
                        FROM print_jobs pj
                        LEFT JOIN file_revisions fr ON fr.id = pj.file_revision_id
                        LEFT JOIN print_settings ps ON ps.file_revision_id = pj.file_revision_id
                        LEFT JOIN order_billings ob ON ob.order_id = pj.order_id
                        WHERE pj.status = 'COMPLETED'
                        "#,
                    )
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                let rows = stmt
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0).unwrap_or_default(),
                            r.get::<_, String>(1).unwrap_or_default(),
                            r.get::<_, i64>(2).unwrap_or(1),
                            r.get::<_, i64>(3).unwrap_or(0),
                            r.get::<_, i64>(4).unwrap_or(0),
                            r.get::<_, Option<String>>(5).unwrap_or(None),
                            r.get::<_, i64>(6).unwrap_or(0),
                        ))
                    })
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                let mut today_sum: u64 = 0;
                let mut all_time_sum: u64 = 0;
                let mut unmetered_today_sum: u64 = 0;
                let mut jobs_to_mark_metered: Vec<(String, u64)> = Vec::new();

                for row_res in rows {
                    if let Ok((pj_id, file_id, copies, recorded_pages, is_metered, billing_json_opt, is_today)) = row_res {
                        let mut billing_pages: u64 = 0;
                        if let Some(ref json_str) = billing_json_opt {
                            if let Ok(items) = serde_json::from_str::<Vec<crate::pricing::FileBillingDetailDto>>(json_str) {
                                if let Some(found) = items.iter().find(|f| f.file_id == file_id) {
                                    billing_pages = (found.effective_pages.max(1) as u64) * (found.copies.max(1) as u64);
                                }
                            }
                        }

                        let rec = recorded_pages.max(0) as u64;
                        let cop = copies.max(1) as u64;
                        let job_pages = billing_pages.max(rec).max(cop);

                        all_time_sum += job_pages;
                        if is_today == 1 {
                            today_sum += job_pages;
                            if is_metered == 0 {
                                unmetered_today_sum += job_pages;
                                jobs_to_mark_metered.push((pj_id, job_pages));
                            }
                        } else if is_metered == 0 {
                            jobs_to_mark_metered.push((pj_id, job_pages));
                        }
                    }
                }

                for (pj_id, job_pages) in &jobs_to_mark_metered {
                    let _ = conn.execute(
                        "UPDATE print_jobs SET pages_printed = ?1, is_metered = 1 WHERE id = ?2",
                        params![*job_pages as i64, pj_id],
                    );
                }

                if unmetered_today_sum > 0 {
                    if is_unlimited_subscription_active {
                        let _ = conn.execute(
                            "UPDATE app_licenses SET pages_printed_lifetime = pages_printed_lifetime + ?1 WHERE id = 1",
                            params![unmetered_today_sum as i64],
                        );
                    } else {
                        let _ = conn.execute(
                            "UPDATE app_licenses SET pages_used = pages_used + ?1, pages_printed_lifetime = pages_printed_lifetime + ?1 WHERE id = 1",
                            params![unmetered_today_sum as i64],
                        );
                    }
                }

                Ok((today_sum, all_time_sum, unmetered_today_sum))
            })
            .unwrap_or((0, 0, 0));

        if unmetered_today_pages > 0 {
            if !is_unlimited_subscription_active {
                pages_used += unmetered_today_pages;
            }
            lifetime_prints += unmetered_today_pages;
        }

        let mut wallet_pages_remaining = pages_granted.map(|granted| granted.saturating_sub(pages_used));
        let lifetime_prints = lifetime_prints.max(computed_lifetime_pages);

        // 6. Determine final status and user-facing messages
        let status: LicenseStatus;
        let mut is_valid = true;
        let mut status_message = format!("License is active (Plan: {})", plan_type.display_name());
        let mut is_license_grace_active = false;
        let mut license_grace_hours_remaining: Option<i64> = None;
        let mut license_grace_prints_remaining: Option<u64> = None;

        let provider_config = self.db.get_config("provider_payment_config")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str::<crate::licensing::ProviderPaymentConfig>(&s).ok())
            .unwrap_or_default();

        if is_clock_tampered {
            status = LicenseStatus::ClockTampered;
            is_valid = false;
            status_message = "System clock manipulation detected. Please synchronize your Windows clock with Internet Time (time.windows.com).".to_string();
        } else if !is_hwid_match {
            status = LicenseStatus::Revoked;
            is_valid = false;
            status_message = format!(
                "Hardware mismatch: License was provisioned for {}, but this machine is {}.",
                db_hwid, self.hwid
            );
        } else if !is_signature_valid {
            status = LicenseStatus::Revoked;
            is_valid = false;
            status_message = "License signature verification failed. Database tampering or corrupted key detected.".to_string();
        } else if plan_type == LicensePlanType::Trial {
            if days_remaining <= 0 {
                status = LicenseStatus::TrialExpired;
                is_valid = false;
                status_message = "Your free trial has expired. Please activate a print pack or subscription to continue.".to_string();
            } else if let Some(rem_pages) = wallet_pages_remaining {
                if rem_pages == 0 {
                    status = LicenseStatus::TrialExpired;
                    is_valid = false;
                    status_message = "Your trial print allowance has been exhausted. Please activate a license.".to_string();
                } else {
                    status = LicenseStatus::TrialActive;
                    status_message = format!(
                        "Free Trial Active: {} days remaining ({} trial pages left)",
                        days_remaining, rem_pages
                    );
                }
            } else {
                status = LicenseStatus::TrialActive;
                status_message = format!("Free Trial Active: {} days remaining", days_remaining);
            }
        } else if plan_type == LicensePlanType::WalletPages {
            let granted = pages_granted.unwrap_or(0);
            if pages_used < granted {
                let rem_pages = granted - pages_used;
                wallet_pages_remaining = Some(rem_pages);
                status = LicenseStatus::Active;
                is_valid = true;
                status_message = format!("Page Wallet Active: {} pages remaining", rem_pages);
            } else if pages_used < granted + 50 {
                let grace_left = (granted + 50) - pages_used;
                wallet_pages_remaining = Some(0);
                is_license_grace_active = true;
                license_grace_prints_remaining = Some(grace_left);
                status = LicenseStatus::Active;
                is_valid = true;
                status_message = format!(
                    "Page Wallet exhausted. Emergency Grace Active: {} of 50 grace prints remaining. Please recharge your print wallet.",
                    grace_left
                );
            } else {
                wallet_pages_remaining = Some(0);
                is_license_grace_active = false;
                license_grace_prints_remaining = Some(0);
                status = LicenseStatus::Expired;
                is_valid = false;
                status_message = "Your Page Wallet and 50-print emergency grace allowance have been exhausted (0 pages left). Please recharge with a new print credit pack.".to_string();
            }
        } else {
            // Subscription plans (Monthly, Quarterly, Half-Yearly, Annual)
            let has_wallet_reserve = wallet_pages_remaining.map(|p| p > 0).unwrap_or(false);
            let rem_wallet = wallet_pages_remaining.unwrap_or(0);

            if days_remaining <= 0 {
                // Subscription has expired: check if there are wallet pages in reserve!
                if has_wallet_reserve {
                    status = LicenseStatus::Active;
                    is_valid = true;
                    status_message = format!(
                        "Subscription expired on {}. Active on Prepaid Page Wallet: {} pages remaining.",
                        expires_at_str.as_deref().unwrap_or("N/A"),
                        rem_wallet
                    );
                } else {
                    // Check 48-Hour (2-Day) Grace Period for paid subscriptions
                    let elapsed_hours = expiry_dt.map(|exp| (now_dt - exp).num_hours().max(0)).unwrap_or(48);
                    if elapsed_hours < 48 {
                        let hours_left = 48 - elapsed_hours;
                        is_license_grace_active = true;
                        license_grace_hours_remaining = Some(hours_left);
                        status = LicenseStatus::Active;
                        is_valid = true; // Printing remains active during 48-hour grace!
                        status_message = format!(
                            "Your {} subscription expired. 48-Hour Emergency Grace Active ({}h remaining). Please renew to prevent print interruption.",
                            plan_type.display_name(),
                            hours_left
                        );
                    } else {
                        is_license_grace_active = false;
                        license_grace_hours_remaining = Some(0);
                        status = LicenseStatus::Expired;
                        is_valid = false; // Hard lockout after 48-hour grace
                        status_message = format!(
                            "Your {} subscription expired on {} and the 48-hour grace period has ended. Please renew to resume printing.",
                            plan_type.display_name(),
                            expires_at_str.as_deref().unwrap_or("N/A")
                        );
                    }
                }
            } else {
                status = LicenseStatus::Active;
                if has_wallet_reserve {
                    status_message = format!(
                        "{} Active ({} days remaining) • {} Pages in Wallet Reserve",
                        plan_type.display_name(),
                        days_remaining,
                        rem_wallet
                    );
                } else {
                    status_message = format!(
                        "{} Active: {} days remaining",
                        plan_type.display_name(),
                        days_remaining
                    );
                }
            }
        }

        // 7. Check 72-hour offline grace metrics
        let last_synced_at_str = self.db
            .get_config("cloud_license_last_synced_at")
            .ok()
            .flatten();

        let (is_offline_grace_active, offline_grace_hours_remaining) = if let Some(sync_str) = last_synced_at_str {
            if let Ok(last_sync) = DateTime::parse_from_rfc3339(&sync_str) {
                let last_sync_utc = last_sync.with_timezone(&Utc);
                let elapsed_hours = (now_dt - last_sync_utc).num_hours();
                if elapsed_hours < 72 {
                    (true, Some(72 - elapsed_hours))
                } else {
                    (false, Some(0))
                }
            } else {
                (false, None)
            }
        } else {
            (false, None)
        };

        // Clean trial suffix from shop_name once on commercial plan or wallet
        let clean_shop_name = if plan_type != LicensePlanType::Trial {
            shop_name
                .replace("(Trial Mode)", "")
                .replace("(Trial)", "")
                .trim()
                .to_string()
        } else {
            shop_name
        };

        let is_profile_configured = profile_configured_int > 0
            || (!clean_shop_name.trim().is_empty()
                && clean_shop_name.trim() != "PrintDrop Retail Station"
                && owner_name.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
                && city.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
                && phone.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false));

        let custom_plan_display = self
            .db
            .get_config("active_plan_display_name")
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty());

        let plan_display_name = if plan_type == LicensePlanType::Trial {
            plan_type.display_name().to_string()
        } else if let Some(custom) = custom_plan_display {
            custom
        } else if plan_type == LicensePlanType::WalletPages {
            if let Some(pgs) = pages_granted {
                format!("Pay-As-You-Go Page Wallet ({} Pages)", pgs)
            } else {
                plan_type.display_name().to_string()
            }
        } else {
            plan_type.display_name().to_string()
        };

        Ok(LicenseStateDto {
            hwid: self.hwid.clone(),
            is_valid,
            status,
            plan_type: plan_type.clone(),
            plan_display_name,
            shop_name: clean_shop_name,
            owner_name,
            city,
            phone,
            profile_configured: is_profile_configured,
            profile_updated_at,
            start_date: issued_at_str,
            expiry_date: expires_at_str,
            days_remaining,
            active_tenure_days,
            wallet_pages_remaining,
            lifetime_prints,
            today_prints,
            clock_tampered: is_clock_tampered,
            is_offline_grace_active,
            offline_grace_hours_remaining,
            is_license_grace_active,
            license_grace_hours_remaining,
            license_grace_prints_remaining,
            provider_company_name: Some(provider_config.business_name),
            provider_contact_phone: provider_config.contact_phone,
            provider_whatsapp_number: provider_config.whatsapp_number,
            provider_support_email: provider_config.support_email,
            status_message,
            credit_balance: self.get_credit_balance(),
            auto_renew_enabled: self.get_auto_renew_enabled(),
        })
    }

    /// Activates a new license key entered by the shopkeeper or verified from cloud
    pub fn activate_license_key(
        &self,
        request: ActivationRequest,
    ) -> Result<LicenseStateDto, String> {
        info!("Attempting to activate license key for HWID: {}", self.hwid);

        let payload = parse_and_verify_activation_key(&request.activation_key, &self.hwid)?;

        let shop = request
            .shop_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(payload.shop_name.clone());
        let owner = request.owner_name.or(payload.owner_name.clone());
        let phone = request.phone.or(payload.phone.clone());
        let city = payload.city.clone();

        let plan_str = match payload.plan_type {
            LicensePlanType::Trial => "TRIAL",
            LicensePlanType::WalletPages => "WALLET_PAGES",
            LicensePlanType::SubMonthly => "SUB_MONTHLY",
            LicensePlanType::SubQuarterly => "SUB_QUARTERLY",
            LicensePlanType::SubHalfYearly => "SUB_HALF_YEARLY",
            LicensePlanType::SubAnnual => "SUB_ANNUAL",
        };

        let now_epoch = Utc::now().timestamp();
        let now_iso = Utc::now().to_rfc3339();

        self.db
            .with_conn(|conn| {
                conn.execute(
                    r#"
                    UPDATE app_licenses SET
                        shop_name = CASE WHEN ?1 != '' AND ?1 != 'PrintDrop Retail Station' THEN ?1 ELSE shop_name END,
                        owner_name = COALESCE(?2, owner_name),
                        city = COALESCE(?3, city),
                        phone = COALESCE(?4, phone),
                        plan_type = ?5,
                        pages_granted = ?6,
                        pages_used = 0,
                        issued_at = ?7,
                        expires_at = ?8,
                        signature = ?9,
                        last_seen_epoch = ?10,
                        last_verified_at = ?11,
                        profile_configured = CASE WHEN ?1 != '' AND ?1 != 'PrintDrop Retail Station' THEN 1 ELSE profile_configured END
                    WHERE id = 1
                    "#,
                    params![
                        shop,
                        owner,
                        city,
                        phone,
                        plan_str,
                        payload.pages_granted,
                        payload.issued_at,
                        payload.expires_at,
                        payload.signature,
                        now_epoch,
                        now_iso,
                    ],
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(())
            })
            .map_err(|e| format!("Failed to update license activation record: {}", e))?;

        let resolved_plan_name = payload
            .plan_name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                if payload.plan_type == LicensePlanType::WalletPages {
                    if let Some(pgs) = payload.pages_granted {
                        format!("Pay-As-You-Go Page Wallet ({} Pages)", pgs)
                    } else {
                        payload.plan_type.display_name().to_string()
                    }
                } else {
                    payload.plan_type.display_name().to_string()
                }
            });
        let _ = self.db.set_config("active_plan_display_name", &resolved_plan_name);

        if payload.plan_type != LicensePlanType::Trial {
            let pay_mode = payload
                .payment_mode
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "OFFLINE_KEY".to_string());
            let pay_ref = payload
                .payment_reference
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| pay_mode.clone());
            let inv_sfx = if self.hwid.len() >= 4 {
                &self.hwid[self.hwid.len() - 4..]
            } else {
                "0001"
            };
            let inv_no = payload
                .invoice_number
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("PD-INV-{}", inv_sfx));
            let pay_rec = LicensePaymentRecord {
                id: format!("offline_{}_{}", self.hwid, now_epoch),
                hwid: self.hwid.clone(),
                plan_code: plan_str.to_string(),
                plan_name: resolved_plan_name.clone(),
                amount_paid: payload.amount_paid.unwrap_or(0.0),
                pages_granted: payload.pages_granted,
                duration_days: None,
                payment_mode: pay_mode,
                payment_reference: pay_ref,
                invoice_number: inv_no,
                status: "VERIFIED_PAID".to_string(),
                created_at: payload.issued_at.clone(),
            };
            let _ = self.record_payment(pay_rec);
        }

        info!(
            "Successfully activated license! Plan: {:?}, Expires: {:?}",
            payload.plan_type, payload.expires_at
        );

        self.get_license_state()
    }

    /// Directly applies an already cryptographically verified LicensePayload
    /// (e.g. delivered securely via authenticated Cloud Registry sync).
    pub fn apply_verified_payload(
        &self,
        payload: &LicensePayload,
    ) -> Result<LicenseStateDto, String> {
        let plan_str = match payload.plan_type {
            LicensePlanType::Trial => "TRIAL",
            LicensePlanType::WalletPages => "WALLET_PAGES",
            LicensePlanType::SubMonthly => "SUB_MONTHLY",
            LicensePlanType::SubQuarterly => "SUB_QUARTERLY",
            LicensePlanType::SubHalfYearly => "SUB_HALF_YEARLY",
            LicensePlanType::SubAnnual => "SUB_ANNUAL",
        };

        let now_epoch = Utc::now().timestamp();
        let now_iso = Utc::now().to_rfc3339();

        let clean_shop = if payload.plan_type != LicensePlanType::Trial {
            payload
                .shop_name
                .replace("(Trial Mode)", "")
                .replace("(Trial)", "")
                .trim()
                .to_string()
        } else {
            payload.shop_name.clone()
        };

        self.db
            .with_conn(|conn| {
                conn.execute(
                    r#"
                    UPDATE app_licenses SET
                        shop_name = CASE WHEN TRIM(shop_name) = '' OR shop_name = 'PrintDrop Retail Station' THEN ?1 ELSE shop_name END,
                        owner_name = CASE WHEN (owner_name IS NULL OR TRIM(owner_name) = '') THEN ?2 ELSE owner_name END,
                        phone = CASE WHEN (phone IS NULL OR TRIM(phone) = '') THEN ?3 ELSE phone END,
                        plan_type = ?4,
                        pages_granted = ?5,
                        pages_used = CASE WHEN issued_at != ?6 THEN 0 ELSE pages_used END,
                        issued_at = ?6,
                        expires_at = ?7,
                        signature = ?8,
                        last_seen_epoch = ?9,
                        last_verified_at = ?10,
                        remote_synced_at = ?10
                    WHERE id = 1
                    "#,
                    params![
                        clean_shop,
                        payload.owner_name,
                        payload.phone,
                        plan_str,
                        payload.pages_granted,
                        payload.issued_at,
                        payload.expires_at,
                        payload.signature,
                        now_epoch,
                        now_iso,
                    ],
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(())
            })
            .map_err(|e| format!("Failed to apply cloud license record: {}", e))?;

        info!(
            "Applied verified license payload from cloud sync: Plan: {:?}, Expires: {:?}",
            payload.plan_type, payload.expires_at
        );

        // When a purchased license (non-Trial) is applied, auto-disable simulation mode and purge virtual printers (in Clean Retail mode)
        #[cfg(not(feature = "simulation"))]
        if payload.plan_type != LicensePlanType::Trial {
            let _ = self.db.with_conn(|conn| {
                conn.execute(
                    "INSERT INTO app_config (key, value) VALUES ('printer_simulation_mode', 'false')
                     ON CONFLICT(key) DO UPDATE SET value = 'false'",
                    [],
                )?;
                Ok(())
            });
            crate::printer::clear_cached_printers();
        }

        self.get_license_state()
    }

    /// Reads the raw local LicensePayload from SQLite for timestamp comparison during cloud sync.
    pub fn get_local_signed_payload(&self) -> Option<LicensePayload> {
        self.db
            .with_conn(|conn| {
                let mut stmt = conn
                    .prepare(
                        "SELECT hwid, shop_name, owner_name, phone, plan_type, pages_granted, issued_at, expires_at, signature
                         FROM app_licenses WHERE id = 1",
                    )
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                let res = stmt
                    .query_row([], |row| {
                        let plan_str: String = row.get(4)?;
                        let plan_type = match plan_str.as_str() {
                            "WALLET_PAGES" => LicensePlanType::WalletPages,
                            "SUB_MONTHLY" => LicensePlanType::SubMonthly,
                            "SUB_QUARTERLY" => LicensePlanType::SubQuarterly,
                            "SUB_HALF_YEARLY" => LicensePlanType::SubHalfYearly,
                            "SUB_ANNUAL" => LicensePlanType::SubAnnual,
                            _ => LicensePlanType::Trial,
                        };
                        Ok(LicensePayload {
                            hwid: row.get(0)?,
                            shop_name: row.get(1)?,
                            owner_name: row.get(2)?,
                            city: None,
                            phone: row.get(3)?,
                            plan_type,
                            pages_granted: row.get(5)?,
                            issued_at: row.get(6)?,
                            expires_at: row.get(7)?,
                            signature: row.get(8)?,
                            plan_name: None,
                            amount_paid: None,
                            payment_mode: None,
                            payment_reference: None,
                            invoice_number: None,
                        })
                    })
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(res)
            })
            .ok()
    }

    /// Returns the station's Rupee Credit Wallet balance (in INR)
    pub fn get_credit_balance(&self) -> f64 {
        self.db
            .get_config("station_credit_balance")
            .ok()
            .flatten()
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map(|v| if v.is_finite() && v > 0.0 { v } else { 0.0 })
            .unwrap_or(0.0)
    }

    /// Persists the station's Rupee Credit Wallet balance (in INR)
    pub fn set_credit_balance(&self, amount: f64) {
        let clean = if amount.is_finite() && amount > 0.0 {
            (amount * 100.0).round() / 100.0
        } else {
            0.0
        };
        let _ = self.db.set_config("station_credit_balance", &format!("{:.2}", clean));
    }

    /// Returns whether Auto-Renew on Expiry is enabled for this station
    pub fn get_auto_renew_enabled(&self) -> bool {
        self.db
            .get_config("auto_renew_enabled")
            .ok()
            .flatten()
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false)
    }

    /// Sets whether Auto-Renew on Expiry is enabled for this station
    pub fn set_auto_renew_enabled(&self, enabled: bool) {
        let _ = self
            .db
            .set_config("auto_renew_enabled", if enabled { "true" } else { "false" });
    }

    /// Returns the most recent paid commercial plan (excluding WALLET_TOPUP and CANCELLED) for Auto-Renew
    pub fn get_last_renewable_plan(&self) -> Option<LicensePaymentRecord> {
        self.get_payment_history().ok().and_then(|list| {
            list.into_iter().find(|p| {
                p.status == "VERIFIED_PAID"
                    && p.plan_code != "WALLET_TOPUP"
                    && p.amount_paid > 0.0
            })
        })
    }

    /// Updates the customer's shop name, owner name, location/city, and phone contact in the local station registry
    pub fn update_station_profile(
        &self,
        shop_name: &str,
        owner_name: Option<String>,
        city: Option<String>,
        phone: Option<String>,
        mark_configured: bool,
    ) -> Result<LicenseStateDto, String> {
        let clean_shop = if shop_name.trim().is_empty() {
            "PrintDrop Retail Station".to_string()
        } else {
            shop_name.trim().to_string()
        };
        let clean_owner = owner_name.and_then(|v| {
            let t = v.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        });
        let clean_city = city.and_then(|v| {
            let t = v.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        });
        let clean_phone = phone.and_then(|v| {
            let t = v.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        });
        let now_iso = Utc::now().to_rfc3339();
        let configured_flag: i64 = if mark_configured { 1 } else { 0 };

        self.db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE app_licenses SET shop_name = ?1, owner_name = ?2, city = ?3, phone = ?4, profile_configured = CASE WHEN ?5 = 1 THEN 1 ELSE profile_configured END, profile_updated_at = ?6 WHERE id = 1",
                    params![clean_shop, clean_owner, clean_city, clean_phone, configured_flag, now_iso],
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(())
            })
            .map_err(|e| format!("Failed to update station profile: {}", e))?;

        self.get_license_state()
    }

    /// Bidirectional Last-Write-Wins profile sync: applies remote station identity if it is newer
    /// than the local profile_updated_at timestamp (or if local is still unconfigured default).
    pub fn sync_remote_profile_if_newer(
        &self,
        remote_shop: &str,
        remote_owner: Option<String>,
        remote_city: Option<String>,
        remote_phone: Option<String>,
        remote_profile_updated_at: Option<String>,
    ) -> bool {
        let local = match self.get_license_state() {
            Ok(s) => s,
            Err(_) => return false,
        };

        let remote_shop_clean = remote_shop.trim();
        let remote_has_data = (!remote_shop_clean.is_empty() && remote_shop_clean != "PrintDrop Retail Station")
            || remote_owner.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
            || remote_city.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
            || remote_phone.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);

        if !remote_has_data {
            return false;
        }

        let local_is_default = local.shop_name.trim() == "PrintDrop Retail Station"
            || !local.profile_configured;

        let should_pull_remote = if local_is_default {
            true
        } else {
            match (
                remote_profile_updated_at.as_deref().and_then(|s| DateTime::parse_from_rfc3339(s).ok()),
                local.profile_updated_at.as_deref().and_then(|s| DateTime::parse_from_rfc3339(s).ok()),
            ) {
                (Some(r_dt), Some(l_dt)) => r_dt > l_dt,
                (Some(_), None) => true,
                _ => false,
            }
        };

        if !should_pull_remote {
            return false;
        }

        let final_shop = if !remote_shop_clean.is_empty() {
            remote_shop_clean.to_string()
        } else {
            local.shop_name.clone()
        };
        let final_owner = remote_owner.filter(|s| !s.trim().is_empty()).or(local.owner_name);
        let final_city = remote_city.filter(|s| !s.trim().is_empty()).or(local.city);
        let final_phone = remote_phone.filter(|s| !s.trim().is_empty()).or(local.phone);
        let ts = remote_profile_updated_at.unwrap_or_else(|| Utc::now().to_rfc3339());

        self.db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE app_licenses SET shop_name = ?1, owner_name = ?2, city = ?3, phone = ?4, profile_configured = 1, profile_updated_at = ?5 WHERE id = 1",
                    params![final_shop, final_owner, final_city, final_phone, ts],
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(())
            })
            .is_ok()
    }

    /// Verifies if the station is currently licensed and authorized to print `requested_pages`
    pub fn check_can_print(&self, requested_pages: u32) -> Result<(), String> {
        let state = self.get_license_state()?;

        if !state.is_valid {
            return Err(format!(
                "Print authorization denied: {}",
                state.status_message
            ));
        }

        // If station has an active unlimited subscription, allow printing unlimited pages
        let is_unlimited_subscription_active = match state.plan_type {
            LicensePlanType::SubMonthly
            | LicensePlanType::SubQuarterly
            | LicensePlanType::SubHalfYearly
            | LicensePlanType::SubAnnual => state.days_remaining > 0 || state.is_license_grace_active,
            _ => false,
        };

        if !is_unlimited_subscription_active {
            if let Some(rem_pages) = state.wallet_pages_remaining {
                if (requested_pages as u64) > rem_pages {
                    return Err(format!(
                        "Insufficient print balance: Job requires {} page(s), but only {} page(s) remaining in your wallet.",
                        requested_pages, rem_pages
                    ));
                }
            }
        }

        Ok(())
    }

    /// Records completed print job pages in the local metered ledger
    pub fn record_printed_pages(&self, pages: u32) -> Result<LicenseStateDto, String> {
        if pages == 0 {
            return self.get_license_state();
        }

        let state = self.get_license_state()?;
        let is_unlimited_subscription_active = match state.plan_type {
            LicensePlanType::SubMonthly
            | LicensePlanType::SubQuarterly
            | LicensePlanType::SubHalfYearly
            | LicensePlanType::SubAnnual => state.days_remaining > 0 || state.is_license_grace_active,
            _ => false,
        };

        if is_unlimited_subscription_active {
            // Unlimited subscription is active: only increment lifetime prints, preserving wallet balance in reserve!
            self.db
                .with_conn(|conn| {
                    conn.execute(
                        r#"
                        UPDATE app_licenses 
                        SET pages_printed_lifetime = pages_printed_lifetime + ?1
                        WHERE id = 1
                        "#,
                        params![pages as i64],
                    )
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                    Ok(())
                })
                .map_err(|e| format!("Failed to record printed pages: {}", e))?;
        } else {
            // Prepaid Wallet pack or Trial: increment both pages_used and pages_printed_lifetime
            self.db
                .with_conn(|conn| {
                    conn.execute(
                        r#"
                        UPDATE app_licenses 
                        SET pages_used = pages_used + ?1,
                            pages_printed_lifetime = pages_printed_lifetime + ?1
                        WHERE id = 1
                        "#,
                        params![pages as i64],
                    )
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                    Ok(())
                })
                .map_err(|e| format!("Failed to record printed pages: {}", e))?;
        }

        self.get_license_state()
    }

    /// Records or updates an individual license payment record in the station ledger
    pub fn record_payment(&self, payment: LicensePaymentRecord) -> Result<(), String> {
        self.db
            .with_conn(|conn| {
                // Prevent duplicate synthetic heartbeat rows when a real payment record with the same UTR/reference already exists
                let ref_trimmed = payment.payment_reference.trim();
                if !ref_trimmed.is_empty()
                    && ref_trimmed != "ONLINE-VERIFIED"
                    && ref_trimmed != "DIRECT-VERIFIED"
                    && payment.id.starts_with("pay_")
                {
                    let updated = conn.execute(
                        "UPDATE license_payments SET status = ?1 WHERE payment_reference = ?2 AND id != ?3",
                        params![payment.status, ref_trimmed, payment.id],
                    )?;
                    if updated > 0 {
                        return Ok(());
                    }
                }

                conn.execute(
                    r#"
                    INSERT INTO license_payments (
                        id, hwid, plan_code, plan_name, amount_paid, pages_granted,
                        duration_days, payment_mode, payment_reference, invoice_number, status, created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                    ON CONFLICT(id) DO UPDATE SET
                        plan_code = excluded.plan_code,
                        plan_name = excluded.plan_name,
                        amount_paid = excluded.amount_paid,
                        pages_granted = excluded.pages_granted,
                        duration_days = excluded.duration_days,
                        payment_mode = excluded.payment_mode,
                        payment_reference = excluded.payment_reference,
                        invoice_number = excluded.invoice_number,
                        status = excluded.status,
                        created_at = excluded.created_at
                    "#,
                    params![
                        payment.id,
                        payment.hwid,
                        payment.plan_code,
                        payment.plan_name,
                        payment.amount_paid,
                        payment.pages_granted,
                        payment.duration_days,
                        payment.payment_mode,
                        payment.payment_reference,
                        payment.invoice_number,
                        payment.status,
                        payment.created_at,
                    ],
                )
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(())
            })
            .map_err(|e| format!("Failed to record license payment: {}", e))
    }

    /// Retrieves full historical ledger of payments made by this station, with auto-synthesis if empty
    pub fn get_payment_history(&self) -> Result<Vec<LicensePaymentRecord>, String> {
        let list: Vec<LicensePaymentRecord> = self
            .db
            .with_conn(|conn| {
                // Auto-purge any legacy duplicate synthetic heartbeat rows matching an existing real payment_reference
                let _ = conn.execute(
                    "DELETE FROM license_payments
                     WHERE id LIKE 'pay\\_%\\_%' ESCAPE '\\'
                       AND payment_reference != ''
                       AND payment_reference IN (
                           SELECT payment_reference FROM license_payments
                           WHERE id NOT LIKE 'pay\\_%\\_%' ESCAPE '\\'
                             AND payment_reference != ''
                       )",
                    [],
                );
                let mut stmt = conn
                    .prepare(
                        r#"
                        SELECT id, hwid, plan_code, plan_name, amount_paid, pages_granted,
                               duration_days, payment_mode, payment_reference, invoice_number, status, created_at
                        FROM license_payments
                        WHERE hwid = ?1
                        ORDER BY datetime(created_at) DESC, rowid DESC
                        "#,
                    )
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                let rows = stmt
                    .query_map(params![self.hwid], |r| {
                        Ok(LicensePaymentRecord {
                            id: r.get(0)?,
                            hwid: r.get(1)?,
                            plan_code: r.get(2)?,
                            plan_name: r.get(3)?,
                            amount_paid: r.get(4)?,
                            pages_granted: r.get(5)?,
                            duration_days: r.get(6)?,
                            payment_mode: r.get(7)?,
                            payment_reference: r.get(8)?,
                            invoice_number: r.get(9)?,
                            status: r.get(10)?,
                            created_at: r.get(11)?,
                        })
                    })
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                let mut out = Vec::new();
                for r in rows {
                    if let Ok(rec) = r {
                        out.push(rec);
                    }
                }
                Ok(out)
            })
            .map_err(|e| format!("Failed to query license payments: {}", e))?;

        // Fallback: If no records exist in license_payments, synthesize one from current active paid license
        if list.is_empty() {
            if let Ok(st) = self.get_license_state() {
                if st.plan_type != LicensePlanType::Trial {
                    let invoice_suffix = if st.hwid.len() >= 4 {
                        &st.hwid[st.hwid.len() - 4..]
                    } else {
                        "0001"
                    };
                    let synth = LicensePaymentRecord {
                        id: format!("rec_init_{}", st.hwid),
                        hwid: st.hwid.clone(),
                        plan_code: format!("{:?}", st.plan_type).to_uppercase(),
                        plan_name: st.plan_display_name.clone(),
                        amount_paid: if st.plan_type == LicensePlanType::SubMonthly { 299.0 } else { 749.0 },
                        pages_granted: st.wallet_pages_remaining,
                        duration_days: if st.days_remaining > 0 { Some(st.days_remaining) } else { None },
                        payment_mode: "DIRECT_VERIFIED".to_string(),
                        payment_reference: format!("ACT-{}", &st.start_date.replace(['-', ':', 'T', 'Z'], "")[..12.min(st.start_date.len())]),
                        invoice_number: format!("PD-INV-{}", invoice_suffix),
                        status: "VERIFIED_PAID".to_string(),
                        created_at: st.start_date.clone(),
                    };
                    let _ = self.record_payment(synth.clone());
                    return Ok(vec![synth]);
                }
            }
        }

        Ok(list)
    }

    /// Synchronizes a batch of payments from the cloud into the local SQLite store
    pub fn sync_remote_payment_history(&self, payments: Vec<LicensePaymentRecord>) -> Result<(), String> {
        for p in payments {
            let _ = self.record_payment(p);
        }
        Ok(())
    }

    /// Computes the daily print usage ledger breakdown under a specific payment record
    pub fn get_payment_usage_history(&self, payment_id: String) -> Result<PaymentUsageSummaryDto, String> {
        let payment: Option<LicensePaymentRecord> = self
            .db
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    r#"
                    SELECT id, hwid, plan_code, plan_name, amount_paid, pages_granted,
                           duration_days, payment_mode, payment_reference, invoice_number, status, created_at
                    FROM license_payments
                    WHERE id = ?1
                    "#,
                )?;
                let mut rows = stmt.query(params![payment_id])?;
                if let Some(r) = rows.next()? {
                    Ok(Some(LicensePaymentRecord {
                        id: r.get(0)?,
                        hwid: r.get(1)?,
                        plan_code: r.get(2)?,
                        plan_name: r.get(3)?,
                        amount_paid: r.get(4)?,
                        pages_granted: r.get(5)?,
                        duration_days: r.get(6)?,
                        payment_mode: r.get(7)?,
                        payment_reference: r.get(8)?,
                        invoice_number: r.get(9)?,
                        status: r.get(10)?,
                        created_at: r.get(11)?,
                    }))
                } else {
                    Ok(None)
                }
            })
            .map_err(|e| format!("DB error reading payment: {}", e))?;

        let rec = match payment {
            Some(p) => p,
            None => return Err(format!("Payment record not found: {}", payment_id)),
        };

        // Determine if next payment exists to bound historical records
        let next_payment_time: Option<String> = self
            .db
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    r#"
                    SELECT created_at FROM license_payments 
                    WHERE hwid = ?1 AND (datetime(created_at) > datetime(?2) OR created_at > ?2)
                    ORDER BY datetime(created_at) ASC, created_at ASC LIMIT 1
                    "#,
                )?;
                let mut rows = stmt.query(params![rec.hwid, rec.created_at])?;
                if let Some(r) = rows.next()? {
                    Ok(Some(r.get(0)?))
                } else {
                    Ok(None)
                }
            })
            .unwrap_or(None);

        self.compute_usage_summary_for_window(
            rec.id,
            rec.plan_code,
            rec.plan_name,
            rec.pages_granted,
            rec.duration_days,
            rec.created_at,
            next_payment_time,
        )
    }

    /// Computes the daily print usage ledger for the active Free Trial evaluation window
    pub fn get_trial_usage_summary(&self) -> Result<PaymentUsageSummaryDto, String> {
        let state = self.get_license_state()?;
        let (issued_at, pages_granted): (String, Option<u64>) = self
            .db
            .with_conn(|conn| {
                let mut stmt = conn.prepare("SELECT issued_at, pages_granted FROM app_licenses WHERE id = 1")?;
                stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
            })
            .map_err(|e| format!("Failed to read trial license window: {}", e))?;

        let duration_days = Some((state.active_tenure_days + state.days_remaining.max(0)).max(1));

        self.compute_usage_summary_for_window(
            format!("trial_{}", self.hwid),
            "TRIAL".to_string(),
            LicensePlanType::Trial.display_name().to_string(),
            pages_granted,
            duration_days,
            issued_at,
            None,
        )
    }

    /// Shared helper that aggregates completed print jobs into daily usage records for any license/payment window
    fn compute_usage_summary_for_window(
        &self,
        payment_id: String,
        plan_code: String,
        plan_name: String,
        total_quota_granted: Option<u64>,
        total_duration_days: Option<i64>,
        window_start_ts: String,
        window_end_ts: Option<String>,
    ) -> Result<PaymentUsageSummaryDto, String> {

        struct RawJobItem {
            day_str: String,
            time_str: String,
            pages: u64,
            order_id: String,
        }

        let raw_jobs: Vec<RawJobItem> = self
            .db
            .with_conn(|conn| {
                let mut jobs_stmt = if window_end_ts.is_some() {
                    conn.prepare(
                        r#"
                        SELECT 
                            COALESCE(date(COALESCE(pj.completed_at, pj.created_at), 'localtime'), date(COALESCE(pj.completed_at, pj.created_at))) AS day_str,
                            COALESCE(time(COALESCE(pj.completed_at, pj.created_at), 'localtime'), time(COALESCE(pj.completed_at, pj.created_at))) AS time_str,
                            COALESCE(pj.pages_printed, 0) AS recorded_pages,
                            COALESCE(ps.copies, 1) AS copies,
                            ob.billing_details_json,
                            COALESCE(fr.file_id, '') AS file_id,
                            pj.order_id
                        FROM print_jobs pj
                        LEFT JOIN file_revisions fr ON fr.id = pj.file_revision_id
                        LEFT JOIN print_settings ps ON ps.file_revision_id = pj.file_revision_id
                        LEFT JOIN order_billings ob ON ob.order_id = pj.order_id
                        WHERE pj.status = 'COMPLETED'
                          AND (datetime(COALESCE(pj.completed_at, pj.created_at)) >= datetime(?1) OR COALESCE(pj.completed_at, pj.created_at) >= ?1)
                          AND (datetime(COALESCE(pj.completed_at, pj.created_at)) < datetime(?2) OR COALESCE(pj.completed_at, pj.created_at) < ?2)
                        ORDER BY datetime(COALESCE(pj.completed_at, pj.created_at)) ASC
                        "#,
                    )?
                } else {
                    conn.prepare(
                        r#"
                        SELECT 
                            COALESCE(date(COALESCE(pj.completed_at, pj.created_at), 'localtime'), date(COALESCE(pj.completed_at, pj.created_at))) AS day_str,
                            COALESCE(time(COALESCE(pj.completed_at, pj.created_at), 'localtime'), time(COALESCE(pj.completed_at, pj.created_at))) AS time_str,
                            COALESCE(pj.pages_printed, 0) AS recorded_pages,
                            COALESCE(ps.copies, 1) AS copies,
                            ob.billing_details_json,
                            COALESCE(fr.file_id, '') AS file_id,
                            pj.order_id
                        FROM print_jobs pj
                        LEFT JOIN file_revisions fr ON fr.id = pj.file_revision_id
                        LEFT JOIN print_settings ps ON ps.file_revision_id = pj.file_revision_id
                        LEFT JOIN order_billings ob ON ob.order_id = pj.order_id
                        WHERE pj.status = 'COMPLETED'
                          AND (datetime(COALESCE(pj.completed_at, pj.created_at)) >= datetime(?1) OR COALESCE(pj.completed_at, pj.created_at) >= ?1)
                        ORDER BY datetime(COALESCE(pj.completed_at, pj.created_at)) ASC
                        "#,
                    )?
                };

                let query_params: &[&dyn rusqlite::ToSql] = if let Some(ref next_ts) = window_end_ts {
                    &[&window_start_ts, next_ts]
                } else {
                    &[&window_start_ts]
                };

                let rows = jobs_stmt.query_map(query_params, |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?.unwrap_or_else(|| "1970-01-01".to_string()),
                        r.get::<_, Option<String>>(1)?.unwrap_or_else(|| "00:00:00".to_string()),
                        r.get::<_, i64>(2).unwrap_or(0),
                        r.get::<_, i64>(3).unwrap_or(1),
                        r.get::<_, Option<String>>(4).unwrap_or(None),
                        r.get::<_, String>(5).unwrap_or_default(),
                        r.get::<_, String>(6).unwrap_or_default(),
                    ))
                })?;

                let mut list = Vec::new();
                for row_res in rows {
                    if let Ok((day_str, time_str, rec_pages, copies, billing_json_opt, file_id, order_id)) = row_res {
                        let mut billing_pages: u64 = 0;
                        if let Some(ref json) = billing_json_opt {
                            if let Ok(items) = serde_json::from_str::<Vec<crate::pricing::FileBillingDetailDto>>(json) {
                                if let Some(f) = items.iter().find(|i| i.file_id == file_id) {
                                    billing_pages = (f.effective_pages.max(1) as u64) * (f.copies.max(1) as u64);
                                }
                            }
                        }
                        let job_pages = billing_pages.max(rec_pages.max(0) as u64).max(copies.max(1) as u64);
                        list.push(RawJobItem {
                            day_str,
                            time_str,
                            pages: job_pages,
                            order_id,
                        });
                    }
                }
                Ok(list)
            })
            .map_err(|e| format!("DB error reading print jobs: {}", e))?;

        // Group into days via BTreeMap (keys chronologically sorted: "2026-11-15", "2026-11-16", etc.)
        struct DayAccumulator {
            day_pages: u64,
            first_time: String,
            last_time: String,
            orders: HashSet<String>,
        }

        let mut daily_groups: BTreeMap<String, DayAccumulator> = BTreeMap::new();
        for job in raw_jobs {
            let entry = daily_groups.entry(job.day_str.clone()).or_insert_with(|| DayAccumulator {
                day_pages: 0,
                first_time: job.time_str.clone(),
                last_time: job.time_str.clone(),
                orders: HashSet::new(),
            });

            entry.day_pages += job.pages;
            if job.time_str < entry.first_time {
                entry.first_time = job.time_str.clone();
            }
            if job.time_str > entry.last_time {
                entry.last_time = job.time_str;
            }
            if !job.order_id.is_empty() {
                entry.orders.insert(job.order_id);
            }
        }

        let is_wallet_plan = total_quota_granted.is_some() || plan_code.contains("WALLET");
        let today_str = Local::now().format("%Y-%m-%d").to_string();

        let format_12h = |t: &str| -> String {
            if let Some((h_str, rest)) = t.split_once(':') {
                let m_str = rest.split(':').next().unwrap_or("00");
                if let Ok(h) = h_str.parse::<u32>() {
                    let ampm = if h >= 12 { "PM" } else { "AM" };
                    let h12 = if h == 0 { 12 } else if h > 12 { h - 12 } else { h };
                    return format!("{:02}:{} {}", h12, m_str, ampm);
                }
            }
            t.to_string()
        };

        let mut running_cumulative: u64 = 0;
        let mut daily_records: Vec<DailyPrintUsageRecord> = Vec::new();

        for (day_str, acc) in daily_groups {
            running_cumulative += acc.day_pages;

            let display_date = if let Ok(nd) = NaiveDate::parse_from_str(&day_str, "%Y-%m-%d") {
                nd.format("%d %b %Y").to_string()
            } else {
                day_str.clone()
            };

            let is_today = day_str == today_str;
            let time_range = if acc.first_time.is_empty() {
                None
            } else if acc.first_time == acc.last_time {
                Some(format_12h(&acc.first_time))
            } else {
                Some(format!("{} - {}", format_12h(&acc.first_time), format_12h(&acc.last_time)))
            };

            let quota_remaining_pages = if is_wallet_plan {
                total_quota_granted.map(|g| (g as i64) - (running_cumulative as i64))
            } else {
                None
            };

            let days_left = if !is_wallet_plan {
                let day_date_opt = NaiveDate::parse_from_str(&day_str, "%Y-%m-%d").ok();
                let purchase_date_opt = window_start_ts.split('T').next()
                    .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
                if let (Some(dd), Some(pd)) = (day_date_opt, purchase_date_opt) {
                    let elapsed = (dd - pd).num_days();
                    total_duration_days.map(|tot| (tot - elapsed).max(0))
                } else {
                    total_duration_days
                }
            } else {
                None
            };

            daily_records.push(DailyPrintUsageRecord {
                date: day_str,
                display_date,
                is_today,
                time_range,
                day_pages: acc.day_pages,
                day_orders_count: acc.orders.len() as u64,
                cumulative_pages: running_cumulative,
                quota_remaining_pages,
                days_left,
            });
        }

        // Reverse so newest date is first (Today at the top)
        daily_records.reverse();

        let pages_remaining = if is_wallet_plan {
            total_quota_granted.map(|g| (g as i64) - (running_cumulative as i64))
        } else {
            None
        };

        let days_remaining = if !is_wallet_plan {
            self.get_license_state().ok().map(|st| st.days_remaining)
        } else {
            None
        };

        Ok(PaymentUsageSummaryDto {
            payment_id,
            plan_code,
            plan_name,
            is_wallet_plan,
            total_quota_granted,
            total_duration_days,
            total_pages_consumed: running_cumulative,
            pages_remaining,
            days_remaining,
            purchase_date: window_start_ts,
            daily_records,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::licensing::crypto::{format_canonical_license_string, sign_license_data};
    use base64::Engine;

    #[test]
    fn test_license_lifecycle_and_tamper_defense() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();

        // 1. Initial State should be TrialActive
        let state = mgr.get_license_state().unwrap();
        assert_eq!(state.status, LicenseStatus::TrialActive);
        assert!(state.is_valid);
        assert_eq!(state.plan_type, LicensePlanType::Trial);
        assert_eq!(state.wallet_pages_remaining, Some(300));
        assert_eq!(state.lifetime_prints, 0);

        // 2. Can print check
        assert!(mgr.check_can_print(5).is_ok());

        // 3. Record print job
        let state_after_print = mgr.record_printed_pages(10).unwrap();
        assert_eq!(state_after_print.wallet_pages_remaining, Some(290));
        assert_eq!(state_after_print.lifetime_prints, 10);

        // 4. Test activation of Commercial Wallet pack (5,000 pages)
        let hwid = mgr.get_hwid();
        let now = Utc::now().to_rfc3339();
        let canonical = format_canonical_license_string(
            hwid,
            &LicensePlanType::WalletPages,
            Some(5000),
            &now,
            None,
        );
        let sig = sign_license_data(&canonical);

        let commercial_payload = LicensePayload {
            hwid: hwid.to_string(),
            shop_name: "Mahalaxmi Xerox & Print Hub".to_string(),
            owner_name: Some("Ramesh Patel".to_string()),
            city: None,
            phone: Some("+91 98765 43210".to_string()),
            plan_type: LicensePlanType::WalletPages,
            pages_granted: Some(5000),
            issued_at: now,
            expires_at: None,
            signature: sig,
            plan_name: None,
            amount_paid: None,
            payment_mode: None,
            payment_reference: None,
            invoice_number: None,
        };

        let key_json = serde_json::to_string(&commercial_payload).unwrap();
        let activation_key = base64::prelude::BASE64_STANDARD.encode(key_json.as_bytes());

        let activated_state = mgr
            .activate_license_key(ActivationRequest {
                activation_key,
                shop_name: Some("Mahalaxmi Xerox & Print Hub".to_string()),
                owner_name: Some("Ramesh Patel".to_string()),
                phone: Some("+91 98765 43210".to_string()),
            })
            .unwrap();

        assert_eq!(activated_state.status, LicenseStatus::Active);
        assert_eq!(activated_state.plan_type, LicensePlanType::WalletPages);
        assert_eq!(activated_state.wallet_pages_remaining, Some(5000));
        assert_eq!(activated_state.shop_name, "Mahalaxmi Xerox & Print Hub");

        // 5. Test SQLite tampering detection (manually altering pages_granted in DB)
        db.with_conn(|conn| {
            conn.execute("UPDATE app_licenses SET pages_granted = 999999 WHERE id = 1", [])
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            Ok(())
        })
        .unwrap();

        let tampered_state = mgr.get_license_state().unwrap();
        assert!(!tampered_state.is_valid);
        assert_eq!(tampered_state.status, LicenseStatus::Revoked);
        assert!(tampered_state.status_message.contains("signature verification failed"));
    }

    #[test]
    fn test_today_prints_counts_actual_pages_and_copies_not_file_rows() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();

        // Seed 3 orders matching the user's exact scenario:
        // Order #8613: 2 files, 1 page each, 1 copy = 2 pages
        // Order #8200: 2 files, 1 page each, 2 copies = 4 pages
        // Order #3633: 2 files, File 1 = 1 page x 3 copies (3), File 2 = 8 pages x 1 copy (8) = 11 pages
        // Total = 2 + 4 + 11 = 17 pages across 6 completed print_jobs rows
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO transfer_sessions (id, token, lan_ip, port, status, expires_at)
                 VALUES ('sess_1', 'tok_1', '127.0.0.1', 3580, 'ACTIVE', datetime('now', '+1 day'))",
                [],
            )?;

            let orders = [
                (
                    "ord_8613",
                    "8613",
                    vec![
                        ("f_8613_1", "fr_8613_1", 1u32, 1u32),
                        ("f_8613_2", "fr_8613_2", 1u32, 1u32),
                    ],
                ),
                (
                    "ord_8200",
                    "8200",
                    vec![
                        ("f_8200_1", "fr_8200_1", 1u32, 2u32),
                        ("f_8200_2", "fr_8200_2", 1u32, 2u32),
                    ],
                ),
                (
                    "ord_3633",
                    "3633",
                    vec![
                        ("f_3633_1", "fr_3633_1", 1u32, 3u32),
                        ("f_3633_2", "fr_3633_2", 8u32, 1u32),
                    ],
                ),
            ];

            for (ord_id, code, files) in orders {
                let rev_id = format!("rev_{}", ord_id);
                conn.execute(
                    "INSERT INTO orders (id, session_id, current_revision_number, status, pickup_code)
                     VALUES (?1, 'sess_1', 1, 'COMPLETED', ?2)",
                    params![ord_id, code],
                )?;
                conn.execute(
                    "INSERT INTO order_revisions (id, order_id, revision_number, total_files, total_bytes, is_approved)
                     VALUES (?1, ?2, 1, 2, 1024, 1)",
                    params![&rev_id, ord_id],
                )?;

                let mut billing_items = Vec::new();
                for (seq, (f_id, fr_id, eff_pages, copies)) in files.iter().enumerate() {
                    conn.execute(
                        "INSERT INTO files (id, order_id, original_filename, sanitized_filename, detected_mime_type, file_extension)
                         VALUES (?1, ?2, 'doc.pdf', 'doc.pdf', 'application/pdf', 'pdf')",
                        params![f_id, ord_id],
                    )?;
                    conn.execute(
                        "INSERT INTO file_revisions (id, file_id, order_revision_id, file_size_bytes, sha256_hash, storage_relative_path, is_deleted, transfer_status)
                         VALUES (?1, ?2, ?3, 512, 'hash', 'rel/doc.dat', 0, 'VERIFIED')",
                        params![fr_id, f_id, &rev_id],
                    )?;
                    conn.execute(
                        "INSERT INTO print_settings (id, file_revision_id, mode, paper_size, color_mode, duplex_mode, copies, orientation)
                         VALUES (?1, ?2, 'MANUAL', 'A4', 'BW', 'SIMPLEX', ?3, 'AUTO')",
                        params![format!("ps_{}", fr_id), fr_id, *copies as i64],
                    )?;
                    conn.execute(
                        "INSERT INTO print_jobs (id, order_id, order_revision_id, file_revision_id, printer_name, job_sequence_index, status, created_at, completed_at)
                         VALUES (?1, ?2, ?3, ?4, 'HP LaserJet 1020', ?5, 'COMPLETED', datetime('now'), datetime('now'))",
                        params![format!("pj_{}", fr_id), ord_id, &rev_id, fr_id, (seq + 1) as i64],
                    )?;

                    billing_items.push(crate::pricing::FileBillingDetailDto {
                        file_id: f_id.to_string(),
                        original_filename: "doc.pdf".to_string(),
                        is_excluded: false,
                        is_purged: false,
                        document_pages: *eff_pages,
                        effective_pages: *eff_pages,
                        copies: *copies,
                        paper_size: "A4".to_string(),
                        color_mode: "BW".to_string(),
                        duplex_mode: "SIMPLEX".to_string(),
                        total_sheets: *eff_pages * *copies,
                        duplex_sheets: 0,
                        simplex_sheets: *eff_pages * *copies,
                        unit_rate_description: "₹3/p".to_string(),
                        subtotal: (*eff_pages * *copies * 3) as f64,
                    });
                }

                let billing_json = serde_json::to_string(&billing_items).unwrap();
                conn.execute(
                    "INSERT INTO order_billings (id, order_id, customer_type, subtotal, total_amount, currency, payment_status, billing_details_json)
                     VALUES (?1, ?2, 'WALK_IN', 10.0, 10.0, '₹', 'UNPAID', ?3)",
                    params![format!("ob_{}", ord_id), ord_id, billing_json],
                )?;
            }
            Ok(())
        })
        .unwrap();

        let state = mgr.get_license_state().unwrap();
        assert_eq!(state.today_prints, 17);
        assert_eq!(state.lifetime_prints, 17);
        assert_eq!(state.wallet_pages_remaining, Some(300 - 17));

        // Second call must be idempotent (no double-deduction)
        let state2 = mgr.get_license_state().unwrap();
        assert_eq!(state2.today_prints, 17);
        assert_eq!(state2.lifetime_prints, 17);
        assert_eq!(state2.wallet_pages_remaining, Some(283));
    }

    #[test]
    fn test_license_payment_history_persistence_and_retrieval() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();
        let hwid = mgr.get_hwid();

        let payment1 = LicensePaymentRecord {
            id: "pay_test_001".to_string(),
            hwid: hwid.to_string(),
            plan_code: "WALLET_5000".to_string(),
            plan_name: "Pay-As-You-Go Commercial Pack (5,000 Pgs)".to_string(),
            amount_paid: 749.0,
            pages_granted: Some(5000),
            duration_days: None,
            payment_mode: "RAZORPAY_CHECKOUT".to_string(),
            payment_reference: "pay_sample_123456".to_string(),
            invoice_number: "PD-INV-2026-0042".to_string(),
            status: "VERIFIED_PAID".to_string(),
            created_at: "2026-11-14T10:00:00Z".to_string(),
        };

        mgr.record_payment(payment1.clone()).unwrap();

        let payment2 = LicensePaymentRecord {
            id: "pay_test_002".to_string(),
            hwid: hwid.to_string(),
            plan_code: "SUB_MONTHLY".to_string(),
            plan_name: "1 Month Unlimited Plan".to_string(),
            amount_paid: 299.0,
            pages_granted: None,
            duration_days: Some(30),
            payment_mode: "BHARAT_QR".to_string(),
            payment_reference: "UTR987654321".to_string(),
            invoice_number: "PD-INV-2026-0043".to_string(),
            status: "VERIFIED_PAID".to_string(),
            created_at: "2026-11-14T11:00:00Z".to_string(),
        };

        mgr.record_payment(payment2.clone()).unwrap();

        let history = mgr.get_payment_history().unwrap();
        assert_eq!(history.len(), 2);
        // Sorted desc by created_at: payment2 first
        assert_eq!(history[0].id, "pay_test_002");
        assert_eq!(history[0].amount_paid, 299.0);
        assert_eq!(history[1].id, "pay_test_001");
        assert_eq!(history[1].amount_paid, 749.0);
    }

    #[test]
    fn test_subscription_48_hour_grace_period() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();
        let hwid = mgr.get_hwid();

        // 1. Set up an expired monthly subscription that expired 12 hours ago (within 48h grace)
        let now = Utc::now();
        let expired_12h_ago = now - chrono::Duration::hours(12);
        let issued_at = now - chrono::Duration::days(30);

        let canonical = crate::licensing::crypto::format_canonical_license_string(
            &hwid,
            &LicensePlanType::SubMonthly,
            None,
            &issued_at.to_rfc3339(),
            Some(&expired_12h_ago.to_rfc3339()),
        );
        let sig = crate::licensing::crypto::sign_license_data(&canonical);

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET 
                    plan_type = 'SUB_MONTHLY',
                    shop_name = 'Grace Test Shop',
                    issued_at = ?1,
                    expires_at = ?2,
                    signature = ?3,
                    pages_granted = NULL,
                    pages_used = 0
                 WHERE id = 1",
                params![issued_at.to_rfc3339(), expired_12h_ago.to_rfc3339(), sig],
            )?;
            Ok(())
        }).unwrap();

        let state = mgr.get_license_state().unwrap();
        assert!(state.is_valid, "Printing must remain authorized during 48-hour grace");
        assert!(state.is_license_grace_active, "Grace period flag must be true");
        assert_eq!(state.license_grace_hours_remaining, Some(36));

        // 2. Set expiry to 50 hours ago (beyond 48h grace)
        let expired_50h_ago = now - chrono::Duration::hours(50);
        let canonical2 = crate::licensing::crypto::format_canonical_license_string(
            &hwid,
            &LicensePlanType::SubMonthly,
            None,
            &issued_at.to_rfc3339(),
            Some(&expired_50h_ago.to_rfc3339()),
        );
        let sig2 = crate::licensing::crypto::sign_license_data(&canonical2);

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET 
                    expires_at = ?1,
                    signature = ?2
                 WHERE id = 1",
                params![expired_50h_ago.to_rfc3339(), sig2],
            )?;
            Ok(())
        }).unwrap();

        let state_locked = mgr.get_license_state().unwrap();
        assert!(!state_locked.is_valid, "License must be locked out after 48-hour grace");
        assert!(!state_locked.is_license_grace_active, "Grace period must be false after 48 hours");
        assert_eq!(state_locked.status, LicenseStatus::Expired);
    }

    #[test]
    fn test_wallet_pages_50_print_grace_buffer() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();
        let hwid = mgr.get_hwid();

        let now = Utc::now();
        let canonical = crate::licensing::crypto::format_canonical_license_string(
            &hwid,
            &LicensePlanType::WalletPages,
            Some(100),
            &now.to_rfc3339(),
            None,
        );
        let sig = crate::licensing::crypto::sign_license_data(&canonical);

        // 1. Used exactly 120 pages (100 granted exhausted + 20 grace used => 30 grace remaining)
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET 
                    plan_type = 'WALLET_PAGES',
                    shop_name = 'Wallet Grace Shop',
                    issued_at = ?1,
                    expires_at = NULL,
                    signature = ?2,
                    pages_granted = 100,
                    pages_used = 120
                 WHERE id = 1",
                params![now.to_rfc3339(), sig],
            )?;
            Ok(())
        }).unwrap();

        let state = mgr.get_license_state().unwrap();
        assert!(state.is_valid, "Printing must remain authorized within 50 grace prints");
        assert!(state.is_license_grace_active, "Grace active flag must be true");
        assert_eq!(state.license_grace_prints_remaining, Some(30));
        assert_eq!(state.wallet_pages_remaining, Some(0));

        // 2. Used 151 pages (beyond the 50 grace buffer) => hard lock!
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET pages_used = 151 WHERE id = 1",
                [],
            )?;
            Ok(())
        }).unwrap();

        let state_locked = mgr.get_license_state().unwrap();
        assert!(!state_locked.is_valid, "Printing must lock out after exhausting 50 grace prints");
        assert!(!state_locked.is_license_grace_active);
        assert_eq!(state_locked.status, LicenseStatus::Expired);
    }

    #[test]
    fn test_trial_locks_immediately_without_grace() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();
        let hwid = mgr.get_hwid();

        // Expired 5 hours ago
        let now = Utc::now();
        let expired_5h_ago = now - chrono::Duration::hours(5);
        let issued_at = now - chrono::Duration::days(15);

        let canonical = crate::licensing::crypto::format_canonical_license_string(
            &hwid,
            &LicensePlanType::Trial,
            Some(300),
            &issued_at.to_rfc3339(),
            Some(&expired_5h_ago.to_rfc3339()),
        );
        let sig = crate::licensing::crypto::sign_license_data(&canonical);

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET 
                    plan_type = 'TRIAL',
                    shop_name = 'Trial Shop (Trial Mode)',
                    issued_at = ?1,
                    expires_at = ?2,
                    signature = ?3,
                    pages_granted = 300,
                    pages_used = 100
                 WHERE id = 1",
                params![issued_at.to_rfc3339(), expired_5h_ago.to_rfc3339(), sig],
            )?;
            Ok(())
        }).unwrap();

        let state = mgr.get_license_state().unwrap();
        assert!(!state.is_valid, "Trial must lock immediately on expiry without grace");
        assert!(!state.is_license_grace_active, "Trial must never activate grace period");
        assert_eq!(state.status, LicenseStatus::TrialExpired);
    }

    #[test]
    fn test_trial_calendar_day_midnight_boundary() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();
        let hwid = mgr.get_hwid();

        let today_local = Local::now().date_naive();
        let issued_at = (Utc::now() - chrono::Duration::days(13)).to_rfc3339();

        // 1. Expires tomorrow (e.g., tomorrow 00:00:00 local, which may be < 24h from now) => 1 day left, TrialActive!
        let tomorrow_local = today_local + chrono::Duration::days(1);
        let tomorrow_midnight = tomorrow_local
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(Local)
            .unwrap()
            .with_timezone(&Utc)
            .to_rfc3339();
        let canonical_1d = crate::licensing::crypto::format_canonical_license_string(
            &hwid,
            &LicensePlanType::Trial,
            Some(300),
            &issued_at,
            Some(&tomorrow_midnight),
        );
        let sig_1d = crate::licensing::crypto::sign_license_data(&canonical_1d);

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET plan_type = 'TRIAL', issued_at = ?1, expires_at = ?2, signature = ?3, pages_granted = 300, pages_used = 0 WHERE id = 1",
                params![issued_at, tomorrow_midnight, sig_1d],
            )?;
            Ok(())
        }).unwrap();

        let state_1d = mgr.get_license_state().unwrap();
        assert_eq!(state_1d.days_remaining, 1);
        assert!(state_1d.is_valid, "Trial expiring tomorrow must remain active today until midnight");
        assert_eq!(state_1d.status, LicenseStatus::TrialActive);

        // 2. Expires today (even at 23:59:59 local) => 0 days left, TrialExpired at midnight!
        let today_end = today_local
            .and_hms_opt(23, 59, 59)
            .unwrap()
            .and_local_timezone(Local)
            .unwrap()
            .with_timezone(&Utc)
            .to_rfc3339();
        let canonical_0d = crate::licensing::crypto::format_canonical_license_string(
            &hwid,
            &LicensePlanType::Trial,
            Some(300),
            &issued_at,
            Some(&today_end),
        );
        let sig_0d = crate::licensing::crypto::sign_license_data(&canonical_0d);

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE app_licenses SET expires_at = ?1, signature = ?2 WHERE id = 1",
                params![today_end, sig_0d],
            )?;
            Ok(())
        }).unwrap();

        let state_0d = mgr.get_license_state().unwrap();
        assert_eq!(state_0d.days_remaining, 0);
        assert!(!state_0d.is_valid, "Trial whose expiry date is today must be expired");
        assert_eq!(state_0d.status, LicenseStatus::TrialExpired);
    }

    #[test]
    fn test_payment_daily_usage_calculation() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = LicenseManager::new(db.clone()).unwrap();
        let hwid = mgr.get_hwid();

        // 1. Record a payment for 1,355 pages on 2026-11-15 10:00:00
        let payment = LicensePaymentRecord {
            id: "pay_test_usage_01".to_string(),
            hwid: hwid.to_string(),
            plan_code: "WALLET_1355".to_string(),
            plan_name: "Pay-As-You-Go 1,355 Pages Pack".to_string(),
            amount_paid: 90.0,
            pages_granted: Some(1355),
            duration_days: None,
            payment_mode: "RAZORPAY_CHECKOUT".to_string(),
            payment_reference: "pay_ref_999".to_string(),
            invoice_number: "INV-999".to_string(),
            status: "VERIFIED_PAID".to_string(),
            created_at: "2026-11-15 10:00:00".to_string(),
        };
        mgr.record_payment(payment).unwrap();

        // 2. Insert print jobs on 2026-11-15, 2026-11-16, and 2026-11-17
        db.with_conn(|conn| {
            conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
            // Day 1: 2026-11-15 (128 pages across 2 jobs)
            conn.execute(
                "INSERT INTO print_jobs (id, order_id, order_revision_id, file_revision_id, printer_name, job_sequence_index, status, pages_printed, completed_at, created_at)
                 VALUES ('pj_1', 'ord_1', 'rev_1', 'fr_1', 'Printer 1', 0, 'COMPLETED', 100, '2026-11-15 11:30:00', '2026-11-15 11:29:00')",
                [],
            )?;
            conn.execute(
                "INSERT INTO print_jobs (id, order_id, order_revision_id, file_revision_id, printer_name, job_sequence_index, status, pages_printed, completed_at, created_at)
                 VALUES ('pj_2', 'ord_2', 'rev_2', 'fr_2', 'Printer 1', 1, 'COMPLETED', 28, '2026-11-15 14:15:00', '2026-11-15 14:14:00')",
                [],
            )?;

            // Day 2: 2026-11-16 (210 pages)
            conn.execute(
                "INSERT INTO print_jobs (id, order_id, order_revision_id, file_revision_id, printer_name, job_sequence_index, status, pages_printed, completed_at, created_at)
                 VALUES ('pj_3', 'ord_3', 'rev_3', 'fr_3', 'Printer 1', 0, 'COMPLETED', 210, '2026-11-16 16:45:00', '2026-11-16 16:40:00')",
                [],
            )?;

            // Day 3: 2026-11-17 (142 pages)
            conn.execute(
                "INSERT INTO print_jobs (id, order_id, order_revision_id, file_revision_id, printer_name, job_sequence_index, status, pages_printed, completed_at, created_at)
                 VALUES ('pj_4', 'ord_4', 'rev_4', 'fr_4', 'Printer 1', 0, 'COMPLETED', 142, '2026-11-17 18:20:00', '2026-11-17 18:15:00')",
                [],
            )?;

            Ok(())
        }).unwrap();

        // 3. Query usage history
        let usage = mgr.get_payment_usage_history("pay_test_usage_01".to_string()).unwrap();

        assert_eq!(usage.total_quota_granted, Some(1355));
        assert_eq!(usage.total_pages_consumed, 128 + 210 + 142); // 480
        assert_eq!(usage.pages_remaining, Some(1355 - 480)); // 875
        assert_eq!(usage.daily_records.len(), 3);

        // Daily records should be newest first (2026-11-17 first)
        assert_eq!(usage.daily_records[0].date, "2026-11-17");
        assert_eq!(usage.daily_records[0].day_pages, 142);
        assert_eq!(usage.daily_records[0].cumulative_pages, 480);
        assert_eq!(usage.daily_records[0].quota_remaining_pages, Some(875));

        assert_eq!(usage.daily_records[1].date, "2026-11-16");
        assert_eq!(usage.daily_records[1].day_pages, 210);
        assert_eq!(usage.daily_records[1].cumulative_pages, 338); // 128 + 210
        assert_eq!(usage.daily_records[1].quota_remaining_pages, Some(1355 - 338));

        assert_eq!(usage.daily_records[2].date, "2026-11-15");
        assert_eq!(usage.daily_records[2].day_pages, 128);
        assert_eq!(usage.daily_records[2].cumulative_pages, 128);
        assert_eq!(usage.daily_records[2].quota_remaining_pages, Some(1355 - 128));
    }
}
