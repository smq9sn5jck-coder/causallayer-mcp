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
const BURST_WINDOW_SECONDS = 5;          // 1 call / 5s / (IP, tool)
const TELEMETRY_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

  // (1) Burst limit per (IP, tool): KV PUT with TTL, treat existence as "too soon"
  const burstKey = `demo:burst:${ip}:${tool}`;
  const burst = await env.LEDGER.get(burstKey);
  if (burst) {
    return {
      allow: false,
      reason: "burst",
      retry_after_seconds: BURST_WINDOW_SECONDS,
    };
  }

  // (2) Daily per-IP for paid tools
  if (PAID_TOOLS.has(tool)) {
    const perIpLimit =
      tool === "submit_incident" ? DEFAULT_DAILY_PER_IP : DEFAULT_VERIFY_PER_IP;
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
    if (usedGlobal >= DEFAULT_DAILY_GLOBAL) {
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

  // Set burst marker (5s TTL)
  await env.LEDGER.put(`demo:burst:${ip}:${tool}`, "1", {
    expirationTtl: BURST_WINDOW_SECONDS,
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

    // 2. Increment aggregate counters used by /stats
    const counters = [
      `tlm:agg:${day}:tool:${payload.tool}`,
      `tlm:agg:${day}:outcome:${payload.outcome}`,
      `tlm:agg:${day}:ua:${ua}`,
      `tlm:agg:${day}:cc:${cc}`,
      `tlm:agg:${day}:total`,
      `tlm:uniq:${day}:ip:${ip}`, // existence-only, dedupes unique IPs/day
    ];
    await Promise.all(
      counters.map(async (k) => {
        if (k.startsWith("tlm:uniq:")) {
          await env.LEDGER.put(k, "1", { expirationTtl: TELEMETRY_TTL_SECONDS });
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
 */
export async function handleStats(env: BillingEnv): Promise<Response> {
  const days = 7;
  const out: Record<string, Record<string, number>> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const day = isoDay(d);
    const dayBucket: Record<string, number> = {};

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
    for (const ua of ["claude", "cursor", "cline", "continue", "vscode", "inspector", "other"]) {
      const v = await env.LEDGER.get(`tlm:agg:${day}:ua:${ua}`);
      if (v) dayBucket[`ua_${ua}`] = Number.parseInt(v, 10);
    }
    const total = await env.LEDGER.get(`tlm:agg:${day}:total`);
    dayBucket.total = Number.parseInt(total || "0", 10);

    // Unique IPs (count of keys with prefix tlm:uniq:{day}:ip:)
    const uniq = await env.LEDGER.list({
      prefix: `tlm:uniq:${day}:ip:`,
      limit: 1000,
    });
    dayBucket.unique_ips = uniq.keys.length;

    out[day] = dayBucket;
  }

  return new Response(JSON.stringify({ days: out }, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
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
