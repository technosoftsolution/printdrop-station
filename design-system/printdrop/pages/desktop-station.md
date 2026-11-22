# Surface 3 Audit & Upgrade Blueprint: Desktop POS Station (`src/App.tsx` + Modals)

> **Target Files**: `src/App.tsx`, `src/index.css`, `src/components/*Modal.tsx`
> **Priority**: **#3 (Step 5 — Targeted POS Polish Pass)**
> **User Persona**: Busy print shopkeeper operating on Windows 11 (1024×768 to 1080p monitors) processing walk-in and remote print orders rapidly.
> **Style Direction**: **High-Speed Dark POS Dashboard** — clarity, scannability, and zero WebView2 lag over heavy visual effects.

---

## 1. Current UI/UX Audit Findings

| # | Severity | Issue Found in Desktop App | Fix Plan |
| :-: | :---: | :--- | :--- |
| 1 | **DONE** | Settings dropdown overflowed bottom of window. | Fixed in `d08ccf4` (viewport-clamped + smooth edge-hover auto-scroll). |
| 2 | **DONE** | Order Card Row 1 congested at default startup width. | Fixed in `d08ccf4` (billing badges moved cleanly to Row 2). |
| 3 | **DONE** | Per-file approval badge showed green "Approved" before review. | Fixed in `d08ccf4` (explicit per-file & order approval states). |
| 4 | **MEDIUM** | Button hierarchy across Order Cards and Inspect Modal uses multiple competing bright colors (amber, emerald, indigo, teal, cyan, rose simultaneously). | Tighten semantic hierarchy: **Primary** (Indigo/Emerald solid), **Secondary** (Slate surface + crisp border), **Danger** (Subtle Rose ghost/outline unless active). |
| 5 | **MEDIUM** | Mixed emoji prefixes inside React buttons/badges (`💰 ₹`, `⏳`, `🚶`, `🌐`, `📱`) alongside Lucide icons. | Gradually replace inline emojis in order cards & modal headers with crisp `lucide-react` icons already bundled in `App.tsx`. |
| 6 | **LOW** | Modal header/footer spacing and border styling varies slightly across the ~10 modal components (`PricingRatesModal`, `PaymentSettingsModal`, `PrinterRoutingModal`, `LicenseActivationModal`, etc.). | Standardize modal shell tokens (header padding, subtle border, sticky footer, focus ring, `tabular-nums` on prices/page counts). |

---

## 2. Step 5 Implementation Scope

- Keep **100%** of Tauri IPC commands, SumatraPDF printing, simulation mode, Cloudflare auto-tunnel, Razorpay standee, OTA disaster recovery, and MeshCentral remote support untouched.
- Perform a clean, surgical visual consistency pass: Lucide icons replacing structural emojis in order cards, `tabular-nums` on all prices/counts, and consistent button/modal hierarchy.
