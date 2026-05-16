# FaultKey · CausalLayer MCP Server

[![npm version](https://img.shields.io/npm/v/causallayer-mcp.svg)](https://www.npmjs.com/package/causallayer-mcp)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Ready-green)](https://modelcontextprotocol.io/)
[![Live Demo](https://img.shields.io/badge/demo-live-success)](https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz)
[![GitHub Stars](https://img.shields.io/github/stars/smq9sn5jck-coder/causallayer-mcp?style=flat&logo=github)](https://github.com/smq9sn5jck-coder/causallayer-mcp/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-85ea2d?logo=openapiinitiative&logoColor=white)](./openapi.yaml)
[![security: ed25519](https://img.shields.io/badge/signing-Ed25519-181717)](./SECURITY.md)
[![anchored: Bitcoin](https://img.shields.io/badge/anchor-Bitcoin%20%2B%20OpenTimestamps-f7931a?logo=bitcoin&logoColor=white)](https://opentimestamps.org)

> **Deterministic fault math for multi-party AI incidents.** When an AI causes harm and three parties argue over who pays, FaultKey returns a signed, Bitcoin-anchored certificate of fault allocation in under 200 ms — no LLM, no probabilistic scoring, no vendor cooperation needed for a third party to verify.

This is the official [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the [CausalLayer](https://github.com/smq9sn5jck-coder/causallayer) engine, packaged as a Cloudflare Worker. It lets AI agents (Claude Desktop, Cursor, Cline, Continue, Windsurf) call the four core liability-attribution tools without writing a single line of integration code.

## Live demo

The public Worker is deployed on Cloudflare's global edge network and is fully functional in standalone demo mode (deterministic responses, watermarked, rate-limited 5 calls / IP / day):

- **Endpoint:** `https://causallayer-mcp-demo.zykm9qkk7j.workers.dev`
- **Healthcheck:** [`/healthz`](https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz)
- **Demand telemetry:** [`/stats`](https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/stats) (public, aggregated, no PII)

Custom domain `mcp.faultkey.com` is provisioned and resolves once Cloudflare DNS propagates.

## Quick start

### Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "faultkey": {
      "command": "npx",
      "args": ["-y", "causallayer-mcp"]
    }
  }
}
```

Restart Claude. Type *"List the FaultKey tools."*

### Cursor

Settings → MCP Servers → Add new:

- **Name:** `faultkey`
- **Command:** `npx -y causallayer-mcp`

### Cline / Continue / Windsurf

```json
{
  "name": "faultkey",
  "command": "npx",
  "args": ["-y", "causallayer-mcp"]
}
```

### Direct HTTP (no CLI)

```bash
curl -X POST https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}'
```

The response includes a `Mcp-Session-Id` header that you reuse for subsequent calls.

## Tools

| Tool | Description | Demo limit | Paid cost |
|---|---|---|---|
| `submit_incident` | Submit an AI incident for deterministic liability attribution. Returns a signed `CausalCertificateV1` with per-agent fault allocation, evidence-chain completeness, and Bitcoin-anchored proof. | 5 / IP / day | 50 credits |
| `verify_certificate` | Independently verify a certificate (signature, Merkle integrity, issuer status) without calling FaultKey. | 50 / IP / day | 1 credit |
| `get_anchor_status` | Return the index of all Tessera anchor batches or one batch's full JSON (signed Merkle root, OpenTimestamps proof reference). | Unlimited | Free |
| `query_issuer_registry` | List all trusted CausalLayer issuer public-key fingerprints, status, and validity windows. | Unlimited | Free |

## Why deterministic?

Insurers, banks, and APRA-regulated entities cannot accept LLM-based fault attribution because the same prompt produces different answers on different days. FaultKey uses a closed-form causal scoring algorithm (graph-theoretic, version-pinned, byte-identical reproducible across runs) so two adversarial parties get the same number — that's the whole point.

The math is published as an Australian Standards-aligned paper. The signed certificate, issuer registry, and Merkle anchor log are all independently verifiable by a third party using only Node's built-in crypto and the [`causallayer-verifier`](https://github.com/smq9sn5jck-coder/causallayer-verifier) tool — no network calls back to the vendor.

## Guardrails (enforced at the Cloudflare edge)

1. **NO-PII** — Payloads are regex-scanned for emails, Tax File Numbers, Medicare numbers, SSNs, and credit cards. Rejected unless the caller sets `pii_acknowledged: true` (which is logged in the certificate as a compliance acknowledgement).
2. **DETERMINISTIC-ONLY** — The engine rejects any request lacking `deterministic_only: true`. This is the agent's binding acknowledgement that FaultKey output is closed-form, not probabilistic.
3. **EVIDENCE-REQ** — At least one identified agent and one timestamped event with description must be supplied or the request is rejected with `400 evidence_insufficient`.

## Self-hosting

You can deploy your own copy to your own Cloudflare account if you want to enforce a corporate firewall, custom rate limits, or bring your own KV namespace:

```bash
git clone https://github.com/smq9sn5jck-coder/causallayer-mcp.git
cd causallayer-mcp
pnpm install
pnpm wrangler kv namespace create LEDGER
# paste the returned id into wrangler.jsonc
pnpm wrangler deploy
```

The CausalLayer engine itself (the closed-form fault math) runs upstream and is available via API key. For self-hosted demos without an upstream, set `STANDALONE_DEMO=true` in `wrangler.jsonc` to short-circuit upstream calls and return deterministic, watermarked responses.

## Architecture

```
[Claude/Cursor/Cline]  ←→  [npx causallayer-mcp]  ←→  [Cloudflare Worker]  ←→  [CausalLayer engine]
                              (mcp-remote proxy)         (this repo)            (Fly.io Sydney)
                                                              ↓
                                                    [KV: credit ledger]
                                                    [DO: per-session state]
                                                    [KV: telemetry buffer]
```

- **Transport:** Streamable HTTP (per the 2024-11-05 MCP spec — SSE is deprecated)
- **Session state:** Cloudflare Durable Object (`CausalLayerMCP`), SQLite-backed
- **Billing:** Cloudflare KV ledger, Stripe Checkout webhook, optional x402 USDC fallback
- **Demo:** Per-IP daily counter in KV, deterministic fixture responses with `[DEMO]` watermark
- **Latency:** p50 ≈ 60 ms (cold), 25 ms (warm) on Cloudflare's 300+ POPs

## Pricing

| Tier | Credits | $AUD | Notes |
|---|---|---|---|
| Demo | 5 incidents / IP / day | Free | Watermarked responses |
| Starter | 1,000 | $99 | Stripe Checkout, no SLA |
| Growth | 10,000 | $749 | + 50 verify, 99.5% SLA |
| Enterprise | Unmetered | Contact | + dedicated namespace, 99.95% SLA, audit log access |

For enterprise tenants email **sales@faultkey.com** (or open a GitHub issue with subject "enterprise inquiry").

## License

Apache 2.0. See [LICENSE](./LICENSE).

## Built in Brisbane

FaultKey is built in Brisbane, Australia, with data residency in Sydney for APRA-regulated buyers. The team can be reached at hello@faultkey.com.
