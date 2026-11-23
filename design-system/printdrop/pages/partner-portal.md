# Surface 4 Audit & Upgrade Blueprint: Partner Sales Portal (`partner-portal/index.html`)

> **Target File**: `partner-portal/index.html`
> **User Persona**: Independent Field Marketing / Sales Partners (on Android/iOS phones in the field, tablets, and laptops) tracking their onboarded Xerox shopkeepers, revenue share, and provider payouts.
> **Style Direction**: **Mobile-First Precision Dark-Slate Sales Workspace** (`MASTER.md` tokens + violet/emerald accents + zero-horizontal-scroll 375px mobile cards + scannable desktop tables + Tailscale VPN & GitHub Pages ready).

---

## 1. True-Responsive Engineering Checklist

| # | Pillar | Implementation in `partner-portal/index.html` |
| :-: | :--- | :--- |
| 1 | **Viewport & Safe Areas** | `viewport-fit=cover` (pinch-zoom enabled), `env(safe-area-inset-top)` on sticky header, `env(safe-area-inset-bottom)` on main workspace & modals, `overscroll-behavior-y: contain`. |
| 2 | **Fluid `clamp()` Typography** | Root `font-size: clamp(13px, 0.35vw + 0.35vh + 7.5px, 15.5px)` with large-monitor scaling (`≥ 1680×900`), `tabular-nums` on all `₹` figures, counts, and dates. |
| 3 | **Adaptive Dual-Layout Data Views** | Zero-overflow **Mobile Cards (`sm:hidden`)** on 375px–639px phones with 1-tap Call/WhatsApp actions + **Sticky-Header Tables (`hidden sm:block`)** on tablets/laptops/desktops across all 3 tabs (Shopkeepers, Ledger, Payouts). |
| 4 | **Single-Row Header & Clamped Overlays** | `flex-nowrap` header with `min-w-0 truncate` title, `whitespace-nowrap shrink-0` pills/buttons (≥ 40–44px touch targets), `max-h-[calc(100vh-5rem)] overscroll-contain` Settings dropdown, and `max-h-[92vh]` scrollable modals. |
| 5 | **Icon & Accessibility Hygiene** | Uniform 2px Lucide SVG icons (no structural emojis), `touch-action: manipulation`, `:focus-visible` outlines, `prefers-reduced-motion`, and ≥ 4.5:1 contrast floor (`#94A3B8` minimum on dark surfaces). |
| 6 | **Network & Security** | Served alongside Admin Portal via `scripts/serve-admin-portal.mjs` over Localhost, LAN, and **Tailscale VPN (`http://100.x.y.z:8787/partner`)**, plus static HTTPS hosting on GitHub Pages. |
