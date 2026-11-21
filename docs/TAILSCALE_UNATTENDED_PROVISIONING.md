# PrintDrop — Tailscale Unattended Windows 11 Provisioning Guide

This document captures the architecture, security rules, and 1-tap unattended provisioning approach for enrolling Windows 11 PrintDrop stations onto the Provider's Tailscale tailnet without interactive browser logins or console authentication popups.

> [!IMPORTANT]
> Remote support connectivity must be disclosed in PrintDrop's Terms of Service / Support Agreement. Windows Administrator (UAC) elevation is required once during initial installation.

---

## 1. Prerequisites in Tailscale Admin Console

### A. Configure ACL Tags & Tenant Isolation (Mandatory)
Without ACL tags, any shopkeeper PC on the same tailnet could reach other shopkeeper PCs or the Provider's admin machine.

In **Tailscale Admin Console → Access Controls**, define:
- `tag:provider-admin` — Provider's support/admin laptops
- `tag:printdrop-station` — Shopkeeper Windows 11 POS stations

Example ACL policy:
```jsonc
{
  "tagOwners": {
    "tag:provider-admin": ["autogroup:admin"],
    "tag:printdrop-station": ["autogroup:admin"]
  },
  "acls": [
    {
      // Provider admin laptops can reach shopkeeper stations (e.g. HTTP 8080, RDP 3389, SSH 22)
      "action": "accept",
      "src": ["tag:provider-admin"],
      "dst": ["tag:printdrop-station:*"]
    }
    // Shopkeeper stations CANNOT reach each other or tag:provider-admin
  ]
}
```

### B. Generate a Tagged Auth Key (or OAuth Client)
In **Tailscale Admin Console → Settings → Keys → Generate auth key**:
- **Reusable**: Enabled (or use a Tailscale OAuth Client to mint single-use 5-minute keys per station)
- **Pre-approved**: Enabled (no manual approval required per PC)
- **Tags**: `tag:printdrop-station` *(tagged nodes automatically disable 180-day key expiry)*

> [!CAUTION]
> **Never commit `tskey-auth-...` keys to GitHub or hardcode them inside `printdrop.exe`.** Pass the key at runtime via parameter/prompt or mint short-lived single-use keys from a private backend/Admin Portal flow.

---

## 2. Unattended Windows 11 Installation & Join Flow

Run from an **Administrator PowerShell** session during onboarding or remote support:

```powershell
# 1. Silent MSI installation (zero wizard UI)
msiexec /i "tailscale-setup-latest-amd64.msi" /quiet /norestart

# 2. Wait briefly for the Windows Tailscale service to register
Start-Sleep -Seconds 5

# 3. Headless unattended join (no browser login, runs as Windows Service before user login)
& "C:\Program Files\Tailscale\tailscale.exe" up `
  --auth-key="tskey-auth-REPLACE_AT_RUNTIME" `
  --unattended `
  --hostname="printdrop-shop-name" `
  --accept-dns=false

# 4. Verify assigned 100.x.y.z Tailscale IP
& "C:\Program Files\Tailscale\tailscale.exe" ip -4
```

### Key Flags Explained
| Flag | Purpose |
| :--- | :--- |
| `--auth-key` | Authenticates the station non-interactively without opening a browser login window. |
| `--unattended` | Keeps the tunnel running strictly as the Windows `Tailscale` service (starts at boot even before Windows login) without requiring the interactive GUI tray app (`tailscale-ipn.exe`). |
| `--hostname` | Labels the node in Tailscale Admin Console (e.g. `printdrop-awesome-xerox` or station HWID). |
| `--accept-dns=false` | Prevents MagicDNS from interfering with the shopkeeper's local LAN/router DNS. |

---

## 3. Optional: Suppressing Interactive Tray Auto-Start
Because `--unattended` runs via the Windows Service, the interactive tray app (`tailscale-ipn.exe`) is not needed for connectivity and can confuse shopkeepers with status/disconnect menus. Disabling its HKLM/HKCU `Run` startup entry keeps the service running quietly in the background while avoiding accidental user disconnects.

---

## 4. Implementation Options (For Future Rollout)
1. **Option A — Standalone Technician Script (`scripts/setup-tailscale-station.ps1`)**:
   - Invoked by the Provider during onboarding/support with `-AuthKey` and `-ShopName`.
   - Zero credentials embedded in PrintDrop installers or public repositories.
2. **Option B — Integrated Admin Portal + PrintDrop Support Tunnel**:
   - Admin Portal mints a short-lived single-use key via Tailscale OAuth Client.
   - Desktop app joins on demand and reports its `100.x.y.z` IP to Supabase `licenses` for 1-click visibility in the Admin Portal.
