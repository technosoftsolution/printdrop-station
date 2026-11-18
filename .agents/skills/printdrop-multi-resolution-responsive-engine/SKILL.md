---
name: printdrop-multi-resolution-responsive-engine
description: >
  Cross-device responsive layout and mobile touch optimization runbook for desktop POS stations
  and customer web portals. Covers adapting from small 800x600/1024x768 billing monitors to 1080p
  widescreens, mobile sticky upload dropzones, unblocking Android Storage Access Framework multi-file
  selection, modal top-clipping prevention, and mobile Chrome desktop-mode self-healing.
---

# PrintDrop Multi-Resolution Responsive Engine & Mobile Touch UI

## Purpose & Scope

This skill provides an **end-to-end design and CSS/Tailwind runbook for cross-resolution applications**. It solves the dual challenge of building a Windows desktop app that runs flawlessly on legacy, low-resolution retail billing monitors (800×600, 1024×768) as well as 1080p displays, while serving a mobile customer web portal that adapts to modern Android and iPhone viewports.

---

## Quick Reference & Pitfall Table

| Problem / Pitfall | Root Cause | Permanent Production Solution |
| :--- | :--- | :--- |
| **Android Chrome refuses to select multiple files** | Using a heterogeneous extension list in `accept=".pdf,.doc,.docx,..."`. Android SAF falls back to single-item mode. | Remove restrictive extension filter from `<input type="file" multiple>`. Handle format validation via client-side JavaScript on `change` event. |
| **Dropzone scrolls out of view when staging 10+ files** | Dropzone placed as standard static block above file list. Customer has to scroll all the way back up to add more files. | Apply **Sticky Top Pinning**: `position: sticky; top: 0.35rem; z-index: 35;` with an opaque backdrop blur. Dropzone sticks neatly to the top edge while files scroll underneath. |
| **Modal header/toolbar cut off on small desktop screens** | Using `flex items-center justify-center` on an overflowing modal container. Content overflows upwards past pixel 0. | Use `items-start justify-center py-4` on the fixed modal wrapper. Ensures toolbars, tabs, and close buttons always start at the visible top of the viewport. |
| **Customer turns on "Desktop Site" on phone, breaking UI** | Android Chrome forces a 980px viewport width, making mobile text and touch buttons microscopic. | Self-healing detection: Detect `isTouch && window.innerWidth >= 768` and append `body.touch-desktop-mode` with scaled font and touch padding. |
| **Order grid squished on 1024x768 shop monitors** | Hardcoded 3-column or 4-column layout. | Fluid responsive grid: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4` with responsive gap `gap-3 sm:gap-4`. |

---

## §1: Unblocking Android Native Multi-File Selection

### The Flawed Approach (Causes Single-File Fallback on Mobile)
```html
<!-- FAILS on Android: Multi-select checkboxes disappear -->
<input type="file" id="fileInput" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp">
```

### The Production Solution
```html
<!-- SUCCEEDS: Native Android & iOS file managers grant full multi-select -->
<input type="file" id="fileInput" multiple style="display:none">
```

```javascript
// Validate in JavaScript without breaking native OS multi-select
const SUPPORTED_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "webp", "bmp", "gif"];

function handleFilesSelected(e) {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      showAlert(`"${file.name}" has an unsupported format. Supported: PDF, Word, Excel, PPT, Photos.`);
      continue;
    }
    // Add valid file to staging queue...
  }
}
```

---

## §2: Compact Sticky Dropzone for Mobile Touch

When customers upload multiple documents, vertical space on mobile phones is precious. A standard 200px dropzone wastes half the screen.

```css
/* Compact Dropzone with Sticky Top Pinning */
.dropzone-card {
  margin-top: 0.65rem;
  background: rgba(19, 28, 46, 0.96);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1.5px dashed #3b82f6;
  border-radius: 1rem;
  padding: 0.55rem 0.85rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  position: sticky;
  top: 0.35rem;
  z-index: 35;
}

/* Reduced Folder Icon with Minimal Gap */
.upload-icon {
  width: 32px;
  height: 32px;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 0.2rem;
  font-size: 1.15rem;
  font-weight: bold;
}

.drop-title {
  font-size: 0.92rem;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.25;
}

.drop-subtitle {
  font-size: 0.68rem;
  color: #94a3b8;
  margin-top: 0.15rem;
  line-height: 1.2;
}

/* Desktop Preservation (Restore Spacious Dimensions & Static Flow) */
@media screen and (min-width: 800px) {
  .dropzone-card {
    position: static;
    padding: 2.2rem 1.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  }
  .upload-icon {
    width: 44px;
    height: 44px;
    margin: 0 auto 0.75rem;
    font-size: 1.4rem;
  }
  .drop-title { font-size: 1.05rem; }
  .drop-subtitle { font-size: 0.75rem; margin-top: 0.25rem; }
}
```

---

## §3: Modal Top-Clipping Prevention on Low-Resolution Monitors

```tsx
/* BAD: Top overflows above viewport on 800x600 or 1024x768 screens */
<div className="fixed inset-0 flex items-center justify-center overflow-y-auto">

/* GOOD: Always anchors toolbar at visible top, scrolling naturally downwards */
<div className="fixed inset-0 flex items-start justify-center p-3 sm:p-5 z-50 overflow-y-auto">
```

---

## §4: Mobile Chrome "Desktop Site" Self-Healing

When customers check "Desktop Site" in mobile Chrome:

```javascript
function checkDesktopMode() {
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if ((isTouch || isMobile) && window.innerWidth >= 768) {
    document.body.classList.add("touch-desktop-mode");
  }
}
checkDesktopMode();
```

```css
/* Auto-scale elements so touch buttons remain comfortable */
body.touch-desktop-mode {
  max-width: 880px !important;
  width: 95% !important;
  font-size: 135%;
  padding: 1.5rem 1rem 6rem;
}
body.touch-desktop-mode .btn-primary,
body.touch-desktop-mode .action-btn {
  font-size: 1.45rem;
  padding: 1.2rem;
  border-radius: 1.2rem;
}
```
