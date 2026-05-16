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
