---
name: printdrop-dual-source-connection-resilience
description: >
  Dual-source network failure discrimination, persistent station heartbeat, zero-data-loss
  cache preservation, and automated bidirectional reconnection engine for edge desktop stations
  and mobile web customer portals. Covers distinguishing between client phone offline (Source A)
  vs shop desktop/tunnel drop (Source B), background station health probes, retaining customer
  print jobs and staged files during 502 Bad Gateway outages, and self-healing auto-reconnection.
---

# PrintDrop Dual-Source Connection Resilience & Auto-Recovery Engine

## Purpose & Scope

This skill documents the complete architecture, operational rules, and implementation patterns for maintaining **resilient, self-healing connectivity between a Windows 11 edge desktop station (Tauri + Rust + Axum) and customer mobile web portals (HTML5 / Vanilla JS)**.

It eliminates manual reconnection overhead for both shopkeepers and customers by:
1. Monitoring internet reachability on the Windows 11 desktop and automatically launching/resuming remote 4G/5G tunnels (Cloudflare) whenever connection drops or resumes.
2. Discriminating the exact source of a disconnection on the customer's phone:
   - **Source A**: Customer phone lost mobile data or Wi-Fi.
   - **Source B**: Shopkeeper's desktop computer lost internet or Cloudflare tunnel dropped.
3. Preventing loss of user interface state or vanishing print jobs when the station is temporarily offline.
4. Automatically resuming synchronization the second internet returns on either device without requiring manual page reloads.

---

## Quick Reference & Pitfall Table

| Problem / Pitfall | Root Cause | Production Solution |
| :--- | :--- | :--- |
| **Mobile screen stays green "Connected" when Desktop internet drops** | Health checking was only attached to active SSE streams/order status polling in the Sent Orders tab. When the user is idle, composing drafts, or viewing printed jobs, no requests were being made. | **Persistent Global Station Heartbeat**: A 3.0s proactive probe (`/api/pricing/rates?_h=Date.now()`) with an `AbortController` timeout (2.5s) runs across all tabs, detecting desktop drops within 3 seconds even while idle. |
| **Printed jobs vanish when revisiting tab during station drop** | On station drop, Cloudflare returns `502 Bad Gateway` (`resp.ok === false`). The query handler defaulted `orders = []`, cleared the DOM cards, and showed the empty placeholder. | **Zero-Data-Loss In-Memory Cache**: `loadPrintedJobs()` maintains `cachedPrintedOrders`. If the network call fails or returns `!resp.ok`, it triggers the connection alert and retains all rendered cards and pickup codes. |
| **Customer confused whether their phone or shop PC is offline** | A generic "Connection Lost" message causes customers to restart their phones or blame their telecom network. | **Dual-Source Fault Discrimination Engine**: Probes external WAN (`connectivitycheck.gstatic.com` + `1.1.1.1`). If WAN is dead -> **Source A: "📱⚠️ Your Mobile Internet is Offline"**. If WAN is alive -> **Source B: "⏳🖨️ Shop Station Reconnecting"**. |
| **Shopkeeper forgets to start 4G/5G tunnel or restart after outage** | Tunnel had to be manually toggled via settings. When broadband blinked, the tunnel remained dead. | **Automated Desktop Supervisor**: On app launch, Tauri checks WAN. If online, it auto-spawns the tunnel. When desktop internet resumes after an outage, it automatically reconnects the tunnel. |
| **Shopkeeper restarts 4G/5G tunnel manually, but mobile stays on 'Shop Station Reconnecting'** | Cloudflare Quick Tunnels generate a brand new random subdomain on restart (`xyz-new.trycloudflare.com`). The mobile client remained stuck sending probes to the destroyed old subdomain (`xyz-old.trycloudflare.com` returns 530). | **Station Gist Registry Auto-Migration**: Heartbeat queries the raw station registry (`raw/station.json`), verifies the new live origin with a CORS probe, and auto-migrates with `window.location.replace` preserving device token, order ID, and customer name. |
| **Mobile portal stuck displaying `📱 Detecting...`** | Any uncaught JavaScript syntax error in `<script>` aborted execution before DOM hydration could update the device badge. | **Synchronous Inline Initialization**: Inline script executes immediately under the input card during DOM parsing, and the static HTML default is initialized to `📱 Ready`. |

---

## §1: Architectural Overview

```
                      ┌──────────────────────────────────────┐
                      │    Windows 11 Desktop Station        │
                      │  (Tauri 2 + Rust Core + Axum 3000)   │
                      └──────────────────┬───────────────────┘
                                         │
                   Rust WAN Probe & Auto-Tunnel Supervisor
                   (check_internet_reachability every 5s)
                                         │
             ┌───────────────────────────┴───────────────────────────┐
             │                                                       │
      [Broadband Alive]                                       [Broadband Lost]
             │                                                       │
   Auto-Starts/Keeps Active                                Closes Tunnel Process
  Cloudflare Quick Tunnel                                 Notifies Shopkeeper:
  (xxxx.trycloudflare.com)                               "App is in Offline Mode"
             │                                                       │
             └───────────────────────────┬───────────────────────────┘
                                         ▼
                             Cloudflare Edge Network
                                         ▲
             ┌───────────────────────────┴───────────────────────────┐
             │                                                       │
      [Tunnel Reached]                                     [Tunnel Unreachable]
      HTTP 200 OK                                          HTTP 502 / 504 Bad Gateway
             │                                                       │
             └───────────────────────────┬───────────────────────────┘
                                         ▼
                      ┌──────────────────────────────────────┐
                      │   Customer Mobile Web Portal         │
                      │ (customer.html via Safari/Chrome)    │
                      └──────────────────┬───────────────────┘
                                         │
                     Global Station Heartbeat (Every 3.0s)
                    Probes Station & External Captive Portal
                                         │
             ┌───────────────────────────┴───────────────────────────┐
             ▼                                                       ▼
   [External WAN Reachable?]                               [External WAN Dead?]
             │                                                       │
          YES: Station Lost                                       NO: Phone Lost
             ▼                                                       ▼
  Source B: "Shop Station Reconnecting"                   Source A: Client Internet Offline
  Header Badge: [● Shop PC Offline] (Sky Blue)            - Mobile: "Your Mobile Internet is Offline" [● Phone Offline]
  Action: Retain all cached print cards                   - Desktop: "Your Computer Internet is Offline" [● PC Offline]
                                                          Action: Await window 'online' event
```

---

## §2: Windows 11 Desktop Station Implementation

### 1. Rust WAN Internet Reachability Probe (`src-tauri/src/tunnel.rs`)

Desktop reachability is tested by resolving and querying high-reliability DNS/HTTP endpoints (`1.1.1.1`, `8.8.8.8`) with a strict 2-second timeout:

```rust
pub fn check_internet_reachability() -> bool {
    let targets = ["1.1.1.1:53", "8.8.8.8:53"];
    for target in &targets {
        if let Ok(addr) = target.parse::<SocketAddr>() {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok() {
                return true;
            }
        }
    }
    // HTTP fallback check
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(2000))
        .build()
        .and_then(|client| client.head("https://connectivitycheck.gstatic.com/generate_204").send())
        .map(|res| res.status().is_success() || res.status().as_u16() == 204)
        .unwrap_or(false)
}
```

### 2. Desktop Auto-Tunnel Supervisor (`src/App.tsx`)

A React heartbeat effect monitors desktop reachability every 5 seconds:
- **Transition: Online -> Offline**: Notifies shopkeeper: *"⚠️ Internet connection lost! App is in Offline Mode (Local Wi-Fi only)."*
- **Transition: Offline -> Online**: Notifies shopkeeper: *"🌐 Internet connection resumed! Auto-connecting 4G/5G Tunnel..."* and invokes `autoStart4G5GTunnel()`.
- **Top Bar Indicator**: Displays a glowing status pill (`● Online` in emerald vs `⚠️ Offline Mode` in pulsing amber).

---

## §3: Mobile Customer Portal Implementation (`customer.html`)

### 1. Dual-Source Network Discrimination Engine

When a station probe fails or an SSE stream disconnects, `handleConnectionDrop()` probes the phone's WAN reachability to determine the root cause:

```javascript
let currentConnectionStatus = "CONNECTED"; // "CONNECTED" | "MOBILE_OFFLINE" | "STATION_OFFLINE"
let lastWanProbeTime = 0;
let cachedWanResult = true;

async function probeExternalWan() {
  if (navigator.onLine === false) {
    cachedWanResult = false;
    return false;
  }
  const now = Date.now();
  if (now - lastWanProbeTime < 2500) {
    return cachedWanResult;
  }
  lastWanProbeTime = now;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    await fetch("https://connectivitycheck.gstatic.com/generate_204?" + now, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    cachedWanResult = true;
    return true;
  } catch (_) {
    try {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 1500);
      await fetch("https://1.1.1.1/cdn-cgi/trace?" + now, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: controller2.signal
      });
      clearTimeout(timeoutId2);
      cachedWanResult = true;
      return true;
    } catch (_) {
      cachedWanResult = false;
      return false;
    }
  }
}
```

### 2. Proactive Global Station Heartbeat

A lightweight GET request against `/api/pricing/rates?_h=Date.now()` runs continuously every 3 seconds across all views:

```javascript
let globalStationHeartbeatTimer = null;
let isStationHeartbeatInFlight = false;

function startGlobalStationHeartbeat() {
  if (globalStationHeartbeatTimer) return;

  const runHeartbeat = async () => {
    if (isStationHeartbeatInFlight) return;
    isStationHeartbeatInFlight = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const probeUrl = activeTrackingOrderId
        ? "/api/orders/" + encodeURIComponent(activeTrackingOrderId) + "/status"
        : "/api/pricing/rates";
      const probeResp = await fetch(probeUrl + "?_h=" + Date.now(), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (probeResp.ok) {
        if (currentConnectionStatus !== "CONNECTED") {
          handleConnectionRestored();
        }
      } else {
        handleConnectionDrop();
      }
    } catch (_) {
      handleConnectionDrop();
    } finally {
      isStationHeartbeatInFlight = false;
    }
  };

  runHeartbeat();
  globalStationHeartbeatTimer = setInterval(runHeartbeat, 3000);
}
```

### 3. Sticky Glassmorphic Status Alert Banner

Located immediately beneath `<header>`, docked at the top of the viewport (`position: sticky; top: 0.5rem; z-index: 999;`):

- **Source A (Mobile Offline)**:
  - Background: `linear-gradient(135deg, rgba(180, 83, 9, 0.98), rgba(146, 64, 14, 0.96))`
  - Border: `1.5px solid #f59e0b`
  - Icon: `📱⚠️`
  - Title: `Your Mobile Internet is Offline`
  - Pill: `Phone Offline`
  - Header Badge: `Phone Offline` (amber pulse)

- **Source B (Shop Station Offline)**:
  - Background: `linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 58, 138, 0.96))`
  - Border: `1.5px solid #38bdf8`
  - Icon: `⏳🖨️`
  - Title: `Shop Station Reconnecting`
  - Pill: `Auto-Reconnecting`
  - Header Badge: `Shop PC Offline` (sky-blue pulse)

- **Restored State**:
  - Background: `linear-gradient(135deg, rgba(6, 78, 59, 0.98), rgba(4, 120, 87, 0.96))`
  - Border: `1.5px solid #10b981`
  - Icon: `✅`
  - Title: `Reconnected to Shop Station!`
  - Auto-fades after 2.8 seconds.
  - Header Badge: `Connected` (emerald pulse)

---

## §4: Zero-Data-Loss In-Memory Ledger Pattern

When the station drops, Cloudflare returns `502 Bad Gateway`. To prevent wiping completed jobs or staged drafts:

```javascript
let cachedPrintedOrders = [];

async function loadPrintedJobs(autoExpandOrderId) {
  // ... parameters setup ...
  try {
    const resp = await fetch(qUrl, { cache: "no-store" });
    let orders = [];
    if (resp.ok) {
      const data = await resp.json();
      orders = data.orders || [];
    } else {
      handleConnectionDrop();
      if (cachedPrintedOrders.length > 0) {
        // PRESERVE rendered DOM cards: Do not clear list or show empty state!
        return;
      }
    }

    const printedOrders = orders.filter(o => o.status === "COMPLETED" || o.status === "PURGED_BY_CUSTOMER");
    if (resp.ok) {
      cachedPrintedOrders = printedOrders;
    }

    if (printedOrders.length === 0) {
      // ONLY clear list if station is VERIFIED CONNECTED
      if (currentConnectionStatus === "CONNECTED") {
        if (listEl) listEl.innerHTML = "";
        if (emptyEl) emptyEl.style.display = "block";
      }
      return;
    }
    // Render job cards ...
  } catch (e) {
    handleConnectionDrop();
    if (cachedPrintedOrders.length > 0) return;
  }
}
```

---

## §5: Verification & Quality Assurance Protocol

### Test Case 1: Desktop Broadband Drop (Source B Verification)
1. Open PrintDrop desktop station and verify 4G/5G remote tunnel is active (`● Online`).
2. Open customer portal on a physical mobile phone via cellular data (4G/5G).
3. Disconnect internet from the desktop computer (disable Wi-Fi / unplug Ethernet).
4. **Desktop Result**: Emits notification *"⚠️ Internet connection lost! App is in Offline Mode"*. Status pill turns amber.
5. **Mobile Result** (within 3 seconds):
   - Banner appears: `"⏳🖨️ Shop Station Reconnecting"`.
   - Header badge changes to sky-blue `"Shop PC Offline"` with active pulse.
   - Switch to "Printed Jobs" tab: completed orders, pickup codes, and bill amounts remain intact.
6. Reconnect internet on the desktop computer.
7. **Desktop Result**: Emits notification *"🌐 Internet connection resumed! Auto-connecting 4G/5G Tunnel..."*.
8. **Mobile Result** (within 3 seconds):
   - Banner changes to emerald `"✅ Reconnected to Shop Station!"` and auto-hides.
   - Header badge returns to green `"Connected"`.
   - Live synchronization resumes automatically without any manual reload.

### Test Case 2: Mobile Phone Offline Drop (Source A Verification)
1. On the customer phone, toggle Airplane Mode ON (or disable Mobile Data and Wi-Fi).
2. **Mobile Result** (instant via `window.offline` or within 3 seconds):
   - Banner appears: `"📱⚠️ Your Mobile Internet is Offline"`.
   - Header badge changes to amber `"Phone Offline"`.
3. Toggle Airplane Mode OFF.
4. **Mobile Result**: Banner shifts to emerald `"✅ Reconnected to Shop Station!"`, and header badge returns to `"Connected"`.

### Test Case 3: Manual Tunnel Restart, Sub-2-Second Resumption & Tab Preservation
1. On the customer phone, submit a print job and stay on the **"Printed Jobs" tab**.
2. On Desktop, manually stop the 4G/5G tunnel (`⏸️ 4G/5G Stopped`).
3. Mobile immediately displays:
   - Banner: `"⏳🖨️ Shop Station Reconnecting"`.
   - Header badge: `"Shop PC Offline"`.
   - Customer remains on the Printed Jobs tab; all print cards remain visible.
4. On Desktop, restart the 4G/5G tunnel (`Start 4G/5G`).
5. **Mobile Result** (within **1.5–2 seconds**):
   - Fast Supabase PostgREST probe discovers the new ephemeral Cloudflare URL without waiting for Fastly Gist 60-second CDN expiration.
   - Banner flashes: `"Shop Station Reconnected! Resuming your printed jobs..."`.
   - Portal auto-migrates and **remains on the "Printed Jobs" tab** without resetting focus to Drafts.
   - All disconnected error alerts vanish, and the status returns to green `Connected`.

---

## §6: Zero-Cache Cloudflare Tunnel Discovery & Tab Persistence Architecture

### 1. Eliminating the 60-Second Fastly CDN Cache Trap
When a Cloudflare Quick Tunnel restarts on Desktop, it receives a new randomized subdomain (e.g., `abc.trycloudflare.com`).
- **The Fastly CDN Trap**: Raw GitHub Gists (`gist.githubusercontent.com/.../raw/station.json`) enforce `Cache-Control: max-age=300`. Fastly CDN edge nodes ignore URL query busters (`?_t=...`), delaying new URL propagation to mobile devices by up to 60 seconds.
- **The Supabase Real-Time Resolution**: Desktop Rust core (`sync_station_registry_background`) upserts the new tunnel URL directly to Supabase table `system_config` (key: `station_live_registry`) via REST PostgREST. Supabase responds in ~180ms with 0-second cache. Mobile queries Supabase first, reducing reconnection latency from 60 seconds down to < 2 seconds.

### 2. Active Tab State Preservation Across Reconnects
When switching tabs (`switchMobileTab`), the customer portal records the tab state in `localStorage`:
```javascript
function switchMobileTab(tab) {
  currentMobileTab = tab;
  try { localStorage.setItem("printdrop_active_tab", tab); } catch(_) {}
  // ... tab UI toggle ...
}
```
During ephemeral origin migration (`window.location.replace`), the target tab is appended to the destination query parameters:
```javascript
const tabToKeep = currentMobileTab || (lastOrdId ? "printed" : "drafts");
params.set("tab", tabToKeep);
```
On page bootstrap, the portal reads `urlParams.get("tab") || localStorage.getItem("printdrop_active_tab")`. If `printed` or `sent` was active, it calls `switchMobileTab(startTab)`, preventing the UI from defaulting back to the Drafts tab.

---

## §7: Strict Code Validation Rules
- **Node.js V8 Script Parser**: Whenever modifying `customer.html`, validate all `<script>` tags using:
  ```bash
  node -e "const fs = require('fs'); const html = fs.readFileSync('src-tauri/src/server/customer.html', 'utf8'); const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = regex.exec(html)) !== null) { if (m[1].trim()) require('vm').createScript(m[1]); } console.log('VALID');"
  ```
- **Cargo Unit Tests**: Ensure all 59 tests pass: `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Frontend Production Build**: Ensure Vite build passes cleanly: `npm run build`.
