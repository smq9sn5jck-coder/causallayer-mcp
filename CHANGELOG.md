# Changelog

All notable changes to **CausalLayer MCP** are documented in this file. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [0.4.1] — 2026-06-01

### Changed
- **Standalone/demo engine** (the artifact shipped on npm) now derives its
  scores from the submitted incident instead of SHA-256-seeded placeholders:
  deviation modes are detected from the incident text, four-factor scores come
  from the causal graph + agent types + severity, foreseeability from severity
  and recognised modes, and precedents are matched by real factor overlap.
- Damages now require a caller-supplied `financial_impact_cents` and **abstain**
  rather than fabricating a figure; actuarial/blast-radius abstain in lockstep.
- npm package name aligned to the published, unscoped `causallayer-mcp`.
- `serverInfo.version` and the upstream `User-Agent` synced to the package
  version (were `0.4.0` / `0.3.1`).

### Removed
- Unsubstantiated calibration claims from demo output (`calibrationR2`,
  `resolvedOutcomesUsed: 725`); `crossCaseCalibration` now reports
  `performed: false`.

### Fixed
- Single-party incidents now apportion the full 100% to the sole identified
  party (previously the split summed to the four-factor score).

### Added
- Server-side adoption analytics (Cloudflare Worker, not in the npm bundle):
  npm-downloads trend (daily cron), real-user retention (DAU/WAU/MAU), and a
  bot-filtered conversion funnel, surfaced in `/admin/stats`.
- Determinism/invariant fuzz tests for the standalone engine.

## [0.2.2] — 2026-05-17

### Added
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 adopted.
- `GOVERNANCE.md` — explicit decision-making model for receipt-format and scoring-function changes.
- `ROADMAP.md` — public roadmap through v0.4.0.
- `.github/SUPPORT.md` — discoverable support channels.
- `CHANGELOG.md` — this file.

### Changed
- README badge order tightened. CI, CodeQL, OpenSSF Scorecard, and License badges are first; ecosystem badges follow.

### Documentation
- Compliance mappings published at `https://faultkey.pages.dev/blog`:
  - `apra-cps-230` — APRA CPS 230 paragraph 36(b) mapping.
  - `eu-ai-act-art-12` — EU AI Act Article 12(1)(a)–(d) mapping.
  - `nist-ai-rmf` — NIST AI RMF MEASURE 2.7 mapping.
  - `iso-iec-42001` — ISO/IEC 42001 Clause 7.5 mapping.

## [0.2.1] — 2026-05-16

### Added
- Public transparency ledger at `https://faultkey.pages.dev/transparency`.
- Drag-and-drop receipt verifier at `https://faultkey.pages.dev/verify`.
- `llms.txt` and `llms-full.txt` for retrieval LLM consumption.
- OpenSearch description (`/opensearch.xml`) for browser-bar discovery.
- RSS feed (`/feed.xml`) for changelog readers.
- `humans.txt` and `.well-known/security.txt`.

### Fixed
- Demo-mode KV TTL violated Cloudflare's 60-second minimum on the `STANDALONE_DEMO=true` environment. Increased default TTL to 300 seconds.

## [0.2.0] — 2026-05-16

### Added
- Initial public release.
- MCP server deployed to Cloudflare Workers at `mcp.faultkey.com/mcp`.
- Four MCP tools: `submit_incident`, `get_certificate`, `verify_certificate`, `get_anchor_status`.
- Ed25519 receipt signing, SHA-256 Merkle leaves, OpenTimestamps anchoring.
- Standalone demo mode with deterministic responses.
- MCP Registry listing as `io.github.smq9sn5jck-cloud/causallayer-mcp`.
- Inclusion in `awesome-mcp-servers` PR #6465 (labels green: `valid-name`, `has-emoji`, `has-glama`).

### Security
- TLS 1.3 terminated at Cloudflare's edge.
- All public endpoints carry strict CSP, HSTS preload-eligible header, and origin-locked CORS.

[0.2.2]: https://github.com/smq9sn5jck-coder/causallayer-mcp/releases/tag/v0.2.2
[0.2.1]: https://github.com/smq9sn5jck-coder/causallayer-mcp/releases/tag/v0.2.1
[0.2.0]: https://github.com/smq9sn5jck-coder/causallayer-mcp/releases/tag/v0.2.0
