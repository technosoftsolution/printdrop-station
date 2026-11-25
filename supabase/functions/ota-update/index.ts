// PrintDrop Authenticated OTA & Time-Limited Installer Gatekeeper
// Serves:
//  1) GET  /ota-update?edition=retail|virtual  (Tauri v2 updater, requires valid `x-station-hwid` in `licenses`)
//  2) POST /ota-update                         (Admin / Partner portal: mints time-limited signed download link)
//  3) GET  /ota-update?dl=<signed_token>       (Redirects to fresh 5-min pre-signed GitHub CDN URL for the .exe)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-station-hwid",
};

const DEFAULT_MASTER_SIGNING_SECRET =
  "PRINTDROP_LICENSING_AUTHORITY_SECURE_HMAC_ROOT_KEY_2026_PROD";

interface GitHubAsset {
  id: number;
  name: string;
  url: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  assets: GitHubAsset[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function htmlErrorPage(title: string, message: string, status = 410): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — PrintDrop</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #090d16; color: #e2e8f0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 20px; }
    .card { max-width: 440px; width: 100%; background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 28px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
    .badge { display: inline-block; padding: 6px 12px; border-radius: 999px; background: rgba(244,63,94,0.15); border: 1px solid rgba(244,63,94,0.35); color: #fda4af; font-size: 12px; font-weight: 700; margin-bottom: 14px; }
    h1 { margin: 0 0 10px; font-size: 20px; color: #ffffff; }
    p { margin: 0; font-size: 14px; line-height: 1.6; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">PrintDrop Secure Distribution</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256Bytes(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const bytes = await hmacSha256Bytes(secret, message);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getGithubHeaders(pat: string, accept = "application/vnd.github+json"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "PrintDrop-OTA-Gatekeeper/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (pat) {
    headers.Authorization = `Bearer ${pat}`;
  }
  return headers;
}

async function fetchLatestRelease(repo: string, pat: string): Promise<GitHubRelease> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: getGithubHeaders(pat),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GitHub latest release lookup failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  return await res.json();
}

async function fetchAssetText(asset: GitHubAsset, pat: string): Promise<string> {
  const res = await fetch(asset.url, {
    headers: getGithubHeaders(pat, "application/octet-stream"),
  });
  if (!res.ok) {
    throw new Error(`GitHub asset fetch failed (${res.status}) for ${asset.name}`);
  }
  return await res.text();
}

async function resolvePresignedAssetUrl(asset: GitHubAsset, pat: string): Promise<string> {
  const res = await fetch(asset.url, {
    headers: getGithubHeaders(pat, "application/octet-stream"),
    redirect: "manual",
  });
  const loc = res.headers.get("location");
  if (loc && (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307)) {
    return loc;
  }
  if (!pat && asset.browser_download_url) {
    return asset.browser_download_url;
  }
  throw new Error(`Unable to resolve pre-signed CDN URL for ${asset.name} (status ${res.status})`);
}

function findInstallerAsset(release: GitHubRelease, edition: string, preferredUrl?: string): GitHubAsset | undefined {
  const exeAssets = (release.assets || []).filter((a) => a.name.toLowerCase().endsWith(".exe"));

  if (preferredUrl) {
    const tail = decodeURIComponent(preferredUrl.split("/").pop() || "").toLowerCase();
    const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");
    const exact = exeAssets.find((a) => a.name.toLowerCase() === tail || norm(a.name) === norm(tail));
    if (exact) return exact;
  }

  if (edition === "virtual") {
    return exeAssets.find((a) => a.name.toLowerCase().includes("virtual"));
  }
  return exeAssets.find((a) => !a.name.toLowerCase().includes("virtual")) || exeAssets[0];
}

function getSupabaseHeaders(key: string): Record<string, string> {
  if (key.startsWith("eyJ")) {
    return { apikey: key, Authorization: `Bearer ${key}` };
  }
  return { apikey: key };
}

async function verifyStationHwid(supabaseUrl: string, serviceKey: string, hwid: string): Promise<{ ok: boolean; reason?: string }> {
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, reason: "missing_supabase_env" };
  }
  const res = await fetch(
    `${supabaseUrl}/rest/v1/licenses?hwid=ilike.${encodeURIComponent(hwid)}&select=hwid,is_active&limit=1`,
    {
      headers: getSupabaseHeaders(serviceKey),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[ota-update] verifyStationHwid HTTP", res.status, txt.slice(0, 150));
    return { ok: false, reason: `db_http_${res.status}` };
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: "hwid_not_found" };
  if (rows[0]?.is_active === false) return { ok: false, reason: "station_inactive" };
  return { ok: true };
}

async function verifyPartnerSession(supabaseUrl: string, serviceKey: string, token: string): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${supabaseUrl}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(token)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}&select=partner_id,marketing_partners(partner_code,is_active)&limit=1`,
    {
      headers: getSupabaseHeaders(serviceKey),
    },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const partner = rows[0]?.marketing_partners;
  if (!partner || partner.is_active === false) return null;
  return String(partner.partner_code || rows[0].partner_id || "PARTNER");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const githubRepo = (Deno.env.get("GITHUB_RELEASE_REPO") || "technosoftsolution/printdrop-station").trim();
  const githubPat = (Deno.env.get("GITHUB_RELEASE_PAT") || "").trim();
  const linkSecret = (Deno.env.get("OTA_LINK_SECRET") || serviceKey || DEFAULT_MASTER_SIGNING_SECRET).trim();
  const masterSecret = (Deno.env.get("MASTER_SIGNING_SECRET") || DEFAULT_MASTER_SIGNING_SECRET).trim();

  const url = new URL(req.url);

  try {
    // -------------------------------------------------------------------------
    // ROUTE 1: Consume signed time-limited installer download link (?dl=...)
    // -------------------------------------------------------------------------
    const dlToken = url.searchParams.get("dl");
    if (req.method === "GET" && dlToken) {
      const parts = dlToken.split(".");
      if (parts.length !== 2) {
        return htmlErrorPage("Invalid Download Link", "This link is malformed. Please request a fresh link from PrintDrop Support or your Partner.", 400);
      }
      const [payloadB64, sigB64] = parts;
      const expectedSig = toBase64Url(await hmacSha256Bytes(linkSecret, payloadB64));
      if (!constantTimeEqual(sigB64, expectedSig)) {
        return htmlErrorPage("Invalid Download Link", "Link signature verification failed. Please request a fresh link from PrintDrop Support or your Partner.", 403);
      }

      let payload: { e?: string; exp?: number };
      try {
        payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
      } catch {
        return htmlErrorPage("Invalid Download Link", "Unable to read link data.", 400);
      }

      if (!payload.exp || Date.now() > payload.exp) {
        return htmlErrorPage(
          "Download Link Expired",
          "For security, PrintDrop installer links expire automatically. Please ask your PrintDrop Partner or Support team to send a fresh link.",
          410,
        );
      }

      const edition = payload.e === "virtual" ? "virtual" : "retail";
      const release = await fetchLatestRelease(githubRepo, githubPat);
      const exeAsset = findInstallerAsset(release, edition);
      if (!exeAsset) {
        return htmlErrorPage("Installer Unavailable", "No installer binary was found in the latest release.", 404);
      }

      const presignedUrl = await resolvePresignedAssetUrl(exeAsset, githubPat);
      return new Response(null, {
        status: 302,
        headers: {
          Location: presignedUrl,
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    // -------------------------------------------------------------------------
    // ROUTE 2: Admin / Partner Portal — Create time-limited download link
    // -------------------------------------------------------------------------
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.action !== "create-download-link") {
        return jsonResponse({ error: "Unsupported action" }, 400);
      }

      const authType = String(body.authType || "");
      let issuedBy = "";

      if (authType === "partner") {
        const partnerCode = await verifyPartnerSession(supabaseUrl, serviceKey, String(body.partnerToken || ""));
        if (!partnerCode) {
          return jsonResponse({ error: "Invalid or expired Partner session. Please sign in again." }, 401);
        }
        issuedBy = `partner:${partnerCode}`;
      } else if (authType === "admin") {
        const ts = Number(body.adminTs || 0);
        const sig = String(body.adminSignature || "").toLowerCase();
        if (!ts || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
          return jsonResponse({ error: "Admin request timestamp expired." }, 401);
        }
        const expected = await hmacSha256Hex(masterSecret, `ADMIN_DL|${ts}`);
        if (!constantTimeEqual(sig, expected)) {
          return jsonResponse({ error: "Invalid Admin authorization signature." }, 401);
        }
        issuedBy = "admin";
      } else {
        return jsonResponse({ error: "Unauthorized authType" }, 401);
      }

      const edition = body.edition === "virtual" ? "virtual" : "retail";
      const ttlMinutes = Math.min(1440, Math.max(5, Number(body.ttlMinutes || 30)));
      const exp = Date.now() + ttlMinutes * 60 * 1000;

      const release = await fetchLatestRelease(githubRepo, githubPat);
      const exeAsset = findInstallerAsset(release, edition);
      if (!exeAsset) {
        return jsonResponse({ error: `No ${edition} installer found in latest release (${release.tag_name}).` }, 404);
      }

      const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify({ e: edition, exp, by: issuedBy })));
      const sigB64 = toBase64Url(await hmacSha256Bytes(linkSecret, payloadB64));
      const token = `${payloadB64}.${sigB64}`;
      const downloadUrl = `${supabaseUrl}/functions/v1/ota-update?dl=${encodeURIComponent(token)}`;

      return jsonResponse({
        ok: true,
        downloadUrl,
        version: release.tag_name,
        fileName: exeAsset.name,
        fileSizeMb: Number((exeAsset.size / (1024 * 1024)).toFixed(2)),
        edition,
        ttlMinutes,
        expiresAt: new Date(exp).toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // ROUTE 3: Desktop Station OTA Auto-Updater (Tauri v2 plugin-updater)
    // -------------------------------------------------------------------------
    if (req.method === "GET") {
      const hwid = (req.headers.get("x-station-hwid") || "").trim().toUpperCase();
      if (!hwid) {
        return jsonResponse({ error: "Station HWID header required" }, 403);
      }

      const authCheck = await verifyStationHwid(supabaseUrl, serviceKey, hwid);
      if (!authCheck.ok) {
        return jsonResponse({ error: "Station not authorized for OTA updates", reason: authCheck.reason }, 403);
      }

      const edition = url.searchParams.get("edition") === "virtual" ? "virtual" : "retail";
      const manifestName = edition === "virtual" ? "virtual-latest.json" : "latest.json";

      const release = await fetchLatestRelease(githubRepo, githubPat);
      const manifestAsset = (release.assets || []).find((a) => a.name.toLowerCase() === manifestName);
      if (!manifestAsset) {
        return jsonResponse({ error: `Manifest ${manifestName} not found in release ${release.tag_name}` }, 404);
      }

      const manifestRaw = await fetchAssetText(manifestAsset, githubPat);
      const manifest = JSON.parse(manifestRaw);

      const winPlatform = manifest?.platforms?.["windows-x86_64"];
      if (!winPlatform || !winPlatform.signature) {
        return jsonResponse({ error: "Invalid manifest: missing windows-x86_64 platform" }, 500);
      }

      const exeAsset = findInstallerAsset(release, edition, winPlatform.url);
      if (!exeAsset) {
        return jsonResponse({ error: `Installer asset not found in release ${release.tag_name}` }, 404);
      }

      const presignedUrl = await resolvePresignedAssetUrl(exeAsset, githubPat);
      manifest.platforms["windows-x86_64"].url = presignedUrl;

      return jsonResponse(manifest, 200);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("[ota-update] error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
