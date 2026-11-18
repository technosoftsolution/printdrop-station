# AI Master Prompt: Zero-Cost Self-Hosted Multi-GB File Transfer & Vault Engine

> **Project Codename**: `VaultDrop` (High-Performance Self-Hosted Cloud & Media Pipeline)  
> **Target Platforms**: Windows 11 / Linux Server / Raspberry Pi (Server Node) + Responsive Web PWA & Mobile Flutter Client  
> **Core Directive**: 100% Free of Cloud Hosting Charges • 100% Private Data Sovereignty • Unlimited Multi-Gigabyte (GBs) Streaming Transfers

---

## 1. Project Overview & Vision

You are tasked with building **VaultDrop**, an enterprise-grade, zero-recurring-cost file transfer and media synchronization platform. 

### Problem Statement
Traditional cloud providers (Google Drive, Dropbox, OneDrive, AWS S3) charge heavy recurring subscription fees (₹1,500 – ₹12,000+ per year), enforce strict storage tiers (15GB/100GB/2TB), apply lossy compression on 4K videos and high-resolution photos, and expose confidential factory/corporate IP or intimate family memories to third-party cloud servers.

### Solution
A self-hosted, lightweight personal/corporate vault server written in **Rust** running on an existing PC, mini-PC, or home/office NAS. Field staff, factory site visitors, and family members can capture high-resolution photos, large PDFs, or multi-gigabyte 4K videos and stream them directly into the vault from anywhere in the world over 4G/5G mobile internet or local Wi-Fi. Authorized users at the home or corporate office gain immediate real-time access to view, stream, or download these files without paying a single rupee to any third-party cloud host.

---

## 2. Comprehensive Technology Stack

| Layer | Technology | Purpose & Justification |
| :--- | :--- | :--- |
| **Server Engine** | **Rust (Edition 2021) + Tokio + Axum 0.8** | Asynchronous, zero-cost abstractions, non-blocking I/O. Streams multi-GB files directly to disk with under 50MB RAM usage. |
| **Desktop GUI / Wrapper** | **Tauri 2.x (Rust + Vite + React + TailwindCSS)** | Native system tray integration, auto-start on boot, local status dashboard, and zero-headache Windows/Linux binaries. |
| **Headless Service** | **Rust CLI Daemon (`systemd` / Windows Service)** | Allows running headlessly on home servers, Linux boxes, or Raspberry Pi. |
| **Database** | **SQLite 3 in WAL Mode (`rusqlite`)** | Embedded, single-file, zero-maintenance, zero-configuration database capable of 100,000+ reads/sec with atomic transactions. |
| **Zero-Cost Remote Networking** | **Cloudflare Tunnel (`cloudflared`)** | ₹0 forever. Exposes secure HTTPS endpoints (`https://vault.yourdomain.com`) without public static IPs or router port-forwarding. |
| **P2P Mesh Networking** | **Tailscale / WireGuard** | Free tier (up to 100 devices). Encrypted direct peer-to-peer virtual LAN connecting trusted devices at full line-rate broadband speed (100–900 Mbps). |
| **Local Discovery** | **mDNS (`mdns-sd`) / Local LAN** | Auto-discovers the vault on local Wi-Fi for ultra-fast local transfers bypassing the internet. |
| **Web Frontend** | **Vanilla JS / TypeScript PWA + Web Workers** | Universal client. Works on any smartphone camera, tablet, or PC without installing any native app. |
| **Mobile Companion (Optional)** | **Flutter (Android & iOS)** | Background photo sync, native share sheet target, offline queuing, and camera burst capture. |
| **Media Transcoding** | **`image` crate + FFmpeg sidecar (optional)** | Fast thumbnail generation and keyframe extraction for instant gallery browsing. |

---

## 3. Architecture Blueprint & System Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       FIELD / MOBILE CLIENTS                                │
│   - Site Inspectors, Factory Visitors, Family Members (Any Smartphone/PC)   │
│   - Instant Camera Capture • 5MB/10MB Chunk Slicer • Offline IndexedDB Queue │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 │                                           │
                 ▼                                           ▼
   [Local Wi-Fi Network]                         [Remote Internet (4G / 5G)]
   - Zero Internet usage                         - Dual Remote Tunneling:
   - Full LAN Speed (100-900 Mbps)                 a) Cloudflare Tunnel (Guests)
   - Discovered via mDNS                           b) Tailscale WireGuard (Family/Team)
                 │                                           │
                 └─────────────────────┬─────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    VAULTDROP RUST SERVER ENGINE                             │
│                                                                             │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐ │
│  │   Axum HTTP Router    │  │ Resumable Chunk Srv   │  │ Media Streaming │ │
│  │ (Auth / Tokens / CORS)│  │ (.chunks/<id>/chunk_N)│  │ (HTTP 206 Range)│ │
│  └───────────┬───────────┘  └───────────┬───────────┘  └────────┬────────┘ │
│              │                          │                       │           │
│              ▼                          ▼                       ▼           │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐ │
│  │ SQLite WAL Catalog    │  │ Streaming Assembler   │  │ Zip Archiver    │ │
│  │ (Metadata, Audit Log) │  │ (Zero-RAM SHA-256 Pipe│  │ (Async ZIP-RS)  │ │
│  └───────────────────────┘  └───────────┬───────────┘  └─────────────────┘ │
└─────────────────────────────────────────┼───────────────────────────────────┘
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PHYSICAL STORAGE VAULT                                │
│   - Local NVMe SSD / SATA Hard Drive / NAS Mirror (e.g. 2TB - 16TB HDD)     │
│   - Storage Layout: `/vault/storage/{user_id}/{year}/{month}/{file_hash}`   │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     OFFICE & HOME RECEIVER DASHBOARD                        │
│   - Real-Time Live Feed • Instant 4K Video Playback • 1-Click Batch ZIP     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Multi-Gigabyte (GB-Scale) Resumable Chunking Protocol

To reliably transfer files ranging from **100MB to 50GB+** over unstable 4G/5G connections without crashing memory or hitting Cloudflare limits, implement this exact 4-phase protocol:

### Sizing Parameter
* **Chunk Size (`CHUNK_SIZE`)**: Default to **5 MB** (`5,242,880` bytes) or **10 MB** (`10,485,760` bytes).
* **Cloudflare Compatibility**: Cloudflare Free limits single HTTP bodies to 100 MB. Since our chunks are 5 MB to 10 MB, Cloudflare **never triggers `HTTP 413 Payload Too Large`**, regardless of total file size.

### Protocol Steps

#### Phase 1: Upload Initiation (`POST /api/vault/upload/init`)
* **Request Payload**:
  ```json
  {
    "clientFileId": "client_generated_uuid",
    "filename": "factory_survey_4k.mp4",
    "fileSizeBytes": 4294967296,
    "chunkSizeBytes": 5242880,
    "totalChunks": 820,
    "sha256": "optional_client_checksum",
    "tags": ["factory", "inspection", "unit-3"]
  }
  ```
* **Server Action**:
  - Validates available physical disk space (`fs2::available_space`).
  - Creates atomic temporary staging directory: `.vault_staging/{file_id}/`.
  - Registers entry in SQLite table `upload_sessions`.
  - Returns `200 OK` with session token.

#### Phase 2: Resume / Gap Analysis (`GET /api/vault/upload/status?fileId={file_id}`)
* **Purpose**: If the network drops at chunk #340 of 820, the client reconnects and asks which chunks the server already has.
* **Server Response**:
  ```json
  {
    "fileId": "file_uuid",
    "totalChunks": 820,
    "receivedChunks": [0, 1, 2, ..., 339],
    "missingChunks": [340, 341, ..., 819],
    "bytesReceived": 1782579200
  }
  ```
* **Benefit**: Zero re-uploading of already transmitted data; saves mobile battery and cellular data.

#### Phase 3: Binary Chunk Upload (`POST /api/vault/upload/chunk`)
* **Headers**:
  - `X-Vault-File-Id`: `{file_id}`
  - `X-Vault-Chunk-Index`: `340`
  - `Content-Type`: `application/octet-stream`
  - `Content-Length`: `5242880`
* **Server Action**:
  - Uses `axum::body::BodyStream` to stream the binary chunk directly to disk file `.vault_staging/{file_id}/chunk_340.part`.
  - Atomically renames to `chunk_340.done`.
  - **Zero RAM Allocation**: Memory footprint remains flat (<50MB).

#### Phase 4: Streaming Assembly & Verification (`POST /api/vault/upload/complete`)
* **Server Action**:
  1. Verifies that all chunks `0` through `totalChunks - 1` exist on disk.
  2. Opens final destination file: `/vault/storage/{hash}.dat`.
  3. Uses a streaming 64KB buffer with `tokio::io::copy` and `ring::digest::Context` to sequentially read each chunk, write it to the final file, and compute the SHA-256 hash in a **single pass**.
  4. Deletes the staging folder `.vault_staging/{file_id}/`.
  5. Atomically commits the file record and metadata to SQLite.

---

## 5. SQLite Database DDL Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Vault Nodes (Server Information)
CREATE TABLE IF NOT EXISTS vault_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    storage_root_path TEXT NOT NULL,
    total_space_bytes INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users / Access Identities
CREATE TABLE IF NOT EXISTS vault_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN', 'FAMILY', 'FIELD_STAFF', 'GUEST')),
    pin_hash TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Staged / In-Flight Upload Sessions
CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES vault_users(id),
    original_filename TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    chunk_size_bytes INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    received_chunks_mask BLOB,
    status TEXT NOT NULL CHECK(status IN ('INITIALIZED', 'UPLOADING', 'COMPLETED', 'ABORTED')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Stored File Catalog
CREATE TABLE IF NOT EXISTS vault_files (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES vault_users(id),
    original_filename TEXT NOT NULL,
    clean_filename TEXT NOT NULL,
    extension TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    storage_relative_path TEXT NOT NULL UNIQUE,
    sha256_hash TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('PHOTO', 'VIDEO', 'DOCUMENT', 'ARCHIVE', 'OTHER')),
    width INTEGER,
    height INTEGER,
    duration_seconds REAL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_trashed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Collections (Albums, Inspection Batches, Project Folders)
CREATE TABLE IF NOT EXISTS vault_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    collection_type TEXT NOT NULL CHECK(collection_type IN ('FAMILY_ALBUM', 'SITE_INSPECTION', 'FACTORY_PROJECT')),
    created_by TEXT REFERENCES vault_users(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Collection Items Mapping
CREATE TABLE IF NOT EXISTS collection_items (
    collection_id TEXT NOT NULL REFERENCES vault_collections(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES vault_files(id) ON DELETE CASCADE,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, file_id)
);

-- 7. Audit Event Ledger
CREATE TABLE IF NOT EXISTS vault_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    actor_id TEXT,
    file_id TEXT,
    ip_address TEXT,
    details_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_files_category ON vault_files(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_hash ON vault_files(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_audit_created ON vault_audit_log(created_at DESC);
```

---

## 6. Remote Zero-Cost Networking Architecture

### Strategy A: Cloudflare Quick Tunnel (Public Guests & Field Workers)
1. Server automatically detects or launches bundled `cloudflared` binary:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8080 --no-autoupdate
   ```
2. Cloudflare dynamically assigns an HTTPS URL: `https://xxxx-xxxx.trycloudflare.com` (or binds to a custom domain like `vault.yourcompany.com`).
3. Field visitors simply scan a QR code or tap the link on their mobile phones.
4. **No static IP, no port forwarding on the router, no monthly bill**.

### Strategy B: Tailscale WireGuard Mesh (Permanent Team & Family Members)
1. Install Tailscale on the Vault PC and family/staff mobile phones (Free tier supports up to 100 devices).
2. The server receives a fixed internal IP: `100.100.10.51`.
3. Mobile devices communicate **directly peer-to-peer** with end-to-end WireGuard encryption.
4. Speeds reach full broadband capacity (100–900 Mbps) with zero proxy intermediaries.

---

## 7. Media Streaming & Viewing Architecture

To ensure remote users at home or corporate offices can immediately preview multi-GB videos without waiting for a 4 GB download:

* **HTTP 206 Partial Content (Range Requests)**:
  - Implement an Axum endpoint supporting `Range: bytes=start-end`.
  - When viewing a 4K factory video in the browser, the browser requests only the first 2 MB to start playing instantly within 500 milliseconds.
* **On-The-Fly ZIP Streaming**:
  - When the office user clicks *"Download All 200 Factory Photos"*, do not build a 5 GB ZIP file on disk.
  - Use `async_zip` in Rust to stream compressed bytes over the HTTP connection as they are read from disk. Memory remains under 20MB.

---

## 8. Mobile PWA & Client Staging (Offline Tolerance)

Mobile devices frequently lose signal inside factory basements or remote project sites:
1. **IndexedDB Local Blob Staging**:
   - The web app stores captured photos in the mobile browser's `IndexedDB` with status `PENDING_SYNC`.
2. **Background Sync Worker**:
   - As soon as the device detects network connectivity (`navigator.onLine` or window focus), it begins uploading the staged queue chunk by chunk.
3. **Native Share Target**:
   - The PWA registers as an Android Web Share Target, allowing field staff to select 30 photos in their native phone gallery and tap *"Share > VaultDrop"*.

---

## 9. Implementation Roadmap (Step-by-Step Instructions)

### Phase 1: High-Throughput Rust Core & Storage Layer
1. Scaffold Cargo workspace with crates: `axum`, `tokio`, `rusqlite`, `serde`, `uuid`, `ring`, `tracing`, `tower-http`.
2. Build `StorageManager` to handle chunk directories, stream reassembly, and disk space pre-flight validation.
3. Implement `init_upload`, `upload_chunk`, `upload_status`, and `complete_upload` endpoints.

### Phase 2: SQLite Schema & Transactional State Engine
1. Implement migration runner (`PRAGMA journal_mode = WAL`).
2. Implement file metadata indexing, tagging, and collection mapping.
3. Write unit tests simulating power cut / network drops during chunk assembly.

### Phase 3: Dual Networking Layer
1. Add local network adapter auto-discovery (IPv4 extraction and mDNS broadcast).
2. Integrate `cloudflared` auto-supervisor (launches daemon, parses assigned tunnel URL, emits QR code).
3. Add Tailscale IP awareness for trusted mesh peers.

### Phase 4: Web Application & Touch-Friendly PWA
1. Build responsive dashboard (TailwindCSS + React or Vanilla TS).
2. Build mobile-first upload deck with drag-and-drop, camera burst trigger, and progress ring.
3. Add chunked JavaScript upload engine with auto-retry and concurrency throttled to 3 parallel chunks.

### Phase 5: Media Streaming & Batch Export
1. Implement HTTP 206 Range Request handler for video seek and instant playback.
2. Implement dynamic streaming ZIP handler (`async_zip`) for multi-file downloads.
3. Integrate background thumbnail generator using the `image` crate.

### Phase 6: Packaging & Standalone Deployment
1. Package GUI wrapper in Tauri 2 for Windows desktop tray management.
2. Provide headless CLI mode (`vaultdrop-server --daemon`) for Docker, Ubuntu Server, or Raspberry Pi.
3. Create single-executable installer with zero external runtime dependencies.

---

## 10. Verification Criteria Checklist

- [ ] Uploading a 2GB test video via mobile 4G/5G slices into 5MB chunks and bypasses Cloudflare limits.
- [ ] Intentionally toggling Wi-Fi off at 50% progress pauses the upload; re-enabling Wi-Fi resumes seamlessly from the exact interrupted chunk.
- [ ] Rust process RAM usage remains below 60 MB throughout a 10 GB multi-file concurrent transfer.
- [ ] Playing a 4K video from the office web dashboard starts playing within 1 second using HTTP 206 Range headers.
- [ ] No third-party cloud accounts, AWS S3 buckets, or recurring credit card subscriptions are required. Data is 100% hosted on local physical disk storage.
