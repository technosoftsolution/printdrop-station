# Surface 2 Audit & Upgrade Blueprint: Admin Fleet Portal (`admin-portal/index.html`)

> **Target File**: `admin-portal/index.html`
> **Priority**: **#2 (Step 4 — After Customer Mobile Portal)**
> **User Persona**: PrintDrop Software Provider / SaaS Operator managing shopkeeper licenses, trial extensions, UPI/Razorpay plans, OTA rollouts, and remote support.
> **Style Direction**: **Data-Dense SaaS Command Center** (`MASTER.md` dark-slate tokens + clean KPI bento row + scannable table + refined slide-over Manage Drawer).

---

## 1. Current UI/UX Audit Findings

| # | Severity | Issue Found in `admin-portal/index.html` | Fix Plan |
| :-: | :---: | :--- | :--- |
| 1 | **HIGH** | Top Provider Profile banner is tall and competes visually with the primary KPI metrics & Station Fleet table. | Make the Provider Profile strip sleeker and more compact so KPI cards and the Station Fleet table sit higher above the fold. |
| 2 | **MEDIUM** | Dense station table rows & status pills vary in height/alignment across Trial / Wallet / Monthly / Expired states. | Standardize row height, align numeric columns (`tabular-nums`, right-aligned), and apply consistent semantic pill tokens from `MASTER.md`. |
| 3 | **MEDIUM** | Admin Settings dropdown (`#adminSettingsDropdownMenu`) lacks viewport height clamping (same issue fixed on Desktop). | Add `max-h-[calc(100vh-5rem)] overflow-y-auto` and sleek scrollbar styling. |
| 4 | **MEDIUM** | Manage Drawer & Daily Print Usage Ledger can benefit from stronger section dividers, sticky drawer header/footer, and clearer primary vs. destructive button hierarchy. | Apply consistent card elevation, sticky drawer header, and clear visual grouping for License Controls vs. Danger Zone. |
| 5 | **LOW** | Mix of `Inter` + `JetBrains Mono` already loaded cleanly, but tabular numerals (`tabular-nums`) aren't consistently applied to KPI counts & billing figures. | Enforce `tabular-nums` across all KPI cards, ledger tables, and revenue totals. |

---

## 2. Step 4 Implementation Scope

- Preserve **100%** of Supabase queries, HMAC-SHA256 signing, OTA policy manager, printable receipts/certificates, CSV export, and Support Hub shortcuts.
- Upgrade KPI strip, filter bar, station fleet table typography/alignment, Manage Drawer visual hierarchy, and Settings dropdown scroll clamping.
