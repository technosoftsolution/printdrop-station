use hmac::{Hmac, Mac};
use sha2::Sha256;
use super::models::{LicensePayload, LicensePlanType};

type HmacSha256 = Hmac<Sha256>;

// Master root signing secret for cryptographic validation of license tokens
pub const MASTER_SIGNING_SECRET: &[u8] = b"PRINTDROP_LICENSING_AUTHORITY_SECURE_HMAC_ROOT_KEY_2026_PROD";

/// Formulates a canonical string for cryptographic signing from license attributes
pub fn format_canonical_license_string(
    hwid: &str,
    plan_type: &LicensePlanType,
    pages_granted: Option<u64>,
    issued_at: &str,
    expires_at: Option<&str>,
) -> String {
    let pages_str = pages_granted.map(|p| p.to_string()).unwrap_or_else(|| "UNLIMITED".to_string());
    let exp_str = expires_at.unwrap_or("NONE");
    format!(
        "HWID={}|PLAN={:?}|PAGES={}|ISSUED={}|EXPIRES={}",
        hwid.trim().to_uppercase(),
        plan_type,
        pages_str,
        issued_at.trim(),
        exp_str.trim()
    )
}

/// Generates an HMAC-SHA256 cryptographic signature for a license payload
pub fn sign_license_data(canonical_str: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(MASTER_SIGNING_SECRET)
        .expect("HMAC supports keys of any length");
    mac.update(canonical_str.as_bytes());
    let result = mac.finalize();
    hex::encode(result.into_bytes()).to_uppercase()
}

/// Verifies that the cryptographic signature of a license payload matches its contents
pub fn verify_license_signature(payload: &LicensePayload) -> bool {
    let plan_str_upper = match payload.plan_type {
        LicensePlanType::Trial => "TRIAL",
        LicensePlanType::WalletPages => "WALLET_PAGES",
        LicensePlanType::SubMonthly => "SUB_MONTHLY",
        LicensePlanType::SubQuarterly => "SUB_QUARTERLY",
        LicensePlanType::SubHalfYearly => "SUB_HALF_YEARLY",
        LicensePlanType::SubAnnual => "SUB_ANNUAL",
    };
    let plan_str_debug = format!("{:?}", payload.plan_type);

    let pages_str = payload
        .pages_granted
        .map(|p| p.to_string())
        .unwrap_or_else(|| "UNLIMITED".to_string());
    let raw_exp_str = payload.expires_at.as_deref().unwrap_or("NONE");

    // Build candidate representations for issued_at to tolerate DB timezone shifts (+00:00 vs +05:30 vs Z)
    let mut issued_candidates = vec![payload.issued_at.trim().to_string()];
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&payload.issued_at) {
        let utc_dt = dt.with_timezone(&chrono::Utc);
        issued_candidates.push(utc_dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        issued_candidates.push(utc_dt.to_rfc3339_opts(chrono::SecondsFormat::Micros, true));
        issued_candidates.push(utc_dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        issued_candidates.push(utc_dt.to_rfc3339());
        issued_candidates.push(utc_dt.format("%Y-%m-%dT%H:%M:%S%.6f+00:00").to_string());
        issued_candidates.push(utc_dt.format("%Y-%m-%dT%H:%M:%S%.3f+00:00").to_string());
        issued_candidates.push(utc_dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
    }

    // Build candidate representations for expires_at
    let mut exp_candidates = vec![raw_exp_str.trim().to_string()];
    if let Some(ref exp) = payload.expires_at {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(exp) {
            let utc_dt = dt.with_timezone(&chrono::Utc);
            exp_candidates.push(utc_dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
            exp_candidates.push(utc_dt.to_rfc3339_opts(chrono::SecondsFormat::Micros, true));
            exp_candidates.push(utc_dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
            exp_candidates.push(utc_dt.to_rfc3339());
            exp_candidates.push(utc_dt.format("%Y-%m-%dT%H:%M:%S%.6f+00:00").to_string());
            exp_candidates.push(utc_dt.format("%Y-%m-%dT%H:%M:%S%.3f+00:00").to_string());
            exp_candidates.push(utc_dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
        }
    }

    let plan_candidates = [plan_str_upper, &plan_str_debug];

    for p in &plan_candidates {
        for iss in &issued_candidates {
            for exp in &exp_candidates {
                let canonical = format!(
                    "HWID={}|PLAN={}|PAGES={}|ISSUED={}|EXPIRES={}",
                    payload.hwid.trim().to_uppercase(),
                    p,
                    pages_str,
                    iss,
                    exp
                );
                let expected_sig = sign_license_data(&canonical);
                if payload.signature.trim().eq_ignore_ascii_case(&expected_sig) {
                    return true;
                }
            }
        }
    }

    false
}

/// Default free trial duration (1 month = 30 days) and test pages
pub const DEFAULT_TRIAL_DAYS: i64 = 30;
pub const DEFAULT_TRIAL_PAGES: u64 = 300;

/// Creates a cryptographically signed trial license with dynamic duration & pages
pub fn create_signed_trial_license_with_policy(hwid: &str, trial_days: i64, trial_pages: u64) -> LicensePayload {
    let safe_days = trial_days.clamp(1, 365);
    let safe_pages = trial_pages.clamp(10, 100_000);
    let now = chrono::Utc::now();
    let issued_at = now.to_rfc3339();
    let expires_at = (now + chrono::Duration::days(safe_days)).to_rfc3339();

    let canonical = format_canonical_license_string(
        hwid,
        &LicensePlanType::Trial,
        Some(safe_pages),
        &issued_at,
        Some(&expires_at),
    );

    let signature = sign_license_data(&canonical);

    LicensePayload {
        hwid: hwid.to_string(),
        shop_name: "PrintDrop Retail Station".to_string(),
        owner_name: None,
        city: None,
        phone: None,
        plan_type: LicensePlanType::Trial,
        pages_granted: Some(safe_pages),
        issued_at,
        expires_at: Some(expires_at),
        signature,
        plan_name: None,
        amount_paid: None,
        payment_mode: None,
        payment_reference: None,
        invoice_number: None,
    }
}

/// Creates a cryptographically signed trial license for the current machine (default 30 days / 1 month)
pub fn create_signed_trial_license(hwid: &str) -> LicensePayload {
    create_signed_trial_license_with_policy(hwid, DEFAULT_TRIAL_DAYS, DEFAULT_TRIAL_PAGES)
}

/// Decodes an activation key into a LicensePayload and validates its cryptographic signature
pub fn parse_and_verify_activation_key(key: &str, current_hwid: &str) -> Result<LicensePayload, String> {
    let clean = key.trim();
    if clean.is_empty() {
        return Err("Activation key cannot be empty".to_string());
    }

    // Try decoding base64
    let json_bytes = base64::Engine::decode(&base64::prelude::BASE64_STANDARD, clean)
        .or_else(|_| base64::Engine::decode(&base64::prelude::BASE64_URL_SAFE_NO_PAD, clean))
        .map_err(|_| "Invalid activation key format (must be valid license key)".to_string())?;

    let payload: LicensePayload = serde_json::from_slice(&json_bytes)
        .map_err(|_| "Malformed license token structure".to_string())?;

    // 1. Verify cryptographic signature
    if !verify_license_signature(&payload) {
        return Err("License signature verification failed: Corrupted or forged key".to_string());
    }

    // 2. Verify hardware bound machine ID
    if !payload.hwid.trim().eq_ignore_ascii_case(current_hwid.trim()) {
        return Err(format!(
            "Hardware mismatch: This key was issued for machine {}, not this PC ({})",
            payload.hwid, current_hwid
        ));
    }

    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_verification_and_tamper_detection() {
        let hwid = "PD-1234-5678-90AB-CDEF";
        let trial = create_signed_trial_license(hwid);

        // Verification should succeed on authentic payload
        assert!(verify_license_signature(&trial));

        // Tampering with HWID must fail
        let mut tampered_hwid = trial.clone();
        tampered_hwid.hwid = "PD-9999-9999-9999-9999".to_string();
        assert!(!verify_license_signature(&tampered_hwid));

        // Tampering with plan type must fail
        let mut tampered_plan = trial.clone();
        tampered_plan.plan_type = LicensePlanType::SubAnnual;
        assert!(!verify_license_signature(&tampered_plan));

        // Tampering with pages granted must fail
        let mut tampered_pages = trial.clone();
        tampered_pages.pages_granted = Some(999999);
        assert!(!verify_license_signature(&tampered_pages));
    }

    #[test]
    fn test_activation_key_encode_decode_roundtrip() {
        let hwid = "PD-AAAA-BBBB-CCCC-DDDD";
        let trial = create_signed_trial_license(hwid);

        let json_str = serde_json::to_string(&trial).unwrap();
        let key = base64::Engine::encode(&base64::prelude::BASE64_STANDARD, json_str.as_bytes());

        // Parse with correct HWID
        let verified = parse_and_verify_activation_key(&key, hwid).expect("Should parse");
        assert_eq!(verified.hwid, hwid);
        assert_eq!(verified.plan_type, LicensePlanType::Trial);

        // Parse with foreign HWID must fail
        let mismatch = parse_and_verify_activation_key(&key, "PD-DIFFERENT-HOST");
        assert!(mismatch.is_err());
        assert!(mismatch.unwrap_err().contains("Hardware mismatch"));
    }

    #[test]
    fn test_supabase_tz_shifted_js_iso_signature() {
        // Admin Portal signs using JS Date.toISOString() (e.g. .630Z),
        // then Supabase TIMESTAMPTZ returns +05:30 with trailing zero stripped (.63+05:30).
        let canonical = "HWID=PD-2EF1-E08B-255C-D6F4|PLAN=SUB_MONTHLY|PAGES=1355|ISSUED=2026-11-18T07:46:35.630Z|EXPIRES=2026-12-18T07:46:35.630Z";
        let sig = sign_license_data(canonical);
        let payload = LicensePayload {
            hwid: "PD-2EF1-E08B-255C-D6F4".to_string(),
            shop_name: "PrintDrop Retail Station".to_string(),
            owner_name: None,
            city: None,
            phone: None,
            plan_type: LicensePlanType::SubMonthly,
            pages_granted: Some(1355),
            issued_at: "2026-11-18T13:16:35.63+05:30".to_string(),
            expires_at: Some("2026-12-18T13:16:35.63+05:30".to_string()),
            signature: sig,
            plan_name: None,
            amount_paid: None,
            payment_mode: None,
            payment_reference: None,
            invoice_number: None,
        };
        assert!(verify_license_signature(&payload));
    }
}
