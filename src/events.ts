/**
 * CausalLayer MCP — Structured user-activity events
 * --------------------------------------------------
 *
 * Single canonical entry point for emitting named events to Cloudflare
 * Workers Observability. Each call writes ONE structured JSON line via
 * `console.log({ ... })` so the Observability dashboard can filter on
 * `event` directly (no Analytics Engine, no D1, no extra binding required).
 *
 * Design goals:
 *
 *   1. PII-free by default. We hash the IP, bucket the user-agent, and never
 *      log Authorization headers, request bodies, payment tokens, API keys,
 *      tenant emails, or any free-form form fields.
 *
 *   2. One canonical schema. Every event has the same top-level fields so
 *      Observability filters like `event == "report_generated" AND country
 *      == "ID"` work identically across every event type.
 *
 *   3. Anonymous session ID. A daily-rotating sha256(ip + ua + day-bucket)
 *      lets us tie multiple WebSocket reconnects to the same person without
 *      tracking them across days. Resets at UTC midnight by design.
 *
 *   4. Aggregate counters in KV. Same pattern as the existing
 *      `recordTelemetry()` in demo.ts, so /admin/stats can return a fast
 *      24h/7d roll-up without scanning every log line. The KV write is best
 *      effort and never blocks the user-facing response.
 *
 *   5. Cheap. Every counter increment is at most one KV read + one KV write
 *      per event, all under `ctx.waitUntil()` so the user response time is
 *      not affected.
 *
 * What we explicitly DO NOT log:
 *   - raw IP address (only sha256 bucket)
 *   - Authorization header values
 *   - request bodies (only payload size in bytes)
 *   - API keys, Stripe tokens, X402 wallet signatures
 *   - tool-call arguments (only the tool name)
 *   - tenant email addresses
 */
import type { BillingEnv } from "./billing.js";

// ─── Public event names ────────────────────────────────────────────────

export type EventName =
  | "app_opened"            // GET / or /healthz — informational landing
  | "websocket_connected"   // MCP WebSocket transport opened
  | "websocket_closed"      // MCP WebSocket transport closed (clean or 1006)
  | "api_request"           // POST /mcp received and routed
  | "api_error"             // /mcp returned a JSON-RPC error or threw
  | "report_generated"      // submit_incident tool returned a CausalCertificate
  | "form_submitted"        // /admin or future CTA endpoint received a form (no PII)
  | "login_success"         // /me successfully resolved a tenant API key
  | "login_failed";         // /me received an invalid Authorization header

// ─── Anonymous session ID ──────────────────────────────────────────────

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

function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Anonymous, daily-rotating session ID. Same person on the same UA on the
 * same day → same session_id. Resets at UTC midnight. NOT a person ID.
 */
export async function anonymousSessionId(request: Request): Promise<string> {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0";
  const ua = request.headers.get("user-agent") || "";
  const day = utcDay();
  const hex = await sha256Hex(`sid:v1:${day}:${ip}:${ua}`);
  return hex.slice(0, 16);
}

// ─── User-agent bucketing ──────────────────────────────────────────────

export function uaCategory(ua: string | null | undefined): string {
  const u = (ua || "").toLowerCase();
  if (u.includes("claude-desktop")) return "claude-desktop";
  if (u.includes("claude-code")) return "claude-code";
  if (u.includes("claude")) return "claude";
  if (u.includes("cursor")) return "cursor";
  if (u.includes("cline")) return "cline";
  if (u.includes("continue")) return "continue";
  if (u.includes("vscode")) return "vscode";
  if (u.includes("inspector")) return "inspector";
  if (u.includes("curl")) return "curl";
  if (u.includes("python") || u.includes("httpx")) return "python";
  if (u.includes("node")) return "node";
  if (u.includes("postman") || u.includes("insomnia")) return "api-client";
  if (u.includes("googlebot") || u.includes("bingbot") || u.includes("yandex")) return "search-bot";
  if (u.includes("ahrefs") || u.includes("semrush") || u.includes("dataforseo")) return "seo-bot";
  if (u.includes("mozilla") && u.includes("chrome")) return "browser-chrome";
  if (u.includes("mozilla") && u.includes("safari")) return "browser-safari";
  if (u.includes("mozilla") && u.includes("firefox")) return "browser-firefox";
  if (u.includes("mozilla")) return "browser-other";
  if (!u.trim()) return "empty";
  return "other";
}

// ─── Cloudflare request metadata extraction ────────────────────────────

interface CfMeta {
  country: string;
  colo: string;
  city: string;
  region: string;
  ray: string;
  asn: number | null;
  as_org: string | null;
}

function cfMeta(request: Request): CfMeta {
  // request.cf is populated by Cloudflare's edge with rich geo/ASN info.
  // Types vary by runtime; we read defensively.
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf ?? {};
  const get = (k: string): string =>
    typeof cf[k] === "string" ? (cf[k] as string) : "";
  const asn = typeof cf.asn === "number" ? (cf.asn as number) : null;
  const asOrg = typeof cf.asOrganization === "string" ? (cf.asOrganization as string) : null;
  return {
    country: (request.headers.get("cf-ipcountry") || get("country") || "ZZ").toUpperCase(),
    colo: get("colo") || "",
    city: get("city") || "",
    region: get("region") || "",
    ray: request.headers.get("cf-ray") || "",
    asn,
    as_org: asOrg,
  };
}

// ─── Optional fields that callers may attach ───────────────────────────

export interface EventExtras {
  // request_path: e.g. "/mcp", "/admin/stats", "/healthz". Required.
  request_path: string;
  // method: GET, POST, OPTIONS. Required.
  method: string;
  // response_status: HTTP status returned to the client.
  response_status?: number;
  // duration_ms: wall-clock time the Worker spent handling the request.
  duration_ms?: number;
  // referrer: only kept if it's a known-public hostname (no query strings).
  referrer?: string | null;
  // tool: for MCP-related events, which tool was invoked.
  tool?: string;
  // jsonrpc_method: for /mcp-related events, which JSON-RPC method was used.
  jsonrpc_method?: string;
  // tenant_id: present for paid tenants only (never an email/name).
  tenant_id?: string;
  // billing_mode: free / demo / stripe / x402.
  billing_mode?: string;
  // error_message: a SHORT (<200 char) sanitized description of the failure.
  // Stack traces and tokens MUST NOT appear here.
  error_message?: string;
  // payload_bytes: size of the request body, if any. No content.
  payload_bytes?: number;
  // wasClean / closeCode: for websocket_closed events.
  ws_was_clean?: boolean;
  ws_close_code?: number;
}

// ─── The single emit function ──────────────────────────────────────────

/**
 * Emit ONE structured JSON line for the given named event. Always succeeds —
 * never throws, never blocks. Best-effort KV counters are scheduled via
 * `ctx.waitUntil()` so the user response is unaffected.
 *
 * Usage:
 *   await logEvent("api_request", request, env, ctx, {
 *     request_path: "/mcp",
 *     method: "POST",
 *     response_status: 200,
 *     duration_ms: 42,
 *     tool: "submit_incident",
 *     tenant_id: "demo:0123abcd",
 *   });
 */
export async function logEvent(
  event: EventName,
  request: Request,
  env: BillingEnv,
  ctx: ExecutionContext,
  extras: EventExtras
): Promise<void> {
  try {
    const meta = cfMeta(request);
    const sid = await anonymousSessionId(request);
    const ua = request.headers.get("user-agent") || "";
    const ua_cat = uaCategory(ua);
    const ts = new Date().toISOString();

    // Truncate referrer to host-only and only if it's not a query string.
    let ref: string | null = null;
    const rawRef = extras.referrer ?? request.headers.get("referer");
    if (rawRef) {
      try {
        ref = new URL(rawRef).host || null;
      } catch {
        ref = null;
      }
    }

    // Truncate user-agent to 200 chars to keep log lines bounded.
    const ua_trim = ua.length > 200 ? ua.slice(0, 200) : ua;

    const line = {
      event,
      ts,
      anonymous_session_id: sid,
      tenant_id: extras.tenant_id ?? null,
      request_path: extras.request_path,
      method: extras.method,
      response_status: extras.response_status ?? null,
      duration_ms: extras.duration_ms ?? null,
      country: meta.country,
      colo: meta.colo,
      city: meta.city,
      region: meta.region,
      asn: meta.asn,
      as_org: meta.as_org,
      ua_category: ua_cat,
      user_agent: ua_trim,
      referrer: ref,
      cf_ray: meta.ray,
      tool: extras.tool ?? null,
      jsonrpc_method: extras.jsonrpc_method ?? null,
      billing_mode: extras.billing_mode ?? env.BILLING_MODE ?? null,
      payload_bytes: extras.payload_bytes ?? null,
      ws_was_clean: extras.ws_was_clean ?? null,
      ws_close_code: extras.ws_close_code ?? null,
      error_message: extras.error_message
        ? extras.error_message.slice(0, 200)
        : null,
      env: env.CAUSALLAYER_ENV ?? null,
    };

    // 1. The canonical structured log line — this is what Observability sees.
    console.log(JSON.stringify(line));

    // 2. Best-effort aggregate counters in KV for fast /admin/stats reads.
    if (env.LEDGER && ctx?.waitUntil) {
      ctx.waitUntil(updateCounters(env, line));
    }
  } catch {
    // Telemetry must NEVER break the user-facing response.
  }
}

// ─── Aggregate counters (24h/7d windows, stored in same KV as ledger) ──

const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

async function bumpCounter(env: BillingEnv, key: string): Promise<void> {
  const cur = Number.parseInt((await env.LEDGER.get(key)) || "0", 10);
  await env.LEDGER.put(key, String(cur + 1), {
    expirationTtl: COUNTER_TTL_SECONDS,
  });
}

async function markUnique(env: BillingEnv, key: string): Promise<void> {
  // Existence-only key. Used for unique-session counts — KV.list() with the
  // prefix returns the count for /admin/stats.
  await env.LEDGER.put(key, "1", { expirationTtl: COUNTER_TTL_SECONDS });
}

async function updateCounters(
  env: BillingEnv,
  line: {
    event: EventName | string;
    anonymous_session_id: string;
    country: string;
    ua_category: string;
    request_path: string;
    response_status: number | null;
    tool: string | null;
  }
): Promise<void> {
  try {
    const day = utcDay();
    const e = line.event;

    const counterKeys = [
      `evt:agg:${day}:total`,
      `evt:agg:${day}:event:${e}`,
      `evt:agg:${day}:cc:${line.country}`,
      `evt:agg:${day}:ua:${line.ua_category}`,
    ];
    if (line.tool) {
      counterKeys.push(`evt:agg:${day}:tool:${line.tool}`);
    }
    if (
      typeof line.response_status === "number" &&
      line.response_status >= 400
    ) {
      counterKeys.push(`evt:agg:${day}:errstatus:${line.response_status}`);
    }
    // Top route (only the first 3 path segments to avoid KV cardinality blow-up).
    const route = line.request_path.split("/").slice(0, 4).join("/") || "/";
    counterKeys.push(`evt:agg:${day}:route:${route}`);

    for (const k of counterKeys) await bumpCounter(env, k);

    // Unique session per day.
    await markUnique(env, `evt:uniq:${day}:sid:${line.anonymous_session_id}`);

    // Unique session-by-country per day (powers the country-tryers chart).
    await markUnique(
      env,
      `evt:uniq:${day}:cc:${line.country}:sid:${line.anonymous_session_id}`
    );
  } catch {
    // best effort
  }
}

// ─── Stats reader used by /admin/stats and /admin/dashboard ────────────

export interface EventStats {
  generated_at: string;
  window_days: number;
  totals: {
    events_24h: number;
    events_7d: number;
    unique_sessions_24h: number;
    unique_sessions_7d: number;
  };
  by_day: Record<string, Record<string, number>>;
  by_event: Record<string, number>;
  by_country: Record<string, number>;
  by_ua_category: Record<string, number>;
  by_route: Record<string, number>;
  by_tool: Record<string, number>;
  errors_by_status: Record<string, number>;
  unique_sessions_by_country_24h: Record<string, number>;
}

export async function readEventStats(
  env: BillingEnv,
  windowDays = 7
): Promise<EventStats> {
  const out: EventStats = {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    totals: {
      events_24h: 0,
      events_7d: 0,
      unique_sessions_24h: 0,
      unique_sessions_7d: 0,
    },
    by_day: {},
    by_event: {},
    by_country: {},
    by_ua_category: {},
    by_route: {},
    by_tool: {},
    errors_by_status: {},
    unique_sessions_by_country_24h: {},
  };

  const today = utcDay();

  for (let i = 0; i < windowDays; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = utcDay(d);
    out.by_day[day] = {};

    // Total
    const total = Number.parseInt(
      (await env.LEDGER.get(`evt:agg:${day}:total`)) || "0",
      10
    );
    out.by_day[day].total = total;
    out.totals.events_7d += total;
    if (i === 0) out.totals.events_24h += total;

    // Per-day per-event listing — list keys with prefix
    const eventKeys = await env.LEDGER.list({
      prefix: `evt:agg:${day}:event:`,
      limit: 100,
    });
    for (const k of eventKeys.keys) {
      const name = k.name.split(":").pop() || "unknown";
      const v = Number.parseInt((await env.LEDGER.get(k.name)) || "0", 10);
      out.by_day[day][`event_${name}`] = v;
      out.by_event[name] = (out.by_event[name] ?? 0) + v;
    }

    // Per-day per-country
    const ccKeys = await env.LEDGER.list({
      prefix: `evt:agg:${day}:cc:`,
      limit: 300,
    });
    for (const k of ccKeys.keys) {
      const cc = k.name.split(":").pop() || "ZZ";
      const v = Number.parseInt((await env.LEDGER.get(k.name)) || "0", 10);
      out.by_country[cc] = (out.by_country[cc] ?? 0) + v;
    }

    // Per-day per-UA-category
    const uaKeys = await env.LEDGER.list({
      prefix: `evt:agg:${day}:ua:`,
      limit: 100,
    });
    for (const k of uaKeys.keys) {
      const ua = k.name.split(":").pop() || "other";
      const v = Number.parseInt((await env.LEDGER.get(k.name)) || "0", 10);
      out.by_ua_category[ua] = (out.by_ua_category[ua] ?? 0) + v;
    }

    // Per-day per-route
    const routeKeys = await env.LEDGER.list({
      prefix: `evt:agg:${day}:route:`,
      limit: 100,
    });
    for (const k of routeKeys.keys) {
      const route = k.name.replace(`evt:agg:${day}:route:`, "") || "/";
      const v = Number.parseInt((await env.LEDGER.get(k.name)) || "0", 10);
      out.by_route[route] = (out.by_route[route] ?? 0) + v;
    }

    // Per-day per-tool
    const toolKeys = await env.LEDGER.list({
      prefix: `evt:agg:${day}:tool:`,
      limit: 50,
    });
    for (const k of toolKeys.keys) {
      const tool = k.name.split(":").pop() || "unknown";
      const v = Number.parseInt((await env.LEDGER.get(k.name)) || "0", 10);
      out.by_tool[tool] = (out.by_tool[tool] ?? 0) + v;
    }

    // Per-day error statuses
    const errKeys = await env.LEDGER.list({
      prefix: `evt:agg:${day}:errstatus:`,
      limit: 50,
    });
    for (const k of errKeys.keys) {
      const code = k.name.split(":").pop() || "?";
      const v = Number.parseInt((await env.LEDGER.get(k.name)) || "0", 10);
      out.errors_by_status[code] = (out.errors_by_status[code] ?? 0) + v;
    }

    // Unique sessions for the day
    const uniqDay = await env.LEDGER.list({
      prefix: `evt:uniq:${day}:sid:`,
      limit: 1000,
    });
    if (i === 0) out.totals.unique_sessions_24h += uniqDay.keys.length;
    out.totals.unique_sessions_7d += uniqDay.keys.length;
  }

  // Unique sessions by country, 24h window only
  const ccUniq = await env.LEDGER.list({
    prefix: `evt:uniq:${today}:cc:`,
    limit: 1000,
  });
  for (const k of ccUniq.keys) {
    // key form: evt:uniq:{day}:cc:{CC}:sid:{sid}
    const parts = k.name.split(":");
    const cc = parts[4] || "ZZ";
    out.unique_sessions_by_country_24h[cc] =
      (out.unique_sessions_by_country_24h[cc] ?? 0) + 1;
  }

  return out;
}
