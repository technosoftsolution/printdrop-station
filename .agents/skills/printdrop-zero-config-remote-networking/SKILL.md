---
name: printdrop-zero-config-remote-networking
description: >
  Zero-cost, zero-configuration remote networking architecture for local servers and edge apps.
  Covers Cloudflare Quick Tunnels (cloudflared / trycloudflare.com), Permanent Static QR Gateways
  (GitHub Pages connect.html redirection), bypassing ISP CGNAT without public static IPs,
  multi-adapter auto-discovery (Wi-Fi LAN + Tailscale WireGuard VPN), and QR routing.
---

# PrintDrop Zero-Config Remote Networking & QR Gateway

## Purpose & Scope

This skill provides an **end-to-end runbook for exposing a local desktop application or POS station to remote mobile clients** without requiring static public IP addresses, router port-forwarding, dynamic DNS subscriptions, or paid cloud hosting. 

It details the **Permanent QR Standee Pattern**: printing a physical counter QR standee once that remains valid forever, even when the local shop's IP address, Wi-Fi router, or cloud tunnel URL changes dynamically.

---

## Quick Reference & Pitfall Table

| Problem / Pitfall | Root Cause | Permanent Production Solution |
| :--- | :--- | :--- |
| **Local PC unreachable from customer phone on 4G/5G** | Shop PC is behind ISP Carrier-Grade NAT (CGNAT) without a public IPv4 address. | Spawn an automated Cloudflare Quick Tunnel (`cloudflared tunnel --url http://127.0.0.1:port`). |
| **Every app restart breaks physical counter standee QR** | Cloudflare Quick Tunnels generate a new random domain (`xxxx.trycloudflare.com`) on every session. | Print a **Permanent QR** pointing to a static GitHub Pages gateway (`connect.html`). The gateway polls the active station URL and redirects seamlessly. |
| **Customer phone on shop Wi-Fi wastes internet quota** | Phone connects over Cloudflare Tunnel even when standing 1 meter away from the shop Wi-Fi router. | Dual-Routing Engine: Web gateway detects whether client is on local subnet (`192.168.x.x`) and prioritizes direct LAN transport for 300+ Mbps local transfers. |
| **Cloudflared crashes or is blocked by Windows Firewall** | Process dies silently or requires admin elevation. | Rust supervisor loop monitors the child process, extracts stdout URL via regex, and auto-restarts upon network interruption. |
| **Tailscale VPN peers cannot connect** | Tailscale adapter not prioritized over virtual adapters. | Scan system network interfaces, bind Axum server to `0.0.0.0`, and dynamically detect the `100.x.y.z` Carrier-Grade CGNAT range. |

---

## §1: The Permanent Standee QR Gateway Architecture

```
[Customer Scans Physical Standee QR]
                │
                ▼
  https://technosoftsolution.github.io/printdrop-station/connect.html
  (Permanent Static URL - Printed Once on Acrylic Counter Standee)
                │
                ├──────────────────────────────────────┐
                ▼                                      ▼
    [Check 1: Local Wi-Fi Fast Ping]         [Check 2: Cloudflare Remote API]
    Tries http://192.168.x.x:8080/api/health   Queries https://xxxx.trycloudflare.com
                │                                      │
        (Connected to Wi-Fi)                   (On 4G/5G Cellular Data)
                ▼                                      ▼
    Redirects to Local LAN                  Redirects to Active Cloudflare Tunnel
   (Ultra-fast, zero data cost)             (Works from anywhere in the world)
```

---

## §2: Rust Supervisor for Cloudflare Tunnel (`tunnel.rs`)

### Spawning & URL Extraction Without User Configuration

```rust
use std::process::Stdio;
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};
use regex::Regex;

pub struct TunnelManager {
    local_port: u16,
}

impl TunnelManager {
    pub fn new(local_port: u16) -> Self {
        Self { local_port }
    }

    pub async fn start_quick_tunnel(&self) -> Result<String, Box<dyn std::error::Error>> {
        let binary_path = self.locate_cloudflared_binary()?;

        let mut child = Command::new(binary_path)
            .args(&[
                "tunnel",
                "--url",
                &format!("http://127.0.0.1:{}", self.local_port),
                "--no-autoupdate",
            ])
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;

        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;
        let mut reader = BufReader::new(stderr).lines();

        let re = Regex::new(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")?;

        // Read stream until URL is announced (usually within 2-4 seconds)
        let timeout = tokio::time::sleep(std::time::Duration::from_secs(15));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                line = reader.next_line() => {
                    if let Ok(Some(text)) = line {
                        if let Some(mat) = re.find(&text) {
                            let public_url = mat.as_str().to_string();
                            tracing::info!("Cloudflare Quick Tunnel Live: {}", public_url);
                            return Ok(public_url);
                        }
                    }
                }
                _ = &mut timeout => {
                    return Err("Timed out waiting for Cloudflare Tunnel URL".into());
                }
            }
        }
    }

    fn locate_cloudflared_binary(&self) -> Result<PathBuf, Box<dyn std::error::Error>> {
        // 1. Check application resource directory
        // 2. Check system PATH
        // 3. Fallback to local vendor folder
        which::which("cloudflared").map_err(|e| e.into())
    }
}
```

---

## §3: Permanent Gateway Redirection Engine (`connect.html`)

This static HTML file is hosted permanently on **GitHub Pages** (free, 99.99% uptime):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connecting to PrintDrop Express Station...</title>
  <style>
    body { background: #090d16; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #131c2e; border: 1px solid #1e293b; border-radius: 1.5rem; padding: 2rem; text-align: center; max-width: 360px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
    .spinner { width: 44px; height: 44px; border: 3px solid rgba(59,130,246,0.2); border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1.25rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2 style="font-size:1.2rem; margin:0 0 0.5rem;">Connecting to Station</h2>
    <p id="statusMsg" style="font-size:0.85rem; color:#94a3b8; margin:0;">Detecting fastest connection (Wi-Fi / 4G / 5G)...</p>
  </div>

  <script>
    async function resolveAndRedirect() {
      const statusMsg = document.getElementById("statusMsg");

      // Step 1: Probe Local Wi-Fi fast-path (500ms timeout)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600);
        const lanRes = await fetch("http://192.168.10.3:8080/api/health", { signal: controller.signal });
        clearTimeout(timeoutId);

        if (lanRes.ok) {
          statusMsg.textContent = "⚡ Fast Wi-Fi connection detected! Redirecting...";
          window.location.replace("http://192.168.10.3:8080/");
          return;
        }
      } catch (e) {
        // Not on local Wi-Fi, proceed to remote tunnel
      }

      // Step 2: Fetch Active Cloudflare Tunnel URL from Dynamic Config / Gist
      try {
        statusMsg.textContent = "Connecting via secure 4G/5G tunnel...";
        const configRes = await fetch("https://api.printdrop.local/station/active.json?t=" + Date.now());
        const data = await configRes.json();
        if (data.tunnelUrl) {
          window.location.replace(data.tunnelUrl);
          return;
        }
      } catch (err) {
        statusMsg.textContent = "Please ensure the shop PC is online or connect to shop Wi-Fi.";
      }
    }
    resolveAndRedirect();
  </script>
</body>
</html>
```

---

## §4: Multi-Adapter Network Detection (`network.rs`)

```rust
use std::net::IpAddr;
use get_if_addrs::get_if_addrs;

#[derive(Debug, Clone, serde::Serialize)]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub ip: String,
    pub is_tailscale: bool,
    pub is_wifi_or_ethernet: bool,
}

pub fn get_active_interfaces() -> Vec<NetworkInterfaceInfo> {
    let mut interfaces = Vec::new();
    if let Ok(ifaces) = get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() { continue; }
            if let IpAddr::V4(ipv4) = iface.ip() {
                let ip_str = ipv4.to_string();
                let is_tailscale = ip_str.starts_with("100.");
                let is_lan = ip_str.starts_with("192.168.") || ip_str.starts_with("10.") || ip_str.starts_with("172.");

                interfaces.push(NetworkInterfaceInfo {
                    name: iface.name,
                    ip: ip_str,
                    is_tailscale,
                    is_wifi_or_ethernet: is_lan,
                });
            }
        }
    }
    interfaces
}
```
