# CausalLayer Deploy & Launch Runbook

This is the single source of truth for getting the CausalLayer stack from "code in a sandbox" to "live, public demo, with at least one working end-to-end call from Claude Desktop." It is written in the order you should execute it. **Do not skip steps.**

## Prerequisites (one-time, on your local machine)

- Node 20+ and `pnpm` (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker Desktop running (for the Fly build)
- `flyctl`: `curl -L https://fly.io/install.sh | sh`
- A Fly.io account with a payment method on file (free tier still requires it)
- A Cloudflare account
- `wrangler`: `pnpm dlx wrangler --version` (any 4.x)
- The Claude Desktop app installed locally for the smoke test

## Step 1 — Deploy the upstream API to Fly.io Sydney

```bash
cd /path/to/causallayer

# Authenticate (opens a browser)
fly auth login

# First time only: create app + persistent volume
./scripts/deploy_fly.sh --first-time

# Every deploy thereafter
./scripts/deploy_fly.sh
```

Expected output ends with:

```
1. Issuer registry (no-auth):
{"issuers":[{"keyId":"clk-issuer-2026-q2", ...
2. Anchor status (no-auth):
{"anchors":[ ... ]}

Live at: https://causallayer-api.fly.dev
```

**If this step fails, stop here.** Do not proceed to step 2 until the Fly URL returns 200 on `/api/v2/issuers`.

## Step 2 — Provision the Cloudflare Worker demo KV namespace

```bash
cd /path/to/causallayer-mcp

# Authenticate (browser pop-up)
pnpm dlx wrangler login

# Create the KV namespace for the demo env
pnpm dlx wrangler kv namespace create LEDGER --env demo
# → copy the returned id

# Edit wrangler.jsonc and replace REPLACE_WITH_DEMO_LEDGER_KV_ID with the
# id you just got.
```

## Step 3 — Deploy the Worker (demo env)

```bash
cd /path/to/causallayer-mcp
pnpm install
pnpm dlx wrangler deploy --env demo
```

Expected URL: `https://causallayer-mcp-demo.<your-subdomain>.workers.dev`

## Step 4 — Run the end-to-end smoke test

```bash
API=https://causallayer-api.fly.dev \
MCP=https://causallayer-mcp-demo.<your-subdomain>.workers.dev \
  ./scripts/smoke_e2e.sh
```

You should see five green `OK`s. If any step fails, the error message tells you which layer is broken.

## Step 5 — Verify from Claude Desktop (the real test)

Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "causallayer": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://causallayer-mcp-demo.<your-subdomain>.workers.dev/mcp"
      ]
    }
  }
}
```

Restart Claude Desktop. In a new conversation, ask:

> Use the CausalLayer tools to submit an incident where Agent A produced a bad recommendation and Agent B acted on it. Show me the certificate.

Expected: Claude calls `submit_incident`, the Worker enforces guardrails, the Fly API returns a watermarked demo certificate, and Claude shows it back to you.

## Step 6 — Read the demand signal

```bash
curl -fsS https://causallayer-mcp-demo.<your-subdomain>.workers.dev/stats | jq
```

You should see your own call counted. Bookmark this URL — it is the only thing that will tell you whether the public launch is working.

---

## Brutally honest pre-launch checklist

Do not flip the public switch (npm publish, MCP marketplace submissions, AFR pitch) until **every** box below is checked:

| # | Check | Pass criterion |
|---|---|---|
| 1 | Fly upstream is up | `curl https://causallayer-api.fly.dev/api/v2/issuers` returns 200 |
| 2 | Worker demo is up | `curl https://...workers.dev/healthz` returns `ok` |
| 3 | E2E smoke test green | `./scripts/smoke_e2e.sh` prints "all 5 steps passed" |
| 4 | Claude Desktop integration works | `submit_incident` round-trips end-to-end |
| 5 | `/stats` shows live counts | Your own test call appears in the JSON |
| 6 | No PII in any log | `fly logs` shows no email/phone/etc. — guardrails are doing their job |
| 7 | Stripe Tax is set up for AU | Required if any paid checkout link will be sent |
| 8 | Custom domain (optional) | `mcp.causallayer.io` and `api.causallayer.io` cleanly resolve to the right targets |

Only when all 8 are green: publish the npm CLI, submit to LobeHub/Smithery/awesome-mcp-servers, and send the LinkedIn / HN / AFR copy.

## What "done" looks like

Two days after public launch, you should have:
- At least 50 unique IPs in `/stats`
- At least one inbound from a `.com.au` domain or LinkedIn DM
- Zero 5xx errors in `fly logs` and `wrangler tail --env demo`

If after seven days you have fewer than 10 unique IPs and zero inbounds, the wedge is wrong. Kill it and pivot. **Do not pour money into a deployment with no demand signal.**


---

## Cloudflare estate — what's deployed and what each piece is for

> Source of truth as of 2026-05-24. Update on any infra change.

### Workers

| Script | Routes / Domains | Purpose | Notes |
|---|---|---|---|
| `causallayer-mcp` | none | **Reserved prod name** — placeholder so the global name `causallayer-mcp` stays under our account. Holds its own (empty) `CausalLayerMCP` Durable Object class. | **DO NOT DELETE.** Deleting a worker frees the name to other CF accounts and destroys all DO storage. Cost to keep: $0 (Workers bill on invocations). |
| `causallayer-mcp-demo` | `mcp.faultkey.com/*` (custom domain) | **Live production demo.** Hosts the MCP server, `/v1/leads`, `/v1/install-ping`, `/cert/{id}`, `/admin/dashboard`. Bindings: D1 `faultkey-prod`, R2 `faultkey`, KV `WEEKLY_PROOFS`/`demo-LEDGER`, Analytics Engine `faultkey_events`. | Independent DO storage from `causallayer-mcp`. Deploy via `wrangler versions upload --env demo` from this repo. |
| `faultkey-try-demo` | `try.faultkey.com/*` (tightened from `*.faultkey.com/*` on 2026-05-24) | "Try it now" no-install web demo. | Route was previously the greedy `*.faultkey.com/*` wildcard — tightened to a single subdomain so future subdomains (status, docs, app) aren't accidentally swallowed. |

### Pages

| Project | Domains | Purpose |
|---|---|---|
| `faultkey` | `faultkey.com`, `www.faultkey.com`, `faultkey.pages.dev` | Static landing page (`faultkey-landing` project in Manus webdev). |

### Databases / storage

| Resource | Name | Purpose |
|---|---|---|
| D1 | `faultkey-prod` (uuid `62e24554-f4b6-4614-b1ba-e4f185f4deac`, APAC/SIN) | Leads, install pings, certificates index, weekly proofs index, install_pings_daily rollup |
| R2 | `faultkey` | Future cert object storage |
| KV | `LEDGER`, `demo-LEDGER`, `WEEKLY_PROOFS` | Anchor ledger and weekly Merkle proofs |
| Analytics Engine | `faultkey_events` | Per-event log of lead_capture / install_ping / cert_generated (free tier, 90-day retention) |

### Edge security (zone faultkey.com)

| Layer | Rule | Effect |
|---|---|---|
| Custom firewall (`http_request_firewall_custom`) | `Allow MCP clients` (existing) + `FaultKey: allow API endpoints (skip managed challenge)` | Bypasses Bot Fight Mode and security_level=high for `mcp.faultkey.com/v1/*`, `/cert/*`, `/healthz`, `/mcp`, `/.well-known/*`. Without this, browser `fetch()` from third-party origins gets a JS challenge interstitial. |
| Rate-limit (`http_ratelimit`) | `FaultKey: rate-limit API endpoints` | **20 req / 60s / IP** on `mcp.faultkey.com/v1/*`. Offenders banned 10 minutes. |
| Zone security level | `high` | Blunt instrument; the skip rule above carves out the API. |

### Worker secrets (set via `wrangler secret put --env demo`)

| Name | Purpose |
|---|---|
| `IP_HASH_SALT` | Daily-rotatable salt for hashing client IPs (we never store raw IPs). |

---

## Runbook entries (Cloudflare)

### How to delete a worker safely
**Never delete a worker that has a Durable Object class with `new_sqlite_classes` migration unless you have explicitly migrated the class to another worker first.** Deletion is irreversible and destroys all DO storage and the global name reservation.

### How to roll back the API
```bash
# List recent versions of the demo worker:
wrangler versions list --name causallayer-mcp-demo --env demo

# Roll back to a specific version (this routes 100% of traffic immediately):
wrangler rollback <version-id> --name causallayer-mcp-demo --env demo
```

### How to restore D1 (Time Travel)
D1 retains 30 days of point-in-time history on the free tier. To restore:
```bash
# Get a bookmark for the moment to restore to:
wrangler d1 time-travel info faultkey-prod --timestamp '2026-05-24T05:00:00Z'

# Restore in place (DESTRUCTIVE - prefer to clone first):
wrangler d1 time-travel restore faultkey-prod --bookmark <bookmark-from-above>
```
Test the bookmark on a clone first: `wrangler d1 create faultkey-prod-restored && wrangler d1 execute faultkey-prod-restored --command 'ATTACH DATABASE ...'`. Always.
