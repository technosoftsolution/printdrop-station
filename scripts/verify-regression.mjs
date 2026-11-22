#!/usr/bin/env node
/**
 * PrintDrop Automated Regression & Contract Gate
 *
 * Usage:
 *   npm run test:regression   -> Runs all fast static contract & JS checks (~0.2s)
 *   npm run test:smart        -> Diff-aware: runs only checks matching modified files
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const isSmart = process.argv.includes("--smart");

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}

function fail(msg) {
  failed++;
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`);
}

function assert(condition, msg) {
  if (condition) pass(msg);
  else fail(msg);
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function validateInlineScripts(html, label) {
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert(scripts.length > 0, `${label}: found ${scripts.length} inline <script> block(s)`);
  for (let i = 0; i < scripts.length; i++) {
    try {
      new Function(scripts[i][1]);
      pass(`${label}: inline <script> #${i + 1} syntax valid`);
    } catch (err) {
      fail(`${label}: inline <script> #${i + 1} syntax ERROR -> ${err.message}`);
    }
  }
}

function checkCustomerPortal() {
  console.log("\n[1] Customer Mobile Portal (src-tauri/src/server/customer.html)");
  const html = read("src-tauri/src/server/customer.html");

  validateInlineScripts(html, "customer.html");

  // Critical DOM IDs that JS relies on
  const requiredIds = [
    "dropzone",
    "fileInput",
    "fileList",
    "stickyFooter",
    "btnSubmitOrder",
    "orderTrackingView",
    "printedJobsView",
    "trackerPickupCode",
    "mobileConnectionAlertBanner",
    "connAlertTitle",
    "connAlertMessage",
    "connAlertPill",
    "trackerBillingCard",
    "customerNameInput",
    "headerConnectionBadge",
  ];
  const missingIds = requiredIds.filter((id) => !html.includes(`id="${id}"`));
  assert(
    missingIds.length === 0,
    missingIds.length === 0
      ? `All ${requiredIds.length} critical DOM IDs present`
      : `Missing critical DOM IDs: ${missingIds.join(", ")}`
  );

  // Supabase PostgREST contract (prevents HTTP 400 &_t= regression!)
  const hasInvalidPostgrestCacheBuster = /supabase\.co\/rest\/v1\/[^\n"'`]*[?&]_t=|STATION_REGISTRY_SUPABASE_[A-Z_]+\s*\+\s*["'`]&_t=/.test(html);
  assert(
    !hasInvalidPostgrestCacheBuster,
    "Supabase PostgREST URLs do NOT append invalid &_t= query param (prevents HTTP 400)"
  );
  assert(
    html.includes('"station_tunnel_" + activeHwid') && html.includes("d.stationHwid"),
    "Multi-tenant HWID station tunnel auto-reconnect (station_tunnel_<HWID>) wired"
  );

  // Responsive & UX guardrails
  assert(!/user-scalable\s*=\s*no/i.test(html), "Viewport meta allows pinch-zoom (no user-scalable=no)");
  assert(html.includes("touch-action: manipulation"), "touch-action: manipulation enabled for mobile tap speed");
  assert(html.includes("prefers-reduced-motion"), "prefers-reduced-motion media query present");
  assert(
    !/requestFullscreen\s*\(/i.test(html),
    "No unwanted auto-fullscreen hijack in regular mobile browser view"
  );
}

function checkAdminPortal() {
  console.log("\n[2] Admin Fleet Portal (admin-portal/index.html)");
  const html = read("admin-portal/index.html");

  validateInlineScripts(html, "admin-portal/index.html");

  const requiredIds = [
    "stationsTableBody",
    "adminSettingsDropdownMenu",
    "dashProviderName",
    "statTotalStations",
    "statActiveStations",
    "statTotalRevenue",
  ];
  const missingIds = requiredIds.filter((id) => !html.includes(`id="${id}"`));
  assert(
    missingIds.length === 0,
    missingIds.length === 0
      ? `All ${requiredIds.length} critical Admin DOM IDs present`
      : `Missing Admin DOM IDs: ${missingIds.join(", ")}`
  );
  assert(
    html.includes("max-h-[calc(100vh-5rem)]"),
    "Admin Settings dropdown is viewport-clamped & scrollable"
  );
}

function checkDesktopFrontend() {
  console.log("\n[3] Desktop POS Frontend (src/App.tsx & src/index.css)");
  const css = read("src/index.css");
  const app = read("src/App.tsx");

  assert(
    !/html\[data-maximized="true"\]\s*\{[^}]*font-size/i.test(css),
    "No blanket data-maximized font-size blow-up in src/index.css"
  );
  assert(css.includes("font-size: clamp("), "Fluid viewport-proportional clamp() typography active in src/index.css");
  assert(app.includes("minmax(320px,34%)"), "Fluid proportional QR sidebar grid active in src/App.tsx");
  assert(app.includes("settingsMenuScrollRef"), "Viewport-clamped scrollable Settings dropdown present in src/App.tsx");
  assert(app.includes("approvedFileIds"), "Explicit per-file approval state present in src/App.tsx");
}

function checkRustContracts() {
  console.log("\n[4] Rust Backend Contracts (src-tauri/src/)");
  const serverMod = read("src-tauri/src/server/mod.rs");
  const commands = read("src-tauri/src/commands.rs");
  const libRs = read("src-tauri/src/lib.rs");

  assert(serverMod.includes("pub station_hwid: Option<String>"), "/api/health exposes stationHwid for multi-tenant reconnect");
  assert(
    commands.includes("#[cfg(debug_assertions)]") && commands.includes("get_permanent_portal_url"),
    "Dev permanent portal URL is gated by #[cfg(debug_assertions)] (clean-slate prod installers)"
  );
  assert(
    libRs.includes("current_monitor()") && libRs.includes("set_size("),
    "Monitor-aware startup window clamping present in src-tauri/src/lib.rs"
  );
}

function getChangedFiles() {
  try {
    const out = execSync("git status --porcelain", { encoding: "utf8" });
    return out
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"|"$/g, ""));
  } catch {
    return null;
  }
}

const t0 = Date.now();
console.log(isSmart ? "=== PrintDrop Smart Diff-Aware Regression Gate ===" : "=== PrintDrop Full Contract & Regression Gate ===");

if (isSmart) {
  const changed = getChangedFiles();
  if (!changed || changed.length === 0) {
    console.log("No uncommitted file changes detected — running fast static contract suite (~0.2s).");
    checkCustomerPortal();
    checkAdminPortal();
    checkDesktopFrontend();
    checkRustContracts();
  } else {
    console.log("Changed files:", changed.join(", "));
    const touchedCustomer = changed.some((f) => f.includes("customer.html"));
    const touchedAdmin = changed.some((f) => f.includes("admin-portal/"));
    const touchedFrontend = changed.some((f) => f.startsWith("src/"));
    const touchedRust = changed.some((f) => f.startsWith("src-tauri/src/") && f.endsWith(".rs"));

    if (touchedCustomer) checkCustomerPortal();
    if (touchedAdmin) checkAdminPortal();
    if (touchedFrontend) {
      checkDesktopFrontend();
      console.log("\n[Smart] Running TypeScript check (npx tsc --noEmit)...");
      execSync("npx tsc --noEmit", { stdio: "inherit" });
      pass("npx tsc --noEmit passed");
    }
    if (touchedRust) {
      checkRustContracts();
      console.log("\n[Smart] Rust files changed — run `cargo test --manifest-path src-tauri/Cargo.toml` when ready.");
    }
    if (!touchedCustomer && !touchedAdmin && !touchedFrontend && !touchedRust) {
      pass("Docs/config-only change — no heavy code checks required");
    }
  }
} else {
  checkCustomerPortal();
  checkAdminPortal();
  checkDesktopFrontend();
  checkRustContracts();
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`\nSummary: ${passed} passed, ${failed} failed (${elapsed}s)`);
if (failed > 0) {
  process.exit(1);
}
