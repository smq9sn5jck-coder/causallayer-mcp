# CausalLayer MCP roadmap

This roadmap is non-binding and is updated whenever a new release ships. It exists so external integrators can plan around upcoming changes and so contributors can self-select work that is in scope.

## Released

### v0.2.0 — May 2026
- Cloudflare Workers deployment with custom domain `mcp.faultkey.com`.
- Four MCP tools: `submit_incident`, `get_certificate`, `verify_certificate`, `get_anchor_status`.
- Standalone demo mode (deterministic responses, watermarked, rate-limited).
- Ed25519 receipt signing, SHA-256 Merkle leaves, OpenTimestamps anchoring.
- Public verifier at `faultkey.pages.dev/verify`.
- Transparency ledger at `faultkey.pages.dev/transparency`.
- MCP Registry submission accepted as `io.github.smq9sn5jck-cloud/causallayer-mcp`.

## In progress

### v0.3.0 — June 2026 target
- Tenant isolation: per-issuer signing keys with KV-backed key registry.
- Persistent Merkle tree storage (D1) replacing in-memory daily tree.
- Receipt batching: bulk `submit_incident` for high-throughput deployers.
- OpenAPI 3.1 spec published as `openapi.yaml` and validated against the MCP server's tool surface.
- First-party Python client (`pip install causallayer-mcp-client`) with type stubs.
- Long-form compliance mappings: APRA CPS 230, EU AI Act Art. 12, NIST AI RMF, ISO/IEC 42001.

### v0.4.0 — Q3 2026 target
- Receipt format v2 (`CausalCertificateV2`) with explicit `superseded_by` field for amended receipts. Backwards-compatible verifier.
- Stripe metering on the public Worker (free tier capped, paid tier metered).
- AWS Lambda + GCP Cloud Run deployment templates.
- SDK in Go (`go get github.com/smq9sn5jck-coder/causallayer-go`).
- Reference integrations:
  - JIRA Service Management (incident → receipt webhook).
  - Splunk SOAR (anomaly → receipt action).
  - PagerDuty (incident → receipt enrichment).

## Future / under consideration

- Receipt verification on EVM (proof-of-existence on Ethereum / L2 in addition to Bitcoin).
- W3C Verifiable Credentials wrapper around CausalCertificateV1 for compatibility with VC-aware verifiers.
- ONNX-described scoring functions, so the deterministic scorer can be shipped as an audited binary blob alongside the receipt format spec.
- Federated multi-issuer trees: deployers issue under their own keys but share a common root.
- Formal threat-model document (`docs/THREATS.md`) covering signature, anchoring, transport, and tenant-isolation surfaces.

## Out of scope

- LLM-based scoring of the same incident features. The CausalLayer scorer is closed-form by design; an LLM variant would defeat the determinism guarantee.
- Personal-data ingestion at the receipt issuance boundary. The receipt format works against feature-vector hashes, not raw PII; the deployer retains underlying personal data inside its controlled environment.
- Custodial key management. Issuer signing keys are held by the deployer's organisation, never by FaultKey Protocol.

## How to influence the roadmap

Open a GitHub issue describing the use case, the standard you are aligning to, and the change you would like to see. Issues that reference a specific clause in CPS 230, the EU AI Act, NIST AI RMF, or ISO/IEC 42001 are prioritised because they map directly to a regulator-facing buyer.
