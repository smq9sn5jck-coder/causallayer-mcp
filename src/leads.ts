/**
 * src/leads.ts
 * ────────────────────────────────────────────────────────────────────────────
 * First-party lead capture for faultkey.com.
 *
 * Replaces the Formspree fallback (xlgvnqek) wherever the LEADS_DB D1 binding
 * is configured. The client (EmailCapture / StickyCtaBar) will call this
 * endpoint first; on any non-2xx the client falls back to Formspree, which
 * still works.
 *
 * Wire-up (no breaking changes):
 *   1) Add a `leads_db` binding in wrangler.jsonc and run migration 0001.
 *   2) Add `LEADS_RL` KV namespace binding for the rate-limit counter.
 *   3) Optional: set TURNSTILE_SECRET for bot protection.
 *   4) Add the route in src/index.ts:
 *
 *        if (url.pathname === "/v1/leads") {
 *          return handleLeads(request, env, ctx, t0);
 *        }
 *
 * Threat model addressed by this module:
 *   - Drive-by form spam     → Turnstile verification + per-IP rate limit
 *   - Payload bombs          → 4 KB request-body limit, strict field length caps
 *   - Header injection       → all fields go through a single sanitise() function
 *   - PII over-retention     → IPs hashed with a daily-rotating salt
 *   - CORS abuse             → strict allowlist (faultkey.com + manus preview)
 *
 * Non-goals:
 *   - Email enrichment, scoring, or CRM sync — those happen out-of-band by a
 *     scheduled job reading the leads table.
 *   - Double-opt-in confirmation — handled by a downstream Resend automation
 *     keyed off new rows.
 *
 * Public-facing JSON contract is intentionally minimal so the client can ship
 * the same body shape to both /v1/leads and Formspree without branching.
 */

import { timingSafeEqual } from "./secure-compare.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Subset of the global Env interface relevant to this module. Re-declared
 *  locally so the file is self-contained and can be reasoned about in
 *  isolation. */
export interface LeadsEnv {
  /** Primary lead-storage KV namespace. Recommended: bind the existing
   *  `LEDGER` namespace (already used by the Worker) under this name. */
  LEADS_KV?: KVNamespace;
  /** Optional separate KV for rate-limit counters. Falls back to LEADS_KV
   *  with a `rl:` prefix if unset, so a single binding is sufficient. */
  LEADS_RL?: KVNamespace;
  TURNSTILE_SECRET?: string;
  TURNSTILE_REQUIRED?: string;       // "true" to enforce
  LEADS_DAILY_SALT_KEY?: string;     // optional pepper override; defaults to fixed pepper
}

interface LeadInput {
  email: string;
  company?: string;
  role?: string;
  sector?: string;
  use_case?: string;
  source?: string;
  ref?: string;
  turnstile_token?: string;
  extras?: Record<string, unknown>;
}

interface LeadRow {
  id: string;
  created_at_ms: number;
  email: string;
  company: string | null;
  role: string | null;
  sector: string | null;
  use_case: string | null;
  source: string | null;
  ref: string | null;
  cf_country: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  turnstile: "pass" | "fail" | null;
  extras_json: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 4 * 1024;            // 4 KB — generous; refuses payload bombs
const MAX_FIELD_LEN = 200;                  // every short field
const MAX_USE_CASE_LEN = 600;               // longer free-text field
const MAX_USER_AGENT_LEN = 500;
const MAX_EMAIL_LEN = 254;
const MIN_EMAIL_LEN = 6;

/** Lenient RFC-5322 — exact RFC compliance is impossible in a regex and
 *  un-helpful in practice. This catches obvious garbage without rejecting
 *  real addresses with + or . sub-addressing. */
const EMAIL_RX = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

const ALLOWED_ORIGINS = new Set<string>([
  "https://faultkey.com",
  "https://www.faultkey.com",
  "https://faultkey-landing.pages.dev",
  // Manus preview URLs change per-session; matching is done with a regex
  // below in `corsHeadersFor()` so we don't need to enumerate them here.
]);
const MANUS_PREVIEW_RX = /^https:\/\/(\d+)-[a-z0-9-]+\.[a-z0-9-]+\.manus\.computer$/;

const RL_WINDOW_SECONDS = 3600;             // 1-hour sliding window
const RL_MAX_PER_WINDOW = 5;                // max 5 submissions / IP-hash / hour

/** Fixed daily-rotating salt (pepper). Combined with the IP and the UTC
 *  date yields an ip_hash that is unlinkable across days. Override via
 *  env.LEADS_DAILY_SALT_KEY if a per-environment value is preferred. */
const DEFAULT_PEPPER = "fk-2026-leads-daily-pepper-v1";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitise(v: unknown, maxLen: number = MAX_FIELD_LEN): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  // Strip control chars and trim. Never strip newlines from use_case — they
  // are signal, not noise.
  const cleaned = v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function validateEmail(raw: unknown): { ok: true; email: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "email_required" };
  const e = raw.trim();
  if (e.length < MIN_EMAIL_LEN) return { ok: false, reason: "email_too_short" };
  if (e.length > MAX_EMAIL_LEN) return { ok: false, reason: "email_too_long" };
  if (!EMAIL_RX.test(e)) return { ok: false, reason: "email_invalid" };
  return { ok: true, email: e };
}

/** ULID-ish opaque id: 10-char k-sortable timestamp prefix + 16-char random
 *  suffix in Crockford-base32. Stable enough for a sortable PK, opaque
 *  enough that it can't be guessed or enumerated. */
function newLeadId(now: number = Date.now()): string {
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function toBase32(n: bigint, len: number): string {
    let s = "";
    let v = n;
    for (let i = 0; i < len; i++) {
      const idx = Number(v % 32n);
      s = CROCKFORD[idx] + s;
      v = v / 32n;
    }
    return s;
  }
  const tsPart = toBase32(BigInt(now), 10);
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  let randBig = 0n;
  for (const b of rand) randBig = (randBig << 8n) | BigInt(b);
  const randPart = toBase32(randBig, 16);
  return `lead_${tsPart}${randPart}`;
}

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function utcDateKey(now: number = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Hash an IP with a per-day rotating pepper. Result is 32 hex chars
 *  (truncated SHA-256). Different IPs on the same day produce different
 *  hashes; the same IP across days produces unlinkable hashes. */
async function hashIp(ip: string | null, env: LeadsEnv, now: number = Date.now()): Promise<string | null> {
  if (!ip) return null;
  const pepper = env.LEADS_DAILY_SALT_KEY || DEFAULT_PEPPER;
  const dayKey = utcDateKey(now);
  const hex = await sha256Hex(`${ip}|${dayKey}|${pepper}`);
  return hex.slice(0, 32);
}

/** Verify a Cloudflare Turnstile token against the siteverify endpoint.
 *  Returns "pass" / "fail" / null (no verification attempted). */
async function verifyTurnstile(token: string | undefined, env: LeadsEnv, ip: string | null): Promise<"pass" | "fail" | null> {
  if (!env.TURNSTILE_SECRET) return null;          // Turnstile not configured
  if (!token) return env.TURNSTILE_REQUIRED === "true" ? "fail" : null;
  try {
    const body = new URLSearchParams();
    body.set("secret", env.TURNSTILE_SECRET);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const j = (await r.json()) as { success?: boolean };
    return j?.success ? "pass" : "fail";
  } catch {
    // Network failure on siteverify — treat as fail when required, otherwise null
    return env.TURNSTILE_REQUIRED === "true" ? "fail" : null;
  }
}

/** Per-IP-hash rate-limit using KV. Best-effort: if KV is unavailable, we
 *  allow the request. This is the right tradeoff for a public lead form —
 *  losing a legitimate lead to a rate-limit false positive is worse than
 *  letting through a couple of extra spam submissions. */
async function checkAndIncrementRl(ipHash: string | null, env: LeadsEnv): Promise<{ ok: true } | { ok: false; retry_after: number }> {
  const kv = env.LEADS_RL || env.LEADS_KV;
  if (!kv || !ipHash) return { ok: true };
  const key = `rl:${ipHash}`;
  try {
    const raw = await kv.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= RL_MAX_PER_WINDOW) {
      return { ok: false, retry_after: RL_WINDOW_SECONDS };
    }
    await kv.put(key, String(count + 1), { expirationTtl: RL_WINDOW_SECONDS });
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

function corsHeadersFor(origin: string | null): Record<string, string> {
  const base: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Cf-Connecting-Ip",
    "Access-Control-Max-Age": "86400",
  };
  if (!origin) return base;
  if (ALLOWED_ORIGINS.has(origin) || MANUS_PREVIEW_RX.test(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

function json(body: unknown, init: ResponseInit = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

// ─── Public handler ─────────────────────────────────────────────────────────

/**
 * Handle a request to POST /v1/leads (or OPTIONS preflight).
 *
 * Wire it into the main fetch handler with a single line:
 *
 *   if (url.pathname === "/v1/leads") {
 *     return handleLeads(request, env, ctx, t0);
 *   }
 *
 * Never throws. Always returns a Response with a JSON body that the client
 * can branch on directly. The shape is intentionally compatible with the
 * Formspree fallback so the client code is identical on both paths:
 *
 *   { ok: true,  lead_id }                          // success
 *   { ok: false, error: "<code>", retry_after? }    // failure
 */
export async function handleLeads(
  request: Request,
  env: LeadsEnv,
  _ctx: ExecutionContext,
  _t0?: number,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = corsHeadersFor(origin);

  // ─ Preflight ────────────────────────────────────────────────────────────
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 }, cors);
  }

  // ─ Body parse with strict size cap ──────────────────────────────────────
  let bodyText: string;
  try {
    // Reading as ArrayBuffer first lets us bound the size; calling .text()
    // directly would happily consume megabytes.
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: "payload_too_large" }, { status: 413 }, cors);
    }
    bodyText = new TextDecoder().decode(buf);
  } catch {
    return json({ ok: false, error: "body_read_failed" }, { status: 400 }, cors);
  }

  let raw: unknown;
  try {
    raw = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 }, cors);
  }
  if (!raw || typeof raw !== "object") {
    return json({ ok: false, error: "body_not_object" }, { status: 400 }, cors);
  }
  const input = raw as LeadInput;

  // ─ Validate email (the only required field) ─────────────────────────────
  const emailCheck = validateEmail(input.email);
  if (!emailCheck.ok) {
    return json({ ok: false, error: emailCheck.reason }, { status: 400 }, cors);
  }

  // ─ Honeypot defence ─────────────────────────────────────────────────────
  // Forms include a hidden field "company_name_hp" which legitimate users
  // never fill; any bot that auto-fills every field will trip this and be
  // silently 200'd to avoid signalling our detection. The lead is dropped.
  if (typeof (input as any).company_name_hp === "string" && (input as any).company_name_hp.trim().length > 0) {
    return json({ ok: true, lead_id: "hp_dropped" }, { status: 200 }, cors);
  }

  // ─ Connection metadata ──────────────────────────────────────────────────
  const ip = request.headers.get("Cf-Connecting-Ip");
  const cfCountry = request.headers.get("Cf-IPCountry");
  const userAgent = request.headers.get("User-Agent");
  const refererHeader = request.headers.get("Referer");
  const ipHash = await hashIp(ip, env);

  // ─ Rate limit ───────────────────────────────────────────────────────────
  const rl = await checkAndIncrementRl(ipHash, env);
  if (!rl.ok) {
    return json(
      { ok: false, error: "rate_limited", retry_after: rl.retry_after },
      { status: 429 },
      { ...cors, "Retry-After": String(rl.retry_after) },
    );
  }

  // ─ Turnstile ────────────────────────────────────────────────────────────
  const turnstile = await verifyTurnstile(input.turnstile_token, env, ip);
  if (turnstile === "fail" && env.TURNSTILE_REQUIRED === "true") {
    return json({ ok: false, error: "turnstile_failed" }, { status: 403 }, cors);
  }

  // ─ Build the row ────────────────────────────────────────────────────────
  const now = Date.now();
  const lead: LeadRow = {
    id: newLeadId(now),
    created_at_ms: now,
    email: emailCheck.email,
    company:  sanitise(input.company,  MAX_FIELD_LEN),
    role:     sanitise(input.role,     MAX_FIELD_LEN),
    sector:   sanitise(input.sector,   MAX_FIELD_LEN),
    use_case: sanitise(input.use_case, MAX_USE_CASE_LEN),
    source:   sanitise(input.source,   MAX_FIELD_LEN),
    ref:      sanitise(input.ref || refererHeader || null, MAX_FIELD_LEN),
    cf_country: cfCountry ? cfCountry.slice(0, 4) : null,
    ip_hash:    ipHash,
    user_agent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LEN) : null,
    turnstile,
    extras_json: input.extras ? JSON.stringify(input.extras).slice(0, 1000) : null,
  };

  // ─ Persist ──────────────────────────────────────────────────────────────
  if (!env.LEADS_KV) {
    // KV not bound — return a structured error so the client can fall back
    // to Formspree without retrying. Should never happen in prod once the
    // wrangler.jsonc binding is added.
    return json({ ok: false, error: "leads_kv_unbound" }, { status: 503 }, cors);
  }

  try {
    // Reverse-index lookup: has this email submitted before? If so we
    // return the existing lead_id instead of creating a duplicate row.
    const emailKey = `lead-by-email:${await sha256Hex(lead.email.toLowerCase())}`;
    const existing = await env.LEADS_KV.get(emailKey);
    if (existing) {
      // 200 (not 201) so the client can distinguish first vs repeat submit.
      return json(
        { ok: true, lead_id: existing, deduped: true },
        { status: 200 },
        cors,
      );
    }

    // Primary write: full lead row, JSON-serialised, keyed by lead_id.
    // Metadata mirrors the most-queried scalars so admin tooling can run a
    // single list({prefix:'lead:'}) and get email + created_at without a
    // follow-up GET per row.
    const primaryKey = `lead:${lead.id}`;
    const metadata = {
      email: lead.email,
      company: lead.company,
      created_at_ms: lead.created_at_ms,
      source: lead.source,
      cf_country: lead.cf_country,
    };
    await env.LEADS_KV.put(primaryKey, JSON.stringify(lead), { metadata });
    await env.LEADS_KV.put(emailKey, lead.id);
  } catch (e) {
    console.error("leads kv put failed", String((e as Error)?.message || e));
    return json({ ok: false, error: "insert_failed" }, { status: 500 }, cors);
  }

  return json({ ok: true, lead_id: lead.id }, { status: 201 }, cors);
}

// ─── Admin retrieval ────────────────────────────────────────────────────────

/**
 * Handle GET /v1/leads with admin-token auth. Returns recent leads as JSON.
 *
 *   curl -H "X-Admin-Token: $LEADS_ADMIN_TOKEN" \
 *        "https://mcp.faultkey.com/v1/leads?limit=50"
 *
 * Auth: shared bearer in env.LEADS_ADMIN_TOKEN (set via
 * `wrangler secret put LEADS_ADMIN_TOKEN`). If the secret is unset, the
 * endpoint returns 503 — listing is disabled until configured.
 */
export async function handleLeadsList(
  request: Request,
  env: LeadsEnv & { LEADS_ADMIN_TOKEN?: string },
): Promise<Response> {
  const cors = corsHeadersFor(request.headers.get("Origin"));
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 }, cors);
  }
  if (!env.LEADS_ADMIN_TOKEN) {
    return json({ ok: false, error: "admin_token_unset" }, { status: 503 }, cors);
  }
  const provided =
    request.headers.get("X-Admin-Token") ||
    (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(provided, env.LEADS_ADMIN_TOKEN)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 }, cors);
  }
  if (!env.LEADS_KV) {
    return json({ ok: false, error: "leads_kv_unbound" }, { status: 503 }, cors);
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1),
    1000,
  );
  const cursor = url.searchParams.get("cursor") || undefined;

  try {
    const list = await env.LEADS_KV.list({ prefix: "lead:", limit, cursor });
    const rows = list.keys.map((k) => ({
      key: k.name,
      lead_id: k.name.startsWith("lead:") ? k.name.slice(5) : k.name,
      ...((k.metadata as Record<string, unknown>) || {}),
    }));
    return json(
      {
        ok: true,
        count: rows.length,
        cursor: list.list_complete ? null : list.cursor,
        leads: rows,
      },
      { status: 200 },
      cors,
    );
  } catch (e) {
    console.error("leads list failed", String((e as Error)?.message || e));
    return json({ ok: false, error: "list_failed" }, { status: 500 }, cors);
  }
}

// ─── Test exports ───────────────────────────────────────────────────────────
// Internal helpers exposed for unit tests. Not part of the public contract.
export const __internal = {
  validateEmail,
  sanitise,
  newLeadId,
  utcDateKey,
  hashIp,
  EMAIL_RX,
  MAX_BODY_BYTES,
  MAX_FIELD_LEN,
  RL_MAX_PER_WINDOW,
};
