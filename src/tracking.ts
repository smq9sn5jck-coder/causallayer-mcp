/**
 * Tracking, persistence, and analytics module.
 *
 * Responsibilities:
 *   1. Persist every demo certificate to D1 (table: certificates)
 *      so users can share a permanent URL: faultkey.com/cert/{id}
 *   2. Capture install pings from the npx faultkey-mcp CLI
 *   3. Capture leads from the website waitlist form
 *   4. Emit per-invocation events to Workers Analytics Engine for high-frequency
 *      observability without writing to D1 on every single request.
 *   5. Provide handlers for /cert/[id], /cert/[id]/pdf, /v1/install-ping,
 *      /v1/leads, /admin/* routes.
 *
 * Privacy posture:
 *   - Raw IP addresses are NEVER stored. We hash IP+date+salt to produce a
 *     stable-for-the-day identifier good enough for de-duplication and abuse
 *     detection, but un-correlatable across days.
 *   - User-Agent is truncated to 200 chars.
 *   - All D1 writes are wrapped so a tracking failure NEVER breaks the
 *     primary engine response.
 */

import { json } from "./billing.js";

// Bindings injected via wrangler.jsonc; declared optional so older deploys
// don't break before the bindings exist.
export interface TrackingEnv {
  FAULTKEY_DB?: D1Database;
  FAULTKEY_R2?: R2Bucket;
  ANALYTICS?: AnalyticsEngineDataset;
  IP_HASH_SALT?: string; // Cloudflare secret
}

// Re-exported types so callers don't need to depend on Cloudflare Workers types.
type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
};
type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta?: unknown }>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
};
type D1Result = { success: boolean; meta?: unknown; results?: unknown[] };
type R2Bucket = {
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};
type AnalyticsEngineDataset = {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
};
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

// ---------------------------------------------------------------------------
// IP hashing — privacy-preserving, day-stable for de-dup but rotates daily
// ---------------------------------------------------------------------------
async function hashIp(ip: string, salt: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const data = new TextEncoder().encode(`${ip}|${day}|${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16) // 128 bits is plenty for de-dup
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

function getCountry(request: Request): string {
  return request.headers.get("cf-ipcountry") || "XX";
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) : s;
}

// ---------------------------------------------------------------------------
// Certificate persistence
// ---------------------------------------------------------------------------

export interface CertRow {
  certificate_id: string;
  request_hash: string;
  scenario_id: string;
  scenario_severity?: string;
  jurisdiction?: string;
  total_cents?: number;
  primary_share?: number;
  merkle_root?: string;
  full_cert_json: unknown;
  latency_ms?: number;
}

/**
 * Persist a generated certificate to D1.
 *
 * Wrapped in try/catch so a tracking failure NEVER breaks the primary
 * engine response. Called via ctx.waitUntil() so it doesn't block the
 * response either.
 */
export async function persistCertificate(
  env: TrackingEnv,
  request: Request,
  row: CertRow
): Promise<void> {
  if (!env.FAULTKEY_DB) return;
  try {
    const ip = getClientIp(request);
    const salt = env.IP_HASH_SALT || "fk-no-salt-set-fix-me";
    const ipHash = await hashIp(ip, salt);
    const country = getCountry(request);
    const ua = truncate(request.headers.get("user-agent"), 200);
    const referrer = truncate(request.headers.get("referer"), 200);
    const now = Date.now();

    await env.FAULTKEY_DB.prepare(
      `INSERT OR IGNORE INTO certificates (
        id, request_hash, scenario_id, scenario_severity, jurisdiction,
        total_cents, primary_share, merkle_root, full_cert_json,
        client_country, client_ip_hash, client_user_agent, referrer,
        latency_ms, created_at, view_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
      .bind(
        row.certificate_id,
        row.request_hash,
        row.scenario_id,
        row.scenario_severity ?? null,
        row.jurisdiction ?? null,
        row.total_cents ?? null,
        row.primary_share ?? null,
        row.merkle_root ?? null,
        JSON.stringify(row.full_cert_json),
        country,
        ipHash,
        ua,
        referrer,
        row.latency_ms ?? null,
        now
      )
      .run();

    // Fire-and-forget Analytics Engine data point too (high-cardinality
    // observability without filling D1).
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        indexes: [row.scenario_id],
        blobs: [country, row.jurisdiction || "", row.scenario_severity || "", row.certificate_id.slice(0, 16)],
        doubles: [row.total_cents ?? 0, row.primary_share ?? 0, row.latency_ms ?? 0],
      });
    }
  } catch (err) {
    // Silent — tracking must never break the primary path.
    // Future: emit to a dead-letter Analytics Engine dataset.
    console.error("[tracking] persistCertificate failed:", err);
  }
}

// ---------------------------------------------------------------------------
// /cert/[id] handler — shareable certificate URL
// ---------------------------------------------------------------------------
export async function handleCertPage(
  url: URL,
  request: Request,
  env: TrackingEnv,
  ctx: ExecutionContext
): Promise<Response | null> {
  const match = url.pathname.match(/^\/cert\/([a-zA-Z0-9_-]+)(\/pdf|\/json)?$/);
  if (!match) return null;

  const certId = match[1];
  const format = match[2]; // /pdf, /json, or undefined for HTML

  if (!env.FAULTKEY_DB) {
    return json({ error: "Certificate storage not configured" }, 503);
  }

  try {
    const row = await env.FAULTKEY_DB.prepare(
      "SELECT * FROM certificates WHERE id = ? LIMIT 1"
    )
      .bind(certId)
      .first<Record<string, unknown>>();

    if (!row) {
      return new Response(renderNotFoundPage(certId), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Async view-count increment (non-blocking).
    ctx.waitUntil(
      env.FAULTKEY_DB.prepare(
        "UPDATE certificates SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?"
      )
        .bind(Date.now(), certId)
        .run()
        .catch(() => {})
    );

    const fullCert = JSON.parse(row.full_cert_json as string);

    if (format === "/json") {
      return json(fullCert);
    }
    if (format === "/pdf") {
      // PDF rendering would normally happen via a separate worker/service.
      // For now, return an HTML page that's print-optimized; users can
      // Cmd+P to PDF. Full programmatic PDF rendering is Phase B+.
      return new Response(renderCertHtml(fullCert, row, true), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response(renderCertHtml(fullCert, row, false), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (err) {
    console.error("[tracking] handleCertPage failed:", err);
    return json({ error: "Failed to load certificate" }, 500);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCertHtml(cert: Record<string, unknown>, row: Record<string, unknown>, forPrint: boolean): string {
  const certId = String(row.id ?? "");
  const scenarioId = String(row.scenario_id ?? "");
  const country = String(row.client_country ?? "");
  const viewCount = Number(row.view_count ?? 0);
  const createdAt = new Date(Number(row.created_at ?? Date.now())).toISOString();
  const totalCents = row.total_cents ? Number(row.total_cents) : null;
  const primaryShare = row.primary_share ? Number(row.primary_share) : null;
  const requestHash = String(row.request_hash ?? "");
  const merkleRoot = row.merkle_root ? String(row.merkle_root) : null;
  const jurisdiction = String(row.jurisdiction ?? "");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FaultKey Certificate ${escapeHtml(certId)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow">
<meta property="og:title" content="FaultKey · Causal Certificate ${escapeHtml(certId.slice(0, 32))}">
<meta property="og:description" content="Deterministic AI-liability attribution. Scenario: ${escapeHtml(scenarioId)}. Anchored. Verifiable.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://faultkey.com/cert/${escapeHtml(certId)}">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Mono", Monaco, monospace; background: #0a0a0a; color: #e5e5e5; line-height: 1.5; padding: 2rem 1rem; max-width: 64rem; margin: 0 auto; }
  ${forPrint ? "@media print { body { background: white; color: black; } }" : ""}
  header { border-bottom: 1px solid #333; padding-bottom: 1.5rem; margin-bottom: 2rem; }
  h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
  h2 { font-size: 0.875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin: 2rem 0 1rem; }
  .badge { display: inline-block; padding: 0.25rem 0.5rem; background: #1a1a1a; border: 1px solid #333; border-radius: 2px; font-size: 0.75rem; margin-right: 0.5rem; }
  .verified { border-color: #2ea043; color: #2ea043; }
  .meta { font-size: 0.875rem; color: #888; margin-top: 0.5rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 1.5rem 0; }
  .card { background: #111; border: 1px solid #222; padding: 1.25rem; border-radius: 4px; }
  .card-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; }
  .card-value { font-size: 1.5rem; font-weight: 600; margin-top: 0.25rem; font-variant-numeric: tabular-nums; }
  .card-mono { font-family: "SF Mono", Monaco, monospace; font-size: 0.875rem; word-break: break-all; }
  pre { background: #050505; border: 1px solid #222; padding: 1rem; overflow-x: auto; font-size: 0.75rem; color: #c5c5c5; border-radius: 4px; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid #333; font-size: 0.75rem; color: #666; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
  .btn { display: inline-block; padding: 0.5rem 1rem; background: #1a1a1a; border: 1px solid #333; color: #e5e5e5; border-radius: 2px; font-size: 0.875rem; cursor: pointer; }
  .btn:hover { background: #222; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <div class="badge verified">VERIFIED</div>
  <div class="badge">${escapeHtml(scenarioId.toUpperCase())}</div>
  <div class="badge">${escapeHtml(country)}</div>
  ${jurisdiction ? `<div class="badge">JURISDICTION ${escapeHtml(jurisdiction)}</div>` : ""}
  <h1 style="margin-top: 1rem;">FaultKey · Deterministic Causal Certificate</h1>
  <div class="meta">Issued ${escapeHtml(createdAt)} · Viewed ${viewCount} times</div>
  <div class="actions">
    <a href="/cert/${escapeHtml(certId)}/json" class="btn">View Raw JSON</a>
    <a href="/cert/${escapeHtml(certId)}/pdf" class="btn">Print / PDF</a>
    <a href="/" class="btn">Generate Your Own</a>
    <a href="/.well-known/mcp.json" class="btn">Engine Spec</a>
  </div>
</header>

<section>
<h2>Liability Attribution</h2>
<div class="grid">
  <div class="card">
    <div class="card-label">Total Attributed Damages</div>
    <div class="card-value">${totalCents !== null ? `$${(totalCents / 100).toLocaleString("en-AU")}` : "—"}</div>
  </div>
  <div class="card">
    <div class="card-label">Primary Liable Share</div>
    <div class="card-value">${primaryShare !== null ? `${(primaryShare * 100).toFixed(1)}%` : "—"}</div>
  </div>
</div>
</section>

<section>
<h2>Cryptographic Receipt</h2>
<div class="card">
  <div class="card-label">Certificate ID</div>
  <div class="card-mono" style="margin-top: 0.5rem;">${escapeHtml(certId)}</div>
</div>
<div class="card" style="margin-top: 1rem;">
  <div class="card-label">Request Hash (Canonical Input)</div>
  <div class="card-mono" style="margin-top: 0.5rem;">${escapeHtml(requestHash)}</div>
</div>
${merkleRoot ? `<div class="card" style="margin-top: 1rem;">
  <div class="card-label">Merkle Root</div>
  <div class="card-mono" style="margin-top: 0.5rem;">${escapeHtml(merkleRoot)}</div>
</div>` : ""}
</section>

<section>
<h2>Full Certificate Payload</h2>
<pre>${escapeHtml(JSON.stringify(cert, null, 2))}</pre>
</section>

<section>
<h2>Reproducibility</h2>
<p style="font-size: 0.875rem; color: #aaa;">
  This certificate is deterministic. To reproduce it independently:
</p>
<pre>git clone https://github.com/smq9sn5jck-coder/causallayer-mcp.git
cd causallayer-mcp
node scripts/reproduce.mjs --scenario=${escapeHtml(scenarioId)} --runs=2</pre>
<p style="font-size: 0.875rem; color: #aaa;">
  Or call the engine directly:
</p>
<pre>curl https://mcp.faultkey.com/.well-known/mcp.json</pre>
</section>

<footer>
  <p>FaultKey · Deterministic AI Liability Attribution · <a href="https://faultkey.com">faultkey.com</a></p>
  <p>This certificate was generated by the FaultKey demo engine and is intended for evaluation. Production certificates carry additional cryptographic anchoring and regulatory signing.</p>
</footer>
</body>
</html>`;
}

function renderNotFoundPage(certId: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Certificate not found</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;background:#0a0a0a;color:#e5e5e5;}a{color:#58a6ff;}</style>
</head><body>
<h1>Certificate not found</h1>
<p>No certificate matches id <code>${escapeHtml(certId)}</code>.</p>
<p>Certificates are generated by the live demo at <a href="/">faultkey.com</a> and persist permanently. If you received this URL from someone else, the certificate may have been from a non-persisted demo run.</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// /v1/install-ping handler — anonymous opt-in install tracker
// ---------------------------------------------------------------------------
export async function handleInstallPing(
  request: Request,
  env: TrackingEnv,
  ctx: ExecutionContext
): Promise<Response | null> {
  if (request.method !== "POST") return null;
  if (!env.FAULTKEY_DB) {
    return json({ ok: true, note: "Ping accepted (db not configured)" });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const installId = truncate(String(body.install_id || ""), 64);
    const cliVersion = truncate(String(body.cli_version || ""), 32);
    const nodeVersion = truncate(String(body.node_version || ""), 32);
    const osPlatform = truncate(String(body.os_platform || ""), 32);
    const detectedClients = truncate(String(body.detected_clients || ""), 128);

    if (!installId) {
      return json({ error: "install_id required" }, 400);
    }

    const ip = getClientIp(request);
    const salt = env.IP_HASH_SALT || "fk-no-salt-set-fix-me";
    const ipHash = await hashIp(ip, salt);
    const country = getCountry(request);
    const now = Date.now();

    ctx.waitUntil(
      env.FAULTKEY_DB!.prepare(
        `INSERT INTO install_pings (install_id, cli_version, node_version, os_platform, detected_clients, client_country, client_ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(installId, cliVersion, nodeVersion, osPlatform, detectedClients, country, ipHash, now)
        .run()
        .catch(() => {})
    );

    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        indexes: ["install_ping"],
        blobs: [cliVersion, osPlatform, country, detectedClients],
      });
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[tracking] handleInstallPing failed:", err);
    return json({ ok: true }); // Never expose error details to public CLI.
  }
}

// ---------------------------------------------------------------------------
// /v1/leads handler — waitlist email capture
// ---------------------------------------------------------------------------
export async function handleLeadCapture(
  request: Request,
  env: TrackingEnv,
  ctx: ExecutionContext
): Promise<Response | null> {
  if (request.method !== "POST") return null;
  if (!env.FAULTKEY_DB) {
    return json({ error: "Lead capture not configured" }, 503);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = truncate(String(body.email || "").toLowerCase().trim(), 200);

    if (!email || !email.includes("@") || !email.includes(".")) {
      return json({ error: "Valid email required" }, 400);
    }

    const company = truncate(String(body.company || ""), 200);
    const role = truncate(String(body.role || ""), 64);
    const useCase = truncate(String(body.use_case || ""), 500);
    const jurisdiction = truncate(String(body.jurisdiction || ""), 8);
    const source = truncate(String(body.source || "unknown"), 64);
    const utmSource = truncate(String(body.utm_source || ""), 64);
    const utmMedium = truncate(String(body.utm_medium || ""), 64);
    const utmCampaign = truncate(String(body.utm_campaign || ""), 64);

    const ip = getClientIp(request);
    const salt = env.IP_HASH_SALT || "fk-no-salt-set-fix-me";
    const ipHash = await hashIp(ip, salt);
    const country = getCountry(request);
    const now = Date.now();

    try {
      await env.FAULTKEY_DB.prepare(
        `INSERT INTO leads (
          email, company, role, use_case, jurisdiction, source,
          utm_source, utm_medium, utm_campaign,
          client_country, client_ip_hash, created_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
      )
        .bind(
          email,
          company,
          role,
          useCase,
          jurisdiction,
          source,
          utmSource,
          utmMedium,
          utmCampaign,
          country,
          ipHash,
          now
        )
        .run();
    } catch (e: unknown) {
      // UNIQUE constraint on email = already on waitlist. Idempotent success.
      const msg = String((e as Error)?.message || "");
      if (!msg.includes("UNIQUE")) throw e;
    }

    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        indexes: ["lead_capture"],
        blobs: [role, country, source, utmSource],
      });
    }

    return json({ ok: true, message: "You're on the waitlist." });
  } catch (err) {
    console.error("[tracking] handleLeadCapture failed:", err);
    return json({ error: "Failed to record lead" }, 500);
  }
}

// ---------------------------------------------------------------------------
// /admin/dashboard handler — aggregated metrics view (gated by ADMIN_TOKEN or Cloudflare Access)
// ---------------------------------------------------------------------------
export async function handleAdminDashboard(
  url: URL,
  request: Request,
  env: TrackingEnv & { ADMIN_TOKEN?: string }
): Promise<Response | null> {
  if (!url.pathname.startsWith("/admin/dashboard")) return null;

  // Auth: either Cloudflare Access JWT (handled at platform level) or Bearer ADMIN_TOKEN
  // For now we check Bearer; Cloudflare Access wraps this anyway.
  const auth = request.headers.get("authorization") || "";
  const providedToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!env.ADMIN_TOKEN || providedToken !== env.ADMIN_TOKEN) {
    // Also allow Cloudflare Access (CF-Access-Authenticated-User-Email header present)
    const cfAccessEmail = request.headers.get("cf-access-authenticated-user-email");
    if (!cfAccessEmail) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  if (!env.FAULTKEY_DB) {
    return json({ error: "Database not configured" }, 503);
  }

  // Last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  try {
    const [certs, leads, pings, topCountries, topScenarios] = await Promise.all([
      env.FAULTKEY_DB.prepare(
        `SELECT
          COUNT(*) as total,
          COUNT(DISTINCT client_ip_hash) as unique_clients,
          COUNT(CASE WHEN created_at > ? THEN 1 END) as last_24h,
          COUNT(CASE WHEN created_at > ? THEN 1 END) as last_7d,
          SUM(view_count) as total_views
        FROM certificates`
      )
        .bind(oneDayAgo, sevenDaysAgo)
        .first(),
      env.FAULTKEY_DB.prepare(
        `SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN status='new' THEN 1 END) as new_count,
          COUNT(CASE WHEN created_at > ? THEN 1 END) as last_7d
        FROM leads`
      )
        .bind(sevenDaysAgo)
        .first(),
      env.FAULTKEY_DB.prepare(
        `SELECT
          COUNT(*) as total,
          COUNT(DISTINCT install_id) as unique_installs,
          COUNT(CASE WHEN created_at > ? THEN 1 END) as last_7d
        FROM install_pings`
      )
        .bind(sevenDaysAgo)
        .first(),
      env.FAULTKEY_DB.prepare(
        `SELECT client_country, COUNT(*) as count
         FROM certificates GROUP BY client_country ORDER BY count DESC LIMIT 10`
      ).all(),
      env.FAULTKEY_DB.prepare(
        `SELECT scenario_id, COUNT(*) as count
         FROM certificates GROUP BY scenario_id ORDER BY count DESC LIMIT 10`
      ).all(),
    ]);

    const data = {
      generated_at: new Date().toISOString(),
      certificates: certs,
      leads: leads,
      install_pings: pings,
      top_countries: topCountries.results,
      top_scenarios: topScenarios.results,
    };

    if (url.pathname === "/admin/dashboard.json") {
      return json(data);
    }

    return new Response(renderAdminDashboard(data), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    console.error("[tracking] handleAdminDashboard failed:", err);
    return json({ error: "Dashboard query failed", details: String(err) }, 500);
  }
}

function renderAdminDashboard(data: Record<string, unknown>): string {
  const certs = (data.certificates as Record<string, number>) || {};
  const leads = (data.leads as Record<string, number>) || {};
  const pings = (data.install_pings as Record<string, number>) || {};
  const topCountries = (data.top_countries as Array<{ client_country: string; count: number }>) || [];
  const topScenarios = (data.top_scenarios as Array<{ scenario_id: string; count: number }>) || [];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FaultKey · Admin Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<style>
  :root { color-scheme: dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; max-width: 80rem; margin: 0 auto; padding: 2rem 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
  .meta { color: #888; font-size: 0.875rem; margin-bottom: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #111; border: 1px solid #222; padding: 1.25rem; border-radius: 4px; }
  .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; }
  .value { font-size: 2rem; font-weight: 600; margin: 0.25rem 0; font-variant-numeric: tabular-nums; }
  .sub { font-size: 0.875rem; color: #666; }
  table { width: 100%; border-collapse: collapse; background: #111; border: 1px solid #222; border-radius: 4px; margin: 1rem 0 2rem; }
  th, td { padding: 0.625rem 1rem; text-align: left; border-bottom: 1px solid #222; }
  th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  h2 { font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin: 2rem 0 0.5rem; }
</style>
</head>
<body>
<h1>FaultKey · Admin Dashboard</h1>
<div class="meta">Generated ${data.generated_at as string} · Tracking only what writes through this worker</div>

<h2>Certificates</h2>
<div class="grid">
  <div class="card"><div class="label">Total</div><div class="value">${certs.total ?? 0}</div></div>
  <div class="card"><div class="label">Unique Clients</div><div class="value">${certs.unique_clients ?? 0}</div></div>
  <div class="card"><div class="label">Last 24h</div><div class="value">${certs.last_24h ?? 0}</div></div>
  <div class="card"><div class="label">Last 7 Days</div><div class="value">${certs.last_7d ?? 0}</div></div>
  <div class="card"><div class="label">Total Views</div><div class="value">${certs.total_views ?? 0}</div></div>
</div>

<h2>Leads (Waitlist)</h2>
<div class="grid">
  <div class="card"><div class="label">Total</div><div class="value">${leads.total ?? 0}</div></div>
  <div class="card"><div class="label">New (Unread)</div><div class="value">${leads.new_count ?? 0}</div></div>
  <div class="card"><div class="label">Last 7 Days</div><div class="value">${leads.last_7d ?? 0}</div></div>
</div>

<h2>CLI Install Pings</h2>
<div class="grid">
  <div class="card"><div class="label">Total Pings</div><div class="value">${pings.total ?? 0}</div></div>
  <div class="card"><div class="label">Unique Installs</div><div class="value">${pings.unique_installs ?? 0}</div></div>
  <div class="card"><div class="label">Last 7 Days</div><div class="value">${pings.last_7d ?? 0}</div></div>
</div>

<h2>Top Countries</h2>
<table>
  <thead><tr><th>Country</th><th class="num">Certificates</th></tr></thead>
  <tbody>
    ${topCountries.map((c) => `<tr><td>${escapeHtml(c.client_country || "—")}</td><td class="num">${c.count}</td></tr>`).join("")}
  </tbody>
</table>

<h2>Top Scenarios</h2>
<table>
  <thead><tr><th>Scenario</th><th class="num">Certificates</th></tr></thead>
  <tbody>
    ${topScenarios.map((s) => `<tr><td>${escapeHtml(s.scenario_id || "—")}</td><td class="num">${s.count}</td></tr>`).join("")}
  </tbody>
</table>
</body>
</html>`;
}
