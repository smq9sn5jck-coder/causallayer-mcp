# FaultKey / CausalLayer MCP Server - Directory Submission Copy

## Short Description (under 100 chars)
Deterministic AI liability attribution. Proves who pays when AI fails.

## Medium Description (under 250 chars)
FaultKey (CausalLayer) is a deterministic AI liability attribution engine. It provides a signed, Bitcoin-anchored certificate proving who pays when an AI incident occurs. No LLMs, no probabilistic scoring.

## Long Description
FaultKey (powered by the CausalLayer engine) provides deterministic fault math for multi-party AI incidents. When an AI causes harm and three parties (vendor, deployer, user) argue over who pays, FaultKey returns a signed, Bitcoin-anchored certificate of fault allocation in under 200 ms. 

Unlike LLM-based scoring which insurers and regulators reject due to non-determinism, FaultKey uses a closed-form causal scoring algorithm (graph-theoretic, version-pinned, byte-identical reproducible across runs). The signed certificate, issuer registry, and Merkle anchor log are all independently verifiable by a third party using only Node's built-in crypto — no network calls back to the vendor.

This MCP server exposes 4 tools:
1. `submit_incident`: Submit an AI incident for deterministic liability attribution.
2. `verify_certificate`: Independently verify a certificate signature and Merkle integrity.
3. `get_anchor_status`: Read the Bitcoin-anchored OpenTimestamps proof index.
4. `query_issuer_registry`: List trusted CausalLayer issuer public keys.

## Metadata
- **Name:** FaultKey (CausalLayer)
- **GitHub Repo:** https://github.com/smq9sn5jck-coder/causallayer-mcp
- **Homepage:** https://faultkey.com
- **Transport:** HTTP (Streamable)
- **Tags/Categories:** AI Governance, Liability, RegTech, Security, Audit, Compliance, Cloudflare Workers
- **Install Command:** `npx -y causallayer-mcp`
- **Demo URL:** `https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp`
