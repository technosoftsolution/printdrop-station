use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};
use crate::server::session::generate_qr_svg;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    pub is_active: bool,
    pub is_connecting: bool,
    pub url: Option<String>,
    pub qr_svg: Option<String>,
    pub qr_data_url: Option<String>,
    pub error: Option<String>,
    pub protocol: String,
}

impl Default for TunnelInfo {
    fn default() -> Self {
        Self {
            is_active: false,
            is_connecting: false,
            url: None,
            qr_svg: None,
            qr_data_url: None,
            error: None,
            protocol: "Cloudflare Quick Tunnel (TLS 1.3 / QUIC)".to_string(),
        }
    }
}

/// Rapidly checks whether the Windows PC has outbound Internet connectivity.
/// Uses a 1200ms timeout attempting TCP handshake to resilient public DNS and HTTPS endpoints (1.1.1.1, 8.8.8.8).
pub fn check_internet_reachability() -> bool {
    let endpoints: [SocketAddr; 4] = [
        SocketAddr::from(([1, 1, 1, 1], 53)),
        SocketAddr::from(([8, 8, 8, 8], 53)),
        SocketAddr::from(([1, 1, 1, 1], 443)),
        SocketAddr::from(([8, 8, 8, 8], 443)),
    ];

    for addr in &endpoints {
        if TcpStream::connect_timeout(addr, Duration::from_millis(1200)).is_ok() {
            return true;
        }
    }
    false
}

/// Locates cloudflared.exe binary on disk
pub fn locate_cloudflared_binary() -> Option<PathBuf> {
    // 1. Current working directory bin/cloudflared.exe
    let p1 = PathBuf::from("bin/cloudflared.exe");
    if p1.is_file() {
        return Some(p1);
    }

    // 2. src-tauri/bin/cloudflared.exe
    let p2 = PathBuf::from("src-tauri/bin/cloudflared.exe");
    if p2.is_file() {
        return Some(p2);
    }

    // 3. Alongside current executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let p3 = parent.join("cloudflared.exe");
            if p3.is_file() {
                return Some(p3);
            }
            let p4 = parent.join("bin").join("cloudflared.exe");
            if p4.is_file() {
                return Some(p4);
            }
        }
    }

    // 4. System standard paths
    let standard_paths = [
        r"C:\Program Files\cloudflared\cloudflared.exe",
        r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
    ];
    for path in &standard_paths {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }

    // 5. Check PATH via where.exe
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("where.exe");
        cmd.arg("cloudflared");
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let pb = PathBuf::from(first_line.trim());
                    if pb.is_file() {
                        return Some(pb);
                    }
                }
            }
        }
    }

    None
}

/// Extracts https://*.trycloudflare.com URL from cloudflared output line
pub fn extract_trycloudflare_url(line: &str) -> Option<String> {
    if let Some(idx) = line.find("https://") {
        let candidate = &line[idx..];
        // Find ending boundary (space, pipe, quote, or end of line)
        let end_idx = candidate
            .find(|c: char| c.is_whitespace() || c == '|' || c == '"' || c == '\'')
            .unwrap_or(candidate.len());
        let url = &candidate[..end_idx];
        if url.contains(".trycloudflare.com") {
            return Some(url.trim().to_string());
        }
    }
    None
}

pub struct TunnelManager {
    child_process: Arc<Mutex<Option<Child>>>,
    current_status: Arc<RwLock<TunnelInfo>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            child_process: Arc::new(Mutex::new(None)),
            current_status: Arc::new(RwLock::new(TunnelInfo::default())),
        }
    }

    /// Returns current tunnel information
    pub fn get_status(&self) -> TunnelInfo {
        self.current_status.read().unwrap().clone()
    }

    /// Dynamically updates the active tunnel's QR code and URL with a new session token
    pub fn update_session_token(&self, new_token: &str) -> Option<TunnelInfo> {
        let mut status_lock = self.current_status.write().unwrap();
        if !status_lock.is_active {
            return None;
        }
        if let Some(ref current_url) = status_lock.url {
            let base_url = current_url.split('?').next().unwrap_or(current_url).trim_end_matches('/');
            let updated_url = if new_token.trim().is_empty() {
                base_url.to_string()
            } else {
                format!("{}/?session={}", base_url, new_token.trim())
            };

            if let Ok((qr_svg, qr_data_url)) = generate_qr_svg(&updated_url) {
                status_lock.url = Some(updated_url);
                status_lock.qr_svg = Some(qr_svg);
                status_lock.qr_data_url = Some(qr_data_url);
                return Some(status_lock.clone());
            }
        }
        None
    }

    /// Stops any running tunnel process
    pub fn stop_tunnel(&self) -> Result<TunnelInfo, Box<dyn std::error::Error>> {
        let child_opt = {
            let mut lock = self.child_process.lock().unwrap();
            lock.take()
        };

        if let Some(mut child) = child_opt {
            let pid = child.id();
            info!("Stopping active Cloudflare public tunnel process (PID: {})...", pid);

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let mut kill_cmd = Command::new("taskkill");
                kill_cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                kill_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                let _ = kill_cmd.output();
            }

            let _ = child.kill();
            let _ = child.try_wait();
        }

        // On Windows, also clean up any orphaned cloudflared.exe process trees
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let mut clean_cmd = Command::new("taskkill");
            clean_cmd.args(["/F", "/IM", "cloudflared.exe"]);
            clean_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            let _ = clean_cmd.output();
        }

        let mut status_lock = self.current_status.write().unwrap();
        *status_lock = TunnelInfo::default();
        info!("Cloudflare public tunnel successfully stopped.");
        Ok(status_lock.clone())
    }

    /// Spawns cloudflared quick tunnel exposing http://127.0.0.1:<local_port>
    /// and waits for the public trycloudflare.com HTTPS URL.
    pub fn start_tunnel(
        &self,
        local_port: u16,
        session_token: Option<&str>,
    ) -> Result<TunnelInfo, Box<dyn std::error::Error>> {
        // Stop any existing process first
        let _ = self.stop_tunnel();

        // 1. Fast Internet Reachability Check: Prevent hanging for 20s if PC is in offline mode
        if !check_internet_reachability() {
            let err_msg = "App is in Offline Mode: No Internet connection detected on this Windows PC/Laptop. Please enable Internet (Wi-Fi or Ethernet) to activate 4G/5G remote uploads. (Local shop Wi-Fi remains fully operational).";
            warn!("{}", err_msg);
            let mut status_lock = self.current_status.write().unwrap();
            status_lock.is_connecting = false;
            status_lock.is_active = false;
            status_lock.error = Some(err_msg.to_string());
            return Err(err_msg.into());
        }

        let binary_path = locate_cloudflared_binary().ok_or_else(|| {
            "cloudflared.exe not found on disk. Ensure cloudflared.exe is in bin/ directory."
        })?;

        info!("Starting Cloudflare Quick Tunnel using binary: {:?}", binary_path);

        {
            let mut status_lock = self.current_status.write().unwrap();
            status_lock.is_connecting = true;
            status_lock.error = None;
        }

        let local_url = format!("http://127.0.0.1:{}", local_port);
        let mut cmd = Command::new(&binary_path);
        cmd.args(["tunnel", "--url", &local_url]);
        cmd.stderr(Stdio::piped());
        cmd.stdout(Stdio::null());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!("Failed to spawn cloudflared process: {}", e)
        })?;

        let stderr = child.stderr.take().ok_or("Failed to capture cloudflared stderr")?;
        let reader = BufReader::new(stderr);

        // Store child in mutex so it can be stopped if needed
        {
            let mut child_lock = self.child_process.lock().unwrap();
            *child_lock = Some(child);
        }

        let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
        let current_status_clone = self.current_status.clone();
        let child_arc = self.child_process.clone();

        // Spawn background reader thread
        std::thread::spawn(move || {
            let mut detected_url: Option<String> = None;
            let mut has_sent = false;

            for line_res in reader.lines() {
                match line_res {
                    Ok(line) => {
                        if detected_url.is_none() {
                            if let Some(url) = extract_trycloudflare_url(&line) {
                                info!("Discovered public Cloudflare Tunnel URL: {}", url);
                                detected_url = Some(url.clone());
                                if !has_sent {
                                    let _ = tx.send(Ok(url));
                                    has_sent = true;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Cloudflare tunnel stderr read closed: {}", e);
                        break;
                    }
                }
            }

            // If the process ended without giving a URL
            if !has_sent {
                let _ = tx.send(Err("Cloudflare process terminated before establishing tunnel.".to_string()));
            }

            // Mark inactive when background process terminates
            let mut st = current_status_clone.write().unwrap();
            if st.is_active {
                st.is_active = false;
                st.is_connecting = false;
            }
            if let Ok(mut cl) = child_arc.try_lock() {
                *cl = None;
            }
        });

        // Wait up to 20 seconds for the URL to arrive
        let start_time = Instant::now();
        let timeout = Duration::from_secs(20);

        match rx.recv_timeout(timeout) {
            Ok(Ok(base_url)) => {
                let full_url = match session_token {
                    Some(token) if !token.trim().is_empty() => {
                        format!("{}/?session={}", base_url, token)
                    }
                    _ => base_url.clone(),
                };

                let (qr_svg, qr_data_url) = generate_qr_svg(&full_url)?;

                let info = TunnelInfo {
                    is_active: true,
                    is_connecting: false,
                    url: Some(full_url),
                    qr_svg: Some(qr_svg),
                    qr_data_url: Some(qr_data_url),
                    error: None,
                    protocol: "Cloudflare Quick Tunnel (TLS 1.3 / QUIC)".to_string(),
                };

                let mut status_lock = self.current_status.write().unwrap();
                *status_lock = info.clone();
                info!("Public tunnel active in {:.2?}s: {}", start_time.elapsed(), base_url);
                Ok(info)
            }
            Ok(Err(err)) => {
                error!("Cloudflare tunnel failed to start: {}", err);
                let mut status_lock = self.current_status.write().unwrap();
                status_lock.is_connecting = false;
                status_lock.is_active = false;
                status_lock.error = Some(err.clone());
                Err(err.into())
            }
            Err(_) => {
                let err_msg = "App is in Offline Mode: Timed out waiting for Cloudflare Tunnel to connect (20s). Please check Windows Internet connection or firewall.";
                error!("{}", err_msg);
                let _ = self.stop_tunnel();
                let mut status_lock = self.current_status.write().unwrap();
                status_lock.is_connecting = false;
                status_lock.is_active = false;
                status_lock.error = Some(err_msg.to_string());
                Err(err_msg.into())
            }
        }
    }

    /// Spawns a permanent Cloudflare Named Tunnel using an account tunnel token
    pub fn start_named_tunnel(
        &self,
        tunnel_token: &str,
        public_url: &str,
    ) -> Result<TunnelInfo, Box<dyn std::error::Error>> {
        let _ = self.stop_tunnel();
        let binary_path = locate_cloudflared_binary().ok_or_else(|| {
            "cloudflared.exe not found on disk. Ensure cloudflared.exe is in bin/ directory."
        })?;

        info!("Starting Cloudflare Named Tunnel using token...");

        {
            let mut status_lock = self.current_status.write().unwrap();
            status_lock.is_connecting = true;
            status_lock.error = None;
        }

        let mut cmd = Command::new(&binary_path);
        cmd.args(["tunnel", "run", "--token", tunnel_token.trim()]);
        cmd.stderr(Stdio::piped());
        cmd.stdout(Stdio::null());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let child = cmd.spawn().map_err(|e| {
            format!("Failed to spawn cloudflared process: {}", e)
        })?;

        {
            let mut child_lock = self.child_process.lock().unwrap();
            *child_lock = Some(child);
        }

        let clean_url = if public_url.starts_with("http://") || public_url.starts_with("https://") {
            public_url.trim().to_string()
        } else {
            format!("https://{}", public_url.trim())
        };

        let (qr_svg, qr_data_url) = generate_qr_svg(&clean_url)?;

        let info = TunnelInfo {
            is_active: true,
            is_connecting: false,
            url: Some(clean_url),
            qr_svg: Some(qr_svg),
            qr_data_url: Some(qr_data_url),
            error: None,
            protocol: "Cloudflare Named Tunnel (Zero Trust Permanent)".to_string(),
        };

        let mut status_lock = self.current_status.write().unwrap();
        *status_lock = info.clone();
        info!("Cloudflare Named Tunnel started with permanent URL: {}", info.url.as_deref().unwrap_or_default());
        Ok(info)
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        let _ = self.stop_tunnel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_trycloudflare_url() {
        let line1 = "2026-10-29T00:55:14Z INF |  https://videos-scanner-violation-paragraph.trycloudflare.com                              |";
        assert_eq!(
            extract_trycloudflare_url(line1),
            Some("https://videos-scanner-violation-paragraph.trycloudflare.com".to_string())
        );

        let line2 = "Visit at: https://my-cool-tunnel.trycloudflare.com for details";
        assert_eq!(
            extract_trycloudflare_url(line2),
            Some("https://my-cool-tunnel.trycloudflare.com".to_string())
        );

        let line3 = "No url here at all";
        assert_eq!(extract_trycloudflare_url(line3), None);
    }

    #[test]
    fn test_locate_cloudflared_binary() {
        let bin = locate_cloudflared_binary();
        assert!(bin.is_some(), "cloudflared binary should be found in bin/ or src-tauri/bin/");
    }

    #[test]
    fn test_check_internet_reachability() {
        // Function returns a boolean without panicking
        let _ = check_internet_reachability();
    }
}
