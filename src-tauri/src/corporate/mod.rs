use std::sync::Arc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use tracing::info;
use crate::db::Database;
use crate::server::session::generate_qr_svg;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorporateClientDto {
    pub id: String,
    pub name: String,
    pub static_token: String,
    pub billing_account: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub registered_devices_count: u32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorporateDeviceDto {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub device_fingerprint: String,
    pub person_name: String,
    pub device_type: String, // "mobile" | "desktop"
    pub auth_token: String,
    pub is_revoked: bool,
    pub last_seen_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorporateQrDto {
    pub client_id: String,
    pub client_name: String,
    pub static_token: String,
    pub access_url: String,
    pub qr_svg: String,
    pub qr_data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyPinResultDto {
    pub success: bool,
    pub client_id: String,
    pub client_name: String,
    pub auth_token: String,
    pub person_name: String,
    pub device_type: String,
}

pub struct CorporateManager {
    db: Arc<Database>,
}

fn hash_pin(pin: &str) -> String {
    let salt = "printdrop_corporate_pin_salt_v1";
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}", salt, pin.trim()).as_bytes());
    hex::encode(hasher.finalize())
}

fn generate_static_token(name: &str) -> String {
    let clean_name: String = name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect();
    let prefix = if clean_name.is_empty() { "corp".to_string() } else { clean_name };
    let uuid_suffix = Uuid::new_v4().to_string().replace('-', "")[..8].to_string();
    format!("corp_{}_{}", prefix, uuid_suffix)
}

impl CorporateManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn create_client(
        &self,
        name: &str,
        pin: &str,
        billing_account: Option<&str>,
        notes: Option<&str>,
    ) -> Result<CorporateClientDto, Box<dyn std::error::Error>> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Corporate client name cannot be empty".into());
        }
        let trimmed_pin = pin.trim();
        if trimmed_pin.len() < 4 || trimmed_pin.len() > 12 {
            return Err("PIN must be between 4 and 12 characters".into());
        }

        let id = Uuid::new_v4().to_string();
        let static_token = generate_static_token(trimmed_name);
        let pin_hash = hash_pin(trimmed_pin);
        let billing = billing_account.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let client_notes = notes.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO corporate_clients (id, name, static_token, pin_hash, billing_account, notes, is_active)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                (
                    &id,
                    trimmed_name,
                    &static_token,
                    &pin_hash,
                    billing.as_deref(),
                    client_notes.as_deref(),
                ),
            )?;
            Ok(())
        })?;

        info!("Created new corporate client: '{}' ({})", trimmed_name, static_token);

        Ok(CorporateClientDto {
            id,
            name: trimmed_name.to_string(),
            static_token,
            billing_account: billing,
            notes: client_notes,
            is_active: true,
            registered_devices_count: 0,
            created_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    pub fn update_client(
        &self,
        client_id: &str,
        name: &str,
        pin: Option<&str>,
        billing_account: Option<&str>,
        notes: Option<&str>,
    ) -> Result<CorporateClientDto, Box<dyn std::error::Error>> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Corporate client name cannot be empty".into());
        }

        let trimmed_pin = pin.map(|p| p.trim()).filter(|p| !p.is_empty());
        if let Some(p) = trimmed_pin {
            if p.len() < 4 || p.len() > 12 {
                return Err("PIN must be between 4 and 12 characters".into());
            }
        }

        let billing = billing_account.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let client_notes = notes.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        self.db.with_conn(|conn| {
            if let Some(p) = trimmed_pin {
                let new_pin_hash = hash_pin(p);
                conn.execute(
                    "UPDATE corporate_clients 
                     SET name = ?1, pin_hash = ?2, billing_account = ?3, notes = ?4
                     WHERE id = ?5",
                    (
                        trimmed_name,
                        &new_pin_hash,
                        billing.as_deref(),
                        client_notes.as_deref(),
                        client_id.trim(),
                    ),
                )?;
                // Security: When Corporate PIN is updated, immediately purge all active device sessions
                // for this client so every employee device must re-authenticate with the new PIN.
                conn.execute(
                    "DELETE FROM corporate_devices WHERE client_id = ?1",
                    [client_id.trim()],
                )?;
                info!("Corporate PIN updated for '{}' ({}) - purged all active device sessions", trimmed_name, client_id);
            } else {
                conn.execute(
                    "UPDATE corporate_clients 
                     SET name = ?1, billing_account = ?2, notes = ?3
                     WHERE id = ?4",
                    (
                        trimmed_name,
                        billing.as_deref(),
                        client_notes.as_deref(),
                        client_id.trim(),
                    ),
                )?;
            }
            Ok(())
        })?;

        info!("Updated corporate client: '{}' ({})", trimmed_name, client_id);

        let clients = self.list_clients()?;
        clients
            .into_iter()
            .find(|c| c.id == client_id)
            .ok_or_else(|| "Corporate client not found".into())
    }

    pub fn list_clients(&self) -> Result<Vec<CorporateClientDto>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.name, c.static_token, c.billing_account, c.notes, c.is_active, c.created_at,
                        (SELECT COUNT(*) FROM corporate_devices cd WHERE cd.client_id = c.id AND cd.is_revoked = 0) AS devices_count
                 FROM corporate_clients c
                 ORDER BY c.created_at DESC"
            )?;

            let rows = stmt.query_map([], |row| {
                let is_active_int: i64 = row.get(5)?;
                let devices_count: i64 = row.get(7)?;
                Ok(CorporateClientDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    static_token: row.get(2)?,
                    billing_account: row.get(3)?,
                    notes: row.get(4)?,
                    is_active: is_active_int != 0,
                    created_at: row.get(6)?,
                    registered_devices_count: devices_count as u32,
                })
            })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            Ok(list)
        })
    }

    pub fn get_client_by_token(&self, static_token: &str) -> Result<Option<CorporateClientDto>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.name, c.static_token, c.billing_account, c.notes, c.is_active, c.created_at,
                        (SELECT COUNT(*) FROM corporate_devices cd WHERE cd.client_id = c.id AND cd.is_revoked = 0) AS devices_count
                 FROM corporate_clients c
                 WHERE c.static_token = ?1"
            )?;

            let mut rows = stmt.query([static_token.trim()])?;
            if let Some(row) = rows.next()? {
                let is_active_int: i64 = row.get(5)?;
                let devices_count: i64 = row.get(7)?;
                Ok(Some(CorporateClientDto {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    static_token: row.get(2)?,
                    billing_account: row.get(3)?,
                    notes: row.get(4)?,
                    is_active: is_active_int != 0,
                    created_at: row.get(6)?,
                    registered_devices_count: devices_count as u32,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn toggle_client_status(&self, client_id: &str, is_active: bool) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE corporate_clients SET is_active = ?1 WHERE id = ?2",
                (if is_active { 1 } else { 0 }, client_id),
            )?;
            Ok(())
        })
    }

    pub fn delete_client(&self, client_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            conn.execute("DELETE FROM corporate_clients WHERE id = ?1", [client_id])?;
            Ok(())
        })
    }

    pub fn verify_pin(
        &self,
        corp_token: &str,
        pin: &str,
        device_fingerprint: &str,
        person_name: &str,
        device_type: &str,
    ) -> Result<VerifyPinResultDto, Box<dyn std::error::Error>> {
        let (client_id, client_name, pin_hash, is_active) = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, pin_hash, is_active FROM corporate_clients WHERE static_token = ?1"
            )?;
            let mut rows = stmt.query([corp_token.trim()])?;
            if let Some(row) = rows.next()? {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let hash: String = row.get(2)?;
                let active: i64 = row.get(3)?;
                Ok((id, name, hash, active != 0))
            } else {
                Err(Box::<dyn std::error::Error>::from("Corporate account not found or invalid QR code"))
            }
        })?;

        if !is_active {
            return Err("This corporate print account has been paused by the shopkeeper".into());
        }

        let entered_hash = hash_pin(pin);
        if entered_hash != pin_hash {
            return Err("Invalid Corporate PIN. Please check with your office administrator".into());
        }

        let auth_token = format!("cdev_{}", Uuid::new_v4().to_string().replace('-', ""));
        let trimmed_person = if person_name.trim().is_empty() {
            "Authorized Staff".to_string()
        } else {
            person_name.trim().to_string()
        };
        let trimmed_type = if device_type.trim().is_empty() {
            "mobile"
        } else {
            device_type.trim()
        };

        // Upsert into corporate_devices with current authenticated_pin_hash
        self.db.with_conn(|conn| {
            let existing_id: Option<String> = conn.query_row(
                "SELECT id FROM corporate_devices WHERE client_id = ?1 AND device_fingerprint = ?2",
                (&client_id, device_fingerprint.trim()),
                |r| r.get(0)
            ).ok();

            if let Some(dev_id) = existing_id {
                conn.execute(
                    "UPDATE corporate_devices 
                     SET person_name = ?1, device_type = ?2, auth_token = ?3, authenticated_pin_hash = ?4, is_revoked = 0, last_seen_at = CURRENT_TIMESTAMP 
                     WHERE id = ?5",
                    (&trimmed_person, trimmed_type, &auth_token, &pin_hash, &dev_id),
                )?;
            } else {
                let new_dev_id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO corporate_devices 
                     (id, client_id, device_fingerprint, person_name, device_type, auth_token, authenticated_pin_hash, is_revoked)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                    (&new_dev_id, &client_id, device_fingerprint.trim(), &trimmed_person, trimmed_type, &auth_token, &pin_hash),
                )?;
            }
            Ok(())
        })?;

        info!("Device '{}' successfully authenticated for corporate client '{}'", trimmed_person, client_name);

        Ok(VerifyPinResultDto {
            success: true,
            client_id,
            client_name,
            auth_token,
            person_name: trimmed_person,
            device_type: trimmed_type.to_string(),
        })
    }

    pub fn validate_device_auth(
        &self,
        auth_token: &str,
        device_fingerprint: &str,
    ) -> Result<Option<(CorporateClientDto, CorporateDeviceDto)>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT cd.id, cd.client_id, c.name, cd.device_fingerprint, cd.person_name, 
                        cd.device_type, cd.auth_token, cd.is_revoked, cd.last_seen_at, cd.created_at,
                        c.static_token, c.billing_account, c.notes, c.is_active, c.created_at,
                        (SELECT COUNT(*) FROM corporate_devices d WHERE d.client_id = c.id AND d.is_revoked = 0) AS total_devices,
                        c.pin_hash, cd.authenticated_pin_hash
                 FROM corporate_devices cd
                 JOIN corporate_clients c ON cd.client_id = c.id
                 WHERE cd.auth_token = ?1"
            )?;

            let mut rows = stmt.query([auth_token.trim()])?;
            if let Some(row) = rows.next()? {
                let is_revoked: i64 = row.get(7)?;
                let is_client_active: i64 = row.get(13)?;

                if is_revoked != 0 || is_client_active == 0 {
                    return Ok(None);
                }

                // Cross-verification: verify current client PIN hash matches device's authenticated PIN hash
                let current_pin_hash: String = row.get(16)?;
                let auth_pin_hash: Option<String> = row.get(17)?;
                if let Some(ref saved_hash) = auth_pin_hash {
                    if saved_hash != &current_pin_hash {
                        info!("Device auth rejected: Corporate PIN has been changed on server side since device authenticated");
                        let dev_id: String = row.get(0)?;
                        let _ = conn.execute("UPDATE corporate_devices SET is_revoked = 1 WHERE id = ?1", [&dev_id]);
                        return Ok(None);
                    }
                } else {
                    info!("Device auth rejected: No authenticated_pin_hash recorded on legacy device record");
                    return Ok(None);
                }

                // If fingerprint provided, verify it matches
                let stored_fp: String = row.get(3)?;
                if !device_fingerprint.trim().is_empty() && stored_fp != device_fingerprint.trim() {
                    return Ok(None);
                }

                let dev_id: String = row.get(0)?;
                let _ = conn.execute(
                    "UPDATE corporate_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
                    [&dev_id],
                );

                let dev = CorporateDeviceDto {
                    id: dev_id,
                    client_id: row.get(1)?,
                    client_name: row.get(2)?,
                    device_fingerprint: stored_fp,
                    person_name: row.get(4)?,
                    device_type: row.get(5)?,
                    auth_token: row.get(6)?,
                    is_revoked: false,
                    last_seen_at: row.get(8)?,
                    created_at: row.get(9)?,
                };

                let client = CorporateClientDto {
                    id: dev.client_id.clone(),
                    name: dev.client_name.clone(),
                    static_token: row.get(10)?,
                    billing_account: row.get(11)?,
                    notes: row.get(12)?,
                    is_active: true,
                    created_at: row.get(14)?,
                    registered_devices_count: row.get::<_, i64>(15)? as u32,
                };

                Ok(Some((client, dev)))
            } else {
                Ok(None)
            }
        })
    }

    pub fn list_devices(&self, client_id: &str) -> Result<Vec<CorporateDeviceDto>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT cd.id, cd.client_id, c.name, cd.device_fingerprint, cd.person_name, 
                        cd.device_type, cd.auth_token, cd.is_revoked, cd.last_seen_at, cd.created_at
                 FROM corporate_devices cd
                 JOIN corporate_clients c ON cd.client_id = c.id
                 WHERE cd.client_id = ?1
                 ORDER BY cd.last_seen_at DESC"
            )?;

            let rows = stmt.query_map([client_id], |row| {
                let is_revoked: i64 = row.get(7)?;
                Ok(CorporateDeviceDto {
                    id: row.get(0)?,
                    client_id: row.get(1)?,
                    client_name: row.get(2)?,
                    device_fingerprint: row.get(3)?,
                    person_name: row.get(4)?,
                    device_type: row.get(5)?,
                    auth_token: row.get(6)?,
                    is_revoked: is_revoked != 0,
                    last_seen_at: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?;

            let mut list = Vec::new();
            for r in rows {
                list.push(r?);
            }
            Ok(list)
        })
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            conn.execute("UPDATE corporate_devices SET is_revoked = 1 WHERE id = ?1", [device_id])?;
            Ok(())
        })
    }

    pub fn restore_device(&self, device_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            conn.execute("UPDATE corporate_devices SET is_revoked = 0 WHERE id = ?1", [device_id])?;
            Ok(())
        })
    }

    pub fn delete_device(&self, device_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            conn.execute("DELETE FROM corporate_devices WHERE id = ?1", [device_id])?;
            Ok(())
        })
    }

    pub fn generate_corporate_qr(
        &self,
        client_id: &str,
        host_or_ip: &str,
        port: u16,
        is_https: bool,
    ) -> Result<CorporateQrDto, Box<dyn std::error::Error>> {
        let (client_name, static_token) = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT name, static_token FROM corporate_clients WHERE id = ?1")?;
            let mut rows = stmt.query([client_id])?;
            if let Some(row) = rows.next()? {
                let name: String = row.get(0)?;
                let token: String = row.get(1)?;
                Ok((name, token))
            } else {
                Err(Box::<dyn std::error::Error>::from("Corporate client not found"))
            }
        })?;

        let is_https = is_https || host_or_ip.starts_with("https://") || host_or_ip.contains("trycloudflare.com");
        let clean_host = host_or_ip
            .split('?')
            .next()
            .unwrap_or(host_or_ip)
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');

        let access_url = if is_https {
            format!("https://{}/?corp={}", clean_host, static_token)
        } else {
            format!("http://{}:{}/?corp={}", clean_host, port, static_token)
        };

        let (qr_svg, qr_data_url) = generate_qr_svg(&access_url)?;

        Ok(CorporateQrDto {
            client_id: client_id.to_string(),
            client_name,
            static_token,
            access_url,
            qr_svg,
            qr_data_url,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_corporate_lifecycle_and_verification() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = CorporateManager::new(db);

        // 1. Create client
        let client = mgr.create_client("Apex Law Firm", "4821", Some("ACCT-9001"), Some("Legal prints")).unwrap();
        assert_eq!(client.name, "Apex Law Firm");
        assert!(client.static_token.starts_with("corp_apex"));
        assert!(client.is_active);

        // 2. Attempt verify with wrong PIN -> fails
        let fail = mgr.verify_pin(&client.static_token, "0000", "fp_123", "Rajesh", "mobile");
        assert!(fail.is_err());

        // 3. Verify with correct PIN -> succeeds and registers device
        let ok = mgr.verify_pin(&client.static_token, "4821", "fp_123", "Rajesh", "mobile").unwrap();
        assert!(ok.success);
        assert!(!ok.auth_token.is_empty());

        // 4. Validate device auth
        let validated = mgr.validate_device_auth(&ok.auth_token, "fp_123").unwrap();
        assert!(validated.is_some());
        let (c, dev) = validated.unwrap();
        assert_eq!(c.id, client.id);
        assert_eq!(dev.person_name, "Rajesh");

        // 5. Revoke device
        mgr.revoke_device(&dev.id).unwrap();
        let revoked = mgr.validate_device_auth(&ok.auth_token, "fp_123").unwrap();
        assert!(revoked.is_none());

        // 6. Restore device
        mgr.restore_device(&dev.id).unwrap();
        let restored = mgr.validate_device_auth(&ok.auth_token, "fp_123").unwrap();
        assert!(restored.is_some());

        // 7. Toggle client inactive -> blocks all devices
        mgr.toggle_client_status(&client.id, false).unwrap();
        let blocked = mgr.validate_device_auth(&ok.auth_token, "fp_123").unwrap();
        assert!(blocked.is_none());
    }

    #[test]
    fn test_corporate_qr_generation() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = CorporateManager::new(db);

        let client = mgr.create_client("Studio Architects", "9912", None, None).unwrap();
        let qr = mgr.generate_corporate_qr(&client.id, "100.100.10.51", 8080, false).unwrap();
        assert!(qr.access_url.contains("100.100.10.51:8080/?corp="));
        assert!(qr.qr_svg.starts_with("<svg"));
        assert!(qr.qr_data_url.starts_with("data:image/svg+xml;base64,"));

        let tunnel_qr = mgr.generate_corporate_qr(&client.id, "https://rapid-words.trycloudflare.com", 8080, true).unwrap();
        assert_eq!(tunnel_qr.access_url, format!("https://rapid-words.trycloudflare.com/?corp={}", client.static_token));
    }

    #[test]
    fn test_corporate_update_name_and_pin() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = CorporateManager::new(db);

        let client = mgr.create_client("Beta Builders", "1111", None, None).unwrap();
        assert_eq!(client.name, "Beta Builders");

        // Old PIN works
        assert!(mgr.verify_pin(&client.static_token, "1111", "fp_1", "User A", "mobile").is_ok());

        // Update name and PIN to 2222
        let updated = mgr.update_client(&client.id, "Beta Infra Ltd", Some("2222"), Some("ACC-123"), Some("Renamed")).unwrap();
        assert_eq!(updated.name, "Beta Infra Ltd");
        assert_eq!(updated.billing_account.as_deref(), Some("ACC-123"));

        // Old PIN now fails
        assert!(mgr.verify_pin(&client.static_token, "1111", "fp_2", "User B", "mobile").is_err());
        // New PIN works
        assert!(mgr.verify_pin(&client.static_token, "2222", "fp_2", "User B", "mobile").is_ok());

        // Update without changing PIN
        let updated2 = mgr.update_client(&client.id, "Beta Infra Global", None, None, None).unwrap();
        assert_eq!(updated2.name, "Beta Infra Global");
        // PIN 2222 still works
        assert!(mgr.verify_pin(&client.static_token, "2222", "fp_3", "User C", "desktop").is_ok());
    }
}
