# FK-METHOD-2026-006 — Deterministic Prospective Evaluation Gate v1

**Status:** v1.0.0, ships in causallayer-mcp `feat/prospective-gate` branch
**Endpoints:** `POST /api/v2/gate/evaluate`, `GET /api/v2/gate/thresholds`
**MCP tool:** `evaluate_prospective_response` (1 credit, same price as `verify_certificate`)
**Engine module:** `src/prospective-gate.ts`

## What this is

A deterministic decision function that runs the FaultKey four-factor engine **before** a response is delivered, returning one of three verdicts on a structured `ProposedAction`:

| Verdict | Meaning | Caller obligation |
|---|---|---|
| `allow` | Prospective aggregate score below the jurisdiction's allow threshold. | Deliver the response. Emit the pre-image hash into the calling agent's trace so a post-hoc certificate (if later issued) chains canonically. |
| `require_revision` | Aggregate sits in the band between allow and block thresholds. | Do **not** deliver as-is. The decision returns `revision_directives[]`, each keyed to the factor that crossed its sub-threshold and pointing at a concrete corrective action (add human-in-the-loop, lower severity, restructure for reversibility, etc.). |
| `block` | Aggregate is at or above the jurisdiction's block threshold. | Refuse delivery. Surface a refusal to the upstream caller. |

## What this is **not**

This is not a content-safety classifier. It does not consume raw response prose and never decides "is this text harmful." It consumes structured `ProposedAction` metadata (action category, agent type, severity estimate, cascade depth, regulatory flags), all of which the calling agent is responsible for supplying. Whoever calls the gate is responsible for translating their LLM call into a `ProposedAction`.

It is not stochastic. Given identical input, identical decision. The pre-image hash is the canonical record.

It is not a substitute for governance. ISO/IEC 42001 §6 risk treatment, AI Act Art. 14 human oversight, and the NIST AI RMF MANAGE controls remain mandatory; this gate is one runtime mechanism that contributes evidence toward those obligations.

## Why this exists (the platform thesis)

Post-hoc apportionment certificates answer "who is liable." The market is shifting to the prior question: *can this be prevented?* AI Act Art. 14 and the AU DISR Voluntary AI Safety Standard's Guardrail 3 explicitly require runtime risk treatment, not just post-incident records. NIST AI RMF MEASURE 2.7 calls for continuous monitoring with feedback into the management system.

A pure post-hoc product becomes a line item inside a larger platform that owns the runtime hook. **Owning the runtime hook converts FaultKey from a forensics tool into a platform.** Every decision the gate makes either becomes a non-event (allowed responses delivered normally) or a feedback signal: revisions surface the specific factor that tripped, blocks force a refusal that can be measured against the post-hoc certificate rate. The gate is the upstream half of the "learning genome" loop the rest of the engine already implements downstream.

## Four-factor derivation

The same four factors used in the post-hoc certificate, derived prospectively from structured metadata.

### causalProximity

Cascade depth attenuates causal proximity sub-linearly. A directly-issued action has very high proximity to its caller's decision; a deeply-nested action (LLM → agent → tool → action) is less proximal.

```
causalProximity = clamp01(0.85 × cascadeMultiplier(depth))
cascadeMultiplier(d) = 1 / (1 + α·ln(1+d)),  α = 0.5
```

This matches FK-METHOD-2026-002 exactly. The α coefficient is shared so prospective scores chain consistently with post-hoc certificates.

### behaviouralDeviation

Without observed behaviour (this is prospective), severity and irreversibility serve as the proxy:

```
behaviouralDeviation = clamp01(
    severity_weight[severity_estimate]
  + 0.10 × irreversible_if_executed
  + 0.05 × affects_vulnerable_population
)
severity_weight = { low: 0.30, medium: 0.55, high: 0.75, critical: 0.92 }
```

The "deviation potential" interpretation: a critical, irreversible action has high deviation potential even before it executes; a low-severity reversible one does not.

### controllability

```
controllability = clamp01(
    0.5
  + 0.30 × human_in_the_loop_present
  + 0.20 × (action_type == "human_handoff")
  - 0.20 × (action_type == "autonomous_decision")
  - 0.25 × irreversible_if_executed
)
```

Higher controllability **lowers** the aggregate (it is inverted before weighting). Human-in-the-loop and human-handoff actions are highly controllable; autonomous and irreversible actions are not.

### regulatoryAlignment

```
regulatoryAlignment = clamp01(
    action_type_regulatory_weight[action_type]
  + agent_type_bias[acting_agent_type]
  + 0.15 × (regulated_domain ∧ ¬human_in_the_loop_present)
  + 0.10 × eu_flags.high_risk_ai
  + 0.08 × eu_flags.pld_compensable_damage
  + 0.12 × eu_flags.human_oversight_unassigned_or_unqualified
)
```

The action-type regulatory weights reflect the *universe of regulated activities*, not the AI engine itself:

| Action type | Weight | Reasoning |
|---|---:|---|
| medical_advice | 0.85 | Therapeutic Goods Act + Health Practitioner Regulation National Law |
| financial_transaction | 0.80 | Corporations Act + ASIC RG 255 |
| legal_advice | 0.75 | Legal Profession Uniform Law |
| financial_advice | 0.75 | Corporations Act Chapter 7 + ASIC RG 175 |
| autonomous_decision | 0.60 | AI Act Annex III + RG 271 (automated decision-making) |
| content_moderation | 0.45 | DSA Art. 14 + Online Safety Act 2021 (AU) |
| code_execution | 0.40 | Cyber Security Act 2024 + supply chain |
| data_modification | 0.35 | Privacy Act 1988 + GDPR Art. 5 |
| external_api_call | 0.30 | Subject to API ToS + downstream regs |
| other | 0.30 | Conservative default |
| tool_call | 0.20 | Generally tool-bounded |
| llm_response | 0.10 | Baseline |
| human_handoff | −0.10 | Explicitly reduces regulatory weight (human takes over) |

## Aggregate and thresholds

```
aggregate =   0.30 × causalProximity
            + 0.30 × behaviouralDeviation
            + 0.20 × (1 - controllability)
            + 0.20 × regulatoryAlignment
```

Same weights as the post-hoc certificate, with `controllability` inverted because high controllability **reduces** liability while the other three increase it.

### Per-jurisdiction allow/block bands

| Jurisdiction | allow_below | block_at_or_above | Posture |
|---|---:|---:|---|
| EU | 0.45 | 0.72 | Strictest. AI Act Art. 9 risk-management baseline |
| AU | 0.50 | 0.75 | Strict for regulated sectors. ACL Pt 3-2 + APRA CPS 230 |
| UK | 0.52 | 0.78 | Moderate. AI White Paper + sectoral approach |
| US | 0.55 | 0.80 | Most permissive baseline. Restatement Torts Apport. §§ 7-9 |
| CA | 0.50 | 0.76 | Moderate. AIDA / PIPEDA hybrid |

These are deliberately conservative. Production callers can loosen them via the `overrides` parameter, but the override **requires a rationale string** so the audit trail is complete. A common rationale is "ISO/IEC 42001 SoA §3.2 approval" — meaning the operator has documented in its Statement of Applicability the residual risk acceptance that justifies the loosening.

## Pre-image and certificate chaining

Every decision emits a `pre_image_sha256` — a SHA-256 over the canonicalised (sorted-key) JSON of `(action ⊕ score ⊕ thresholds ⊕ verdict ⊕ overrides_rationale ⊕ ruleId ⊕ ruleVersion)`. The canonicalisation is identical to the one used by the post-hoc engine, so:

- **If the response is `allow`-ed and the response is delivered**, the calling agent should record `pre_image_sha256` against the trace. If a post-hoc incident is later filed for the same trace, the certificate's `request_hash` chains to the pre-image, producing a complete `prospective → response → certificate → anchor` audit trail.
- **If the response is `block`-ed**, the calling agent records `pre_image_sha256` against the refusal log. This is itself evidence under AI Act Art. 12(1) "automatically generated logs."
- **If the response is `require_revision`-ed**, the agent revises the `ProposedAction` and calls again. Each call emits a distinct pre-image, producing a tree of revisions that is itself an evidence artifact.

## Signing

By default, decisions are `signature_status: "unsigned_demo"` — the manifest is integrity-only via SHA-256. If `ANCHOR_PRIVATE_KEY` is bound in the worker environment, decisions can be signed by passing a `sign` callback to `evaluateProspectiveResponse()`. Signed decisions emit `signature_status: "signed"` with a detached Ed25519 signature over `pre_image_sha256`.

This honesty marker mirrors `weekly-determinism.ts`. Consumers should treat unsigned decisions as integrity proofs, not non-repudiable signatures, until production binds the key.

## Middleware integration

### Claude Desktop `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "faultkey": {
      "command": "npx",
      "args": ["-y", "@faultkey/mcp-client"],
      "env": { "FAULTKEY_API_KEY": "your_key_here" }
    }
  }
}
```

Claude then calls `evaluate_prospective_response` directly as one of its available tools.

### Cursor `.cursor/mcp.json`

Same shape as Claude Desktop. Cursor surfaces the tool as available in agent mode.

### n8n custom node

```javascript
// In an n8n Code node, before the LLM-call node:
const decision = await $http.post(
  "https://mcp.faultkey.com/api/v2/gate/evaluate",
  {
    action: {
      action_id: $execution.id + "-" + $node.name,
      action_type: "external_api_call",
      acting_agent_id: "n8n-workflow-" + $workflow.id,
      acting_agent_type: "ai_system",
      severity_estimate: $input.first().json.severity ?? "medium",
      cascade_depth: $node.context.cascadeDepth ?? 0,
      context_flags: {
        regulated_domain: $input.first().json.is_regulated ?? false,
      },
    },
  },
  { headers: { Authorization: "Bearer " + $env.FAULTKEY_API_KEY } }
);
if (decision.verdict === "block") {
  throw new Error("Refused by FaultKey gate: " + decision.revision_directives.map(d => d.directive).join("; "));
}
if (decision.verdict === "require_revision") {
  // Surface directives to the agent and re-call after revision
  return { json: { needs_revision: true, directives: decision.revision_directives } };
}
// allow: proceed with the next node
return $input.all();
```

### Cline / Aider / custom agent loops

Wrap the model-call inside an `evaluate_prospective_response` check. On `require_revision`, feed the directives back to the model and retry. On `block`, surface a refusal to the upstream caller.

## Failure modes (honest)

1. **Garbage in, garbage out.** The gate is only as good as the `ProposedAction` the caller supplies. A caller that always says `severity_estimate: "low"` will always be allowed; that does not make the calls actually low-severity. The gate's value depends on honest action metadata.
2. **Not a substitute for content filters.** It cannot tell that a `severity_estimate: "low"` LLM response is in fact toxic. Use it alongside (not instead of) content classifiers like Perspective API, OpenAI Moderation, or AWS Comprehend.
3. **Determinism cuts both ways.** The same `ProposedAction` is always allowed or always blocked. If your business logic depends on stochasticity (A/B testing of the gate), you must vary the `ProposedAction` inputs deterministically.
4. **Thresholds are calibrated, not learned.** They reflect the regulatory posture of each jurisdiction at the time of release (May 2026). They will need re-calibration after AI Act enforcement actions accumulate and the AU DISR mandatory standard supersedes the voluntary one.

## Authorities cited

- AI Act Reg. (EU) 2024/1689 Arts. 9, 14, 17
- ISO/IEC 42001:2023 §§ 6.1, 8.3, 9.1
- ISO/IEC 23894:2023 §§ 6.4.4, 6.5.3
- NIST AI RMF (AI 100-1) MANAGE 2.x, MEASURE 2.7
- AU DISR Voluntary AI Safety Standard Guardrails 1, 3, 5
- Restatement (Third) of Torts: Apportionment of Liability §§ 7–9, 29
- *Wagon Mound (No 1)* [1961] AC 388 (foreseeability)
- FK-METHOD-2026-002 (Cascade Attenuation)
- FK-METHOD-2026-006 (this rule)

## Versioning

This is v1.0.0. Planned v1.1 additions:

- Per-tenant threshold profiles (read from KV with the tenant id, override the jurisdiction defaults).
- Bulk evaluation endpoint for backtesting.
- Calibration corpus: 50 anonymised real-world actions with expert-labelled verdicts so the thresholds can be evaluated against ground truth.

v2.0 will introduce learned-coefficient mode: the same engine framework, but with the four-factor weights and the action-type regulatory weights fitted to an audited corpus of post-hoc certificates. v1.0 is deliberately closed-form so it is fully auditable and reproducible by any third-party verifier.
