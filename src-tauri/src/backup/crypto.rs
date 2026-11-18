use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

pub const BACKUP_MAGIC_BYTES: &[u8; 8] = b"PDROPBAK";
pub const CURRENT_BACKUP_VERSION: u8 = 1;
pub const PBKDF2_ITERATIONS: u32 = 100_000;
pub const SALT_LENGTH: usize = 16;
pub const NONCE_LENGTH: usize = 12;

/// Derives a 32-byte (256-bit) AES key using standard RFC 2898 / RFC 8018 PBKDF2-HMAC-SHA256.
pub fn derive_key_pbkdf2(password: &str, salt: &[u8], rounds: u32) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(password.as_bytes())
        .expect("HMAC supports keys of any length");
    mac.update(salt);
    mac.update(&1u32.to_be_bytes()); // Block index 1 (produces first 32 bytes)
    let mut u = mac.finalize().into_bytes();
    let mut key = u;

    for _ in 1..rounds {
        let mut mac_inner = HmacSha256::new_from_slice(password.as_bytes())
            .expect("HMAC inner");
        mac_inner.update(&u);
        u = mac_inner.finalize().into_bytes();
        for (k, byte) in key.iter_mut().zip(u.iter()) {
            *k ^= byte;
        }
    }

    let mut result = [0u8; 32];
    result.copy_from_slice(&key);
    result
}

/// Encrypts plaintext bytes using AES-256-GCM with a PBKDF2-HMAC-SHA256 derived key.
/// Produces a self-contained binary payload:
/// [ MAGIC (8 bytes) | VERSION (1 byte) | SALT (16 bytes) | NONCE (12 bytes) | CIPHERTEXT + TAG ]
pub fn encrypt_backup_payload(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if password.trim().is_empty() {
        return Err("Password cannot be empty for backup encryption".to_string());
    }

    // 1. Generate cryptographically strong random Salt (16 bytes) and Nonce (12 bytes)
    let salt = *Uuid::new_v4().as_bytes();
    let nonce_raw = Uuid::new_v4();
    let nonce_bytes: [u8; NONCE_LENGTH] = nonce_raw.as_bytes()[0..NONCE_LENGTH]
        .try_into()
        .map_err(|_| "Failed to create nonce".to_string())?;

    // 2. Derive 256-bit (32 bytes) encryption key via PBKDF2
    let key = derive_key_pbkdf2(password, &salt, PBKDF2_ITERATIONS);

    // 3. Encrypt with AES-256-GCM
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to initialize AES-256-GCM: {}", e))?;
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Encryption failure: {}", e))?;

    // 4. Assemble container
    let mut output = Vec::with_capacity(BACKUP_MAGIC_BYTES.len() + 1 + SALT_LENGTH + NONCE_LENGTH + ciphertext.len());
    output.extend_from_slice(BACKUP_MAGIC_BYTES);
    output.push(CURRENT_BACKUP_VERSION);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(output)
}

/// Decrypts a PrintDrop backup payload using AES-256-GCM.
/// Validates magic header, format version, and cryptographic integrity.
pub fn decrypt_backup_payload(encrypted_payload: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if password.trim().is_empty() {
        return Err("Password cannot be empty for backup decryption".to_string());
    }

    let min_length = BACKUP_MAGIC_BYTES.len() + 1 + SALT_LENGTH + NONCE_LENGTH + 16; // 16 bytes min GCM tag
    if encrypted_payload.len() < min_length {
        return Err("Invalid backup file: file is truncated or corrupted".to_string());
    }

    // 1. Validate magic header
    if &encrypted_payload[0..8] != BACKUP_MAGIC_BYTES {
        return Err("Not a valid PrintDrop backup file (invalid magic signature)".to_string());
    }

    // 2. Validate format version
    let version = encrypted_payload[8];
    if version != CURRENT_BACKUP_VERSION {
        return Err(format!("Unsupported backup version {} (expected {})", version, CURRENT_BACKUP_VERSION));
    }

    // 3. Extract salt and nonce
    let mut offset = 9;
    let salt = &encrypted_payload[offset..offset + SALT_LENGTH];
    offset += SALT_LENGTH;

    let nonce_bytes = &encrypted_payload[offset..offset + NONCE_LENGTH];
    offset += NONCE_LENGTH;

    let ciphertext = &encrypted_payload[offset..];

    // 4. Re-derive 256-bit encryption key with user password
    let key = derive_key_pbkdf2(password, salt, PBKDF2_ITERATIONS);

    // 5. Decrypt and authenticate ciphertext
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to initialize AES-256-GCM: {}", e))?;
    let nonce_arr: [u8; NONCE_LENGTH] = nonce_bytes
        .try_into()
        .map_err(|_| "Invalid nonce length in backup payload".to_string())?;
    let nonce = Nonce::from(nonce_arr);

    cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| "Decryption failed: Incorrect password or corrupted backup file".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_decryption_roundtrip() {
        let original_data = b"PrintDrop production ledger test backup payload 1234567890";
        let password = "SuperSecretShopkeeperPassword@2026";

        let encrypted = encrypt_backup_payload(original_data, password)
            .expect("Encryption should succeed");

        assert_ne!(encrypted, original_data);
        assert_eq!(&encrypted[0..8], BACKUP_MAGIC_BYTES);
        assert_eq!(encrypted[8], CURRENT_BACKUP_VERSION);

        // Decrypt with correct password
        let decrypted = decrypt_backup_payload(&encrypted, password)
            .expect("Decryption should succeed with correct password");
        assert_eq!(decrypted, original_data);

        // Decryption with wrong password MUST fail
        let wrong_pw_res = decrypt_backup_payload(&encrypted, "WrongPassword123");
        assert!(wrong_pw_res.is_err());
        assert!(wrong_pw_res.unwrap_err().contains("Decryption failed"));

        // Decryption with empty password MUST fail
        assert!(decrypt_backup_payload(&encrypted, "").is_err());
    }

    #[test]
    fn test_corrupted_payload_detection() {
        let original_data = b"Testing tamper resistance";
        let password = "TestPassword";

        let mut encrypted = encrypt_backup_payload(original_data, password).unwrap();
        // Tamper with one byte in the ciphertext
        let len = encrypted.len();
        encrypted[len - 5] ^= 0xFF;

        let res = decrypt_backup_payload(&encrypted, password);
        assert!(res.is_err(), "Tampered ciphertext should fail authentication");
    }
}
