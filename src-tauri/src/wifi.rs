use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;
use crate::db::Database;
use crate::server::session::generate_qr_svg;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiInfo {
    pub ssid: String,
    pub password: Option<String>,
    pub auth_type: String,
    pub is_connected: bool,
    pub signal_quality: String,
    pub interface_name: String,
    pub is_hidden: bool,
    pub qr_svg: String,
    pub qr_data_url: String,
    pub qr_raw_payload: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedNetshInterface {
    pub name: String,
    pub state: String,
    pub ssid: String,
    pub auth: String,
    pub signal: String,
}

/// Escapes special characters for standard ZXing Wi-Fi QR code syntax:
/// Escaped characters: \ , ; , , , : , "
pub fn escape_wifi_string(val: &str) -> String {
    let mut res = String::new();
    for c in val.chars() {
        if matches!(c, '\\' | ';' | ',' | ':' | '"') {
            res.push('\\');
        }
        res.push(c);
    }
    res
}

/// Formulates standard Wi-Fi QR code payload string:
/// `WIFI:T:<WPA|WEP|nopass>;S:<SSID>;P:<password>;H:<true|false>;;`
pub fn build_wifi_qr_payload(
    ssid: &str,
    password: Option<&str>,
    auth: &str,
    is_hidden: bool,
) -> String {
    let clean_auth = if auth.to_uppercase().contains("WEP") {
        "WEP"
    } else if auth.to_uppercase().contains("WPA") {
        "WPA"
    } else if password.is_none() || password.unwrap_or("").trim().is_empty() {
        "nopass"
    } else {
        "WPA"
    };

    let escaped_ssid = escape_wifi_string(ssid);
    let mut payload = format!("WIFI:T:{};S:{};", clean_auth, escaped_ssid);

    if clean_auth != "nopass" {
        if let Some(pass) = password {
            if !pass.trim().is_empty() {
                payload.push_str(&format!("P:{};", escape_wifi_string(pass)));
            }
        }
    }

    if is_hidden {
        payload.push_str("H:true;");
    }

    payload.push(';');
    payload
}

/// Parses the output of `netsh wlan show interfaces`
pub fn parse_netsh_interfaces(output: &str) -> Option<ParsedNetshInterface> {
    let mut name = String::new();
    let mut state = String::new();
    let mut ssid = String::new();
    let mut auth = String::new();
    let mut signal = String::new();

    for line in output.lines() {
        let line = line.trim();
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let val = val.trim().to_string();

            if key == "name" && name.is_empty() {
                name = val;
            } else if key == "state" && state.is_empty() {
                state = val;
            } else if key == "ssid" && ssid.is_empty() {
                ssid = val;
            } else if key == "authentication" && auth.is_empty() {
                auth = val;
            } else if key == "signal" && signal.is_empty() {
                signal = val;
            }
        }
    }

    if !ssid.is_empty() || !state.is_empty() {
        Some(ParsedNetshInterface {
            name: if name.is_empty() { "Wi-Fi".to_string() } else { name },
            state,
            ssid,
            auth: if auth.is_empty() { "WPA2-Personal".to_string() } else { auth },
            signal: if signal.is_empty() { "100%".to_string() } else { signal },
        })
    } else {
        None
    }
}

/// Parses the clear-text password from `netsh wlan show profile name="<SSID>" key=clear`
pub fn parse_netsh_key_content(output: &str) -> Option<String> {
    for line in output.lines() {
        let line = line.trim();
        if let Some((key, val)) = line.split_once(':') {
            if key.trim().eq_ignore_ascii_case("Key Content") {
                let password = val.trim().to_string();
                if !password.is_empty() {
                    return Some(password);
                }
            }
        }
    }
    None
}

/// Queries Windows host via `netsh wlan show interfaces` with `CREATE_NO_WINDOW`
pub fn detect_system_wifi() -> Option<ParsedNetshInterface> {
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;

        let mut cmd = Command::new("netsh");
        cmd.args(["wlan", "show", "interfaces"]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return parse_netsh_interfaces(&stdout);
            }
        }
    }
    None
}

/// Queries Windows host via `netsh wlan show profile name="<SSID>" key=clear`
pub fn detect_wifi_key_content(ssid: &str) -> Option<String> {
    if ssid.trim().is_empty() {
        return None;
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;

        let mut cmd = Command::new("netsh");
        let profile_arg = format!("name=\"{}\"", ssid);
        cmd.args(["wlan", "show", "profile", &profile_arg, "key=clear"]);
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return parse_netsh_key_content(&stdout);
            }
        }
    }
    None
}

use std::sync::RwLock;
use std::time::Instant;

static CACHED_WIFI_INFO: RwLock<Option<(Instant, WifiInfo)>> = RwLock::new(None);

pub struct WifiManager {
    db: Arc<Database>,
}

impl WifiManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// Retrieves active Wi-Fi information, checking in-memory cache and SQLite `app_config` first
    /// before falling back to Windows host `netsh` detection.
    pub fn get_or_detect_wifi(&self) -> Result<WifiInfo, Box<dyn std::error::Error>> {
        // 1. Fast cache check (60-second TTL)
        if let Ok(guard) = CACHED_WIFI_INFO.read() {
            if let Some((ts, ref cached)) = *guard {
                if ts.elapsed().as_secs() < 60 {
                    return Ok(cached.clone());
                }
            }
        }

        // 2. Check SQLite DB for saved configuration first to avoid spawning netsh processes
        let saved_ssid = self.db.get_config("wifi_ssid")?.unwrap_or_default();
        let saved_pass = self.db.get_config("wifi_password")?;
        let saved_auth = self.db.get_config("wifi_auth_type")?.unwrap_or_else(|| "WPA2-Personal".to_string());
        let saved_hidden = self.db.get_config("wifi_hidden")?.map(|v| v == "1" || v == "true").unwrap_or(false);

        let (effective_ssid, effective_pass, effective_auth, is_connected, detected_signal, detected_name) = if !saved_ssid.is_empty() {
            // Already configured by shopkeeper - return immediately without blocking on netsh
            (
                saved_ssid,
                saved_pass.filter(|p| !p.trim().is_empty()),
                saved_auth,
                true,
                "100%".to_string(),
                "Wi-Fi".to_string(),
            )
        } else {
            // Auto-detect from system
            let system_wifi = detect_system_wifi();
            let is_conn = system_wifi
                .as_ref()
                .map(|w| w.state.eq_ignore_ascii_case("connected"))
                .unwrap_or(false);

            let d_ssid = system_wifi.as_ref().map(|w| w.ssid.clone()).unwrap_or_default();
            let d_auth = system_wifi.as_ref().map(|w| w.auth.clone()).unwrap_or_else(|| "WPA2-Personal".to_string());
            let d_signal = system_wifi.as_ref().map(|w| w.signal.clone()).unwrap_or_else(|| "0%".to_string());
            let d_name = system_wifi.as_ref().map(|w| w.name.clone()).unwrap_or_else(|| "Wi-Fi".to_string());

            let eff_ssid = if !d_ssid.is_empty() {
                d_ssid
            } else {
                "Shop_WiFi".to_string()
            };

            let eff_pass = if let Some(key) = detect_wifi_key_content(&eff_ssid) {
                let _ = self.db.set_config("wifi_ssid", &eff_ssid);
                let _ = self.db.set_config("wifi_password", &key);
                let _ = self.db.set_config("wifi_auth_type", &d_auth);
                Some(key)
            } else {
                None
            };

            (eff_ssid, eff_pass, d_auth, is_conn, d_signal, d_name)
        };

        let raw_payload = build_wifi_qr_payload(
            &effective_ssid,
            effective_pass.as_deref(),
            &effective_auth,
            saved_hidden,
        );

        let (qr_svg, qr_data_url) = generate_qr_svg(&raw_payload)?;

        let result = WifiInfo {
            ssid: effective_ssid,
            password: effective_pass,
            auth_type: effective_auth,
            is_connected,
            signal_quality: detected_signal,
            interface_name: detected_name,
            is_hidden: saved_hidden,
            qr_svg,
            qr_data_url,
            qr_raw_payload: raw_payload,
        };

        if let Ok(mut guard) = CACHED_WIFI_INFO.write() {
            *guard = Some((Instant::now(), result.clone()));
        }

        Ok(result)
    }

    /// Clears any manual overrides in `app_config` and re-detects directly from Windows host Wi-Fi interface.
    pub fn reset_wifi_to_system(&self) -> Result<WifiInfo, Box<dyn std::error::Error>> {
        if let Ok(mut guard) = CACHED_WIFI_INFO.write() {
            *guard = None;
        }
        self.db.with_conn(|conn| {
            conn.execute("DELETE FROM app_config WHERE key IN ('wifi_ssid', 'wifi_password', 'wifi_auth_type', 'wifi_hidden')", [])?;
            Ok(())
        })?;
        info!("Cleared custom Wi-Fi config, re-detecting from Windows system interface");
        self.get_or_detect_wifi()
    }

    /// Saves custom Wi-Fi configuration (SSID, password, auth type) into SQLite `app_config`
    /// and returns the newly generated Wi-Fi QR details.
    pub fn save_wifi_settings(
        &self,
        ssid: &str,
        password: &str,
        auth_type: &str,
        is_hidden: bool,
    ) -> Result<WifiInfo, Box<dyn std::error::Error>> {
        if let Ok(mut guard) = CACHED_WIFI_INFO.write() {
            *guard = None;
        }
        self.db.set_config("wifi_ssid", ssid)?;
        self.db.set_config("wifi_password", password)?;
        self.db.set_config("wifi_auth_type", auth_type)?;
        self.db.set_config("wifi_hidden", if is_hidden { "1" } else { "0" })?;

        info!("Updated Wi-Fi configuration in SQLite for SSID: {}", ssid);

        self.get_or_detect_wifi()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_wifi_string() {
        assert_eq!(escape_wifi_string("Simple123"), "Simple123");
        assert_eq!(escape_wifi_string("Pass;with:special,chars\\and\"quotes"), "Pass\\;with\\:special\\,chars\\\\and\\\"quotes");
    }

    #[test]
    fn test_build_wifi_qr_payload_wpa() {
        let payload = build_wifi_qr_payload("OHM5_", Some("N0Pa$$4Me@_"), "WPA2-Personal", false);
        assert_eq!(payload, "WIFI:T:WPA;S:OHM5_;P:N0Pa$$4Me@_;;");
    }

    #[test]
    fn test_build_wifi_qr_payload_nopass() {
        let payload = build_wifi_qr_payload("OpenNetwork", None, "Open", false);
        assert_eq!(payload, "WIFI:T:nopass;S:OpenNetwork;;");

        let payload_empty = build_wifi_qr_payload("OpenNetwork2", Some(""), "Open", false);
        assert_eq!(payload_empty, "WIFI:T:nopass;S:OpenNetwork2;;");
    }

    #[test]
    fn test_build_wifi_qr_payload_wep() {
        let payload = build_wifi_qr_payload("OldRouter", Some("1234567890"), "WEP", false);
        assert_eq!(payload, "WIFI:T:WEP;S:OldRouter;P:1234567890;;");
    }

    #[test]
    fn test_build_wifi_qr_payload_hidden() {
        let payload = build_wifi_qr_payload("SecretWiFi", Some("password"), "WPA", true);
        assert_eq!(payload, "WIFI:T:WPA;S:SecretWiFi;P:password;H:true;;");
    }

    #[test]
    fn test_parse_netsh_interfaces() {
        let sample = r#"
There is 1 interface on the system: 

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6E AX211 160MHz
    State                  : connected
    SSID                   : OHM5_
    Authentication         : WPA2-Personal
    Cipher                 : CCMP
    Signal                 : 82% 
"#;
        let parsed = parse_netsh_interfaces(sample).expect("Should parse interface");
        assert_eq!(parsed.name, "Wi-Fi");
        assert_eq!(parsed.state, "connected");
        assert_eq!(parsed.ssid, "OHM5_");
        assert_eq!(parsed.auth, "WPA2-Personal");
        assert_eq!(parsed.signal, "82%");
    }

    #[test]
    fn test_parse_netsh_key_content() {
        let sample = r#"
Profile OHM5_ on interface Wi-Fi: 
Security settings 
----------------- 
    Authentication         : WPA2-Personal
    Security key           : Present
    Key Content            : N0Pa$$4Me@_
"#;
        let key = parse_netsh_key_content(sample).expect("Should parse key content");
        assert_eq!(key, "N0Pa$$4Me@_");
    }

    #[test]
    fn test_wifi_db_integration() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = WifiManager::new(db.clone());

        let info = mgr.save_wifi_settings("TestPrintShop", "Secret1234", "WPA2-Personal", false).unwrap();
        assert_eq!(info.ssid, "TestPrintShop");
        assert_eq!(info.password, Some("Secret1234".to_string()));
        assert!(info.qr_raw_payload.contains("WIFI:T:WPA;S:TestPrintShop;P:Secret1234;;"));
        assert!(info.qr_data_url.starts_with("data:image/svg+xml;base64,"));
        assert!(info.qr_svg.starts_with("<svg"));
    }
}
