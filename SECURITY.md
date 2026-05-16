# Security policy — CausalLayer MCP / FaultKey

## Reporting a vulnerability

We take security seriously because this software exists to settle liability disputes. A trivially-forgeable certificate would defeat the entire premise of the protocol.

If you discover a vulnerability — particularly anything affecting:

* **Signature verification** (Ed25519 batch checks, malleability, ASN.1 parsing).
* **Merkle-proof construction or validation**.
* **OpenTimestamps anchor verification**.
* **Tenant isolation** (a request authenticated as tenant A reading tenant B's ledger).
* **Determinism** (any path that produces a different certificate for the same inputs).
* **MCP transport** (session-id forging, prompt-injection inside `params`, CORS bypass).

…please report it privately, **not** as a public GitHub issue.

| Channel | Address |
| --- | --- |
| Email | `security@faultkey.com` |
| GitHub Security Advisory | <https://github.com/smq9sn5jck-coder/causallayer-mcp/security/advisories/new> |

We respond within **48 hours** and aim to patch within **7 days** for high-severity findings.

## Scope

In scope: this repository (`causallayer-mcp`) and the public demo Worker at `causallayer-mcp-demo.zykm9qkk7j.workers.dev`. Out of scope: third-party MCP clients (Claude Desktop, Cursor) — please report those upstream.

## Safe-harbour

Good-faith research conducted under this policy will not be subject to legal action. We will publicly credit reporters in release notes unless anonymity is requested.

## Cryptographic primitives

* Signing: **Ed25519** (RFC 8032).
* Hashing: **SHA-256** for Merkle leaves and intermediate nodes.
* Anchoring: **OpenTimestamps** (Bitcoin block-level timestamping, RFC-style proof).
* Transport security: **TLS 1.3** terminated at Cloudflare's edge.

A formal threat model lives in `docs/THREATS.md` (in preparation).
