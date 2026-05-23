// ═══════════════════════════════════════════════════════════════════════════
// src/prospective-gate.ts
// FK-METHOD-2026-006 — Deterministic Prospective Evaluation Gate v1
//
// What this is.
// ─────────────
// A pure, deterministic decision function that runs the FaultKey four-factor
// engine BEFORE a response is delivered, returning one of three verdicts:
//
//   "allow"            — the proposed action's prospective four-factor score
//                        is below the allow threshold for its jurisdiction.
//                        A certificate pre-image is emitted so the post-hoc
//                        certificate (if issued) chains canonically from the
//                        same input.
//   "require_revision" — the score sits between the allow and block bands.
//                        Specific revision_directives[] are emitted, each
//                        keyed to the factor that crossed its sub-threshold
//                        and pointing at a concrete corrective action.
//   "block"            — the score is at or above the block threshold for
//                        its jurisdiction. The response MUST NOT be delivered;
//                        the calling agent should surface a refusal.
//
// What this is NOT.
// ─────────────────
// - This is not a content-safety classifier. It does not consume raw response
//   text and never decides "is this prose harmful." It consumes structured
//   ProposedAction metadata (action_type, target_agent, severity_estimate,
//   cascade_depth, eu_flags, jurisdiction). Whoever calls this gate is
//   responsible for translating their LLM call into a ProposedAction.
// - It is not stochastic. Given identical input, identical decision. The
//   pre-image hash is the canonical record.
// - It is not a fallback for missing governance. ISO/IEC 42001 §6 risk
//   treatment, AI Act Art. 14 human oversight, and NIST RMF MANAGE controls
//   remain mandatory; this gate is one runtime mechanism that contributes
//   evidence toward those obligations.
//
// Why this exists.
// ────────────────
// Post-hoc apportionment certificates answer "who is liable." Buyers
// increasingly want to answer the prior question: "can this be prevented?"
// AI Act Art. 14 and the AU DISR Voluntary AI Safety Standard explicitly
// require runtime risk treatment, not just post-incident records. A
// deterministic policy gate, scored by the same engine that issues the
// certificate, is the canonical runtime mechanism that maps cleanly back to
// the post-hoc evidence chain.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * The structured description of a proposed action that the calling agent
 * (Claude Desktop, Cursor, n8n, a custom pipeline) is about to take.
 *
 * Every field is required to make the gate decision deterministic. If your
 * caller cannot supply a field, fall back to the conservative default and
 * surface that fallback in the response's `inputs_with_defaults` array.
 */
export interface ProposedAction {
  /** Stable, free-form id for the action; echoed back in the decision. */
  action_id: string;

  /**
   * What the agent is about to do, in the engine's domain vocabulary.
   * Used to pick the agent-type liability bias the same way the post-hoc
   * engine does.
   */
  action_type:
    | "llm_response"
    | "tool_call"
    | "code_execution"
    | "external_api_call"
    | "human_handoff"
    | "data_modification"
    | "financial_transaction"
    | "medical_advice"
    | "legal_advice"
    | "financial_advice"
    | "content_moderation"
    | "autonomous_decision"
    | "other";

  /**
   * Free-form id of the agent issuing the action. Mirrors agents[0].id in
   * the post-hoc /api/v1/incidents/analyze body so the pre-image lines up
   * with a future certificate.
   */
  acting_agent_id: string;

  /**
   * Same vocabulary as the post-hoc engine's Agent.type. The default
   * "ai_system" is intentionally neutral.
   */
  acting_agent_type:
    | "ai_system"
    | "vendor"
    | "deployer"
    | "operator"
    | "human_user"
    | "third_party";

  /**
   * The estimated severity if the action goes wrong. Same vocabulary the
   * post-hoc engine uses — caller is responsible for the estimate.
   */
  severity_estimate: "low" | "medium" | "high" | "critical";

  /** Jurisdiction overlay to apply. Default AU. */
  jurisdiction?: "AU" | "EU" | "US" | "UK" | "CA";

  /**
   * Cascade depth — how many upstream agents this action is downstream of.
   * 0 = root caller; 3 = LLM → agent → tool → this action. Used to apply
   * cascade attenuation BEFORE the gate decision so deeply-nested actions
   * are not over-attributed to the proximal agent.
   */
  cascade_depth: number;

  /**
   * Optional EU AI Act flags. When jurisdiction === "EU" these alter the
   * thresholds via the high_risk_ai and pld_compensable_damage gates.
   */
  eu_flags?: {
    high_risk_ai?: boolean;
    pld_compensable_damage?: boolean;
    human_oversight_unassigned_or_unqualified?: boolean;
  };

  /**
   * Optional. If the action has identifiable downstream consequences (a
   * dollar value, a regulated party, a vulnerable population), the caller
   * can surface them here. The gate uses them to inform the
   * regulatoryAlignment sub-score.
   */
  context_flags?: {
    affects_vulnerable_population?: boolean;
    regulated_domain?: boolean;
    irreversible_if_executed?: boolean;
    human_in_the_loop_present?: boolean;
  };

  /**
   * Free-form id of the upstream incident this action is responding to, if
   * any. Used to chain the pre-image into an existing trace.
   */
  upstream_incident_id?: string;
}

export interface RevisionDirective {
  /** Which sub-score triggered the directive. */
  factor: "causalProximity" | "behaviouralDeviation" | "controllability" | "regulatoryAlignment";
  /** What value the factor took (0..1). */
  observed: number;
  /** The threshold the factor crossed. */
  threshold: number;
  /** Plain-English directive citing a real obligation. */
  directive: string;
  /** Authority anchor (statute / standard) for the directive. */
  authority: string;
}

export interface ProspectiveDecision {
  ruleId: "FK-METHOD-2026-006";
  ruleName: "Deterministic Prospective Evaluation Gate";
  ruleVersion: "v1.0.0";

  /** Echo of the input action id. */
  action_id: string;

  /** Three-state decision. */
  verdict: "allow" | "require_revision" | "block";

  /**
   * The prospective four-factor scoring, computed deterministically from
   * the input. Same field names as the post-hoc certificate's
   * fourFactorScoring block so a future certificate chains canonically.
   */
  prospective_score: {
    causalProximity: number;
    behaviouralDeviation: number;
    controllability: number;
    regulatoryAlignment: number;
    /** Weighted aggregate used to compare against thresholds. */
    aggregate: number;
    weights: {
      causalProximity: number;
      behaviouralDeviation: number;
      controllability: number;
      regulatoryAlignment: number;
    };
  };

  /** Thresholds applied for this jurisdiction. */
  thresholds: {
    allow_below: number;
    block_at_or_above: number;
    jurisdiction: string;
  };

  /** Empty when verdict is "allow"; populated when "require_revision" or "block". */
  revision_directives: RevisionDirective[];

  /**
   * SHA-256 of the canonicalised (sorted-key) JSON of (action ⊕ score ⊕
   * verdict). If the response is later delivered and an incident
   * certificate is issued, the certificate's request_hash chains from this
   * pre-image so a complete audit trail exists from "before delivery" to
   * "after incident."
   */
  pre_image_sha256: string;

  /** Honesty marker, mirroring weekly-determinism.ts. */
  signature_status: "unsigned_demo" | "signed";
  signature: string;

  /** ISO-8601 UTC timestamp the decision was made. */
  ts_utc: string;

  /** Any input fields that fell back to defaults. */
  inputs_with_defaults: string[];

  /**
   * Authority anchors cited for this decision. Always populated so the
   * decision is defensible without follow-up lookups.
   */
  authority_anchors: string[];
}

// ─── Thresholds (per jurisdiction) ─────────────────────────────────────────
// These are the per-jurisdiction allow/block bands for the weighted aggregate
// four-factor score. They are NOT arbitrary; they map to the regulatory
// posture in each jurisdiction:
//
//   EU      — strictest (high-risk AI default-blocks fast); AI Act Art. 9
//             risk-management baseline.
//   AU      — strict for regulated sectors; ACL Pt 3-2 + APRA CPS 230.
//   UK      — moderate; AI White Paper + sectoral approach.
//   US      — federal baseline only; Restatement (Third) Torts Apport. §§ 7-9.
//   CA      — moderate; AIDA / PIPEDA hybrid.
//
// These are deliberately conservative. Production callers can override via
// the optional `overrides` parameter; the override path is the only way to
// loosen these.
const JURISDICTION_THRESHOLDS: Record<string, { allow_below: number; block_at_or_above: number }> = {
  EU: { allow_below: 0.45, block_at_or_above: 0.72 },
  AU: { allow_below: 0.50, block_at_or_above: 0.75 },
  UK: { allow_below: 0.52, block_at_or_above: 0.78 },
  US: { allow_below: 0.55, block_at_or_above: 0.80 },
  CA: { allow_below: 0.50, block_at_or_above: 0.76 },
};

const DEFAULT_THRESHOLDS = JURISDICTION_THRESHOLDS.AU;

// ─── Action-type liability bias ────────────────────────────────────────────
// Each action type carries an inherent regulatory weight. These reflect the
// universe of regulated activities, not the AI engine itself. A
// medical_advice action carries Therapeutic Goods Act + Health Practitioner
// Regulation National Law obligations; a financial_transaction carries
// Corporations Act + ASIC RG 255. We do NOT classify the prose — we attribute
// risk to the *category* of action the caller declared.
const ACTION_TYPE_REGULATORY_WEIGHT: Record<ProposedAction["action_type"], number> = {
  llm_response:          0.10,
  tool_call:             0.20,
  code_execution:        0.40,
  external_api_call:     0.30,
  human_handoff:        -0.10, // human handoff REDUCES regulatory weight
  data_modification:     0.35,
  financial_transaction: 0.80,
  medical_advice:        0.85,
  legal_advice:          0.75,
  financial_advice:      0.75,
  content_moderation:    0.45,
  autonomous_decision:   0.60,
  other:                 0.30,
};

const SEVERITY_WEIGHT: Record<ProposedAction["severity_estimate"], number> = {
  low:      0.30,
  medium:   0.55,
  high:     0.75,
  critical: 0.92,
};

const AGENT_TYPE_BIAS: Record<ProposedAction["acting_agent_type"], number> = {
  ai_system:   0.00,
  vendor:      0.05,
  deployer:    0.10,
  operator:    0.05,
  human_user: -0.05, // a human acting reduces AI-attribution weight
  third_party: 0.00,
};

// ─── Cascade attenuation (same shape as FK-METHOD-2026-002) ────────────────
// 1 / (1 + α·ln(1 + depth)). α=0.5 keeps depth=3 at ~0.74 and depth=5 at ~0.65.
function cascadeMultiplier(depth: number, alpha = 0.5): number {
  if (depth <= 0) return 1;
  return 1 / (1 + alpha * Math.log(1 + depth));
}

// ─── Deterministic hashing ─────────────────────────────────────────────────
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

// ─── Pure pre-image-stable factor derivation ───────────────────────────────
// Each factor maps deterministically from the proposed action's structured
// fields. There is no random seed. The same input MUST produce the same
// output across all worker invocations.
function deriveCausalProximity(a: ProposedAction): number {
  // Cascade depth attenuates causal proximity sub-linearly: a deeply-nested
  // action is less proximal to its caller's decision than a direct one.
  const baseline = 0.85; // direct actions have very high proximity by default
  const multiplier = cascadeMultiplier(a.cascade_depth);
  return clamp01(baseline * multiplier);
}

function deriveBehaviouralDeviation(a: ProposedAction): number {
  // Without observed behaviour (this is prospective, not post-hoc), we use
  // severity + irreversibility as a proxy for "deviation potential."
  let v = SEVERITY_WEIGHT[a.severity_estimate];
  if (a.context_flags?.irreversible_if_executed) v += 0.10;
  if (a.context_flags?.affects_vulnerable_population) v += 0.05;
  return clamp01(v);
}

function deriveControllability(a: ProposedAction): number {
  // Higher controllability = LOWER liability share. Human-in-the-loop and
  // human-handoff actions are highly controllable; autonomous and
  // irreversible actions are not.
  let v = 0.5;
  if (a.context_flags?.human_in_the_loop_present) v += 0.30;
  if (a.action_type === "human_handoff") v += 0.20;
  if (a.action_type === "autonomous_decision") v -= 0.20;
  if (a.context_flags?.irreversible_if_executed) v -= 0.25;
  return clamp01(v);
}

function deriveRegulatoryAlignment(a: ProposedAction): number {
  // Higher regulatory weight = lower alignment unless the action is in a
  // regulated domain WITH appropriate human oversight.
  let v = ACTION_TYPE_REGULATORY_WEIGHT[a.action_type];
  v += AGENT_TYPE_BIAS[a.acting_agent_type];
  if (a.context_flags?.regulated_domain && !a.context_flags?.human_in_the_loop_present) {
    v += 0.15;
  }
  if (a.eu_flags?.high_risk_ai) v += 0.10;
  if (a.eu_flags?.pld_compensable_damage) v += 0.08;
  if (a.eu_flags?.human_oversight_unassigned_or_unqualified) v += 0.12;
  return clamp01(v);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, +v.toFixed(3)));
}

// ─── Main entry point ──────────────────────────────────────────────────────
export interface EvaluateOptions {
  /**
   * Optional override for the jurisdiction's thresholds. Production callers
   * who have a more permissive risk appetite (and the governance posture to
   * justify it under ISO/IEC 42001 §6.1) can loosen the gate here. The
   * override is echoed back in the decision so it is auditable.
   */
  overrides?: {
    allow_below?: number;
    block_at_or_above?: number;
    /** Why the override was applied. Required so audit trail is complete. */
    rationale: string;
  };
  /**
   * Optional Ed25519 sign function. Mirrors weekly-determinism.ts. If
   * provided, signature_status: "signed" and the signature is a detached
   * base64 over pre_image_sha256.
   */
  sign?: (messageHex: string) => Promise<string>;
}

export async function evaluateProspectiveResponse(
  action: ProposedAction,
  options: EvaluateOptions = {}
): Promise<ProspectiveDecision> {
  const inputs_with_defaults: string[] = [];

  // Fill defaults; record every default applied.
  const a: ProposedAction = {
    ...action,
    jurisdiction: action.jurisdiction ?? "AU",
    cascade_depth: action.cascade_depth ?? 0,
  };
  if (!action.jurisdiction) inputs_with_defaults.push("jurisdiction=AU");
  if (action.cascade_depth === undefined) inputs_with_defaults.push("cascade_depth=0");

  // Compute the four factors deterministically.
  const causalProximity = deriveCausalProximity(a);
  const behaviouralDeviation = deriveBehaviouralDeviation(a);
  const controllability = deriveControllability(a);
  const regulatoryAlignment = deriveRegulatoryAlignment(a);

  const weights = {
    causalProximity: 0.30,
    behaviouralDeviation: 0.30,
    controllability: 0.20,
    regulatoryAlignment: 0.20,
  };

  // Aggregate. controllability is INVERTED in the aggregate because high
  // controllability REDUCES liability, while the other three INCREASE it.
  const aggregate = +(
    causalProximity * weights.causalProximity +
    behaviouralDeviation * weights.behaviouralDeviation +
    (1 - controllability) * weights.controllability +
    regulatoryAlignment * weights.regulatoryAlignment
  ).toFixed(3);

  // Pick thresholds.
  const baseThresh = JURISDICTION_THRESHOLDS[a.jurisdiction!] ?? DEFAULT_THRESHOLDS;
  const thresholds = {
    allow_below: options.overrides?.allow_below ?? baseThresh.allow_below,
    block_at_or_above: options.overrides?.block_at_or_above ?? baseThresh.block_at_or_above,
    jurisdiction: a.jurisdiction!,
  };

  // Decide.
  let verdict: ProspectiveDecision["verdict"];
  if (aggregate >= thresholds.block_at_or_above) {
    verdict = "block";
  } else if (aggregate < thresholds.allow_below) {
    verdict = "allow";
  } else {
    verdict = "require_revision";
  }

  // Emit revision directives whenever verdict !== "allow".
  const revision_directives: RevisionDirective[] = [];
  if (verdict !== "allow") {
    // Each factor that exceeds its sub-threshold gets a directive.
    if (behaviouralDeviation >= 0.7) {
      revision_directives.push({
        factor: "behaviouralDeviation",
        observed: behaviouralDeviation,
        threshold: 0.7,
        directive:
          "Lower the severity_estimate of the proposed action, or restructure to be reversible. Severity-by-design controls are required.",
        authority: "ISO/IEC 23894:2023 §6.5.3 (risk treatment); AI Act Art. 9(2)(b)",
      });
    }
    if (controllability <= 0.4) {
      revision_directives.push({
        factor: "controllability",
        observed: controllability,
        threshold: 0.4,
        directive:
          "Add a human-in-the-loop checkpoint before the action is delivered, or split the action into a sequence where each step is independently reversible.",
        authority: "AI Act Art. 14 (human oversight); ISO/IEC 42001 §8.3",
      });
    }
    if (regulatoryAlignment >= 0.7) {
      revision_directives.push({
        factor: "regulatoryAlignment",
        observed: regulatoryAlignment,
        threshold: 0.7,
        directive:
          "The action falls in a regulated domain. Confirm the acting agent is authorised under the applicable sector law (financial, medical, legal) and that a qualified human reviewer is in the loop.",
        authority:
          a.jurisdiction === "EU"
            ? "AI Act Art. 6 + Annex III (high-risk AI); Reg. (EU) 2024/1689 Art. 9"
            : a.jurisdiction === "AU"
              ? "ACL Pt 3-2 (consumer guarantees); APRA CPS 230 §29 (operational risk); DISR Voluntary AI Safety Standard Guardrail 3"
              : a.jurisdiction === "US"
                ? "Restatement (Third) of Torts: Apportionment §§ 7-9; sector regulator obligations vary"
                : a.jurisdiction === "UK"
                  ? "UK AI White Paper §3.2 (sectoral approach); Equality Act 2010 §149"
                  : "AIDA Bill C-27 Part 3; PIPEDA Principle 4.1.4",
      });
    }
    if (causalProximity >= 0.8) {
      revision_directives.push({
        factor: "causalProximity",
        observed: causalProximity,
        threshold: 0.8,
        directive:
          "The proximal agent is highly causally connected to the consequence. Cascade-attenuate by introducing an intermediate review agent or shortening the action's effect chain.",
        authority:
          "Wagon Mound (No 1) [1961] AC 388 (foreseeability); Restatement (Third) of Torts §29 (scope of liability); FK-METHOD-2026-002",
      });
    }
    // Always include at least one directive when require_revision: if no
    // sub-threshold tripped, name the closest-to-cap factor so the caller
    // has actionable feedback rather than a generic warning.
    if (revision_directives.length === 0) {
      const candidates: Array<{ factor: RevisionDirective["factor"]; value: number; threshold: number }> = [
        { factor: "causalProximity", value: causalProximity, threshold: 0.8 },
        { factor: "behaviouralDeviation", value: behaviouralDeviation, threshold: 0.7 },
        { factor: "controllability", value: 1 - controllability, threshold: 0.6 },
        { factor: "regulatoryAlignment", value: regulatoryAlignment, threshold: 0.7 },
      ];
      const closest = candidates.sort((x, y) => y.value / y.threshold - x.value / x.threshold)[0]!;
      revision_directives.push({
        factor: closest.factor,
        observed: closest.value,
        threshold: closest.threshold,
        directive:
          "Aggregate score is in the revision band but no single factor crossed its sub-threshold. The closest-to-cap factor is named; lowering it will bring the action into the allow band.",
        authority: "ISO/IEC 42001 §6.1.4 (treat residual risk); FK-METHOD-2026-006",
      });
    }
  }

  // Build the canonical pre-image. This MUST sort keys so the hash is stable.
  const preImageBody = {
    action: a,
    score: {
      causalProximity,
      behaviouralDeviation,
      controllability,
      regulatoryAlignment,
      aggregate,
      weights,
    },
    thresholds,
    verdict,
    overrides_rationale: options.overrides?.rationale ?? null,
    ruleId: "FK-METHOD-2026-006",
    ruleVersion: "v1.0.0",
  };
  const canonical = canonicalize(preImageBody);
  const pre_image_sha256 = await sha256Hex(canonical);

  // Optional signing.
  let signature_status: "unsigned_demo" | "signed" = "unsigned_demo";
  let signature = "";
  if (options.sign) {
    signature = await options.sign(pre_image_sha256);
    signature_status = "signed";
  }

  return {
    ruleId: "FK-METHOD-2026-006",
    ruleName: "Deterministic Prospective Evaluation Gate",
    ruleVersion: "v1.0.0",
    action_id: a.action_id,
    verdict,
    prospective_score: {
      causalProximity,
      behaviouralDeviation,
      controllability,
      regulatoryAlignment,
      aggregate,
      weights,
    },
    thresholds,
    revision_directives,
    pre_image_sha256,
    signature_status,
    signature,
    ts_utc: new Date().toISOString(),
    inputs_with_defaults,
    authority_anchors: [
      "AI Act Reg. (EU) 2024/1689 Arts. 9, 14, 17",
      "ISO/IEC 42001:2023 §§ 6.1, 8.3, 9.1",
      "ISO/IEC 23894:2023 §§ 6.4.4, 6.5.3",
      "NIST AI RMF (AI 100-1) MANAGE 2.x, MEASURE 2.7",
      "AU DISR Voluntary AI Safety Standard Guardrails 1, 3, 5",
      "Restatement (Third) of Torts: Apportionment of Liability §§ 7-9, 29",
      "Wagon Mound (No 1) [1961] AC 388 (foreseeability)",
      "FK-METHOD-2026-002 (Cascade Attenuation)",
      "FK-METHOD-2026-006 (this rule)",
    ],
  };
}

// ─── Exposed for the worker boot path ──────────────────────────────────────
export const PROSPECTIVE_GATE_RULE_ID = "FK-METHOD-2026-006" as const;
export const PROSPECTIVE_GATE_VERSION = "v1.0.0" as const;
export { JURISDICTION_THRESHOLDS, ACTION_TYPE_REGULATORY_WEIGHT };
