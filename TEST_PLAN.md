# PrintDrop Comprehensive Verification & Test Plan

## 1. Test Strategy Overview

PrintDrop requires rigorous verification across three testing tiers:
1. **Automated Unit & Integration Tests**: Rust unit tests for SQLite persistence, revision bumping, chunk assembly, SHA-256 verification, and path traversal defense.
2. **Simulated Hardware & Network Tests**: Automated tests with simulated Wi-Fi disconnects, partial chunk uploads, corrupted hashes, and mock printer adapters.
3. **Physical End-to-End Tests**: Testing on a real physical Android phone connected to the shop's local Wi-Fi, paired with a Windows 11 desktop and physical/virtual printers.

---

## 2. Test Suite Matrix

### Category A: Transfer & Session Security Tests

| Test ID | Scenario | Expected Outcome | Verification Method |
| :--- | :--- | :--- | :--- |
| **SEC-01** | Connect with valid QR session token | Session accepted, quota limits returned, web UI loads | Automated API test / Mobile browser |
| **SEC-02** | Connect with expired session token | HTTP 401/403, clear message: "Session expired; request new QR" | Automated API test |
| **SEC-03** | Connect with revoked session | Immediate rejection, all active operations blocked | Automated API test |
| **SEC-04** | Cross-order access attempt (`Token_A` querying `Order_B`) | HTTP 403 Forbidden, no metadata leaked | Automated security test |
| **SEC-05** | Upload exceeding individual file limit (>50MB) | Rejected at preflight and HTTP receiver (HTTP 413) | Client & server unit test |
| **SEC-06** | Upload exceeding total order quota (>200MB) | Preflight validation blocks submission, receiver enforces limit | Client & server unit test |
| **SEC-07** | Directory traversal in filename (`../../Windows/win.ini`) | Filename stripped to safe metadata; disk path uses generated UUID | Automated unit test |
| **SEC-08** | Malformed / Null-byte filenames (`file\0.pdf`, `CON.txt`) | Windows reserved names and null bytes normalized safely | Automated unit test |
| **SEC-09** | Rate limiting / Flooding chunk endpoints | Receiver throttles excessive parallel requests with HTTP 429 | Automated benchmark test |

---

### Category B: Resumable Upload & Storage Tests

| Test ID | Scenario | Expected Outcome | Verification Method |
| :--- | :--- | :--- | :--- |
| **UPL-01** | Multi-file chunked upload (e.g. 3 files, 1MB chunks) | All chunks stored in staging; assembled cleanly on complete | Automated integration test |
| **UPL-02** | Wi-Fi disconnect mid-upload (simulate lost connection) | Upload pauses; upon reconnect, resumes from missing chunk index | Automated mock network test |
| **UPL-03** | Mobile browser refresh mid-upload | Client reads chunk map from local store and resumes without restarting from byte 0 | Manual mobile browser test |
| **UPL-04** | Desktop application restart during active upload | DB retains partial chunk map; client resumes seamlessly when server restarts | Automated crash test |
| **UPL-05** | SHA-256 hash mismatch (corrupted chunk) | Complete request fails; staging file discarded; file marked FAILED | Automated test with mutated byte |
| **UPL-06** | Duplicate chunk upload / duplicate complete call | Idempotent handling; no file corruption or duplicate records | Automated API test |

---

### Category C: Order Revision & State Machine Tests

| Test ID | Scenario | Expected Outcome | Verification Method |
| :--- | :--- | :--- | :--- |
| **ORD-01** | Initial order submission | Creates Order ID, Revision 1 snapshot, files in RECEIVED state | DB transaction test |
| **ORD-02** | Customer edits print settings (e.g. changes copies 1 -> 3) | Generates Revision 2; Revision 1 remains auditable in DB | DB transaction test |
| **ORD-03** | Customer deletes a file before approval | Generates Revision 3; file marked `is_deleted` in Rev 3 | DB transaction test |
| **ORD-04** | Customer adds a new file before approval | Generates Revision 4; requires chunk upload for new file | Integration test |
| **ORD-05** | **Approval Invalidation**: Customer edits after Shopkeeper approves | Prior approval record status marked `INVALIDATED`; order reverts to `AWAITING_APPROVAL` | Automated business logic test |
| **ORD-06** | Print gate enforcement | "Print All" button strictly disabled unless exact current revision is `APPROVED` | Desktop UI component test |
| **ORD-07** | Shopkeeper order rejection | Order transitions to `REJECTED`; customer receives rejection notice with reason | End-to-end integration test |

---

### Category D: Print Engine & Spooler Tests

| Test ID | Scenario | Expected Outcome | Verification Method |
| :--- | :--- | :--- | :--- |
| **PRN-01** | PDF printing via SumatraPDF adapter | Submits to selected printer with requested duplex, color, and copies | Virtual / Physical printer test |
| **PRN-02** | Image printing (PNG / JPG) | Proper scaling, orientation, and resolution applied | Virtual / Physical printer test |
| **PRN-03** | Multi-file sequential batch printing (e.g. 5 files) | Processed one-by-one in order; queue sequence maintained | Automated batch runner test |
| **PRN-04** | Rapid duplicate clicks on "Print All" | Idempotent submission: only one batch dispatched; no duplicate print jobs | Desktop UI & Rust test |
| **PRN-05** | Printer offline / out of paper | Spooler error caught; job marked `FAILED` with diagnostic message | Hardware test / mock spooler |
| **PRN-06** | Desktop app crash/kill during active printing | On restart, completed jobs remain completed; pending jobs marked `UNCERTAIN` for shopkeeper review | Crash recovery test |

---

### Category E: Customer Real-Time Status & Synchronization

| Test ID | Scenario | Expected Outcome | Verification Method |
| :--- | :--- | :--- | :--- |
| **STA-01** | Real-time SSE status push on mobile | Phone screen dynamically updates when shopkeeper approves and prints | Mobile device test |
| **STA-02** | Mobile phone screen lock / sleep and reopen | SSE reconnects automatically; reconciles missed status events | Mobile device test |
| **STA-03** | SSE fallback to polling | If SSE stream blocked by proxy/firewall, polling fallback updates status | Automated web test |
| **STA-04** | Status link reopen | Secure, expiring link allows customer to check status if browser was closed | Browser bookmark test |

---

## 3. Physical Hardware & Manual Verification Procedure

### Procedure for Mobile-to-Desktop Acceptance:
1. Connect Windows 11 laptop to shop Wi-Fi (or turn on Windows Mobile Hotspot).
2. Launch PrintDrop desktop application; note the displayed LAN IP and QR code.
3. Open camera on a physical Android phone connected to the same Wi-Fi.
4. Scan QR code; confirm mobile browser opens `http://<LAN_IP>:<PORT>/?session=<TOKEN>`.
5. Select 2 PDF documents and 1 JPG image.
6. Configure File 1 as *Duplex B&W (2 copies)*, File 2 as *Single-sided Color (1 copy)*.
7. Tap **"Submit Order"**; verify progress bars complete and screen shows *"Awaiting Shopkeeper Approval"*.
8. On Windows desktop, inspect the order details; verify requested settings match.
9. Click **"Approve Revision"**; verify customer phone displays *"Order Approved"*.
10. Click **"Print All"**; observe animated batch progress (*"File 1 of 3: Preparing... Spooling..."*).
11. Confirm output on physical printer or Windows "Microsoft Print to PDF".
