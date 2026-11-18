use crate::db::Database;
use base64::Engine;
use qrcode::render::svg;
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub token: String,
    pub lan_ip: String,
    pub port: u16,
    pub status: String,
    pub expires_at: String,
    pub access_url: String,
    pub qr_svg: String,
    pub qr_data_url: String,
    pub max_file_size_bytes: i64,
    pub max_order_size_bytes: i64,
}

pub struct SessionManager {
    db: Arc<Database>,
}

impl SessionManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn get_or_create_active(&self, lan_ip: &str, port: u16) -> Result<SessionInfo, Box<dyn std::error::Error>> {
        let existing = self.get_active_session()?;
        if let Some(session) = existing {
            // If the IP changed (user switched adapter), regenerate URL and QR
            if session.lan_ip != lan_ip {
                return self.switch_session_ip(lan_ip, port);
            }
            return Ok(session);
        }
        self.create_new_session(lan_ip, port, 720)
    }

    pub fn switch_session_ip(&self, new_ip: &str, port: u16) -> Result<SessionInfo, Box<dyn std::error::Error>> {
        let existing = self.get_active_session()?;
        if let Some(session) = existing {
            self.db.with_conn(|conn| {
                conn.execute(
                    "UPDATE transfer_sessions SET lan_ip = ?1, port = ?2 WHERE id = ?3",
                    (new_ip, port, &session.id),
                ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                Ok(())
            })?;

            let access_url = format!("http://{}:{}/?session={}", new_ip, port, session.token);
            let (qr_svg, qr_data_url) = generate_qr_svg(&access_url)?;

            return Ok(SessionInfo {
                id: session.id,
                token: session.token,
                lan_ip: new_ip.to_string(),
                port,
                status: session.status,
                expires_at: session.expires_at,
                access_url,
                qr_svg,
                qr_data_url,
                max_file_size_bytes: session.max_file_size_bytes,
                max_order_size_bytes: session.max_order_size_bytes,
            });
        }

        self.create_new_session(new_ip, port, 720)
    }

    pub fn get_active_session(&self) -> Result<Option<SessionInfo>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, token, lan_ip, port, status, expires_at, max_file_size_bytes, max_order_size_bytes 
                 FROM transfer_sessions 
                 WHERE status = 'ACTIVE' AND datetime('now') < expires_at 
                 ORDER BY created_at DESC LIMIT 1"
            ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            let mut rows = stmt.query([])
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            if let Some(row) = rows.next().map_err(|e| Box::new(e) as Box<dyn std::error::Error>)? {
                let id: String = row.get(0)?;
                let token: String = row.get(1)?;
                let lan_ip: String = row.get(2)?;
                let port: u16 = row.get(3)?;
                let status: String = row.get(4)?;
                let expires_at: String = row.get(5)?;
                let max_file_size_bytes: i64 = row.get(6)?;
                let max_order_size_bytes: i64 = row.get(7)?;

                let access_url = format!("http://{}:{}/?session={}", lan_ip, port, token);
                let (qr_svg, qr_data_url) = generate_qr_svg(&access_url)?;

                return Ok(Some(SessionInfo {
                    id,
                    token,
                    lan_ip,
                    port,
                    status,
                    expires_at,
                    access_url,
                    qr_svg,
                    qr_data_url,
                    max_file_size_bytes: max_file_size_bytes.max(104857600),
                    max_order_size_bytes: max_order_size_bytes.max(1073741824),
                }));
            }
            Ok(None)
        })
    }

    pub fn create_new_session(&self, lan_ip: &str, port: u16, duration_minutes: i64) -> Result<SessionInfo, Box<dyn std::error::Error>> {
        let session_id = Uuid::new_v4().to_string();
        let token = Uuid::new_v4().simple().to_string(); // Cryptographic 128-bit hex token

        self.db.with_conn(|conn| {
            // Revoke any previous active sessions
            conn.execute(
                "UPDATE transfer_sessions SET status = 'REVOKED' WHERE status = 'ACTIVE'",
                [],
            ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            // Insert new session with expiration
            conn.execute(
                "INSERT INTO transfer_sessions (id, token, lan_ip, port, status, expires_at, max_file_size_bytes, max_order_size_bytes, max_files_count) 
                 VALUES (?1, ?2, ?3, ?4, 'ACTIVE', datetime('now', ?5), 104857600, 1073741824, 999999)",
                (&session_id, &token, lan_ip, port, format!("+{} minutes", duration_minutes)),
            ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            Ok(())
        })?;

        let access_url = format!("http://{}:{}/?session={}", lan_ip, port, token);
        let (qr_svg, qr_data_url) = generate_qr_svg(&access_url)?;

        // Read back exact expiration timestamp
        let expires_at = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT expires_at FROM transfer_sessions WHERE id = ?1")
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            let exp: String = stmt.query_row([&session_id], |row| row.get(0))
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            Ok(exp)
        })?;

        Ok(SessionInfo {
            id: session_id,
            token,
            lan_ip: lan_ip.to_string(),
            port,
            status: "ACTIVE".to_string(),
            expires_at,
            access_url,
            qr_svg,
            qr_data_url,
            max_file_size_bytes: 104857600,
            max_order_size_bytes: 1073741824,
        })
    }

    pub fn verify_token(&self, token: &str) -> Result<Option<SessionInfo>, Box<dyn std::error::Error>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, token, lan_ip, port, status, expires_at, max_file_size_bytes, max_order_size_bytes 
                 FROM transfer_sessions 
                 WHERE token = ?1 AND status = 'ACTIVE' AND datetime('now') < expires_at"
            ).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            let mut rows = stmt.query([token])
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            if let Some(row) = rows.next().map_err(|e| Box::new(e) as Box<dyn std::error::Error>)? {
                let id: String = row.get(0)?;
                let token: String = row.get(1)?;
                let lan_ip: String = row.get(2)?;
                let port: u16 = row.get(3)?;
                let status: String = row.get(4)?;
                let expires_at: String = row.get(5)?;
                let max_file_size_bytes: i64 = row.get(6)?;
                let max_order_size_bytes: i64 = row.get(7)?;

                let access_url = format!("http://{}:{}/?session={}", lan_ip, port, token);

                return Ok(Some(SessionInfo {
                    id,
                    token,
                    lan_ip,
                    port,
                    status,
                    expires_at,
                    access_url,
                    qr_svg: String::new(),
                    qr_data_url: String::new(),
                    max_file_size_bytes: max_file_size_bytes.max(104857600),
                    max_order_size_bytes: max_order_size_bytes.max(1073741824),
                }));
            }
            Ok(None)
        })
    }
}

pub fn generate_qr_svg(url: &str) -> Result<(String, String), Box<dyn std::error::Error>> {
    let code = QrCode::new(url.as_bytes())?;
    let mut image = code.render::<svg::Color>()
        .min_dimensions(260, 260)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build();

    if let Some(pos) = image.find("<svg") {
        image = image[pos..].to_string();
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&image);
    let data_url = format!("data:image/svg+xml;base64,{}", b64);

    Ok((image, data_url))
}

pub fn generate_qr_png_bytes(url: &str, scale: u32) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let code = QrCode::new(url.as_bytes())?;
    let width = code.width();
    let border = 2;
    let total_width = width + border * 2;
    let img_dim = (total_width as u32) * scale;
    let mut img = image::RgbaImage::new(img_dim, img_dim);

    for pixel in img.pixels_mut() {
        *pixel = image::Rgba([255, 255, 255, 255]);
    }

    let colors = code.into_colors();
    for y in 0..width {
        for x in 0..width {
            if colors[y * width + x] == qrcode::Color::Dark {
                let px_start = ((x + border) as u32) * scale;
                let py_start = ((y + border) as u32) * scale;
                for dy in 0..scale {
                    for dx in 0..scale {
                        img.put_pixel(px_start + dx, py_start + dy, image::Rgba([0, 0, 0, 255]));
                    }
                }
            }
        }
    }

    let mut buffer = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buffer, image::ImageFormat::Png)?;
    Ok(buffer.into_inner())
}

pub fn generate_qr_png_data_url(url: &str, scale: u32) -> Result<String, Box<dyn std::error::Error>> {
    let bytes = generate_qr_png_bytes(url, scale)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_qr_generation() {
        let (svg, data_url) = generate_qr_svg("http://192.168.1.10:8080/?session=test").expect("Failed to generate QR");
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("</svg>"));
        assert!(data_url.starts_with("data:image/svg+xml;base64,"));
    }

    #[test]
    fn test_session_lifecycle_and_verification() {
        let db = Arc::new(Database::new_in_memory().unwrap());
        let mgr = SessionManager::new(db);

        // 1. Create session
        let session = mgr.create_new_session("192.168.1.100", 8080, 30).expect("Failed to create session");
        assert_eq!(session.status, "ACTIVE");
        assert_eq!(session.lan_ip, "192.168.1.100");
        assert!(session.qr_svg.starts_with("<svg"));
        assert!(session.qr_data_url.starts_with("data:image/svg+xml;base64,"));

        // 2. Verify with valid token
        let verified = mgr.verify_token(&session.token).expect("Verification failed");
        assert!(verified.is_some());
        assert_eq!(verified.unwrap().id, session.id);

        // 3. Verify with invalid token
        let invalid = mgr.verify_token("non-existent-token").expect("Verification failed");
        assert!(invalid.is_none());

        // 4. Create new session -> previous should be revoked
        let session2 = mgr.create_new_session("192.168.1.100", 8080, 30).expect("Failed to create second session");
        let old_verified = mgr.verify_token(&session.token).expect("Verification failed");
        assert!(old_verified.is_none()); // Revoked!

        let new_verified = mgr.verify_token(&session2.token).expect("Verification failed");
        assert!(new_verified.is_some());
    }
}
