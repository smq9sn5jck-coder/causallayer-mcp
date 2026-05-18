/**
 * CausalLayer MCP — Admin endpoints
 * ---------------------------------
 *
 * Minimal admin surface area for provisioning tenants and issuing API keys.
 * Authenticated by ADMIN_TOKEN (a single shared secret you set via wrangler
 * secret put). For production, consider replacing with Cloudflare Access in
 * front of /admin/*.
 *
 * Endpoints:
 *   POST /admin/tenants                 — create a tenant
 *   POST /admin/tenants/:id/keys        — issue an API key (returned ONCE)
 *   GET  /admin/tenants/:id/credits     — read balance + lifetime stats
 *   POST /admin/tenants/:id/credits/grant — manually grant credits (e.g. for invoice-pay)
 *   POST /admin/checkout                — create a Stripe Checkout link for a pack
 *
 * Public endpoint:
 *   GET  /me                            — caller introspection (tenant + balance)
 */

import {
  type BillingEnv,
  type TenantRecord,
  type ApiKeyRecord,
  getCredits,
  hashApiKey,
  json,
  resolveTenantFromAuth,
  topUpCredits,
} from "./billing.js";
import { readEventStats, type EventStats } from "./events.js";

function requireAdmin(env: BillingEnv, request: Request): Response | null {
  const tok = request.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || tok !== env.ADMIN_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

function generateApiKey(): string {
  // 32-byte URL-safe random with a clk_ prefix; the prefix lets us detect
  // CausalLayer keys in the wild (e.g. for log scrubbing).
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return `clk_${s}`;
}

function tenantId(): string {
  // Short slug-like id (12 hex chars) — enough for ~10^14 tenants.
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return `t_${s}`;
}

export async function handleAdmin(
  env: BillingEnv,
  request: Request,
  url: URL
): Promise<Response> {
  // /me is public-but-authenticated (with a tenant API key, not admin token)
  if (url.pathname === "/me" && request.method === "GET") {
    const r = await resolveTenantFromAuth(env, request.headers.get("Authorization"));
    if (!r) return json({ error: "unauthorized" }, 401);
    const credits = await getCredits(env, r.tenant.tenant_id);
    return json({
      tenant: {
        tenant_id: r.tenant.tenant_id,
        name: r.tenant.name,
        email: r.tenant.email,
        status: r.tenant.status,
      },
      credits: {
        balance: credits.balance,
        lifetime_purchased: credits.lifetime_purchased,
        lifetime_consumed: credits.lifetime_consumed,
      },
    });
  }

  // All /admin/* require ADMIN_TOKEN
  if (!url.pathname.startsWith("/admin/")) {
    return json({ error: "not_found" }, 404);
  }
  const authErr = requireAdmin(env, request);
  if (authErr) return authErr;

  // POST /admin/tenants
  if (url.pathname === "/admin/tenants" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as
      | { name?: string; email?: string; stripe_customer_id?: string }
      | null;
    if (!body?.name || !body.email) {
      return json({ error: "name_and_email_required" }, 400);
    }
    const id = tenantId();
    const rec: TenantRecord = {
      tenant_id: id,
      name: body.name,
      email: body.email,
      stripe_customer_id: body.stripe_customer_id,
      status: "active",
      created_at: new Date().toISOString(),
    };
    await env.LEDGER.put(`tenant:${id}`, JSON.stringify(rec));
    return json(rec, 201);
  }

  // POST /admin/tenants/:id/keys
  let m = /^\/admin\/tenants\/([^/]+)\/keys$/.exec(url.pathname);
  if (m && request.method === "POST") {
    const id = m[1];
    const tenant = await env.LEDGER.get<TenantRecord>(`tenant:${id}`, "json");
    if (!tenant) return json({ error: "tenant_not_found" }, 404);

    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    const rec: ApiKeyRecord = {
      tenant_id: id,
      name: body?.name ?? "default",
      status: "active",
      created_at: new Date().toISOString(),
    };
    await env.LEDGER.put(`apikey:${keyHash}`, JSON.stringify(rec));
    return json(
      {
        api_key: rawKey,
        warning: "This key is shown only once. Store it securely.",
        tenant_id: id,
      },
      201
    );
  }

  // GET /admin/tenants/:id/credits
  m = /^\/admin\/tenants\/([^/]+)\/credits$/.exec(url.pathname);
  if (m && request.method === "GET") {
    const id = m[1];
    const credits = await getCredits(env, id);
    return json(credits);
  }

  // POST /admin/tenants/:id/credits/grant
  m = /^\/admin\/tenants\/([^/]+)\/credits\/grant$/.exec(url.pathname);
  if (m && request.method === "POST") {
    const id = m[1];
    const body = (await request.json().catch(() => null)) as
      | { amount?: number; memo?: string }
      | null;
    const amount = body?.amount;
    if (!amount || amount <= 0) return json({ error: "amount_required" }, 400);
    await topUpCredits(env, id, amount, `admin_grant_${Date.now()}`, `evt_admin_${Date.now()}`);
    const credits = await getCredits(env, id);
    return json({ ok: true, credits });
  }

  // GET /admin/stats — named-event aggregates for the last 7 days.
  // Returns the same shape that /admin/dashboard renders as HTML.
  if (url.pathname === "/admin/stats" && request.method === "GET") {
    const days = Math.min(
      Math.max(Number.parseInt(url.searchParams.get("days") || "7", 10) || 7, 1),
      30
    );
    const stats = await readEventStats(env, days);
    return json(stats);
  }

  // GET /admin/dashboard — a self-contained, server-rendered HTML page that
  // renders the same data as /admin/stats. Token-gated. No external JS, no
  // CDN dependencies, ~6 KB gzipped.
  if (url.pathname === "/admin/dashboard" && request.method === "GET") {
    const days = Math.min(
      Math.max(Number.parseInt(url.searchParams.get("days") || "7", 10) || 7, 1),
      30
    );
    const stats = await readEventStats(env, days);
    return new Response(renderDashboard(stats, env), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  }

  // POST /admin/checkout — create a Stripe Checkout session for a pack
  if (url.pathname === "/admin/checkout" && request.method === "POST") {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "stripe_not_configured" }, 503);
    const body = (await request.json().catch(() => null)) as
      | { tenant_id?: string; pack?: "starter" | "growth" | "enterprise"; success_url?: string; cancel_url?: string }
      | null;
    if (!body?.tenant_id || !body.pack || !body.success_url || !body.cancel_url) {
      return json({ error: "tenant_id_pack_success_url_cancel_url_required" }, 400);
    }
    const priceMap = {
      starter: env.STRIPE_PRICE_STARTER,
      growth: env.STRIPE_PRICE_GROWTH,
      enterprise: env.STRIPE_PRICE_ENTERPRISE,
    };
    const priceId = priceMap[body.pack];
    if (!priceId) return json({ error: "pack_not_configured" }, 503);

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("client_reference_id", body.tenant_id);
    form.set("success_url", body.success_url);
    form.set("cancel_url", body.cancel_url);
    form.set("line_items[0][price]", priceId);
    form.set("line_items[0][quantity]", "1");

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: "stripe_failed", status: r.status, detail: t.slice(0, 300) }, 502);
    }
    const session = (await r.json()) as { id: string; url: string };
    return json({ checkout_url: session.url, session_id: session.id });
  }

  return json({ error: "not_found" }, 404);
}

// ─── Dashboard renderer ────────────────────────────────────────────────────

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sortDesc(obj: Record<string, number>, limit = 20): Array<[string, number]> {
  return Object.entries(obj)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function renderTable(
  title: string,
  rows: Array<[string, number]>,
  emptyText = "No data yet."
): string {
  if (rows.length === 0) {
    return `<section class="card"><h2>${esc(title)}</h2><p class="empty">${esc(emptyText)}</p></section>`;
  }
  const total = rows.reduce((s, [, v]) => s + v, 0) || 1;
  const body = rows
    .map(([k, v]) => {
      const pct = Math.round((v / total) * 100);
      return `<tr>
        <td class="k">${esc(k)}</td>
        <td class="v">${esc(v)}</td>
        <td class="bar"><div class="fill" style="width:${pct}%"></div></td>
      </tr>`;
    })
    .join("");
  return `<section class="card">
    <h2>${esc(title)}</h2>
    <table><tbody>${body}</tbody></table>
  </section>`;
}

function renderTimeline(byDay: Record<string, Record<string, number>>): string {
  const days = Object.keys(byDay).sort();
  if (days.length === 0) {
    return `<section class="card wide"><h2>Daily timeline</h2><p class="empty">No data yet.</p></section>`;
  }
  const max = Math.max(
    1,
    ...days.map((d) => byDay[d].total || 0)
  );
  const bars = days
    .map((d) => {
      const v = byDay[d].total || 0;
      const h = Math.round((v / max) * 100);
      return `<div class="col" title="${esc(d)}: ${esc(v)} events">
        <div class="col-bar" style="height:${h}%"></div>
        <div class="col-label">${esc(d.slice(5))}</div>
        <div class="col-value">${esc(v)}</div>
      </div>`;
    })
    .join("");
  return `<section class="card wide">
    <h2>Daily event volume</h2>
    <div class="timeline">${bars}</div>
  </section>`;
}

function renderDashboard(stats: EventStats, env: BillingEnv): string {
  const eventsRows = sortDesc(stats.by_event, 20);
  const countryRows = sortDesc(stats.by_country, 20);
  const uaRows = sortDesc(stats.by_ua_category, 15);
  const routeRows = sortDesc(stats.by_route, 15);
  const toolRows = sortDesc(stats.by_tool, 10);
  const errRows = sortDesc(stats.errors_by_status, 10);
  const ccUniqRows = sortDesc(stats.unique_sessions_by_country_24h, 15);

  const env_label = env.CAUSALLAYER_ENV ? esc(env.CAUSALLAYER_ENV) : "unknown";
  const billing_label = env.BILLING_MODE ? esc(env.BILLING_MODE) : "unknown";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FaultKey · CausalLayer admin dashboard</title>
  <style>
    :root {
      --bg: #0b0d10;
      --panel: #14181d;
      --panel-2: #1b2127;
      --border: #232a31;
      --text: #e6e9ee;
      --muted: #8a96a3;
      --accent: #6ee7b7;
      --warn: #fbbf24;
      --err: #f87171;
      --bar: linear-gradient(90deg, #6ee7b7, #34d399);
    }
    * { box-sizing: border-box; }
    html, body { background: var(--bg); color: var(--text); margin: 0; padding: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    header { padding: 24px 32px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    header h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.01em; }
    header .meta { color: var(--muted); font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    main { padding: 24px 32px 64px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
    .totals { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
    .totals .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
    .totals .stat .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .totals .stat .value { font-size: 32px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; min-width: 0; }
    .card.wide { grid-column: 1 / -1; }
    .card h2 { margin: 0 0 14px; font-size: 14px; font-weight: 600; letter-spacing: 0.01em; color: var(--text); }
    .card .empty { color: var(--muted); font-size: 13px; margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    table tr { border-bottom: 1px solid var(--border); }
    table tr:last-child { border-bottom: 0; }
    table td { padding: 8px 0; vertical-align: middle; }
    table td.k { color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
    table td.v { color: var(--muted); width: 60px; text-align: right; font-variant-numeric: tabular-nums; padding-right: 10px; }
    table td.bar { width: 40%; }
    table td.bar .fill { height: 6px; border-radius: 999px; background: var(--bar); }
    .timeline { display: flex; align-items: flex-end; gap: 6px; height: 160px; padding: 8px 0; overflow-x: auto; }
    .timeline .col { flex: 1 0 40px; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 40px; }
    .timeline .col-bar { width: 70%; background: var(--bar); border-radius: 4px 4px 0 0; min-height: 2px; transition: height 0.2s; }
    .timeline .col-label { color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .timeline .col-value { color: var(--text); font-size: 12px; font-variant-numeric: tabular-nums; }
    footer { color: var(--muted); font-size: 12px; padding: 16px 32px 32px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    @media (max-width: 720px) {
      main { grid-template-columns: 1fr; padding: 16px; }
      .totals { grid-template-columns: repeat(2, 1fr); }
      header { padding: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>FaultKey · CausalLayer admin</h1>
    <div class="meta">env=${env_label} · billing=${billing_label} · window=${esc(stats.window_days)}d · generated=${esc(stats.generated_at)}</div>
  </header>
  <main>
    <div class="totals">
      <div class="stat"><div class="label">Events (24h)</div><div class="value">${esc(stats.totals.events_24h)}</div></div>
      <div class="stat"><div class="label">Events (${esc(stats.window_days)}d)</div><div class="value">${esc(stats.totals.events_7d)}</div></div>
      <div class="stat"><div class="label">Unique sessions (24h)</div><div class="value">${esc(stats.totals.unique_sessions_24h)}</div></div>
      <div class="stat"><div class="label">Unique sessions (${esc(stats.window_days)}d)</div><div class="value">${esc(stats.totals.unique_sessions_7d)}</div></div>
    </div>
    ${renderTimeline(stats.by_day)}
    ${renderTable("Events by type", eventsRows)}
    ${renderTable("Top routes / paths", routeRows)}
    ${renderTable("Active sessions by country (24h)", ccUniqRows)}
    ${renderTable("Total events by country", countryRows)}
    ${renderTable("Top user-agent categories", uaRows)}
    ${renderTable("Top tools called", toolRows, "No tool calls yet.")}
    ${renderTable("Errors by HTTP status", errRows, "No errors. \u{1f389}")}
  </main>
  <footer>
    Source: <code>evt:agg:*</code> KV counters · raw structured logs in Cloudflare Workers Observability ·
    JSON: <a href="./stats?days=${esc(stats.window_days)}">/admin/stats?days=${esc(stats.window_days)}</a>
  </footer>
</body>
</html>`;
}
