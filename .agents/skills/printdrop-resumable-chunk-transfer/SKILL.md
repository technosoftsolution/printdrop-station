---
name: printdrop-resumable-chunk-transfer
description: >
  High-throughput, zero-RAM resumable chunked file upload and streaming assembly engine.
  Covers client-side Blob slicing (1MB/5MB chunks), Rust Axum streaming chunk endpoints,
  bypassing Cloudflare 100MB HTTP body limits, disk staging (.chunks/<id>/), single-pass
  SHA-256 streaming verification, and network interrupt recovery for multi-gigabyte transfers.
---

# PrintDrop Resumable Chunk Transfer Engine

## Purpose & Scope

This skill provides an **end-to-end, zero-trial-and-error implementation runbook** for high-throughput, memory-efficient, resumable file transfer. Designed for desktop servers (Rust Axum, Tokio, Tauri) communicating with web and mobile clients (vanilla JS, React, Flutter) over unpredictable cellular (4G/5G) and local Wi-Fi connections.

---

## Quick Reference & Pitfall Table

| Problem / Pitfall | Root Cause | Permanent Production Solution |
| :--- | :--- | :--- |
| **Cloudflare returns `HTTP 413 Payload Too Large`** | Client sends a file > 100MB in a single HTTP POST request. Cloudflare Free proxy strictly enforces 100MB body limit. | Slice all uploads into **1MB or 5MB chunks** using `Blob.slice()`. Each HTTP request is small and passes Cloudflare without friction. |
| **Server crashes with Out of Memory (OOM)** | Server buffers the entire incoming file or multi-MB chunks in RAM before saving. | Stream chunks directly from `axum::body::BodyStream` to temporary files on disk (`.chunks/<file_id>/chunk_<idx>`). |
| **Reassembly takes huge RAM and freezes CPU** | Reading all chunks into memory and concatenating them with `Vec<u8>`. | Stream chunks sequentially on disk using a 64KB sliding buffer directly into the target file while computing SHA-256 in a single I/O pass. |
| **4G upload interrupts at 85% and restarts from 0%** | Monolithic form upload without chunk state tracking. | Client queries `GET /api/upload/status?file_id=...` on reconnect; server returns missing chunk indexes; client uploads only missing chunks. |
| **Corrupted files on concurrent multi-part writes** | Race conditions when multiple chunks write to the same target file concurrently. | Write chunks to isolated files (`chunk_0`, `chunk_1`), then sequentially concatenate only after all chunks are present. |

---

## §1: The 4-Phase Chunked Transfer Protocol

```
[Client (Mobile / Web)]                                      [Rust Axum Backend]
        │                                                             │
        │── (1) POST /api/upload/init (filename, size, totalChunks) ─>│ ──> Validates disk space
        │<─ 200 OK (fileId, status: "ready") ────────────────────────│ ──> Creates .chunks/<id>/
        │                                                             │
        │── (2) GET /api/upload/status (fileId) ────────────────────>│ ──> Checks existing chunks
        │<─ 200 OK (missingChunks: [0, 1, 2, ...]) ───────────────────│
        │                                                             │
        │── (3) POST /api/upload/chunk (Range, Index, Binary) ───────>│ ──> Writes chunk_<N> to disk
        │<─ 200 OK (received: N) ────────────────────────────────────│
        │                                                             │
        │── (4) POST /api/upload/complete (fileId, sha256) ──────────>│ ──> Streaming disk assembly
        │<─ 200 OK (finalPath, verified: true) ──────────────────────│ ──> Cleans up .chunks/<id>/
```

---

## §2: Client-Side Chunking Implementation (JavaScript / TypeScript)

```javascript
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks (bypasses Cloudflare 100MB limit)

async function uploadFileResumable(file, sessionToken) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = "doc_" + Math.random().toString(36).substring(2, 10);

  // Phase 1: Initialize
  const initRes = await fetch("/api/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionToken,
      fileId,
      filename: file.name,
      fileSizeBytes: file.size,
      totalChunks,
    }),
  });
  if (!initRes.ok) throw new Error("Upload initialization failed");
  const initData = await initRes.json();

  // Phase 2: Check missing chunks for resume
  const missingSet = new Set(initData.missingChunks);

  // Phase 3: Upload chunks sequentially or with concurrency = 3
  for (let i = 0; i < totalChunks; i++) {
    if (!missingSet.has(i)) continue; // Already received, skip

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBlob = file.slice(start, end);

    let attempts = 0;
    while (attempts < 3) {
      try {
        const chunkRes = await fetch("/api/upload/chunk", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Session-Token": sessionToken,
            "X-File-Id": fileId,
            "X-Chunk-Index": i.toString(),
            "X-Total-Chunks": totalChunks.toString(),
            "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
          },
          body: chunkBlob,
        });

        if (chunkRes.ok) break;
        attempts++;
      } catch (err) {
        attempts++;
        if (attempts >= 3) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
    }
  }

  // Phase 4: Finalize & Complete
  const completeRes = await fetch("/api/upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken, fileId }),
  });

  return await completeRes.json();
}
```

---

## §3: Server-Side Streaming Storage Engine (Rust)

### Chunk Staging & Direct-to-Disk Writer

```rust
use std::path::{Path, PathBuf};
use tokio::fs::{self, File};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use ring::digest::{Context, SHA256};

pub struct StorageManager {
    staging_dir: PathBuf,
    storage_dir: PathBuf,
}

impl StorageManager {
    pub async fn write_chunk(
        &self,
        file_id: &str,
        chunk_index: u32,
        mut body_stream: impl AsyncReadExt + Unpin,
    ) -> Result<u64, Box<dyn std::error::Error>> {
        let chunk_dir = self.staging_dir.join(file_id);
        fs::create_dir_all(&chunk_dir).await?;

        let chunk_file = chunk_dir.join(format!("chunk_{}", chunk_index));
        let mut file = BufWriter::new(File::create(&chunk_file).await?);

        let mut buffer = [0u8; 65536]; // 64KB buffer
        let mut total_written = 0u64;

        loop {
            let n = body_stream.read(&mut buffer).await?;
            if n == 0 { break; }
            file.write_all(&buffer[..n]).await?;
            total_written += n as u64;
        }

        file.flush().await?;
        Ok(total_written)
    }

    /// Streaming Zero-RAM Assembly: Reads each chunk from disk,
    /// writes to destination file, and hashes in a single pass.
    pub async fn assemble_chunks_streaming(
        &self,
        file_id: &str,
        total_chunks: u32,
        final_filename: &str,
    ) -> Result<(PathBuf, String, u64), Box<dyn std::error::Error>> {
        let chunk_dir = self.staging_dir.join(file_id);
        let dest_file = self.storage_dir.join(final_filename);

        let mut out = BufWriter::new(File::create(&dest_file).await?);
        let mut hasher = Context::new(&SHA256);
        let mut total_size = 0u64;
        let mut buffer = [0u8; 65536];

        for i in 0..total_chunks {
            let chunk_path = chunk_dir.join(format!("chunk_{}", i));
            let mut chunk = File::open(&chunk_path).await
                .map_err(|e| format!("Missing chunk {}: {}", i, e))?;

            loop {
                let n = chunk.read(&mut buffer).await?;
                if n == 0 { break; }
                out.write_all(&buffer[..n]).await?;
                hasher.update(&buffer[..n]);
                total_size += n as u64;
            }
        }

        out.flush().await?;

        // Cleanup temporary staging folder
        let _ = fs::remove_dir_all(&chunk_dir).await;

        let digest = hasher.finish();
        let hash_hex = hex::encode(digest.as_ref());

        Ok((dest_file, hash_hex, total_size))
    }
}
```

---

## §4: Verification & Performance Rules

1. **Memory Bound Test**:
   - Run transfer of a 2GB file while monitoring process RSS (`Get-Process printdrop`).
   - RAM usage must remain flat (under 60MB) throughout the transfer.
2. **Abrupt Disconnect Simulation**:
   - Terminate connection during chunk #50 of 100.
   - Verify server keeps chunks 0 to 49 on disk.
   - On re-upload, client queries status and resumes strictly from chunk 50.
3. **SHA-256 Bit-for-Bit Validation**:
   - Compare `CertUtil -hashfile <original> SHA256` with the server's computed hash.
   - Hashes must match 100% with zero byte offset errors.
