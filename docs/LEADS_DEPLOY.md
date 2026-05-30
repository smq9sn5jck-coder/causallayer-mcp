# /v1/leads deploy runbook (KV-backed)

Operator runbook for the first-party lead-capture endpoint. The endpoint is
shipped in `src/leads.ts` and wired into `src/index.ts` at `/v1/leads`.
Storage is **Cloudflare KV** — specifically the existing `LEDGER` namespace,
re-bound under the name `LEADS_KV`.

The endpoint is **safe to deploy before bindings are configured.** Until the
operator completes the wiring below, `POST /v1/leads` returns
`503 leads_kv_unbound` and the client (faultkey.com) falls back to Formspree
automatically. No outage, no data loss.

## Why KV (not D1)

- The Worker already binds the `LEDGER` KV namespace; zero new infrastructure.
- Lead volume is low (tens to hundreds per day at most). KV is the right
  primitive for low-volume key-addressed data.
- Lookups are O(1) by primary key (`lead:<lead_id>`) and by email hash
  (reverse index, `lead-by-email:<sha256>`).
- Future-proof: when D1 token scopes become available, a one-time
  export-and-replay job moves rows to D1 without changing the public API.

## Step 1 — Bind `LEADS_KV` (and optionally `LEADS_RL`) in `wrangler.jsonc`

Reuse the existing `LEDGER` namespace ID. The leads code uses the `lead:`,
`lead-by-email:`, and `rl:` key prefixes which don't collide with anything
the existing ledger code writes.

```jsonc
"kv_namespaces": [
  { "binding": "LEDGER",   "id": "<existing-LEDGER-id>" },
  { "binding": "LEADS_KV", "id": "<existing-LEDGER-id>" },
  { "binding": "LEADS_RL", "id": "<existing-LEDGER-id>" }
]
```

## Step 2 — Generate and store the admin token (gates `GET /v1/leads`)

```bash
openssl rand -hex 32 | wrangler secret put LEADS_ADMIN_TOKEN
```

## Step 3 — (Optional) Cloudflare Turnstile bot protection

```bash
wrangler secret put TURNSTILE_SECRET     # paste secret from Turnstile dashboard
wrangler secret put TURNSTILE_REQUIRED   # value: "true" to enforce, omit otherwise
```

## Step 4 — Deploy

```bash
wrangler deploy
```

## Step 5 — Smoke test

```bash
# Public submission (success → 201)
curl -i -X POST https://mcp.faultkey.com/v1/leads \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://faultkey.com' \
  --data '{"email":"deploy-smoke@faultkey.com","source":"deploy_smoke"}'

# Admin list (success → 200 with the lead you just created)
curl -i 'https://mcp.faultkey.com/v1/leads?limit=10' \
  -H "X-Admin-Token: $LEADS_ADMIN_TOKEN"
```

## Public API contract

```
POST /v1/leads
Content-Type: application/json
Body:
  {
    "email":           "user@example.com",   // required
    "company":         "Acme Corp",          // optional
    "role":            "Head of AI Risk",    // optional
    "sector":          "financial_services", // optional
    "use_case":        "free text",          // optional, max 600 chars
    "source":          "sticky_cta",         // optional
    "ref":             "/try",               // optional
    "turnstile_token": "...",                // optional
    "extras":          { ... }               // optional, max 1KB
  }

Responses:
  201 { "ok": true,  "lead_id": "lead_..." }                        // first time
  200 { "ok": true,  "lead_id": "lead_...", "deduped": true }       // repeat email
  400 { "ok": false, "error": "email_invalid" }                      // validation
  413 { "ok": false, "error": "payload_too_large" }                  // > 4 KB body
  429 { "ok": false, "error": "rate_limited", "retry_after": 3600 }  // 5/IP/hour
  503 { "ok": false, "error": "leads_kv_unbound" }                   // not bound yet
```

```
GET /v1/leads?limit=50&cursor=<opaque>
Headers:
  X-Admin-Token: <LEADS_ADMIN_TOKEN>

Response:
  200 { "ok": true, "count": N, "cursor": "...|null", "leads": [...] }
```

## Cutover plan for the client

Once smoke test passes, the `EmailCapture` component on faultkey.com can be
updated to call `https://mcp.faultkey.com/v1/leads` **first**, then fall
back to Formspree on any non-2xx. The change is one function in
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
  return submitToFormspree(payload); // unchanged
}
```

That client change is a separate PR on the `faultkey-landing` repo.

## Operational notes

- **No PII at rest beyond the email itself.** IPs are SHA-256 hashed with a
  daily-rotating pepper; raw IP is never persisted.
- **Dedup**: identical email submissions return the original `lead_id` with
  `deduped: true` (200, not 201). The client treats both as success.
- **Rate limit**: 5 submissions per IP-hash per hour. If KV is unavailable,
  the limit is silently skipped (the right tradeoff for a public form).
- **Rollback**: `wrangler rollback` reverts the worker. Existing KV data is
  preserved; the route returns 404 on the previous version.
- **Privacy disclosure**: update the public privacy policy if Turnstile is
  enabled (Turnstile sets a cookie under specific conditions).
- **Migration to D1 later**: a one-time job iterates `list({prefix:"lead:"})`,
  reads each value, and INSERTs into D1. The public API contract does not
  change.
