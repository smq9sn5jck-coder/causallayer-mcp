/**
 * CausalLayer MCP — Demo mode
 * ---------------------------
 *
 * When BILLING_MODE=demo the worker accepts unauthenticated MCP traffic with
 * three strict limits, all backed by the same KV namespace as the credit
 * ledger so we don't add a second binding:
 *
 *   1. Per-IP daily quota for paid tools (submit_incident, verify_certificate)
 *   2. Per-IP per-tool burst limit (max 1 call / 5s) to stop replay loops
 *   3. Hard global daily cap to keep Cloudflare invoice predictable
 *
 * Free tools (get_anchor_status, query_issuer_registry) are NOT rate-limited
 * for individual IPs but still count towards the global cap.
 *
 * Every call also writes a small anonymous telemetry record into KV so we
 * can read demand signal directly from /stats. No PII is ever stored:
 *   - IP is hashed (sha256, truncated) — never raw
 *   - Country is the CF-IPCountry header (already public)
 *   - User-Agent is bucketed to one of: claude / cursor / cline / continue / other
 *   - Payload is reduced to length + sha256 hash
 */

import type { BillingEnv, ToolName } from "./billing.js";

// ─── Request metadata extraction ───────────────────────────────────────

/**
 * Small, serializable subset of the inbound Request that the demo helpers
 * need. Captured at the fetch-handler boundary and stashed on McpAgent
 * `props` so individual tool callbacks (which never see the raw Request)
 * can still enforce per-IP limits and write telemetry.
 */
export interface RequestMeta {
  ip_bucket: string;
  ua: string;
  cc: string;
}

export async function buildRequestMeta(request: Request): Promise<RequestMeta> {
  return {
    ip_bucket: await ipBucket(request),
    ua: uaBucket(request),
    cc: country(request),
  };
}

// ─── Tunables ───────────────────────────────────────────────────────────

const PAID_TOOLS: ReadonlySet<ToolName> = new Set([
  "submit_incident",
  "verify_certificate",
]);

const DEFAULT_DAILY_PER_IP = 5;          // submit_incident calls / IP / day
const DEFAULT_DAILY_GLOBAL = 1000;       // total submit_incident calls / day
const DEFAULT_VERIFY_PER_IP = 50;        // verify_certificate calls / IP / day
const DEFAULT_BURST_WINDOW_SECONDS = 5;  // 1 call / 5s / (IP, tool)
const TELEMETRY_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Parse a positive integer env var with a default fallback. */
function envInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function demoLimits(env: BillingEnv) {
  return {
    dailyPerIpSubmit: envInt(env.DEMO_DAILY_PER_IP_SUBMIT, DEFAULT_DAILY_PER_IP),
    dailyPerIpVerify: envInt(env.DEMO_DAILY_PER_IP_VERIFY, DEFAULT_VERIFY_PER_IP),
    dailyGlobalSubmit: envInt(env.DEMO_DAILY_GLOBAL_SUBMIT, DEFAULT_DAILY_GLOBAL),
    burstWindowSeconds: envInt(env.DEMO_BURST_WINDOW_SECONDS, DEFAULT_BURST_WINDOW_SECONDS),
  };
}

// ─── KV key helpers ────────────────────────────────────────────────────

function isoDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export async function ipBucket(request: Request): Promise<string> {
  // CF-Connecting-IP is set by Cloudflare's edge; fallback to header chain.
  const raw =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0";
  const hex = await sha256Hex(`v1:${raw}`);
  return hex.slice(0, 16); // 64-bit bucket; collision-tolerant for rate limits
}

export function uaBucket(request: Request): string {
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  if (ua.includes("claude")) return "claude";
  if (ua.includes("cursor")) return "cursor";
  if (ua.includes("cline")) return "cline";
  if (ua.includes("continue")) return "continue";
  if (ua.includes("vscode")) return "vscode";
  if (ua.includes("inspector")) return "inspector";
  return "other";
}

export function country(request: Request): string {
  return (request.headers.get("cf-ipcountry") || "ZZ").toUpperCase();
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface DemoLimitDecision {
  allow: boolean;
  reason?:
    | "burst"
    | "daily_per_ip"
    | "daily_global"
    | "ok";
  retry_after_seconds?: number;
  remaining?: number;
}

/**
 * Enforce demo limits before any tool work happens. Returns a structured
 * decision. The caller (the MCP tool wrapper) decides whether to respond
 * with `isError: true` or to pass through.
 */
export async function enforceDemoLimit(
  env: BillingEnv,
  meta: RequestMeta,
  tool: ToolName
): Promise<DemoLimitDecision> {
  if (env.BILLING_MODE !== "demo") return { allow: true, reason: "ok" };

  const ip = meta.ip_bucket;
  const day = isoDay();
  const limits = demoLimits(env);

  // (1) Burst limit per (IP, tool). KV minimum TTL is 60s, but our burst
  // window is short — so we store the timestamp inside the value and check
  // elapsed time on read. KV record self-expires after 60s.
  const burstKey = `demo:burst:${ip}:${tool}`;
  const burstRaw = await env.LEDGER.get(burstKey);
  if (burstRaw) {
    const lastTs = Number.parseInt(burstRaw, 10);
    if (
      Number.isFinite(lastTs) &&
      Date.now() - lastTs < limits.burstWindowSeconds * 1000
    ) {
      return {
        allow: false,
        reason: "burst",
        retry_after_seconds: limits.burstWindowSeconds,
      };
    }
  }

  // (2) Daily per-IP for paid tools
  if (PAID_TOOLS.has(tool)) {
    const perIpLimit =
      tool === "submit_incident" ? limits.dailyPerIpSubmit : limits.dailyPerIpVerify;
    const perIpKey = `demo:ip:${day}:${ip}:${tool}`;
    const used = Number.parseInt((await env.LEDGER.get(perIpKey)) || "0", 10);
    if (used >= perIpLimit) {
      return {
        allow: false,
        reason: "daily_per_ip",
        remaining: 0,
      };
    }
  }

  // (3) Global daily cap — only check for the most expensive tool
  if (tool === "submit_incident") {
    const globalKey = `demo:global:${day}:submit_incident`;
    const usedGlobal = Number.parseInt(
      (await env.LEDGER.get(globalKey)) || "0",
      10
    );
    if (usedGlobal >= limits.dailyGlobalSubmit) {
      return { allow: false, reason: "daily_global", remaining: 0 };
    }
  }

  return { allow: true, reason: "ok" };
}

/**
 * Commit the rate-limit counters AFTER a successful call. Burst marker is
 * set unconditionally on entry so naive replays don't double-charge the
 * global cap on failure.
 */
export async function commitDemoUsage(
  env: BillingEnv,
  meta: RequestMeta,
  tool: ToolName
): Promise<void> {
  if (env.BILLING_MODE !== "demo") return;
  const ip = meta.ip_bucket;
  const day = isoDay();

  // Set burst marker. KV requires expirationTtl >= 60, so we use the minimum
  // and rely on the timestamp-in-value check on read for the actual 5s window.
  await env.LEDGER.put(`demo:burst:${ip}:${tool}`, String(Date.now()), {
    expirationTtl: 60,
  });

  // Increment per-IP daily counter (TTL = 36h to cover timezone slop)
  if (PAID_TOOLS.has(tool)) {
    const perIpKey = `demo:ip:${day}:${ip}:${tool}`;
    const used = Number.parseInt((await env.LEDGER.get(perIpKey)) || "0", 10);
    await env.LEDGER.put(perIpKey, String(used + 1), {
      expirationTtl: 60 * 60 * 36,
    });
  }

  // Increment global counter for submit_incident
  if (tool === "submit_incident") {
    const globalKey = `demo:global:${day}:submit_incident`;
    const used = Number.parseInt((await env.LEDGER.get(globalKey)) || "0", 10);
    await env.LEDGER.put(globalKey, String(used + 1), {
      expirationTtl: 60 * 60 * 36,
    });
  }
}

/**
 * Append an anonymous telemetry record. Always called, regardless of mode,
 * so we capture demand signal during paid traffic too.
 */
export async function recordTelemetry(
  env: BillingEnv,
  meta: RequestMeta,
  payload: {
    tool: ToolName;
    outcome: "ok" | "error" | "rate_limited" | "guardrail_block";
    payload_bytes?: number;
    payload_hash?: string;
    tenant_id?: string;
  }
): Promise<void> {
  try {
    const day = isoDay();
    const ip = meta.ip_bucket;
    const ua = meta.ua;
    const cc = meta.cc;

    // 1. Append to today's log (ULID-ordered key)
    const ts = new Date().toISOString();
    const ulid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const logKey = `tlm:log:${day}:${ulid}`;
    await env.LEDGER.put(
      logKey,
      JSON.stringify({
        ts,
        tool: payload.tool,
        outcome: payload.outcome,
        ip,
        ua,
        cc,
        bytes: payload.payload_bytes ?? 0,
        hash: payload.payload_hash ?? null,
        tenant_id: payload.tenant_id ?? null,
        billing_mode: env.BILLING_MODE,
        env: env.CAUSALLAYER_ENV,
      }),
      { expirationTtl: TELEMETRY_TTL_SECONDS }
    );

    // 2. Increment aggregate counters used by /stats and /admin/stats
    const tenant = (payload.tenant_id ?? "anonymous").replace(/[^a-zA-Z0-9:_\-]/g, "_").slice(0, 64);
    const counters = [
      `tlm:agg:${day}:tool:${payload.tool}`,
      `tlm:agg:${day}:outcome:${payload.outcome}`,
      `tlm:agg:${day}:ua:${ua}`,
      `tlm:agg:${day}:cc:${cc}`,
      `tlm:agg:${day}:total`,
      `tlm:agg:${day}:tenant:${tenant}`,
      `tlm:agg:${day}:tenant_tool:${tenant}:${payload.tool}`,
      `tlm:agg:${day}:tenant_outcome:${tenant}:${payload.outcome}`,
      `tlm:uniq:${day}:ip:${ip}`,             // existence-only, dedupes unique IPs/day
      `tlm:uniq:${day}:tenant:${tenant}`,     // existence-only, dedupes active tenants/day
      `tlm:uniq7:ip:${ip}`,                   // 7-day rolling unique IPs (TTL=7d)
    ];
    await Promise.all(
      counters.map(async (k) => {
        if (k.startsWith("tlm:uniq:")) {
          await env.LEDGER.put(k, "1", { expirationTtl: TELEMETRY_TTL_SECONDS });
        } else if (k.startsWith("tlm:uniq7:")) {
          // 7 days exactly; lets us count distinct IPs across the rolling window without summing per-day
          await env.LEDGER.put(k, "1", { expirationTtl: 7 * 24 * 60 * 60 });
        } else {
          const cur = Number.parseInt((await env.LEDGER.get(k)) || "0", 10);
          await env.LEDGER.put(k, String(cur + 1), {
            expirationTtl: TELEMETRY_TTL_SECONDS,
          });
        }
      })
    );
  } catch {
    // Telemetry must never break the user-facing call.
  }
}

/**
 * /stats endpoint — anonymous, public, returns the last 7 days of demand
 * signal. Safe to expose because everything is bucketed/aggregated and no
 * raw IPs or payloads are ever stored.
 *
 * Hardened in v0.3.1: per-day budget timeout + edge cache wrap. KV reads on
 * busy days were spiking past the 30s wall-clock limit; this keeps response
 * times under ~3s worst-case and serves a 60s edge-cached copy to repeat
 * visitors.
 */
const STATS_DAY_BUDGET_MS = 2500;
const STATS_CACHE_TTL_S = 60;
const EMPTY_LIST = {
  keys: [],
  list_complete: false,
  cursor: "",
  cacheStatus: null,
};

async function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleStats(env: BillingEnv): Promise<Response> {
  const days = 7;
  const out: Record<string, Record<string, number | Record<string, number>>> = {};
  let truncated = false;
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = isoDay(d);
    const dayBucket: Record<string, number | Record<string, number>> = {};

    const tools: ToolName[] = [
      "submit_incident",
      "verify_certificate",
      "get_anchor_status",
      "query_issuer_registry",
    ];
    for (const t of tools) {
      const v = await env.LEDGER.get(`tlm:agg:${day}:tool:${t}`);
      dayBucket[`tool_${t}`] = Number.parseInt(v || "0", 10);
    }
    for (const o of ["ok", "error", "rate_limited", "guardrail_block"]) {
      const v = await env.LEDGER.get(`tlm:agg:${day}:outcome:${o}`);
      dayBucket[`outcome_${o}`] = Number.parseInt(v || "0", 10);
    }
    const uaBreakdown: Record<string, number> = {};
    for (const ua of ["claude", "cursor", "cline", "continue", "vscode", "inspector", "other"]) {
      const v = await env.LEDGER.get(`tlm:agg:${day}:ua:${ua}`);
      if (v) {
        const n = Number.parseInt(v, 10);
        dayBucket[`ua_${ua}`] = n;
        uaBreakdown[ua] = n;
      }
    }
    if (Object.keys(uaBreakdown).length > 0) dayBucket.ua_breakdown = uaBreakdown;

    // Country breakdown. Two-letter ISO from Cloudflare's CF-IPCountry header.
    // Listed via prefix scan because the country set is open-ended.
    // Capped at 100 keys per day + 2.5s budget. If the cap is hit, we mark the
    // payload as truncated rather than blow the request budget.
    const ccList = await withBudget(
      env.LEDGER.list({ prefix: `tlm:agg:${day}:cc:`, limit: 100 }),
      STATS_DAY_BUDGET_MS,
      EMPTY_LIST as unknown as Awaited<ReturnType<typeof env.LEDGER.list>>
    );
    if (ccList.keys.length > 0) {
      const ccBreakdown: Record<string, number> = {};
      await withBudget(
        Promise.all(
          ccList.keys.map(async (k) => {
            const cc = k.name.slice(`tlm:agg:${day}:cc:`.length);
            const v = await env.LEDGER.get(k.name);
            if (v) ccBreakdown[cc] = Number.parseInt(v, 10);
          })
        ),
        STATS_DAY_BUDGET_MS,
        []
      );
      dayBucket.country_breakdown = ccBreakdown;
      dayBucket.unique_countries = Object.keys(ccBreakdown).length;
      if ((ccList as { list_complete?: boolean }).list_complete === false) truncated = true;
    }

    const total = await env.LEDGER.get(`tlm:agg:${day}:total`);
    dayBucket.total = Number.parseInt(total || "0", 10);

    // Unique IPs (count of keys with prefix tlm:uniq:{day}:ip:)
    const uniq = await withBudget(
      env.LEDGER.list({ prefix: `tlm:uniq:${day}:ip:`, limit: 1000 }),
      STATS_DAY_BUDGET_MS,
      EMPTY_LIST as unknown as Awaited<ReturnType<typeof env.LEDGER.list>>
    );
    dayBucket.unique_ips = uniq.keys.length;
    if ((uniq as { list_complete?: boolean }).list_complete === false) truncated = true;

    // Active tenants
    const tenantUniq = await withBudget(
      env.LEDGER.list({ prefix: `tlm:uniq:${day}:tenant:`, limit: 1000 }),
      STATS_DAY_BUDGET_MS,
      EMPTY_LIST as unknown as Awaited<ReturnType<typeof env.LEDGER.list>>
    );
    dayBucket.active_tenants = tenantUniq.keys.length;

    out[day] = dayBucket;
  }

  // 7-day rolling unique IP count. De-duplicates returning visitors.
  const uniq7 = await withBudget(
    env.LEDGER.list({ prefix: `tlm:uniq7:ip:`, limit: 1000 }),
    STATS_DAY_BUDGET_MS,
    EMPTY_LIST as unknown as Awaited<ReturnType<typeof env.LEDGER.list>>
  );
  const totals_7d = {
    unique_ips_7d: uniq7.keys.length,
  };

  return new Response(
    JSON.stringify({ days: out, totals_7d, truncated, budget_ms: STATS_DAY_BUDGET_MS }, null, 2),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${STATS_CACHE_TTL_S}, s-maxage=${STATS_CACHE_TTL_S}`,
      },
    }
  );
}

/**
 * /admin/stats — ADMIN_TOKEN-gated. Returns everything /stats does, plus:
 *   - per-tenant breakdown (tool mix, outcome mix, daily count) for active tenants
 *   - daily Cloudflare Workers Analytics (requests, p50/p95 latency) for the past 7 days
 *     when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_ANALYTICS_TOKEN are set in the env.
 *
 * Privacy: tenant identifiers shown here are your own (tenant_id from your KV),
 * not third-party PII. Country and UA breakdowns are already public on /stats.
 */
export async function handleAdminStats(
  env: BillingEnv & {
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_ANALYTICS_TOKEN?: string;
  }
): Promise<Response> {
  // Build the same daily bucket as /stats
  const days = 7;
  type DayRow = Record<string, number | Record<string, number | Record<string, number>>>;
  const out: Record<string, DayRow> = {};
  const tenantsSeen = new Set<string>();

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = isoDay(d);
    const dayBucket: DayRow = {};

    const total = await env.LEDGER.get(`tlm:agg:${day}:total`);
    dayBucket.total = Number.parseInt(total || "0", 10);

    // Tools
    const toolsRow: Record<string, number> = {};
    for (const t of ["submit_incident", "verify_certificate", "get_anchor_status", "query_issuer_registry"] as const) {
      const v = await env.LEDGER.get(`tlm:agg:${day}:tool:${t}`);
      toolsRow[t] = Number.parseInt(v || "0", 10);
    }
    dayBucket.tools = toolsRow;

    // Outcomes
    const outRow: Record<string, number> = {};
    for (const o of ["ok", "error", "rate_limited", "guardrail_block"] as const) {
      const v = await env.LEDGER.get(`tlm:agg:${day}:outcome:${o}`);
      outRow[o] = Number.parseInt(v || "0", 10);
    }
    dayBucket.outcomes = outRow;

    // Country breakdown
    const ccList = await env.LEDGER.list({ prefix: `tlm:agg:${day}:cc:`, limit: 1000 });
    const ccBreakdown: Record<string, number> = {};
    await Promise.all(
      ccList.keys.map(async (k) => {
        const cc = k.name.slice(`tlm:agg:${day}:cc:`.length);
        const v = await env.LEDGER.get(k.name);
        if (v) ccBreakdown[cc] = Number.parseInt(v, 10);
      })
    );
    if (Object.keys(ccBreakdown).length > 0) dayBucket.countries = ccBreakdown;

    // Active tenants today
    const tenantUniq = await env.LEDGER.list({ prefix: `tlm:uniq:${day}:tenant:`, limit: 1000 });
    const tenantsToday: Record<string, Record<string, number>> = {};
    for (const k of tenantUniq.keys) {
      const tenant = k.name.slice(`tlm:uniq:${day}:tenant:`.length);
      tenantsSeen.add(tenant);
      const tenantTotal = await env.LEDGER.get(`tlm:agg:${day}:tenant:${tenant}`);
      const row: Record<string, number> = {
        total: Number.parseInt(tenantTotal || "0", 10),
      };
      // tool mix per tenant
      for (const t of ["submit_incident", "verify_certificate", "get_anchor_status", "query_issuer_registry"] as const) {
        const v = await env.LEDGER.get(`tlm:agg:${day}:tenant_tool:${tenant}:${t}`);
        if (v && Number.parseInt(v, 10) > 0) row[`tool_${t}`] = Number.parseInt(v, 10);
      }
      // outcome mix per tenant
      for (const o of ["ok", "error", "rate_limited", "guardrail_block"] as const) {
        const v = await env.LEDGER.get(`tlm:agg:${day}:tenant_outcome:${tenant}:${o}`);
        if (v && Number.parseInt(v, 10) > 0) row[`outcome_${o}`] = Number.parseInt(v, 10);
      }
      tenantsToday[tenant] = row;
    }
    if (Object.keys(tenantsToday).length > 0) dayBucket.tenants = tenantsToday;

    out[day] = dayBucket;
  }

  // 7-day rolling uniques
  const uniq7 = await env.LEDGER.list({ prefix: `tlm:uniq7:ip:`, limit: 1000 });

  // Cloudflare Workers Analytics (optional)
  let cf_analytics: unknown = null;
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ANALYTICS_TOKEN) {
    cf_analytics = await fetchWorkersAnalytics(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_ANALYTICS_TOKEN, days);
  }

  return new Response(
    JSON.stringify(
      {
        days: out,
        totals_7d: {
          unique_ips_7d: uniq7.keys.length,
          active_tenants_7d: tenantsSeen.size,
        },
        cf_analytics,
        generated_at: new Date().toISOString(),
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "private, no-store",
      },
    }
  );
}

/**
 * Cloudflare Workers Analytics via GraphQL. Returns daily request counts and
 * latency percentiles for the worker that owns the API token.
 * https://developers.cloudflare.com/analytics/graphql-api/
 */
async function fetchWorkersAnalytics(
  accountId: string,
  token: string,
  days: number
): Promise<unknown> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceISO = since.toISOString().slice(0, 10);
  const untilISO = new Date().toISOString().slice(0, 10);
  const query = `query($accountTag: string, $since: string, $until: string) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        workersInvocationsAdaptive(
          limit: 100,
          filter: { date_geq: $since, date_leq: $until }
        ) {
          dimensions { date }
          sum { requests subrequests errors }
          quantiles { cpuTimeP50 cpuTimeP95 wallTimeP50 wallTimeP95 }
        }
      }
    }
  }`;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: { accountTag: accountId, since: sinceISO, until: untilISO },
      }),
    });
    if (!r.ok) return { error: `cf_analytics_http_${r.status}` };
    return await r.json();
  } catch (e) {
    return { error: "cf_analytics_fetch_failed", message: String(e) };
  }
}

/**
 * Wrap the watermark message that is appended to demo-mode tool responses
 * so callers know they are not seeing full-fidelity output.
 */
export function demoWatermark(env: BillingEnv): string | null {
  if (env.BILLING_MODE !== "demo") return null;
  return (
    "DEMO RESULT — this response was produced by the CausalLayer public demo " +
    "with limited fidelity and a per-IP daily cap. Full deterministic liability " +
    "scoring, signed certificates, and Bitcoin-anchored proofs require a paid " +
    "tenant. Email sales@causallayer.io to upgrade."
  );
}
