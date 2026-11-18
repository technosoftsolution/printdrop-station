use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tracing::info;

#[derive(Debug, Clone)]
pub struct VerifiedFile {
    pub file_id: String,
    pub storage_path: PathBuf,
    pub size_bytes: u64,
    pub sha256_hash: String,
}

#[derive(Clone)]
pub struct StorageManager {
    base_dir: PathBuf,
}

impl StorageManager {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> Self {
        let base = base_dir.as_ref().to_path_buf();
        let _ = fs::create_dir_all(base.join("temp").join("chunks"));
        let _ = fs::create_dir_all(base.join("temp").join("assembled"));
        let _ = fs::create_dir_all(base.join("verified"));
        Self { base_dir: base }
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    pub fn sanitize_filename(filename: &str) -> String {
        // 1. Remove dangerous/illegal path characters
        let clean: String = filename
            .chars()
            .filter(|c| !['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'].contains(c))
            .collect();

        // 2. Trim whitespace and leading/trailing dots
        let trimmed = clean.trim().trim_matches('.');

        // 3. Normalize multiple dots to single dot to prevent traversal tricks
        let mut no_double_dots = String::new();
        let mut prev_dot = false;
        for c in trimmed.chars() {
            if c == '.' {
                if !prev_dot {
                    no_double_dots.push(c);
                    prev_dot = true;
                }
            } else {
                no_double_dots.push(c);
                prev_dot = false;
            }
        }

        // 4. Fallback if empty
        let candidate = if no_double_dots.is_empty() {
            "unnamed_document".to_string()
        } else {
            no_double_dots
        };

        // 5. Windows reserved device names defense (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
        let stem = match candidate.find('.') {
            Some(idx) => &candidate[..idx],
            None => &candidate,
        };
        let stem_upper = stem.to_uppercase();
        let is_reserved = matches!(
            stem_upper.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6"
                | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5"
                | "LPT6" | "LPT7" | "LPT8" | "LPT9"
        );

        let safe_name = if is_reserved {
            format!("doc_{}", candidate)
        } else {
            candidate
        };

        // 6. Max length clamp (200 chars)
        if safe_name.len() > 200 {
            safe_name.chars().take(200).collect()
        } else {
            safe_name
        }
    }

    pub fn sanitize_id(id: &str) -> Result<String, String> {
        if id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') && !id.is_empty() && id.len() <= 64 {
            Ok(id.to_string())
        } else {
            Err("Invalid ID format: contains illegal characters or path traversal attempt".to_string())
        }
    }

    pub fn init_chunk_dir(&self, file_id: &str) -> Result<PathBuf, String> {
        let safe_id = Self::sanitize_id(file_id)?;
        let chunk_dir = self.base_dir.join("temp").join("chunks").join(&safe_id);
        fs::create_dir_all(&chunk_dir).map_err(|e| format!("Failed to create chunk directory: {}", e))?;
        Ok(chunk_dir)
    }

    pub fn write_chunk(&self, file_id: &str, chunk_index: u32, data: &[u8]) -> Result<(), String> {
        let safe_id = Self::sanitize_id(file_id)?;
        let chunk_dir = self.base_dir.join("temp").join("chunks").join(&safe_id);
        if !chunk_dir.exists() {
            fs::create_dir_all(&chunk_dir).map_err(|e| format!("Failed to create chunk dir: {}", e))?;
        }

        let chunk_path = chunk_dir.join(format!("chunk_{}.part", chunk_index));
        fs::write(&chunk_path, data).map_err(|e| format!("Failed to write chunk {}: {}", chunk_index, e))?;
        Ok(())
    }

    pub fn assemble_and_verify(
        &self,
        file_id: &str,
        total_chunks: u32,
        expected_size: u64,
        expected_hash: Option<&str>,
    ) -> Result<VerifiedFile, String> {
        let safe_id = Self::sanitize_id(file_id)?;
        let chunk_dir = self.base_dir.join("temp").join("chunks").join(&safe_id);
        let assembled_temp = self.base_dir.join("temp").join("assembled").join(format!("{}.part", safe_id));
        let verified_dest = self.base_dir.join("verified").join(format!("{}.dat", safe_id));

        // 1. Verify all chunk parts exist
        for i in 0..total_chunks {
            let chunk_path = chunk_dir.join(format!("chunk_{}.part", i));
            if !chunk_path.exists() {
                return Err(format!("Missing chunk {} for file {}", i, safe_id));
            }
        }

        // 2. Assemble chunks sequentially and compute SHA-256
        let mut out_file = File::create(&assembled_temp)
            .map_err(|e| format!("Failed to create assembled file: {}", e))?;
        let mut hasher = Sha256::new();
        let mut total_bytes_written = 0u64;
        let mut buffer = vec![0u8; 64 * 1024]; // 64KB buffer

        for i in 0..total_chunks {
            let chunk_path = chunk_dir.join(format!("chunk_{}.part", i));
            let mut chunk_file = File::open(&chunk_path)
                .map_err(|e| format!("Failed to read chunk {}: {}", i, e))?;

            loop {
                let n = chunk_file.read(&mut buffer).map_err(|e| format!("Error reading chunk: {}", e))?;
                if n == 0 {
                    break;
                }
                out_file.write_all(&buffer[..n]).map_err(|e| format!("Error writing assembled file: {}", e))?;
                hasher.update(&buffer[..n]);
                total_bytes_written += n as u64;
            }
        }

        out_file.flush().map_err(|e| format!("Failed to flush assembled file: {}", e))?;
        drop(out_file);

        // 3. Verify size
        if total_bytes_written != expected_size {
            let _ = fs::remove_file(&assembled_temp);
            return Err(format!(
                "Size mismatch: expected {} bytes, assembled {} bytes",
                expected_size, total_bytes_written
            ));
        }

        // 4. Verify SHA-256 checksum
        let calculated_hash = hex::encode(hasher.finalize());
        if let Some(exp_hash) = expected_hash {
            if !exp_hash.trim().is_empty() && !calculated_hash.eq_ignore_ascii_case(exp_hash) {
                let _ = fs::remove_file(&assembled_temp);
                return Err(format!(
                    "SHA-256 checksum mismatch: expected {}, calculated {}",
                    exp_hash, calculated_hash
                ));
            }
        }

        // 5. Inspect magic bytes for dangerous executable signatures (anti-malware defense)
        if let Err(e) = Self::verify_not_dangerous_payload(&assembled_temp) {
            let _ = fs::remove_file(&assembled_temp);
            let _ = fs::remove_dir_all(&chunk_dir);
            return Err(e);
        }

        // 6. Clean up temporary chunk parts
        let _ = fs::remove_dir_all(&chunk_dir);

        // 7. Atomically move assembled file to verified storage
        fs::rename(&assembled_temp, &verified_dest)
            .map_err(|e| format!("Failed to promote to verified storage: {}", e))?;

        info!("File {} verified successfully. SHA-256: {}", safe_id, calculated_hash);

        Ok(VerifiedFile {
            file_id: safe_id,
            storage_path: verified_dest,
            size_bytes: total_bytes_written,
            sha256_hash: calculated_hash,
        })
    }

    pub fn get_missing_chunks(&self, file_id: &str, total_chunks: u32) -> Result<Vec<u32>, String> {
        let safe_id = Self::sanitize_id(file_id)?;
        let chunk_dir = self.base_dir.join("temp").join("chunks").join(&safe_id);

        let mut missing = Vec::new();
        for i in 0..total_chunks {
            let chunk_path = chunk_dir.join(format!("chunk_{}.part", i));
            if !chunk_path.exists() {
                missing.push(i);
            }
        }
        Ok(missing)
    }

    pub fn get_verified_file_path(&self, file_id: &str) -> Result<PathBuf, String> {
        let safe_id = Self::sanitize_id(file_id)?;
        let path = self.base_dir.join("verified").join(format!("{}.dat", safe_id));
        if path.exists() {
            Ok(path)
        } else {
            let direct = self.base_dir.join("verified").join(&safe_id);
            if direct.exists() {
                Ok(direct)
            } else {
                Err(format!("Verified file not found on disk: {}", safe_id))
            }
        }
    }

    pub fn resolve_verified_file_path(
        &self,
        db: &crate::db::Database,
        file_id_or_storage_id: &str,
    ) -> Result<PathBuf, String> {
        let storage_rel: Option<String> = db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT fr.storage_relative_path FROM file_revisions fr 
                 JOIN files f ON fr.file_id = f.id 
                 WHERE f.id = ?1 OR f.sanitized_filename = ?1 
                 LIMIT 1"
            )?;
            let mut rows = stmt.query([file_id_or_storage_id])?;
            if let Some(r) = rows.next()? {
                let p: String = r.get(0)?;
                return Ok(Some(p));
            }
            Ok(None)
        }).unwrap_or(None);

        if let Some(rel) = storage_rel {
            let direct = self.base_dir.join(&rel);
            if direct.exists() {
                return Ok(direct);
            }
            let rel_clean = rel.trim_start_matches("verified/").trim_start_matches("verified\\");
            let in_verified = self.base_dir.join("verified").join(rel_clean);
            if in_verified.exists() {
                return Ok(in_verified);
            }
        }

        self.get_verified_file_path(file_id_or_storage_id)
    }

    pub fn verify_not_dangerous_payload<P: AsRef<Path>>(path: P) -> Result<(), String> {
        let mut file = File::open(path.as_ref())
            .map_err(|e| format!("Failed to open file for security inspection: {}", e))?;
        let mut header = [0u8; 16];
        let n = file.read(&mut header).unwrap_or(0);
        if n >= 2 {
            // Windows PE executable / DLL / SYS / COM
            if &header[0..2] == b"MZ" {
                return Err("Security violation: Windows executable files (PE/EXE/DLL) are strictly prohibited from upload.".to_string());
            }
            // Unix script with shebang
            if &header[0..2] == b"#!" {
                return Err("Security violation: Script files are strictly prohibited from upload.".to_string());
            }
        }
        if n >= 4 {
            // Linux ELF executable
            if &header[0..4] == b"\x7FELF" {
                return Err("Security violation: Linux executable files (ELF) are strictly prohibited from upload.".to_string());
            }
            // Mach-O binaries / Java bytecode
            if &header[0..4] == b"\xFE\xED\xFA\xCE"
                || &header[0..4] == b"\xFE\xED\xFA\xCF"
                || &header[0..4] == b"\xCF\xFA\xED\xFE"
                || &header[0..4] == b"\xCE\xFA\xED\xFE"
                || &header[0..4] == b"\xCA\xFE\xBA\xBE"
            {
                return Err("Security violation: Compiled binary bytecode files are strictly prohibited from upload.".to_string());
            }
        }
        Ok(())
    }

    /// Zero-fill file shredder: overwrites file bytes with zeros, flushes to disk, and removes entry.
    pub fn secure_shred_file<P: AsRef<Path>>(path: P) -> std::io::Result<()> {
        let path = path.as_ref();
        if !path.exists() {
            return Ok(());
        }
        if let Ok(metadata) = fs::metadata(path) {
            let len = metadata.len();
            if len > 0 {
                if let Ok(mut file) = fs::OpenOptions::new().write(true).open(path) {
                    let chunk_size = 64 * 1024;
                    let zeros = vec![0u8; chunk_size];
                    let mut remaining = len;
                    while remaining > 0 {
                        let to_write = std::cmp::min(remaining, chunk_size as u64) as usize;
                        let _ = file.write_all(&zeros[..to_write]);
                        remaining -= to_write as u64;
                    }
                    let _ = file.sync_all();
                }
            }
        }
        fs::remove_file(path)
    }

    pub fn shred_verified_file(&self, file_id: &str) -> Result<(), String> {
        let safe_id = Self::sanitize_id(file_id)?;
        let path = self.base_dir.join("verified").join(format!("{}.dat", safe_id));
        if path.exists() {
            Self::secure_shred_file(&path).map_err(|e| format!("Failed to securely shred file: {}", e))?;
        }
        let direct = self.base_dir.join("verified").join(&safe_id);
        if direct.exists() {
            Self::secure_shred_file(&direct).map_err(|e| format!("Failed to securely shred file: {}", e))?;
        }
        Ok(())
    }

    /// Cleans up orphaned chunks and temporary assembled files older than max_age to prevent disk space exhaustion.
    pub fn cleanup_orphaned_staging(&self, max_age: std::time::Duration) -> Result<usize, String> {
        let mut cleaned = 0;
        let now = std::time::SystemTime::now();

        // 1. Clean temp/chunks/
        let chunks_dir = self.base_dir.join("temp").join("chunks");
        if let Ok(entries) = fs::read_dir(&chunks_dir) {
            for entry in entries.filter_map(Result::ok) {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if let Ok(age) = now.duration_since(modified) {
                            if age > max_age {
                                let _ = fs::remove_dir_all(entry.path());
                                cleaned += 1;
                            }
                        }
                    }
                }
            }
        }

        // 2. Clean temp/assembled/
        let assembled_dir = self.base_dir.join("temp").join("assembled");
        if let Ok(entries) = fs::read_dir(&assembled_dir) {
            for entry in entries.filter_map(Result::ok) {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if let Ok(age) = now.duration_since(modified) {
                            if age > max_age {
                                let _ = fs::remove_file(entry.path());
                                cleaned += 1;
                            }
                        }
                    }
                }
            }
        }

        Ok(cleaned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filename_sanitization() {
        assert_eq!(StorageManager::sanitize_filename("../../etc/passwd"), "etcpasswd");
        assert_eq!(StorageManager::sanitize_filename("valid_doc.pdf"), "valid_doc.pdf");
        assert_eq!(StorageManager::sanitize_filename("CON.txt"), "doc_CON.txt");
        assert_eq!(StorageManager::sanitize_filename("aux.pdf"), "doc_aux.pdf");
        assert_eq!(StorageManager::sanitize_filename("hello:world?.jpg"), "helloworld.jpg");
        assert_eq!(StorageManager::sanitize_filename(""), "unnamed_document");
    }

    #[test]
    fn test_dangerous_payload_rejection() {
        let temp_dir = std::env::temp_dir().join(format!("printdrop_sec_test_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        // Test PE executable
        let exe_path = temp_dir.join("malicious.exe");
        let mut exe_bytes = b"MZ\x90\x00\x03\x00\x00\x00".to_vec();
        exe_bytes.extend(vec![0u8; 100]);
        fs::write(&exe_path, &exe_bytes).unwrap();
        assert!(StorageManager::verify_not_dangerous_payload(&exe_path).is_err());

        // Test safe PDF
        let pdf_path = temp_dir.join("safe.pdf");
        fs::write(&pdf_path, b"%PDF-1.7\n1 0 obj\n<<>>\nendobj").unwrap();
        assert!(StorageManager::verify_not_dangerous_payload(&pdf_path).is_ok());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_secure_shred_file() {
        let temp_path = std::env::temp_dir().join(format!("printdrop_shred_{}.txt", uuid::Uuid::new_v4()));
        fs::write(&temp_path, b"Sensitive customer Aadhaar / Pan card data!").unwrap();
        assert!(temp_path.exists());
        StorageManager::secure_shred_file(&temp_path).unwrap();
        assert!(!temp_path.exists());
    }

    #[test]
    fn test_id_sanitization() {
        assert!(StorageManager::sanitize_id("valid-id_123").is_ok());
        assert!(StorageManager::sanitize_id("../bad-path").is_err());
        assert!(StorageManager::sanitize_id("bad/id").is_err());
        assert!(StorageManager::sanitize_id("").is_err());
    }

    #[test]
    fn test_chunk_assembly_and_hash_verification() {
        let temp_dir = std::env::temp_dir().join(format!("printdrop_test_{}", uuid::Uuid::new_v4()));
        let storage = StorageManager::new(&temp_dir);

        let file_id = "test-doc-1";
        storage.init_chunk_dir(file_id).expect("Init chunk dir failed");

        let chunk0 = b"Hello, ";
        let chunk1 = b"World! This is ";
        let chunk2 = b"PrintDrop Phase-E.";

        storage.write_chunk(file_id, 0, chunk0).unwrap();
        storage.write_chunk(file_id, 1, chunk1).unwrap();
        storage.write_chunk(file_id, 2, chunk2).unwrap();

        let total_size = (chunk0.len() + chunk1.len() + chunk2.len()) as u64;

        // Missing chunk test before assembly
        let missing = storage.get_missing_chunks(file_id, 4).unwrap();
        assert_eq!(missing, vec![3]);

        // Assemble and verify
        let verified = storage.assemble_and_verify(file_id, 3, total_size, None).expect("Assembly failed");
        assert_eq!(verified.size_bytes, total_size);
        assert!(!verified.sha256_hash.is_empty());
        assert!(verified.storage_path.exists());

        // Cleanup test directory
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
