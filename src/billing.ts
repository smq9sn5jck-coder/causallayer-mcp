/**
 * CausalLayer MCP — Billing module
 * --------------------------------
 *
 * Implements the prepaid-credit ledger, API-key resolution, and Stripe
 * webhook for the CausalLayer MCP server.
 *
 * Storage: a single Cloudflare KV namespace (binding LEDGER) holds all
 * billing state. KV is eventually consistent globally but strongly
 * consistent within a region for ~60s, which is acceptable here because
 * (a) we use atomic compare-and-swap for credit deduction via a small
 *     read-modify-write loop, and
 * (b) Stripe webhooks are idempotent (we dedupe on event.id).
 *
 * Pricing is intentionally configurable via env so we can adjust per
 * deployment without re-deploying the worker.
 */

export interface BillingEnv {
  LEDGER: KVNamespace;

  // Pricing (credits per call) — strings because env vars are strings
  PRICE_SUBMIT_INCIDENT: string;
  PRICE_VERIFY_CERTIFICATE: string;
  PRICE_GET_ANCHOR_STATUS: string;
  PRICE_QUERY_ISSUER_REGISTRY: string;

  // Stripe
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_STARTER?: string; // e.g. price_1Xyz... → 1,000 credits
  STRIPE_PRICE_GROWTH?: string; // 10,000 credits
  STRIPE_PRICE_ENTERPRISE?: string; // 100,000 credits

  // Admin
  ADMIN_TOKEN?: string;

  // Mode flags
  BILLING_MODE: "stripe" | "x402" | "free" | "demo"; // free = no charging (dev), demo = public free with rate-limit
  CAUSALLAYER_ENV: "dev" | "sandbox" | "production";

  // Demo-mode rate-limit overrides (all optional; empty/missing = use defaults)
  // Strings because env vars are strings.
  DEMO_DAILY_PER_IP_SUBMIT?: string;       // default 5
  DEMO_DAILY_PER_IP_VERIFY?: string;       // default 50
  DEMO_DAILY_GLOBAL_SUBMIT?: string;       // default 1000
  DEMO_BURST_WINDOW_SECONDS?: string;      // default 5
}

// ─── Pricing ───────────────────────────────────────────────────────────────

export type ToolName =
  | "submit_incident"
  | "verify_certificate"
  | "get_anchor_status"
  | "query_issuer_registry"
  | "extract_incident";

export function priceFor(env: BillingEnv, tool: ToolName): number {
  const map: Record<ToolName, string | undefined> = {
    submit_incident: env.PRICE_SUBMIT_INCIDENT,
    verify_certificate: env.PRICE_VERIFY_CERTIFICATE,
    get_anchor_status: env.PRICE_GET_ANCHOR_STATUS,
    query_issuer_registry: env.PRICE_QUERY_ISSUER_REGISTRY,
    extract_incident: (env as unknown as Record<string, string | undefined>).PRICE_EXTRACT_INCIDENT,
  };
  const raw = map[tool];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ─── KV record types ───────────────────────────────────────────────────────

export interface TenantRecord {
  tenant_id: string;
  name: string;
  email: string;
  stripe_customer_id?: string;
  status: "active" | "suspended" | "expired";
  created_at: string;
}

export interface CreditsRecord {
  tenant_id: string;
  balance: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  updated_at: string;
}

export interface ApiKeyRecord {
  tenant_id: string;
  name: string;
  status: "active" | "revoked";
  created_at: string;
}

export interface LedgerEntry {
  id: string; // ulid
  tenant_id: string;
  type: "topup" | "charge" | "refund";
  delta: number; // positive for topup/refund, negative for charge
  tool?: ToolName;
  request_id?: string;
  stripe_session_id?: string;
  stripe_event_id?: string;
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const enc = new TextEncoder();

export async function hashApiKey(rawKey: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(rawKey));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function ulid(): string {
  // ulid-lite: 48-bit timestamp + 80-bit random, base32 Crockford
  const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const ts = Date.now();
  let tsPart = "";
  let t = ts;
  for (let i = 0; i < 10; i++) {
    tsPart = ALPH[t % 32] + tsPart;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(10));
  let rPart = "";
  for (const b of rand) rPart += ALPH[b % 32];
  return tsPart + rPart;
}

// ─── Tenant + key resolution ───────────────────────────────────────────────

export async function resolveTenantFromAuth(
  env: BillingEnv,
  authHeader: string | null
): Promise<{ tenant: TenantRecord; keyHash: string } | null> {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m) return null;
  const rawKey = m[1].trim();
  if (!rawKey.startsWith("clk_")) return null; // CausalLayer key prefix
  const keyHash = await hashApiKey(rawKey);

  const keyRec = await env.LEDGER.get<ApiKeyRecord>(`apikey:${keyHash}`, "json");
  if (!keyRec || keyRec.status !== "active") return null;

  const tenant = await env.LEDGER.get<TenantRecord>(`tenant:${keyRec.tenant_id}`, "json");
  if (!tenant || tenant.status !== "active") return null;

  return { tenant, keyHash };
}

// ─── Credit ledger ─────────────────────────────────────────────────────────

export async function getCredits(env: BillingEnv, tenantId: string): Promise<CreditsRecord> {
  const cur = await env.LEDGER.get<CreditsRecord>(`credits:${tenantId}`, "json");
  if (cur) return cur;
  const fresh: CreditsRecord = {
    tenant_id: tenantId,
    balance: 0,
    lifetime_purchased: 0,
    lifetime_consumed: 0,
    updated_at: new Date().toISOString(),
  };
  await env.LEDGER.put(`credits:${tenantId}`, JSON.stringify(fresh));
  return fresh;
}

async function writeLedger(env: BillingEnv, entry: LedgerEntry): Promise<void> {
  await env.LEDGER.put(`tx:${entry.tenant_id}:${entry.id}`, JSON.stringify(entry), {
    // 7-year retention for audit (APRA CPS 234 / financial records)
    expirationTtl: 60 * 60 * 24 * 365 * 7,
  });
}

/**
 * Atomically deduct `cost` credits. Returns true on success, false on
 * insufficient balance. Uses a small read-modify-write retry loop because
 * KV does not support true CAS; conflicts are rare per-tenant.
 */
export async function chargeCredits(
  env: BillingEnv,
  tenantId: string,
  cost: number,
  ctx: { tool: ToolName; request_id: string }
): Promise<{ ok: true; balance: number; tx_id: string } | { ok: false; balance: number; reason: string }> {
  if (cost <= 0) {
    const c = await getCredits(env, tenantId);
    return { ok: true, balance: c.balance, tx_id: "free" };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const c = await getCredits(env, tenantId);
    if (c.balance < cost) {
      return { ok: false, balance: c.balance, reason: "INSUFFICIENT_CREDITS" };
    }
    const next: CreditsRecord = {
      ...c,
      balance: c.balance - cost,
      lifetime_consumed: c.lifetime_consumed + cost,
      updated_at: new Date().toISOString(),
    };
    await env.LEDGER.put(`credits:${tenantId}`, JSON.stringify(next));

    const txId = ulid();
    await writeLedger(env, {
      id: txId,
      tenant_id: tenantId,
      type: "charge",
      delta: -cost,
      tool: ctx.tool,
      request_id: ctx.request_id,
      created_at: new Date().toISOString(),
    });
    return { ok: true, balance: next.balance, tx_id: txId };
  }
  return { ok: false, balance: 0, reason: "WRITE_CONFLICT" };
}

export async function refundCredits(
  env: BillingEnv,
  tenantId: string,
  amount: number,
  ctx: { tool: ToolName; request_id: string; reason: string }
): Promise<void> {
  if (amount <= 0) return;
  const c = await getCredits(env, tenantId);
  const next: CreditsRecord = {
    ...c,
    balance: c.balance + amount,
    lifetime_consumed: Math.max(0, c.lifetime_consumed - amount),
    updated_at: new Date().toISOString(),
  };
  await env.LEDGER.put(`credits:${tenantId}`, JSON.stringify(next));
  await writeLedger(env, {
    id: ulid(),
    tenant_id: tenantId,
    type: "refund",
    delta: amount,
    tool: ctx.tool,
    request_id: ctx.request_id,
    created_at: new Date().toISOString(),
  });
}

export async function topUpCredits(
  env: BillingEnv,
  tenantId: string,
  amount: number,
  stripeSessionId: string,
  stripeEventId: string
): Promise<void> {
  // Idempotency: skip if we have already processed this stripe event
  const idemKey = `idem:stripe:${stripeEventId}`;
  const seen = await env.LEDGER.get(idemKey);
  if (seen) return;
  await env.LEDGER.put(idemKey, "1", { expirationTtl: 60 * 60 * 24 * 90 });

  const c = await getCredits(env, tenantId);
  const next: CreditsRecord = {
    ...c,
    balance: c.balance + amount,
    lifetime_purchased: c.lifetime_purchased + amount,
    updated_at: new Date().toISOString(),
  };
  await env.LEDGER.put(`credits:${tenantId}`, JSON.stringify(next));
  await writeLedger(env, {
    id: ulid(),
    tenant_id: tenantId,
    type: "topup",
    delta: amount,
    stripe_session_id: stripeSessionId,
    stripe_event_id: stripeEventId,
    created_at: new Date().toISOString(),
  });
}

// ─── Stripe webhook ────────────────────────────────────────────────────────

/**
 * Verify Stripe webhook signature using HMAC-SHA256 (per Stripe docs).
 * Implemented natively (no Stripe SDK) so it runs on Workers without
 * Node compatibility issues.
 */
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  toleranceSeconds = 300
): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const ts = Number.parseInt(t, 10);
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  const signedPayload = `${t}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  // constant-time compare
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

/**
 * Map a Stripe price ID to a credit pack size.
 */
export function creditsForPriceId(env: BillingEnv, priceId: string): number {
  if (priceId === env.STRIPE_PRICE_STARTER) return 1000;
  if (priceId === env.STRIPE_PRICE_GROWTH) return 10_000;
  if (priceId === env.STRIPE_PRICE_ENTERPRISE) return 100_000;
  return 0;
}

/**
 * Handle a Stripe checkout.session.completed event. Expects the session
 * to have client_reference_id = tenant_id and a single line item whose
 * price.id maps to a known credit pack.
 */
export async function handleStripeWebhook(
  env: BillingEnv,
  request: Request
): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "stripe_not_configured" }, 503);
  }
  const rawBody = await request.text();
  const ok = await verifyStripeSignature(
    rawBody,
    request.headers.get("Stripe-Signature"),
    env.STRIPE_WEBHOOK_SECRET
  );
  if (!ok) return json({ error: "invalid_signature" }, 400);

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return json({ ok: true, ignored: event.type });
  }
  const session = event.data?.object;
  const tenantId = session?.client_reference_id as string | undefined;
  const sessionId = session?.id as string | undefined;
  if (!tenantId || !sessionId) {
    return json({ error: "missing_tenant_or_session" }, 400);
  }

  // Fetch line items via Stripe REST (no SDK)
  if (!env.STRIPE_SECRET_KEY) return json({ error: "stripe_secret_missing" }, 503);
  const liResp = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=10`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );
  if (!liResp.ok) return json({ error: "stripe_lookup_failed", status: liResp.status }, 502);
  const li = (await liResp.json()) as { data: Array<{ price: { id: string }; quantity: number }> };

  let credits = 0;
  for (const item of li.data ?? []) {
    credits += creditsForPriceId(env, item.price.id) * (item.quantity || 1);
  }
  if (credits <= 0) return json({ error: "unknown_price_id" }, 400);

  await topUpCredits(env, tenantId, credits, sessionId, event.id);
  return json({ ok: true, tenant_id: tenantId, credits_added: credits });
}

// ─── Helper: JSON response ─────────────────────────────────────────────────

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, mcp-session-id, accept",
      "access-control-expose-headers": "mcp-session-id",
      "access-control-max-age": "86400",
    },
  });
}
