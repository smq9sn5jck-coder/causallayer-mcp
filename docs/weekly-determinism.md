# FK-METHOD-2026-005 — Weekly Determinism Proof

**Status:** v1.0.0 — shipped 2026-05-23
**Schedule:** Every Monday 12:00 UTC (Cloudflare Workers cron)
**Endpoints:**
 - `GET /api/v2/proofs/weekly` — public read of the rolling manifest log
 - `POST /api/v2/proofs/run-now` — `x-admin-token`-gated, on-demand run
**Module:** `src/weekly-determinism.ts`
**Suite version:** `v1.0.0` (`CANONICAL_SUITE_VERSION`)

---

## 1. The claim this rule answers

The marketing surface for FaultKey says the engine is *deterministic* — same input, same output, same certificate id, same Merkle root, every time. That claim is structural: the engine has no randomness, no wall-clock, no environment access. But "structural" is a property of the source code; auditors want a property of the *running system*. They want continuous, third-party-reproducible evidence that the deployed worker still behaves identically week over week.

`FK-METHOD-2026-005` turns the claim into a recurring, public, falsifiable artifact.

## 2. What the rule does

Every Monday 12:00 UTC the worker's `scheduled()` handler:

1. Iterates the canonical demo suite — the same five scenarios shown on `/try` (loan, medical, content, coding, hiring), with `timestamp_utc` *frozen* to `2026-01-01T00:00:00Z` so wall-clock time can never enter the input.
2. For each scenario, calls the engine's `submit_incident` path **twice** in succession.
3. Compares `(request_hash, certificate_id, merkle_root)` between the two runs. Determinism PASS only if all three match bit-for-bit.
4. Builds a manifest:

   ```json
   {
     "ruleId": "FK-METHOD-2026-005",
     "ruleName": "Weekly Determinism Proof",
     "iso_week": "2026-W21",
     "ts_utc": "2026-05-25T12:00:00.123Z",
     "suite_version": "v1.0.0",
     "scenario_count": 5,
     "pass_count": 5,
     "fail_count": 0,
     "all_pass": true,
     "per_scenario": [ /* full hashes per scenario */ ],
     "manifest_sha256": "<sha256 of canonical manifest body>",
     "signature_status": "unsigned_demo" | "signed",
     "signature": "<base64 ed25519 signature, empty if unsigned>",
     "engine": { "standalone": true, "env": "demo" }
   }
   ```

5. Stores the manifest under `weekly:<iso_week>` in the `WEEKLY_PROOFS` KV namespace.
6. Updates the rolling index `weekly:index` (last 52 entries, newest-first).

The manifest is then publicly readable at `GET /api/v2/proofs/weekly`. Anyone can pull the log, recompute every `manifest_sha256` themselves, and confirm the engine produced bit-identical output for the suite.

## 3. Honesty markers

This rule is the most important place not to overstate.

**Hashing vs signing.** When `ANCHOR_PRIVATE_KEY` is bound (production only), the worker imports the seed and signs `manifest_sha256` with WebCrypto Ed25519. `signature_status: "signed"` and `signature` is a base64 detached signature. When the seed is not bound (the public demo at `mcp.faultkey.com`, today), the manifest is hashed but **not signed**, and `signature_status: "unsigned_demo"` is set explicitly so no consumer can mistake it for a non-repudiable proof. The unsigned version is still useful — third parties can independently re-run the canonical suite against the same engine and confirm they get the same `manifest_sha256` — but the cryptographic guarantee is integrity-only, not identity.

**The engine being tested is the deployed engine.** `scoreOneScenario()` calls `callApi(env, "POST", "/api/v1/incidents/analyze", ...)` — the same code path that every public `/mcp` tool call hits. There is no separate test harness. If the deployed engine breaks determinism, the cron sees it. If the cron doesn't catch it, no one will.

**Frozen timestamps.** `CANONICAL_SCENARIOS[*].input.incident.timestamp_utc` is hard-coded to `"2026-01-01T00:00:00Z"`. This is essential. If the suite passed `new Date()`, the manifest would be deterministic *within a week* but not *across weeks*, which would defeat the point. Anyone editing a scenario's `timestamp_utc` must also bump `CANONICAL_SUITE_VERSION` (and add a docs changelog entry) so consumers can detect the suite shift.

**The "scoring" path uses the standalone demo today.** The public worker is in `STANDALONE_DEMO=true` mode, which means `submit_incident` produces a watermarked deterministic response without calling the upstream engine. The cron tests *that* engine — the standalone demo. When the upstream engine is wired in (`STANDALONE_DEMO=false` and `CAUSALLAYER_API_KEY` configured), the cron transparently switches to testing the production engine. The manifest's `engine.standalone` field self-discloses which is being measured.

**v1 does not detect determinism *drift across weeks*.** A scenario that passes determinism within week N (run twice, same hash) and within week N+1 (run twice, same hash) but produces *different* hashes between weeks N and N+1 would not be flagged by `all_pass`. v1.1 will add a `cross_week_drift` field that compares `merkle_root` to the previous week's stored value and emits a warning when they differ without a corresponding `suite_version` bump.

## 4. KV layout

| Key | Value |
|---|---|
| `weekly:<iso_week>` | Full manifest JSON for that week. |
| `weekly:index` | JSON array of ISO-week strings, newest first, capped at 52. |

The 52-week cap is a hard cap (`if (index.length > 52) index = index.slice(0, 52)` in `persistManifest`). Older manifests remain in KV but disappear from `/api/v2/proofs/weekly`'s default response. They can still be fetched via `?week=YYYY-Www` if the caller knows the week.

## 5. Why a separate KV namespace

The credit ledger (`LEDGER`) is hot, write-heavy, and tenant-scoped. The weekly proof log is cold, read-heavy, and globally public. Mixing them would (a) bloat the ledger's read pattern, (b) risk an accidental leak of weekly proofs into per-tenant queries, and (c) couple their retention policies. They live in separate KVs.

## 6. Triggering a run from outside Cloudflare

`POST /api/v2/proofs/run-now` is gated by `x-admin-token: <ADMIN_TOKEN>`. A GitHub Actions workflow can trigger weekly proof generation from outside Cloudflare's cron scheduler — useful when (a) the cron isn't yet configured in production, (b) we need to force a re-run after a fix, or (c) a third party (e.g. an auditor) wants to time-shift the proof.

The endpoint returns 404 (not 401) when the token is missing or wrong, matching the existing `/admin/*` hardening in `index.ts` to deny scanners any signal.

A reference workflow, to be added at `.github/workflows/weekly-proof.yml`, would post to `https://mcp.faultkey.com/api/v2/proofs/run-now` Mondays at 12:05 UTC — five minutes after the Cloudflare cron — as a redundancy check.

## 7. Public reproduction recipe

A third party can independently reproduce any week's manifest:

1. Fetch the canonical suite definition from `src/weekly-determinism.ts` in the public repo at the tag corresponding to `suite_version`.
2. For each scenario, POST the canonical `input` to `https://mcp.faultkey.com/api/v1/incidents/analyze`.
3. Capture `(request_hash, certificate_id, merkle_root)` from each response.
4. Build the same manifest body as `runWeeklyDeterminism`, canonicalize keys with the same sort, and SHA-256 the result.
5. Compare to the published `manifest_sha256` for the same week.

If they match, determinism holds. If they don't, the engine has drifted, the suite changed, or someone edited the canonical scenarios mid-week — and the published `suite_version` will tell them which.

## 8. Smoke tests

`/tmp/test_weekly.mjs` — 23/23 pass. Coverage:
 - all-pass manifest under deterministic stub
 - all-fail manifest under flaky stub (alternating merkle_root)
 - signing path populates `signature_status: "signed"` and base64 signature
 - scoring errors are caught per scenario, not silently swallowed
 - ISO-week string is well-formed (`YYYY-Www`)
 - `canonicalize()` produces stable byte order across object key insertion orders
 - `sha256Hex("hello")` matches the known canonical value

## 9. Versioning

`CANONICAL_SUITE_VERSION` bumps when:
 - a scenario is added or removed
 - a scenario's input is edited (description, agents, events, timestamp_utc)
 - a hashing algorithm changes
 - a manifest field is added, removed, or renamed

Per-rule `ruleId: "FK-METHOD-2026-005"` does not change between minor versions; the rule name stays stable for citation.

## 10. Deploy checklist

1. `wrangler kv:namespace create WEEKLY_PROOFS` — copy the returned id into `wrangler.jsonc` (replacing both `REPLACE_WITH_WEEKLY_PROOFS_KV_ID` placeholders).
2. (production only) `wrangler secret put ANCHOR_PRIVATE_KEY` with a base64-encoded raw 32-byte Ed25519 seed.
3. (production only) `wrangler secret put ADMIN_TOKEN` with a long random string for `/api/v2/proofs/run-now` access.
4. `wrangler deploy` — the `triggers.crons` block is read on deploy.
5. `curl -X POST https://mcp.faultkey.com/api/v2/proofs/run-now -H "x-admin-token: $TOKEN"` to seed the first manifest immediately.
6. `curl https://mcp.faultkey.com/api/v2/proofs/weekly` — should return the seeded manifest.

## 11. Authority anchors

This is an operational rule, not a legal one, so the authority anchors are different in flavour:
 - **NIST RMF (AI 100-1) MEASURE 2.7** — "AI system [is] continuously monitored for [its] performance"
 - **ISO/IEC 42001:2023 §9.1** — "monitoring, measurement, analysis and evaluation"
 - **ISO/IEC 23894:2023 §6.5.3** — "monitoring of the AI risk treatments"
 - **AI Act Reg. 2024/1689 Art. 12 ("Logging") and Art. 17 ("Quality management system, monitoring")** — the providers' obligation to maintain post-market monitoring records

A weekly determinism proof, archived publicly, contributes evidence toward all four of these obligations and is the kind of artifact a downstream auditor (or a defendant in a counterfactual deposition) can subpoena and inspect.

## 12. Authority changelog

- **2026-05-23 — v1.0.0** ships. 5-scenario suite (loan, medical, content, coding, hiring) drawn verbatim from the `/try` page. Mondays 12:00 UTC. Unsigned demo by default; signed when `ANCHOR_PRIVATE_KEY` bound.
- **(planned) v1.1.0** — add `cross_week_drift` field that compares `manifest_sha256` to the previous week's same-`suite_version` value.
- **(planned) v1.2.0** — promote suite to 10 scenarios to match the landing-page claim. Until then, the landing copy will be corrected to "five canonical scenarios" to match the truth.
