# CausalLayer MCP v0.2.0 — public launch

Today we are publishing the first public version of the **FaultKey / CausalLayer MCP** server: a deterministic AI-liability-attribution service exposed as a Model Context Protocol server, deployed on Cloudflare Workers, and free to use.

When an AI causes harm and three parties argue over who pays — **vendor, deployer, end-user** — FaultKey returns a signed, Bitcoin-anchored `CausalCertificateV1` in under 200 ms, using a closed-form scoring function that produces byte-identical output for any auditor on any machine in any year. No LLM in the scoring path. No probabilistic black box. No vendor cooperation required for verification.

## Highlights

- **Live demo Worker** at `https://causallayer-mcp-demo.zykm9qkk7j.workers.dev`, fully CORS-enabled and globally distributed across Cloudflare's edge network.
- Four MCP tools: `submit_incident`, `verify_certificate`, `get_anchor_status`, `query_issuer_registry`.
- Full **OpenAPI 3.1** spec at `/openapi.yaml` so AI agents and crawlers can ingest the surface.
- **`/.well-known/mcp.json`** discovery file so MCP-aware tooling can auto-register the server.
- **Ed25519** signatures, **SHA-256** Merkle proofs, **OpenTimestamps** Bitcoin anchoring.
- One-line install for **Claude Desktop**, **Cursor**, **Cline**, **Continue**, **Windsurf**.

## Why this matters now

The first wave of AI-liability litigation is already in motion — Air Canada's chatbot judgment, the OpenAI defamation suits, the FTC's Operation AI Comply, the EU AI Act coming into force, and APRA's CPS 230 third-party-risk regime in Australia. None of those frameworks have a mechanism that produces a *deterministic* fault number that two adversarial parties can agree on. CausalLayer is that mechanism.

## What's in 0.2.0

- Demo / free / Stripe / x402 billing modes
- KV-backed ledger for per-tenant credit accounting
- Standalone-demo deterministic mock so the server can be evaluated offline
- Public CORS for browser-based verification UIs
- Per-IP rate limiting and watermarking on the demo tier
- A landing page at `https://faultkey.com` that talks to the live endpoint

## Compliance mappings

The certificate fields and audit log slot directly into:
- **APRA CPS 230** (operational risk · third-party reliance, Australia)
- **EU AI Act** Articles 9, 12, 13, 14
- **ISO/IEC 42001** AI management systems
- **NIST AI Risk Management Framework** (Map · Measure · Manage · Govern)
- **Australia's Voluntary AI Safety Standard**

## Get involved

- Source: <https://github.com/smq9sn5jck-coder/causallayer-mcp>
- Issues / integration requests: use the templates in `.github/ISSUE_TEMPLATE/`
- Security disclosures: see `SECURITY.md`
- Citation: `CITATION.cff` is preconfigured for academic citation tools.

Built in Brisbane.
