# Deploying the `/v1/leads` endpoint

This file is the *only* document the operator needs to bring the first-party
lead capture endpoint online. It assumes the PR that added `src/leads.ts`,
`migrations/0001_create_leads.sql`, and the router wiring in `src/index.ts`
is already merged.

The endpoint is **safe to deploy before bindings are configured.** Until the
operator completes the wiring below, `POST /v1/leads` returns `503
leads_db_unbound` and the client (faultkey.com) falls back to Formspree
automatically. No outage, no data loss.

---

## Step 1 — Create the D1 database

```bash
wrangler d1 create faultkey_leads
```

Wrangler will print a `database_id`. Copy it.

## Step 2 — Create the rate-limit KV namespace

```bash
wrangler kv namespace create LEADS_RL --env demo
```

Wrangler will print a `kv_namespace.id`. Copy it.

## Step 3 — Add bindings to `wrangler.jsonc`

Inside `env.demo` (and `env.production` if/when applicable), add:

```jsonc
"d1_databases": [
  { "binding": "LEADS_DB", "database_name": "faultkey_leads", "database_id": "<from step 1>" }
],
"kv_namespaces": [
  // existing LEDGER + WEEKLY_PROOFS entries…
  { "binding": "LEADS_RL", "id": "<from step 2>" }
]
```

## Step 4 — Apply the schema migration

```bash
wrangler d1 execute LEADS_DB --file=migrations/0001_create_leads.sql --remote --env demo
```

## Step 5 — (Optional) configure Cloudflare Turnstile

If you want bot protection, add the Turnstile **site key** to the client
form and the **secret key** as a Worker secret:

```bash
wrangler secret put TURNSTILE_SECRET --env demo
# Paste the secret from the Turnstile dashboard.
```

By default the endpoint accepts submissions without Turnstile. To require
Turnstile (rejecting submissions without a valid token), also set:

```bash
wrangler secret put TURNSTILE_REQUIRED --env demo   # value: true
```

## Step 6 — Deploy

```bash
wrangler deploy --env demo
```

## Step 7 — Smoke-test

```bash
curl -sS -X POST https://mcp.faultkey.com/v1/leads \
  -H 'Content-Type: application/json' \
  -d '{"email":"deploy-smoke@faultkey.com","source":"deploy-smoke"}'
```

Expected: `HTTP 201 {"ok":true,"lead_id":"lead_…"}`.
Then check:

```bash
wrangler d1 execute LEADS_DB --command 'SELECT id, created_at_ms, email, source FROM leads ORDER BY created_at_ms DESC LIMIT 5' --env demo --remote
```

---

## Cutover plan for the client

Once the smoke test passes, the `EmailCapture` component on faultkey.com
can be updated to call `https://mcp.faultkey.com/v1/leads` **first**, then
fall back to Formspree on any non-2xx. The change is one function in
`client/src/components/EmailCapture.tsx`:

```ts
async function submitLead(payload: LeadPayload) {
  try {
    const r = await fetch("https://mcp.faultkey.com/v1/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return { ok: true, via: "firstparty" };
  } catch {
    /* fall through to Formspree */
  }
  // Existing Formspree call stays exactly as it is.
  return submitToFormspree(payload);
}
```

That client change is a separate PR on the `faultkey-landing` repo and is
**not** in scope for this deploy.

---

## Operational notes

- **No PII at rest beyond the email itself.** IPs are SHA-256 hashed with a
  daily-rotating pepper; the raw IP is never persisted.
- **Rate limit**: 5 submissions per IP-hash per hour, enforced via the
  `LEADS_RL` KV namespace. If KV is unavailable, the limit is silently
  skipped (the right tradeoff for a public lead form).
- **Rollback**: deleting the D1 binding from `wrangler.jsonc` and
  redeploying restores Formspree-only behavior. The client falls back
  automatically. The leads table itself is left intact.
- **Privacy disclosure**: update the public privacy policy if Turnstile is
  enabled (Turnstile sets a cookie under specific conditions).
- **Daily backup**: D1 has automatic snapshots, but for a high-value lead
  table I'd recommend a weekly `wrangler d1 export` to R2 as belt-and-braces.
