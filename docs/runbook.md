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
