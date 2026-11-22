# PrintDrop — Unified Design System (`MASTER.md`)

> **Version**: 1.0 (Generated with `ui-ux-pro-max` + Live Codebase Audit)
> **Scope**: Shared visual language across all 3 PrintDrop surfaces:
> 1. **Customer Mobile Portal** (`src-tauri/src/server/customer.html`) — *Express Retail Self-Service*
> 2. **Admin Fleet Portal** (`admin-portal/index.html`) — *SaaS Licensing & Telemetry Command Center*
> 3. **Desktop Counter Station** (`src/App.tsx` + `src/components/*`) — *High-Speed Windows POS Terminal*

---

## 1. Brand Aesthetic & Core Philosophy

- **Visual Direction**: **Precision Dark-Slate Retail & POS** — high-contrast midnight slate surfaces with disciplined semantic accents, hairline borders, tabular numerals for money/codes, and crisp SVG iconography.
- **Core Principles**:
  1. **Zero-Friction Retail Speed**: Every primary action (Upload, Pay, Approve, Print) is immediately recognizable in <1 second.
  2. **One Cohesive Brand**: All 3 surfaces share identical semantic color tokens, badge meanings, and typography hierarchy.
  3. **Commercial Trust**: Replace ad-hoc emoji UI icons with crisp, uniform-stroke (`2px`) Lucide-style SVGs.
  4. **Offline & Performance Guardrails**:
     - `customer.html` is embedded in the Rust binary and must remain **100% offline-LAN safe** (zero Google Fonts CDN, zero external icon CDNs, pure system font stack + inline SVG).
     - Desktop POS (`WebView2`) avoids expensive continuous `backdrop-filter` or heavy layout-thrashing animations to stay instantaneous on 1024×768–1080p shop monitors.

---

## 2. Semantic Color Tokens

All 3 surfaces use the exact same dark-slate semantic palette:

| Token | Hex | Usage |
| :--- | :--- | :--- |
| `--pd-bg-canvas` | `#090D16` | Page / app canvas background |
| `--pd-bg-surface` | `#111827` | Primary cards, panels, modals |
| `--pd-bg-elevated` | `#182235` | Nested cards, hover surfaces, drawers |
| `--pd-bg-inset` | `#0B1120` | Inputs, segmented tracks, code chips |
| `--pd-border-subtle` | `#1E293B` | Hairline card & divider borders |
| `--pd-border-strong` | `#334155` | Interactive control borders & focus containers |
| `--pd-text-primary` | `#F8FAFC` | Headings, filenames, primary labels (contrast > 15:1) |
| `--pd-text-secondary` | `#CBD5E1` | Body copy, specs, secondary values (contrast > 10:1) |
| `--pd-text-muted` | `#94A3B8` | Helper text, metadata, timestamps (contrast > 6:1 on `#090D16`) |
| `--pd-brand-primary` | `#4F46E5` | Primary CTA, active tab, brand accent (Indigo 600) |
| `--pd-brand-primary-hover` | `#6366F1` | Hover / highlight accent (Indigo 500) |
| `--pd-brand-soft` | `rgba(99, 102, 241, 0.14)` | Soft indigo pill/icon container background |
| `--pd-success` | `#10B981` | Connected, Paid, Approved, Completed, Money totals |
| `--pd-success-text` | `#34D399` | High-contrast green text on dark surfaces |
| `--pd-warning` | `#F59E0B` | Pickup Code highlight, Awaiting Review, Unpaid due |
| `--pd-warning-text` | `#FBBF24` | High-contrast amber text on dark surfaces |
| `--pd-info` | `#0EA5E9` | Live Printing / Spooling, Remote customer, App View |
| `--pd-info-text` | `#38BDF8` | High-contrast cyan/sky text on dark surfaces |
| `--pd-danger` | `#EF4444` | Rejected, Paper Jam, Delete/Shred, Offline error |
| `--pd-danger-text` | `#F87171` | High-contrast red text on dark surfaces |

> **Contrast Rule**: Never use `#64748B` (Slate 500) for critical readable text on `#111827` (contrast < 4.5:1). Use `#94A3B8` (Slate 400) minimum for captions/helpers, `#CBD5E1` for secondary body, `#F8FAFC` for primary text.

---

## 3. Typography & Numeric Discipline

- **Font Stack**:
  - **Customer Portal (Offline-Safe)**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
  - **Desktop & Admin Portal**: `'Inter', system-ui, -apple-system, sans-serif`
  - **Monospace (IDs, Pickup Codes, Prices, HWIDs)**: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- **Tabular Numerals**: Always apply `font-variant-numeric: tabular-nums;` on all prices (`₹12.00`), page counts, pickup codes (`#4821`), and queue countdowns so digits never jitter during live SSE updates.
- **Type Scale**:
  - **Display / Pickup Token**: `2rem–2.25rem`, `font-weight: 900`, tracking `0.08em`
  - **Section Heading**: `1rem–1.125rem`, `font-weight: 700`
  - **Card Title / Filename**: `0.875rem–0.95rem`, `font-weight: 600`
  - **Body / Controls**: `0.8125rem–0.875rem`, `line-height: 1.5`
  - **Micro Labels / Badges**: `0.6875rem–0.75rem`, `font-weight: 700` (never `< 11px` for readable labels)

---

## 4. Spacing, Radii & Elevation Rhythm

- **4px / 8px Spacing Grid**: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`.
- **Border Radii**:
  - Cards & Modals: `16px` (`1rem`) / Bottom Sheets: `20px` (`1.25rem`) top corners
  - Buttons & Inputs: `10px–12px` (`0.65rem–0.75rem`)
  - Pills & Status Badges: `9999px` (full pill)
  - Document Type Chips: `8px` (`0.5rem`)
- **Elevation**: Prefer **1px crisp borders + tonal surface stepping** (`#090D16` → `#111827` → `#182235`) over heavy drop shadows. Reserve glow shadows strictly for primary CTAs and active Pickup Code cards.

---

## 5. Iconography & Motion Rules

- **No Emoji as Structural UI Icons**:
  - Replace structural emojis (`📁`, `📤`, `🖨️`, `🔍`, `⛶`, `🚀`, `👤`, `🔄`, `🧾`, `🔒`, `➕`) with **inline Lucide-style SVGs** (`width: 16–20px`, `stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`, `aria-hidden="true"` when beside text).
  - Reserve expressive icons only for empty-state illustrations or status badges where SVG icons give sharper clarity.
- **Motion & Interaction**:
  - Fast press feedback: `120ms ease-out` (color/opacity/subtle elevation — never layout-shifting transforms).
  - Modal / drawer entrance: `220ms cubic-bezier(0.16, 1, 0.3, 1)`.
  - Always include `@media (prefers-reduced-motion: reduce)` to disable non-essential animations.
  - Always add `touch-action: manipulation;` on buttons/interactive controls on mobile.

---

## 6. Global Pre-Delivery Checklist (All 3 Surfaces)

- [ ] No emojis used as structural navigation/button icons (crisp SVG icons used instead).
- [ ] All interactive controls have `cursor: pointer`, clear `:hover` / `:active` feedback, and visible `:focus-visible` ring.
- [ ] Mobile touch targets ≥ `44×44px` with ≥ `8px` spacing between adjacent controls.
- [ ] Body & helper text contrast ≥ `4.5:1` against dark surfaces (`#94A3B8` minimum on `#111827`).
- [ ] All monetary totals, pickup codes, and counters use `font-variant-numeric: tabular-nums`.
- [ ] Safe areas (`env(safe-area-inset-*)`) respected on fixed headers, sheets, and sticky bottom CTA bars.
- [ ] `@media (prefers-reduced-motion: reduce)` honored.
- [ ] Zero broken existing JS/Rust/Tauri IDs, handlers, SSE hooks, or Razorpay payment flows.
