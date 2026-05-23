# FK-METHOD-2026-003 — Counterfactual Remediation Simulator v1

> Citable design document. Version: v1.0.0. Status: shipped.
> Source of truth: `src/remediation.ts`, `docs/simulate-remediation.md`,
> `/api/v2/remediation/simulate`, MCP tool `simulate_remediation`.

## 1. Purpose

Given a CausalCertificate that already attributes liability across a set of
parties, the simulator answers a question that underwriters, regulators,
and litigators ask in every real engagement:

> *"What mitigation would have prevented this — and by how much?"*

The output is the **counterfactual apportionment** under each plausible
remediation in isolation, plus the **composite apportionment** when the
remediations are stacked. Each remediation in the catalog cites a real
statute, standard, or doctrine, so the output is defensible in
regulatory, settlement, and underwriting contexts.

## 2. Why this matters commercially

| Buyer | How they use it |
|---|---|
| **Insurers (Lloyd's, APRA-regulated)** | Premium discounts for documented mitigations: "We cut your AI-liability premium by N% because you have ISO/IEC 42001 certification." |
| **Litigators (defense)** | "If our client had implemented HITL per AI Act Art. 14, primary share would have dropped from 75% to 62%, and damages should be reduced commensurately." |
| **Regulators** | Enforcement discount for parties who can demonstrate documented mitigation prior to incident. |
| **Boards / risk committees** | "We're at 78%. With three changes (eval suite, HITL, ISO 42001), we'd be at 60%. Costs ~$X. Premium savings ~$Y. Pay-back: Z months." |

## 3. Method

### 3.1 Closed-form four-factor delta

The engine's `fourFactorScoring` block is a weighted combination of four
sub-scores already computed by `/api/v1/incidents/analyze`:

```
primaryScore = 0.30·causalProximity
             + 0.30·behaviouralDeviation
             + 0.20·controllability
             + 0.20·regulatoryAlignment
clamped to [0.25, 0.95]
```

Each remediation in the catalog declares a **negative delta vector** on
one or more of these sub-scores, scoped by agent type. The simulator:

1. Applies the deltas to a copy of the four-factor scoring (clamped per
   factor to `[0,1]`).
2. Re-derives `primaryScore` using the engine's weights and band.
3. Caps the resulting reduction at the per-remediation `maxReductionPp`
   (a documented ceiling, ≤15pp for any single mitigation).
4. **Conservation:** redistributes the freed mass to the secondary parties
   proportionally to their existing shares. Total share always sums
   to 1.000 (rounded to three dp).

### 3.2 Doctrinal rule for secondary-party mitigation

When a remediation applies to a SECONDARY party (deployer, operator,
user) rather than the primary, the freed mass is redistributed across
the **other secondaries**, NOT into the primary party.

*Reasoning.* A secondary party's diligence does not increase the
primary's culpability. The primary's liability flows from its own
conduct (product defect / non-delegable duty), and that conduct is not
altered by a co-defendant's diligence. Treating the primary as a sink
for freed mass would over-reward primaries when secondaries mitigate,
which is doctrinally wrong under:

- Restatement (Third) of Torts: Apportionment of Liability §8 cmt. b
- Civil Liability Act 2002 (NSW) §35 (proportionate liability)

If there is no other secondary to absorb the freed mass, the simulator
emits a `no_other_secondary_to_absorb:<id>` warning and parks the
overflow on the primary as a last-resort sink, capped at the engine's
0.95 ceiling.

### 3.3 Composite (stacking)

Composite apportionment is computed by:

1. Aggregating all primary-targeting deltas onto the four-factor block,
   recomputing `primaryScore` once.
2. Applying secondary-targeting share-shifts sequentially.
3. Capping the total primary-share reduction at
   `composite_cap_pp = min(Σ per-remediation maxReductionPp, 25pp)`.

The 25pp global ceiling reflects the empirical observation that no
realistic stack of process-level mitigations reduces a primary's share
by more than ~25pp without altering the underlying causal chain — at
which point the analysis is of a *different incident*, not a mitigation
of this one.

## 4. Determinism

The simulator is a **pure function**. No wall-clock, no randomness, no
I/O. The catalog is a frozen `const` whose version equals the worker
code hash.

> **Property.** For any input `x`, `simulateRemediation(x)` returns a
> byte-identical JSON serialisation across runs, processes, and
> machines.

This property is verified in the smoke test
(`/tmp/test_remediation.mjs`) and is guaranteed by the same recompute
discipline that backs `/api/v2/verify/recompute` (see
`docs/verify-recompute.md`).

## 5. Catalog

The v1 catalog ships with 15 remediations organised by target agent
type. Every entry declares: `id`, `label`, `targetType`, `factorDeltas`,
`maxReductionPp`, `citation`, `rationale`. Discover via:

```
GET /api/v2/remediation/catalog
```

Selected entries:

| ID | Target | Max reduction | Citation |
|---|---|---|---|
| `vendor_adversarial_eval_suite` | vendor | 12 pp | EU AI Act Art. 9; ISO/IEC 23894 §6.2.3 |
| `vendor_red_team_attestation` | vendor | 10 pp | NIST AI RMF Manage 4.1; EU AI Act Art. 60 |
| `vendor_safety_card` | vendor | 6 pp | EU AI Act Annex IV; ISO/IEC 42001 §A.6.1.4 |
| `deployer_human_in_loop` | deployer | 14 pp | EU AI Act Art. 14; APRA CPS 230 §31 |
| `deployer_pre_prod_validation` | deployer | 12 pp | FDA 510(k); EU MDR Art. 61; ISO/IEC 23053 |
| `deployer_continuous_monitoring` | deployer | 10 pp | EU AI Act Art. 72; ISO/IEC 42001 §A.9 |
| `deployer_input_validation` | deployer | 9 pp | ISO/IEC 23894 §7.4.2; OWASP ML01 |
| `deployer_incident_response_runbook` | deployer | 6 pp | APRA CPS 230 §17–§22; NIST AI RMF Manage 4.3 |
| `operator_training_certification` | human_operator | 9 pp | EU AI Act Art. 14(4); ISO/IEC 23894 §7.5 |
| `user_warning_acknowledgement` | user | 5 pp | Air Canada chatbot; Restatement Products §2(c) |
| `governance_iso_42001_certification` | deployer | 8 pp | ISO/IEC 42001:2023 |
| `governance_dpia_completed` | deployer | 6 pp | GDPR Art. 35; EU AI Act Art. 27 (FRIA) |
| `governance_third_party_audit` | vendor | 12 pp | EU AI Act Art. 43; ISO/IEC 17020 |
| `ai_system_runtime_guardrails` | ai_system | 11 pp | Anthropic Constitutional AI; OpenAI Spec |
| `vendor_sbom_disclosure` | vendor | 5 pp | EU AI Act Art. 10; US EO 14110 §4.2 |

## 6. API

### POST `/api/v2/remediation/simulate`

```json
{
  "verdict": {
    "primaryParty": "vendor-medai",
    "primaryShare": 0.78,
    "secondary": [
      { "party": "deployer-stmary", "share": 0.14 },
      { "party": "operator-radiologist", "share": 0.05 },
      { "party": "patient-jane", "share": 0.03 }
    ]
  },
  "fourFactorScoring": {
    "primaryAgent": "vendor-medai",
    "causalProximity": 0.82,
    "behaviouralDeviation": 0.74,
    "controllability": 0.55,
    "regulatoryAlignment": 0.60,
    "weights": {
      "causalProximity": 0.30,
      "behaviouralDeviation": 0.30,
      "controllability": 0.20,
      "regulatoryAlignment": 0.20
    }
  },
  "agents": [
    { "id": "vendor-medai", "type": "vendor" },
    { "id": "deployer-stmary", "type": "deployer" },
    { "id": "operator-radiologist", "type": "human_operator" },
    { "id": "patient-jane", "type": "user" }
  ],
  "remediations": [
    { "id": "vendor_adversarial_eval_suite" },
    { "id": "deployer_human_in_loop" },
    { "id": "governance_iso_42001_certification" }
  ]
}
```

Response shape:

```json
{
  "ruleId": "FK-METHOD-2026-003",
  "ruleName": "Counterfactual Remediation Simulator v1",
  "before": { "primaryParty": "...", "primaryShare": 0.78, "secondary": [...] },
  "perRemediation": [
    {
      "id": "vendor_adversarial_eval_suite",
      "label": "...",
      "citation": "EU AI Act Art. 9 (risk management); ISO/IEC 23894 §6.2.3",
      "appliedToParty": "vendor-medai",
      "before": {...},
      "after": { "primaryShare": 0.66, "secondary": [...] },
      "primaryShareDeltaPp": -12,
      "perPartyDeltaPp": [...],
      "capped": true,
      "rationale": "..."
    },
    ...
  ],
  "composite": {
    "after": { "primaryShare": 0.55, "secondary": [...] },
    "primaryShareDeltaPp": -23,
    "perPartyDeltaPp": [...],
    "capped": true,
    "cap_pp": 25,
    "citations": [...]
  },
  "methodology": { "weights": {...}, "composite_cap_pp": 25, "determinism": "...", "sources": [...] },
  "warnings": []
}
```

### GET `/api/v2/remediation/catalog`

Returns the full catalog, including `factorDeltas` and `rationale` for
each remediation. Free, no auth required (demo mode).

## 7. MCP tool

```
simulate_remediation
  cost: 1 credit (priced as verify_certificate)
  inputs: verdict, fourFactorScoring, agents, remediations[]
  output: full JSON of the simulator response
```

Same billing path as `verify_certificate` because it is a read-only
inference over an already-issued certificate.

## 8. Limitations

1. **The catalog is curated, not exhaustive.** Mitigations not in the
   catalog cannot be simulated. Adding a new remediation requires a code
   change (so the citation lineage is always visible in source control).
2. **Deltas are conservative.** A single mitigation never reduces
   primary share by more than 15 pp; the composite stack never by more
   than 25 pp. This reflects what the doctrine and the empirical case
   law actually support, not what defendants might prefer.
3. **No sector-specific overlays in v1.** A future v2 may apply
   sector-specific multipliers (e.g. medical-device deltas should be
   evaluated against FDA-specific test sets) — flagged but not in this
   release.
4. **No interaction effects in the catalog.** Some mitigations are
   complementary (HITL + monitoring) and some are substitutes
   (third-party audit + ISO 42001 certification). v1 stacks deltas
   additively; v2 will introduce interaction matrices once we have
   enough resolved-outcome data to fit them.

## 9. Versioning

`REMEDIATION_CATALOG_VERSION = "v1.0.0"`. Any change to deltas or
citations bumps the version. The version is included in the response so
verifiers can confirm the catalog used at simulation time.

## 10. Related

- `docs/cascade-rule.md` — FK-METHOD-2026-002 (Cascade Attenuation Rule)
- `docs/verify-recompute.md` — recompute verifier
- `proofs/README.md` — weekly determinism harness
