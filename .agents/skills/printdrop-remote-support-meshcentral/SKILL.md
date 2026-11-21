---
name: printdrop-remote-support-meshcentral
description: Complete architectural runbook, setup guide, security hardening checklist, and pros/cons reference for PrintDrop's zero-cost, white-labeled Remote Desktop Support architecture using local MeshCentral + Cloudflare Quick Tunnel + Supabase signaling.
---

# PrintDrop White-Labeled Remote Support Architecture (MeshCentral + Cloudflare + Supabase)

This skill documents how PrintDrop provides **₹0/month, 100% PrintDrop-branded on-demand Remote Desktop, File Transfer, and Terminal support** to Windows 11 shopkeeper stations behind Indian ISP CGNAT (JioFiber, Airtel, 4G/5G) without requiring a paid VPS, paid domain, or third-party branded tools (AnyDesk, TeamViewer, Tailscale).

---

## 1. Architecture Overview

```text
[Provider Windows 11 Laptop]                  [Supabase Cloud]                       [Shopkeeper Windows 11 PC]
npm run support:hub                           system_config                          PrintDrop Desktop App
  ├─ MeshCentral (127.0.0.1:4430)             key: provider_remote_support_tunnel    Settings → Connect to Remote Support
  ├─ cloudflared.exe quick tunnel ──► POST ──► { active: true,                         ├─ Reads live WSS URL + pinned ServerID
  │   (https://<slug>.trycloudflare.com)         tunnelUrl, meshServerWss,             ├─ Downloads/caches PrintDropSupportAgent.exe
  └─ Opens http://127.0.0.1:4430                 serverId, meshId, meshName }          ├─ Writes PrintDropSupportAgent.msh
                                                                                       └─ Runs PrintDropSupportAgent.exe -connect
          ▲                                                                                       │
          └────────────────────── Encrypted TLS WebSocket (Port 443) + WebRTC P2P ────────────────┘
```

### Key Components
| Component | Location | Responsibility |
| :--- | :--- | :--- |
| **Provider Support Hub** | `support-hub/start-support-hub.ps1`, `support-hub/config.template.json`, `support-hub/package.json` | Runs local MeshCentral (`127.0.0.1:4430`, `tlsOffload`), spawns `cloudflared` quick tunnel, publishes live endpoint to Supabase on start, marks `active: false` on exit. |
| **Desktop Rust Commands** | `src-tauri/src/commands.rs` (`get_remote_support_status`, `start_remote_support_session`, `stop_remote_support_session`) | Fetches live `provider_remote_support_tunnel` from Supabase, downloads & validates PE (`MZ`) binary `PrintDropSupportAgent.exe` to `%APPDATA%\PrintDrop\support\`, writes pinned `.msh`, launches `-connect` headless, and kills cleanly on disconnect. |
| **Desktop UI** | `src/App.tsx` | **Settings → Connect to Remote Support** 1-click button + prominent green **PrintDrop Remote Support Session Active** banner with 1-click **Disconnect Support**. |
| **Admin Portal Shortcut** | `admin-portal/index.html` | **Settings → PrintDrop Support Hub** button opening `http://127.0.0.1:4430`. |

---

## 2. First-Time One-Off Setup (Provider Laptop — ~2 Minutes)

1. From `C:\Flutter_src\PrintDrop`, run:
   ```powershell
   npm run support:hub
   ```
   - Automatically installs `meshcentral` inside `support-hub/node_modules/` (first run only).
   - Creates `support-hub/meshcentral-data/config.json` from `support-hub/config.template.json`.
   - Starts MeshCentral on `http://127.0.0.1:4430` and opens it in your browser.
2. **Create Your Provider Admin Account**:
   - Register your admin username/password in the browser.
   - Immediately enable **2FA (TOTP Authenticator or Windows Hello/FIDO2)** in **My Account → Account Security**.
3. **Create the Device Group & Export Template `.msh`**:
   - Click **Add Device Group** → name it **`PrintDrop Stations`**.
   - Inside `PrintDrop Stations`, click **Add Agent → Windows (.msh settings file)**.
   - Save the downloaded file as:
     `C:\Flutter_src\PrintDrop\support-hub\station-template.msh`
   - *(This file is gitignored — it supplies the permanent pinned `ServerID` and `MeshID` to `start-support-hub.ps1`.)*
4. **Lock Down Public Signups**:
   - Edit `support-hub/meshcentral-data/config.json` and change `"newAccounts": true` to **`"newAccounts": false`**.
5. **Restart Support Hub**:
   - Press `Ctrl+C` in the terminal and re-run `npm run support:hub`.
   - It now automatically publishes the live `wss://<slug>.trycloudflare.com:443/agent.ashx` + pinned `ServerID` to Supabase!

---

## 3. Daily Support Workflow

1. **Provider**: Run `npm run support:hub` on your Windows 11 laptop. Your browser opens `http://127.0.0.1:4430` (`PrintDrop Support Hub`).
2. **Shopkeeper**: In PrintDrop Desktop, click **Settings → Connect to Remote Support**.
   - PrintDrop fetches the live tunnel URL from Supabase, caches `PrintDropSupportAgent.exe` (once, ~3 MB), writes `.msh` with the pinned `ServerID`, and starts an on-demand `-connect` session.
   - A green banner appears in PrintDrop: *"PrintDrop Remote Support Session Active — Click Disconnect anytime to end access immediately."*
3. **Provider**: The shopkeeper's PC appears live under **PrintDrop Stations** in your browser. Click **Desktop**, **Files**, or **Terminal**.
4. **End Session**: Shopkeeper clicks **Disconnect Support** (immediately kills `PrintDropSupportAgent.exe`), or Provider presses `Ctrl+C` in the Support Hub terminal (marks `active: false` in Supabase).

---

## 4. Security Architecture & Hardening Rules

- **Pinned Root CA (`ServerID`)**: `PrintDropSupportAgent.exe` verifies the server's cryptographic `ServerID` hash during the WebSocket handshake — even if DNS or a tunnel URL were spoofed, the agent refuses to connect to any untrusted server.
- **Zero Inbound Ports**: Shopkeeper PCs only make outbound TLS port `443` connections.
- **Explicit Consent & Zero Persistent Backdoor**: Uses `-connect` on-demand mode — no permanent background service is installed, no UAC Admin prompt is required for standard support, and the shopkeeper can terminate the session in 1 click.
- **Git Secret Hygiene**: `support-hub/meshcentral-data/`, `support-hub/station-template.msh`, and `support-hub/node_modules/` are strictly `.gitignore`d so private Root CA keys never enter GitHub.
- **Mandatory Hardening**:
  - Always set `"newAccounts": false` after creating your admin user.
  - Enable **2FA** on the admin account.
  - Back up `support-hub/meshcentral-data/` securely (losing the Root CA requires regenerating `station-template.msh`).

---

## 5. Benefits, Pros & Cons

### Benefits & Pros
- **₹0/month**: Zero VPS cost, zero domain cost, zero per-seat licensing fees (Apache-2.0).
- **100% White-Labeled**: Branded strictly as **PrintDrop Support Hub / PrintDrop Remote Support** — zero third-party names (no AnyDesk, TeamViewer, Tailscale, or MeshCentral exposed to shopkeepers).
- **Works Behind Indian ISP CGNAT**: Outbound HTTPS/WSS 443 over Cloudflare's Mumbai/Delhi/Chennai PoPs (~40–80 ms RTT), with automatic WebRTC P2P upgrade when NAT permits.
- **Fast & Bandwidth-Efficient**: Dirty-rectangle JPEG/WebP tile updates (10–25 FPS on POS screens) with adjustable quality/scaling for weak 4G hotspots.
- **Zero Installer Bloat**: Agent (~3 MB) downloads on demand only when a shopkeeper actually requests support.
- **Seamless Future Upgrade**: Copy `support-hub/meshcentral-data/` to a ₹350/mo Linux VPS or Oracle Cloud Always Free VM later with a permanent domain (`support.printdrop.in`) for 24×7 unattended access — zero rewrite needed.

### Cons & Limitations
- **Requires Provider PC Running During Support**: Because MeshCentral runs locally on the Provider's laptop, Support Hub must be open when a shopkeeper clicks Connect.
- **Requires PrintDrop Open on Shopkeeper PC (Quick Tunnel Mode)**: Because `trycloudflare.com` URLs rotate per Support Hub restart, the Shopkeeper's PrintDrop app must be running to read the new URL from Supabase (cannot connect while the Shopkeeper's PC is sitting at the Windows Lock Screen before login — upgrade to a permanent domain + Named Tunnel / VPS if lock-screen access is needed).
- **Standard-User Scope in `-connect` Mode**: Running without UAC elevation means Windows Admin UAC prompts on the Shopkeeper's screen cannot be clicked remotely (the shopkeeper clicks "Yes" locally if an admin action is needed).

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| *"PrintDrop Support Hub is currently offline"* | Provider hasn't run `npm run support:hub` or `station-template.msh` wasn't saved yet. | Start `npm run support:hub` on Provider PC and confirm `Published!` appears in terminal. |
| Agent downloads fail (`HTTP 502` or invalid binary) | Cloudflare Quick Tunnel hasn't finished propagating (~3–5s after startup). | Wait 5 seconds and click **Connect to Remote Support** again. |
| Agent connects then immediately disconnects | `ServerID` in `station-template.msh` doesn't match `meshcentral-data/` certs. | Re-download `.msh` from `http://127.0.0.1:4430` → `PrintDrop Stations` → `Add Agent` and overwrite `support-hub/station-template.msh`. |
