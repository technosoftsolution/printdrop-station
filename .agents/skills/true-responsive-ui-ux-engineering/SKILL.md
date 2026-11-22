---
name: true-responsive-ui-ux-engineering
description: Systematic end-to-end engineering playbook for building and upgrading truly responsive websites, mobile web portals, SaaS dashboards, and Desktop webview apps (Tauri/Electron) using the ui-ux-pro-max design intelligence skill plus the 4-Point True-Responsive Architecture (Monitor-Aware Window Clamping, Fluid vw+vh clamp() Typography, Proportional Fluid Grids, and Single-Row Adaptive Headers & Scrollable Overlays). Use whenever creating a new responsive frontend or fixing layout breakage across low-res laptops (1024x768, 1366x768 @ 125% DPI), mobile phones (375px+), and 1080p/4K monitors.
---

# True-Responsive UI/UX Engineering Playbook

A repeatable, battle-tested methodology (proven across PrintDrop's Mobile Web Portal, SaaS Admin Portal, and Windows 11 Tauri Desktop POS) combining **`nextlevelbuilder/ui-ux-pro-max-skill`** with **4 concrete responsive engineering pillars** so any web or desktop-webview app scales cleanly from **375px phones** to **1024×768 / 1366×768 @ 125% laptops** to **4K monitors** without breaking layout structure.

---

## Prerequisites: Global `ui-ux-pro-max` Skill Setup

Ensure `ui-ux-pro-max` is installed globally (pure Python 3.x, zero pip dependencies):

```powershell
# Verify Python 3.x and global skill path
python --version
Test-Path "C:\Users\$env:USERNAME\.gemini\config\skills\ui-ux-pro-max\scripts\search.py"
```

If installing fresh on a new machine:
1. Clone `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill` (`--depth 1`).
2. Copy `.claude/skills/ui-ux-pro-max` into `C:\Users\<USER>\.gemini\config\skills\ui-ux-pro-max`.
3. Update `${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py` in `SKILL.md` to the absolute global path.

---

## Phase 1 — Design-System-First Audit (Before Touching UI Code)

Always generate and persist a cohesive design system **before** editing CSS/HTML/JSX:

1. **Query `ui-ux-pro-max` for Product Direction & UX Rules**:
   ```bash
   python "C:/Users/<USER>/.gemini/config/skills/ui-ux-pro-max/scripts/search.py" "<product_type> <domain> <keywords>" --design-system -p "<ProjectName>"
   python "C:/Users/<USER>/.gemini/config/skills/ui-ux-pro-max/scripts/search.py" "mobile touch target responsive" --domain ux -n 6
   python "C:/Users/<USER>/.gemini/config/skills/ui-ux-pro-max/scripts/search.py" "saas dashboard table drawer" --domain style -n 3
   ```
2. **Read `references/pro-rules.md`** for mobile touch targets, contrast thresholds, safe areas, and the pre-delivery checklist.
3. **Persist `design-system/<project>/MASTER.md`** defining:
   - Semantic CSS custom properties (`--bg-canvas`, `--bg-surface`, `--bg-elevated`, `--border-subtle`, `--text-primary`, `--text-secondary`, `--text-muted`, `--brand-primary`, `--success`, `--warning`, `--info`, `--danger`).
   - Contrast floor: **≥ 4.5:1** for body/caption text (`#94A3B8` minimum on dark `#111827` surfaces; never `#64748B` for readable labels).
   - Typography & `tabular-nums` discipline for all prices, IDs, and counters.
   - Offline/performance guardrails (e.g., system font stack + inline 2px SVGs for offline/embedded portals).
4. **Create Per-Surface Override Blueprints** (`design-system/<project>/pages/<surface>.md`) listing concrete audit findings sorted by severity (`CRITICAL → HIGH → MEDIUM → LOW`).
5. **Take a Git Backup Checkpoint** before applying UI edits.

---

## Phase 2 — The 4-Point True-Responsive Architecture

Never rely on rigid pixel widths or abrupt breakpoint font jumps. Implement all 4 pillars systematically:

### Point 1: Viewport & Monitor-Aware Initialization
- **Mobile & Web (`<head>`)**:
  - **NEVER** disable pinch-zoom (`maximum-scale=1.0, user-scalable=no` is an accessibility violation).
  - Always use:
    ```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    ```
  - Respect safe areas on fixed headers, sheets, and sticky bottom bars:
    ```css
    padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));
    padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
    ```
- **Desktop WebView Apps (Tauri / Electron)**:
  - A hardcoded `1280×700` startup window **overflows** `1366×768` laptops running at **125% Windows DPI scaling** (logical viewport = `1092×614`) and clips behind the taskbar.
  - In Tauri `.setup(|app| { ... })`, clamp & center startup size to logical monitor work area:
    ```rust
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = win.current_monitor() {
            let scale = monitor.scale_factor();
            let phys = monitor.size();
            let logical_w = (phys.width as f64) / scale;
            let logical_h = (phys.height as f64) / scale;
            let max_w = (logical_w * 0.94).max(780.0);
            let max_h = (logical_h * 0.88).max(540.0);
            if 1280.0 > max_w || 700.0 > max_h {
                let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                    1280.0_f64.min(max_w),
                    700.0_f64.min(max_h),
                )));
                let _ = win.center();
            }
        }
    }
    ```

### Point 2: True Fluid Viewport-Proportional Typography (`clamp()`)
- **Anti-Pattern to Avoid**: Never attach a blanket font-size jump to window maximize (e.g., `html[data-maximized="true"] { font-size: 17.5px; }`). On a `1366×768` laptop, maximizing blindly inflates `rem` by +25% and breaks single-row headers and cards!
- **Correct Pattern**: Drive root `font-size` smoothly from **both viewport width and height** via `clamp()`, and upscale only when **both** width AND height confirm a genuine large monitor:
  ```css
  :root {
    font-size: clamp(12px, 0.42vw + 0.48vh + 5.5px, 15.5px);
  }
  @media screen and (min-width: 1680px) and (min-height: 900px) {
    :root { font-size: 16.5px; }
  }
  @media screen and (min-width: 2100px) and (min-height: 1100px) {
    :root { font-size: 18px; }
  }
  ```

### Point 3: Proportional Fluid Grids (Eliminate Fixed-Pixel Sidebars)
- **Anti-Pattern to Avoid**: `lg:grid-cols-[510px_1fr]` — on a `1024px`–`1092px` screen, a fixed `510px` sidebar steals 50% of the viewport and crushes the primary workspace.
- **Correct Pattern**: Use proportional `minmax()` tracks with upper/lower bounds so the primary workspace always retains **≥ 65%** of available width:
  ```html
  <div class="grid grid-cols-1 lg:grid-cols-[minmax(320px,34%)_1fr] xl:grid-cols-[minmax(380px,35%)_1fr] 2xl:grid-cols-[440px_1fr] gap-4 xl:gap-6 flex-1 min-h-0">
  ```
- Always add `min-w-0` on flex/grid children that contain truncating text or scrollable inner containers so CSS Grid/Flexbox never refuses to shrink them.

### Point 4: Single-Row Adaptive Headers, Scrollable Dropdowns & Clamped Modals
- **Single-Row Header Discipline**:
  - Keep `<header>` `flex-nowrap` at desktop breakpoints (`flex-wrap lg:flex-nowrap items-center justify-between gap-2`).
  - Give the left brand block `min-w-0 shrink` + `truncate` on titles/subtitles.
  - Give the right action group `flex-nowrap shrink-0` and every status pill/button `whitespace-nowrap shrink-0`.
  - Hide secondary verbose labels at tighter widths (`hidden xl:inline` / `hidden 2xl:inline`) and clamp `<select>` max-widths responsively (`max-w-[115px] xl:max-w-[165px] 2xl:max-w-[205px]`).
- **Viewport-Clamped Scrollable Dropdowns**:
  - Never render tall dropdown menus without a height ceiling (`max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain`).
  - For hover-opened desktop menus with many items, dynamically compute `maxHeight = Math.max(220, window.innerHeight - triggerRect.bottom - 18)` on open/resize, add top/bottom scroll indicator bars, and run a `requestAnimationFrame` edge-hover auto-scroll when the cursor enters the top/bottom 56px zones.
- **Modal Viewport Safety**:
  - Every modal/drawer must use `max-h-[90vh] flex flex-col overflow-hidden` with an internal `overflow-y-auto overscroll-contain` body and sticky header/footer.

---

## Phase 3 — Commercial UI Polish & Accessibility Checklist

Apply consistently across every surface:
- [ ] **No Structural Emojis as UI Icons**: Use uniform `2px`-stroke SVG icons (Lucide React or offline-safe inline `<svg class="pd-svg" aria-hidden="true">`).
- [ ] **Tabular Numerals**: Apply `font-variant-numeric: tabular-nums` (`.tabular-nums`) on all prices, IDs, codes, KPIs, and counters.
- [ ] **Mobile Touch Ergonomics**: `touch-action: manipulation` on all interactive controls (eliminates 300ms tap delay), `overscroll-behavior-y: contain`, touch targets ≥ `40–46px` with ≥ `8px` spacing.
- [ ] **Keyboard & Motion Accessibility**:
  ```css
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
- [ ] **Status Badges Never Wrap**: Add `white-space: nowrap; flex-shrink: 0;` to all status pills so badges like `Awaiting Review` stay on one clean line.
- [ ] **Declutter Dense Cards**: Keep Row 1 strictly for primary identity + live status; move secondary metadata/billing badges to Row 2.

---

## Phase 4 — Verification Matrix

Before shipping any responsive UI pass, verify:
1. **Build & Syntax**:
   - TypeScript/Vite: `npx tsc --noEmit && npm run build`
   - Rust/Tauri (if applicable): `cargo check --manifest-path src-tauri/Cargo.toml`
   - Single-file HTML portals: validate all inline `<script>` blocks via `node -e` (`new Function(script)`).
2. **Resolution Matrix**:
   - **375px** (small phone portrait) — zero horizontal overflow, ≥44px touch targets, single-line badges.
   - **768px** (tablet / split-screen) — clean grid reflow, no clipped modals.
   - **1024×768 & 1366×768 @ 125% Windows scaling** (default AND maximized) — startup window fits above taskbar, header stays single-row with right controls pinned top-right, main workspace ≥ 65% width, dropdowns never clip bottom edge.
   - **1920×1080 & 4K** — balanced typography without excessive whitespace or oversized pills.
