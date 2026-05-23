# Recompute Verifier

**Status:** Live (this PR)
**Endpoint:** `POST /api/v2/verify/recompute`
**MCP tool:** `verify_certificate_recompute`
**Cost:** 1 credit (same as `verify_certificate`)

## What this is

The strongest verification path FaultKey offers. Given a certificate
and the canonical input that produced it, the engine **re-runs itself**
and compares the recomputed certificate to the claimed certificate on
every meaningful field, byte-for-byte.

Returns **PASS** only if every checked field matches identically.

## Why it exists

The default `verify_certificate` endpoint checks the issuer's Ed25519
signature and the Merkle inclusion proof. Both depend on trusting the
issuer's signing key. That's the right default for high-volume use,
but it leaves one residual question: *did the engine actually compute
this certificate, or did the issuer fabricate the JSON and sign it?*

The recompute verifier removes that question. Anyone with access to
the engine and the canonical input can independently re-derive the
certificate and confirm byte-equality. **No trust in the issuer or
signing key is required.**

This is the cryptographic equivalent of "show your working." It also
catches a class of bug that a signature check cannot: any
non-determinism in the engine itself (e.g. a wall-clock value sneaking
into a hashed field) is caught the moment a recompute is attempted.

## Fields compared

The verifier compares these fields between claimed and recomputed:

- `certificateId`
- `_demo_request_hash`
- `verdict`
- `causalGraph`
- `fourFactorScoring`
- `deviationTaxonomy`
- `euRuleOverlay`
- `cascadeAttenuation`
- `damages`
- `underwriting`
- `anchor.merkleRoot` (extracted directly)

## Request shape

```json
POST /api/v2/verify/recompute
{
  "certificate": { ... the cert claimed by the issuer ... },
  "canonicalInput": { ... the original incident body ... }
}
```

`canonicalInput` is the same JSON that was originally submitted to
`submit_incident` or `submit_otel_trace`. It must be the *exact*
canonical body — any difference (severity, jurisdiction, event ordering,
agent ids) will produce a different request_hash and the verifier will
correctly report FAIL.

## Response shape (PASS)

```json
{
  "verification": {
    "verified": true,
    "method": "recompute",
    "claim": "Recomputing the engine on the supplied canonical input produces a byte-identical certificate.",
    "verdict": "PASS — recomputed certificate matches the claimed certificate on all checked fields."
  },
  "comparison": {
    "fieldsMatched": ["certificateId", "verdict", "causalGraph", "fourFactorScoring", ...],
    "fieldsDrifted": [],
    "certificateId":   { "claimed": "demo_...", "recomputed": "demo_...", "match": true },
    "request_hash":    { "claimed": "0768...", "recomputed": "0768...", "match": true },
    "merkleRoot":      { "claimed": "0xdemo_...", "recomputed": "0xdemo_...", "match": true }
  },
  "recomputed": { ... full recomputed certificate ... },
  "methodology": { "steps": [...], "defensibility": "...", "limits": [...] }
}
```

## Response shape (FAIL)

```json
{
  "verification": {
    "verified": false,
    "verdict": "FAIL — 1 field(s) drifted between claimed and recomputed; merkleRoot match: true."
  },
  "comparison": {
    "fieldsDrifted": [
      { "field": "verdict", "claimed": {...}, "recomputed": {...} }
    ],
    ...
  }
}
```

The drifted-field array is the audit hook: it shows exactly which
field disagreed, what the issuer claimed, and what the engine
recomputed. An auditor can use this to pinpoint tampering or surface
an engine-version mismatch.

## Composability with the existing verify path

The two verifier endpoints solve different problems and are designed
to be used together:

| Path                            | Trust model                                     | Cost (latency) | Catches                                    |
|---------------------------------|-------------------------------------------------|----------------|--------------------------------------------|
| `/api/v2/verify/certificate`    | Trust issuer's Ed25519 key + Merkle anchor      | ~1 ms          | Forged signatures, key revocation          |
| `/api/v2/verify/recompute`      | Trust the engine algorithm only                 | ~50 ms         | Engine non-determinism, fabricated outputs |

For high-stakes evidence (insurance claim, court filing, regulator
submission), running both is recommended. For high-volume use
(billing reconciliation, automated routing), the signature path alone
is appropriate.

## Determinism prerequisite

The recompute verifier only works if the engine is fully deterministic
for a given canonical input. This PR fixes a residual non-determinism
bug discovered during testing: synthetic timestamps on `causalGraph`
nodes were previously generated from `Date.now()` when an event had
no caller-supplied timestamp. They are now derived from the input hash
and a fixed epoch (2024-01-01), so the same canonical input produces
identical graph nodes on every re-run.

This was the same family of bug as the cert-id non-determinism fixed
in PR #43. The recompute verifier is what surfaced it. Both fixes are
small changes; together they bring the engine to true byte-identical
reproducibility on every checked field.

## Limits

- **Engine version drift.** If the engine is upgraded between the
  certificate's issuance and the recompute attempt, fields tied to
  engine version may legitimately drift. The certificate's
  `engineVersion` field documents which version was originally used.
  Auditors can pin a specific engine version in their environment to
  reproduce historical certificates.

- **Bitcoin OpenTimestamps proof not validated.** The recompute path
  does not verify the Bitcoin anchor — that requires the anchor-log
  Git repository and the OpenTimestamps Bitcoin block headers. Use
  `/api/v2/anchor/<version>` for the anchor-log proof.

- **Privacy.** Submitting a canonical input to the recompute endpoint
  reveals the full incident body to whoever runs the engine. For
  privacy-sensitive cases, run the recompute on a self-hosted engine
  instance rather than the public demo worker.

## Related work

- PR #41 — Weekly determinism harness. The recompute verifier is the
  manual on-demand version of that harness.
- PR #43 — `certificateId` determinism fix.
- PR #44 — W3C Trace Context evidence on causal-graph edges.
- PR #45 — `submit_otel_trace` OTLP ingest tool.
- PR (this) — `verify_certificate_recompute` + causalGraph timestamp
  determinism fix.
