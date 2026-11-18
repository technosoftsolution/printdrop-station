use sha2::{Digest, Sha256};
use std::process::Command;
use tracing::info;

/// Extracts the Windows MachineGuid from the local machine registry.
fn get_windows_machine_guid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .args(&["/c", "reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid"])
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("MachineGuid") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        return Some(parts[2].trim().to_string());
                    }
                }
            }
        }
    }
    None
}

/// Extracts the motherboard or computer system product UUID.
fn get_system_uuid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .args(&["/c", "wmic csproduct get uuid"])
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("uuid") {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

/// Extracts the CPU Processor ID or identifier from registry.
fn get_cpu_identifier() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .args(&["/c", "reg query HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0 /v ProcessorNameString"])
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("ProcessorNameString") {
                    let parts: Vec<&str> = line.split("REG_SZ").collect();
                    if parts.len() >= 2 {
                        return Some(parts[1].trim().to_string());
                    }
                }
            }
        }
    }
    None
}

/// Fallback machine identifier using computer name and user profile
fn get_fallback_entropy() -> String {
    let comp_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PrintDrop-Host".to_string());
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    format!("{}:{}", comp_name, sys_root)
}

/// Generates a unique, reproducible Hardware ID (HWID) bound to this physical machine.
/// Formats as: PD-XXXX-XXXX-XXXX-XXXX (e.g. PD-6C0C-9825-4BAB-7DE2)
pub fn generate_hardware_id() -> String {
    let guid = get_windows_machine_guid().unwrap_or_default();
    let uuid = get_system_uuid().unwrap_or_default();
    let cpu = get_cpu_identifier().unwrap_or_default();
    let fallback = get_fallback_entropy();

    let raw_payload = format!(
        "PRINTDROP_V1:GUID={}:UUID={}:CPU={}:SYS={}",
        guid, uuid, cpu, fallback
    );

    let mut hasher = Sha256::new();
    hasher.update(raw_payload.as_bytes());
    let digest = hasher.finalize();
    let hex_hash = hex::encode(digest).to_uppercase();

    // Format the first 16 characters into 4 blocks of 4 characters: PD-XXXX-XXXX-XXXX-XXXX
    let part1 = &hex_hash[0..4];
    let part2 = &hex_hash[4..8];
    let part3 = &hex_hash[8..12];
    let part4 = &hex_hash[12..16];

    let formatted_hwid = format!("PD-{}-{}-{}-{}", part1, part2, part3, part4);
    info!("Hardware Fingerprint generated: {}", formatted_hwid);
    formatted_hwid
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hwid_generation_format_and_stability() {
        let hwid1 = generate_hardware_id();
        let hwid2 = generate_hardware_id();

        // Must be stable and reproducible on the same machine
        assert_eq!(hwid1, hwid2, "HWID must be deterministic on the same physical host");

        // Must follow format PD-XXXX-XXXX-XXXX-XXXX (22 characters)
        assert!(hwid1.starts_with("PD-"));
        assert_eq!(hwid1.len(), 22, "Formatted HWID must be 22 characters (PD- + 4x4 hex + 3 dashes)");

        let parts: Vec<&str> = hwid1.split('-').collect();
        assert_eq!(parts.len(), 5);
        assert_eq!(parts[0], "PD");
        for p in &parts[1..] {
            assert_eq!(p.len(), 4);
            assert!(p.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }
}
