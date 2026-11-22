# Surface 1 Audit & Upgrade Blueprint: Customer Mobile Portal (`customer.html`)

> **Target File**: `src-tauri/src/server/customer.html`
> **Priority**: **#1 (Step 3 — First Implementation Target)**
> **Customer Persona**: Walk-in or 4G remote customer on Android/iOS standing at or near a print shop counter. First impression directly drives trust, repeat usage, and conversion.
> **Hard Constraint**: Embedded in Rust binary (`include_str!`) — must remain **100% offline-LAN safe** (zero Google Fonts CDN, zero external icon CDN). Keep **100% of existing element IDs, JS functions, SSE, chunked upload, Razorpay, and PWA hooks intact**.

---

## 1. Current UI/UX Audit Findings (From Live Code Inspection)

| # | Severity | Issue Found in `customer.html` | Fix Plan |
| :-: | :---: | :--- | :--- |
| 1 | **CRITICAL** | `viewport` meta disables pinch-zoom (`maximum-scale=1.0, user-scalable=no`). | Change to `width=device-width, initial-scale=1.0, viewport-fit=cover` + add `touch-action: manipulation` on controls. |
| 2 | **HIGH** | Touch targets below 44px: header pills (`padding: 0.25rem 0.5rem`), `.drawer-close` (`28×28px`), `.btn-config` (`padding: 0.3rem 0.7rem`), `.stepper-btn` (`36×36px`), `.btn-remove` (`padding: 0.25rem`). | Upgrade all interactive buttons to comfortable `min-height: 40–44px` touch zones with `>= 8px` gaps. |
| 3 | **HIGH** | Heavy emoji overuse as structural icons (`📁`, `📤`, `🖨️`, `🔍`, `⛶`, `🚀`, `👤`, `🔄`, `➕`, `🧾`, `🔒`) looks like a dev prototype rather than a commercial retail app. | Introduce crisp inline Lucide-style SVG icons across Header, 3-Tab Nav, Dropzone, File Cards, Order Tracker, Receipt, and Sticky Checkout Bar. |
| 4 | **HIGH** | Hardcoded hex colors scattered across CSS & inline styles; low-contrast `#64748b` used for helper text/empty states. | Add `:root` PrintDrop semantic CSS custom properties (`--pd-*`) and lift muted text to `#94A3B8` (≥ 6:1 contrast). |
| 5 | **MEDIUM** | **First-Screen Hierarchy**: Customer Name input card sits *above* the primary "Choose Files" dropzone, adding friction before the #1 action, and the dropzone looks flat. | Elevate the **Hero Upload Dropzone** visually (subtle indigo radial glow, crisp SVG upload badge, supported format chips `PDF · DOCX · XLSX · Photos`), and make the Customer Name bar sleek & compact with a clean focus ring. |
| 6 | **MEDIUM** | **Sticky Bottom Checkout Bar**: Basic dark bar with plain indigo button. | Upgrade to a frosted elevated retail checkout bar displaying live file count + bold `tabular-nums` estimated cost + high-contrast primary CTA (`Send to Print →` / SVG icon) with safe-area padding. |
| 7 | **MEDIUM** | **Order Tracking & Pickup Code Card**: Functional, but cluttered with mismatched inline styles and emoji banners. | Style the **Pickup Token Card** like a crisp digital boarding-pass/counter ticket (high-contrast `#XXXX` tabular monospace, clean 4-step visual progress rail `Sent → Approved → Printing → Ready`, refined receipt card, and clean trust/privacy badge). |
| 8 | **LOW** | Missing `@media (prefers-reduced-motion: reduce)` and `:focus-visible` outlines. | Add global `:focus-visible` ring (`2px solid #6366f1`) and `prefers-reduced-motion` media query. |

---

## 2. Step 3 Implementation Scope (Safe, Surgical, High-Impact)

1. **CSS Design Tokens & Polish Layer (`<style>` block)**:
   - Add `:root` semantic variables from `MASTER.md`, `tabular-nums`, `touch-action: manipulation`, `overscroll-behavior-y: contain`, `:focus-visible`, and `prefers-reduced-motion`.
   - Polish `.header`, `.mobile-nav-tabs`, `.dropzone-card`, `.file-card`, `.sticky-footer`, `.modal-drawer`, `.segment-bar`, `.stepper-btn`, and `.desktop-order-card`.
2. **Header & Navigation Bar**:
   - Crisp PrintDrop brand lockup with subtle indigo icon mark + shop name hydration preserved.
   - Clean SVG icons for **Find Order**, **App View**, and **Live Connected** status pill (preserving `#btnHeaderLookup`, `#btnHeaderFullscreen`, `#headerConnectionBadge` and all ultra-narrow `<=380px` rules).
   - Refined 3-Tab pill switcher (**Drafts**, **Sent Orders**, **Printed Jobs**) with crisp SVG icons and tabular count badges.
3. **Upload Workspace (Drafts Tab)**:
   - Upgraded **Hero Dropzone** with SVG upload icon, concise title (`Tap to Select Files`), and clean format chips (`PDF`, `Word`, `Excel`, `PPT`, `Photos`).
   - Sleek **Customer Name / Counter ID** card with SVG user icon and crisp focus state.
   - Refined **File Cards** (rendered via JS) with crisp 44px touch actions (`Preview`, `Settings`, `Remove`) and cleaner spec pills.
   - Polished **Sticky Checkout Footer** with live total estimate + vibrant emerald/indigo CTA.
4. **Sent Orders & Printed Jobs Polish**:
   - Digital ticket styling for `#trackerPickupBox` with tabular monospace pickup code.
   - Clean SVG icons on action buttons, privacy shield, billing receipt, and empty states.
5. **Verification**:
   - Verify all existing DOM IDs (`#dropzone`, `#fileInput`, `#fileList`, `#stickyFooter`, `#btnSubmitOrder`, `#orderTrackingView`, `#printedJobsView`, `#trackerPickupCode`, `#customerLivePrintCard`, `#trackerBillingCard`, etc.) are 100% preserved.
   - Verify `cargo test --manifest-path src-tauri/Cargo.toml` passes and test across `375px` mobile, `412px` Android, and `1080p` desktop browser viewports.
