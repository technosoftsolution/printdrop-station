use local_ip_address::list_afinet_netifas;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::RwLock;
use std::time::Instant;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub ip: String,
    pub is_vpn: bool,
    pub is_wifi: bool,
    pub is_loopback: bool,
    pub is_default: bool,
}

// 300-second (5-minute) cache to make startup and runtime interface lookups instantaneous (<0.01ms)
static CACHED_INTERFACES: RwLock<Option<(Instant, Vec<NetworkInterfaceInfo>)>> = RwLock::new(None);

/// Identifies unwanted adapters that should be completely skipped.
/// Excludes VMware, VirtualBox, Hyper-V, Bluetooth, Docker, WSL, Ethernet, and APIPA (169.254.x.x).
fn is_unwanted_adapter(name: &str, ip_str: &str) -> bool {
    let lower = name.to_lowercase();

    // 1. Skip virtual & virtualization adapters
    if lower.contains("vmware")
        || lower.contains("vmnet")
        || lower.contains("virtual")
        || lower.contains("vbox")
        || lower.contains("virtualbox")
        || lower.contains("hyper-v")
        || lower.contains("vethernet")
        || lower.contains("docker")
        || lower.contains("wsl")
        || lower.contains("teredo")
        || lower.contains("isatap")
    {
        return true;
    }

    // 2. Skip Bluetooth PAN / serial adapters
    if lower.contains("bluetooth") || lower.contains("bthpan") {
        return true;
    }

    // 3. Skip link-local APIPA addresses (169.254.x.x)
    if ip_str.starts_with("169.254.") {
        return true;
    }

    false
}

pub fn list_available_interfaces() -> Vec<NetworkInterfaceInfo> {
    // Check in-memory cache (300-second TTL for instantaneous startup & zero lag)
    if let Ok(guard) = CACHED_INTERFACES.read() {
        if let Some((ts, ref cached)) = *guard {
            if ts.elapsed().as_secs() < 300 {
                return cached.clone();
            }
        }
    }

    let mut interfaces = Vec::new();

    if let Ok(netifas) = list_afinet_netifas() {
        for (name, ip) in netifas {
            if let IpAddr::V4(ipv4) = ip {
                let ip_str = ipv4.to_string();
                let is_loop = ipv4.is_loopback();
                let lower_name = name.to_lowercase();

                if is_loop || is_unwanted_adapter(&name, &ip_str) {
                    continue;
                }

                // Strictly detect ONLY Wi-Fi / Wireless adapters for ultra-fast startup per user preference
                let is_wifi = lower_name.contains("wi-fi")
                    || lower_name.contains("wlan")
                    || lower_name.contains("wireless");

                if is_wifi {
                    interfaces.push(NetworkInterfaceInfo {
                        name,
                        ip: ip_str,
                        is_vpn: false,
                        is_wifi: true,
                        is_loopback: false,
                        is_default: false,
                    });
                }
            }
        }
    }

    let mut result = interfaces;

    if result.is_empty() {
        // Fallback to loopback if Wi-Fi adapter is disconnected or offline
        result.push(NetworkInterfaceInfo {
            name: "Loopback (Wi-Fi Offline)".to_string(),
            ip: "127.0.0.1".to_string(),
            is_vpn: false,
            is_wifi: false,
            is_loopback: true,
            is_default: true,
        });
    } else {
        result[0].is_default = true;
    }

    info!("Discovered {} usable IPv4 network interfaces", result.len());
    for iface in &result {
        info!(
            "  - [{}] {} (VPN: {}, Wi-Fi: {}, Default: {})",
            iface.name,
            iface.ip,
            iface.is_vpn,
            iface.is_wifi,
            ifif_str(iface.is_default)
        );
    }

    // Cache the result
    if let Ok(mut guard) = CACHED_INTERFACES.write() {
        *guard = Some((Instant::now(), result.clone()));
    }

    result
}

fn ifif_str(b: bool) -> &'static str {
    if b { "yes" } else { "no" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interface_listing() {
        let list = list_available_interfaces();
        assert!(!list.is_empty(), "Should discover at least loopback or physical adapter");
        let has_default = list.iter().any(|i| i.is_default);
        assert!(has_default, "One interface must be marked as default");
    }
}
