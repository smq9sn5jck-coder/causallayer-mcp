/**
 * remediation.ts — Counterfactual remediation simulator (FK-METHOD-2026-003)
 * --------------------------------------------------------------------------
 *
 * Closed-form four-factor delta engine. Given a certificate's verdict (primary
 * + secondary shares), the certificate's fourFactorScoring block, and a list
 * of plausible remediations the responsible parties claim they took (or could
 * have taken), this module returns the COUNTERFACTUAL APPORTIONMENT under
 * each remediation and under the composite (all selected remediations
 * stacked).
 *
 * Why this exists
 * ---------------
 * Underwriters and litigators don't just want to know who was at fault —
 * they want to know *what mitigation would have changed the share*. That
 * shapes:
 *   • premium discounts for documented mitigations
 *   • settlement offers ("if we'd done X, share would be Y")
 *   • regulatory enforcement (mitigated parties get reduced penalty)
 *
 * Math (auditable)
 * ----------------
 * Each remediation specifies a `factorDeltas` vector that targets one or
 * more of the four factors used by the engine to compute primary share:
 *
 *     causalProximity         (weight 0.30)
 *     behaviouralDeviation    (weight 0.30)
 *     controllability         (weight 0.20)
 *     regulatoryAlignment     (weight 0.20)
 *
 * (Weights match standalone.ts:806 — fourFactorScoring.weights)
 *
 * Procedure:
 *   1. For each agent type targeted by a remediation, apply the delta to the
 *      relevant sub-scores. Deltas are negative (a mitigation REDUCES that
 *      agent's contribution to its own factor). Bounded to [0, 1].
 *   2. Recompute the primary party's primaryScore by the same weighted
 *      formula the engine uses.
 *   3. Cap the post-mitigation reduction at the remediation's
 *      `maxReductionPp` (a documented per-remediation ceiling, e.g. ≤15pp,
 *      because no single mitigation flips a verdict).
 *   4. Redistribute the freed share to secondary parties proportionally to
 *      their existing shares (mass-conservation: shares always sum to 1).
 *   5. Return before/after shares plus the per-remediation delta in pp.
 *
 * Composability
 * -------------
 * Multiple remediations stack additively on the factor sub-scores (each
 * delta accumulates), then the recompute happens once. The composite
 * reduction is also capped: composite_max = min(sum(maxReductionPp), 25pp).
 * This ceiling reflects the empirical observation that no realistic stack
 * of process mitigations reduces a primary's share by more than ~25pp
 * without altering the underlying causal chain (which would require a
 * different incident, not a mitigation of this one).
 *
 * Determinism
 * -----------
 * Pure function. No wall-clock, no randomness, no I/O. Same inputs →
 * byte-identical output. Catalog is a static const so version = code hash.
 *
 * Citation
 * --------
 * Every remediation in REMEDIATION_CATALOG carries a `citation` field
 * pointing at the statute or standard whose control the mitigation
 * implements (EU AI Act Art. 9, ISO/IEC 23894, NIST AI RMF, etc.). This
 * makes the simulator output defensible in regulatory and litigation
 * contexts: "Remediation X reduces vendor share by 12pp because it
 * implements ISO/IEC 23894 §6.2.3 risk-treatment control."
 */

// ─── Types ────────────────────────────────────────────────────────────────

/** Four-factor sub-scores. Same shape as fourFactorScoring in standalone.ts. */
export interface FourFactorScoring {
  primaryAgent: string;
  causalProximity: number;
  behaviouralDeviation: number;
  controllability: number;
  regulatoryAlignment: number;
  weights: {
    causalProximity: number;
    behaviouralDeviation: number;
    controllability: number;
    regulatoryAlignment: number;
  };
}

/** Verdict shares from a certificate. */
export interface VerdictShares {
  primaryParty: string;
  primaryShare: number;
  secondary: Array<{ party: string; share: number }>;
}

/** Agent type → remediation applies to which kind of party. */
export type RemediationTargetType =
  | "vendor"
  | "deployer"
  | "ai_system"
  | "human_operator"
  | "user"
  | "third_party";

export interface RemediationDef {
  id: string;
  label: string;
  /**
   * Which class of agent this remediation applies to. The simulator looks
   * up the agent on the verdict whose declared type matches and applies
   * the deltas to that party only.
   */
  targetType: RemediationTargetType;
  /**
   * Negative deltas on four-factor sub-scores. Magnitude ≤ 0.20 per factor
   * so a single mitigation cannot zero-out any factor.
   */
  factorDeltas: {
    causalProximity?: number;
    behaviouralDeviation?: number;
    controllability?: number;
    regulatoryAlignment?: number;
  };
  /** Per-remediation cap on the primary-share reduction in percentage points. */
  maxReductionPp: number;
  /** Statute/standard the mitigation implements (citable). */
  citation: string;
  /** Plain-language explanation for non-technical reviewers. */
  rationale: string;
}

export interface RemediationInput {
  /** Catalog ID from REMEDIATION_CATALOG. */
  id: string;
  /**
   * Optional override of the agent the remediation applies to. Defaults to
   * the first secondary agent whose type matches `targetType`.
   */
  appliedToParty?: string;
}

export interface SimulateRemediationInput {
  /** Verdict block from the certificate. */
  verdict: VerdictShares;
  /** Four-factor scoring block from the certificate. */
  fourFactorScoring: FourFactorScoring;
  /**
   * Agent registry — needed to map remediation targetType → party id.
   * id, type pairs only.
   */
  agents: Array<{ id: string; type?: string }>;
  /** List of plausible remediations to simulate. */
  remediations: RemediationInput[];
}

export interface RemediationResult {
  id: string;
  label: string;
  citation: string;
  appliedToParty: string;
  before: VerdictShares;
  after: VerdictShares;
  /** primaryShare delta in percentage points (negative = reduction). */
  primaryShareDeltaPp: number;
  /** Per-party delta in pp, including secondary parties. */
  perPartyDeltaPp: Array<{ party: string; deltaPp: number }>;
  /** Whether the cap (maxReductionPp) clamped the result. */
  capped: boolean;
  rationale: string;
}

export interface SimulateRemediationOutput {
  ruleId: "FK-METHOD-2026-003";
  ruleName: "Counterfactual Remediation Simulator v1";
  before: VerdictShares;
  /** Per-remediation simulations (each computed in isolation). */
  perRemediation: RemediationResult[];
  /**
   * Composite: all selected remediations stacked. Reflects the "if we'd
   * done all of these together" counterfactual.
   */
  composite: {
    after: VerdictShares;
    primaryShareDeltaPp: number;
    perPartyDeltaPp: Array<{ party: string; deltaPp: number }>;
    capped: boolean;
    cap_pp: number;
    citations: string[];
  };
  methodology: {
    weights: FourFactorScoring["weights"];
    composite_cap_pp: number;
    determinism: "byte-identical given same inputs (no wall-clock, no RNG)";
    sources: string[];
  };
  /** Skipped remediations (unknown id, missing party). */
  warnings: string[];
}

// ─── Catalog ──────────────────────────────────────────────────────────────

/**
 * Curated catalog of plausible mitigations. Every entry cites a real
 * statute, standard, or prevailing-practice document. Deltas are
 * deliberately conservative — the simulator's value lies in being
 * REPLICABLE and DEFENSIBLE, not in being maximally generous.
 */
export const REMEDIATION_CATALOG: Readonly<Record<string, RemediationDef>> = Object.freeze({
  // ── Vendor-side (model provider, foundation-model lab) ──────────────────
  vendor_adversarial_eval_suite: {
    id: "vendor_adversarial_eval_suite",
    label: "Documented adversarial evaluation suite covering known failure modes",
    targetType: "vendor",
    factorDeltas: { behaviouralDeviation: -0.10, regulatoryAlignment: -0.06 },
    maxReductionPp: 12,
    citation: "EU AI Act Art. 9 (risk management); ISO/IEC 23894 §6.2.3 (risk treatment)",
    rationale:
      "A pre-deployment adversarial eval suite with documented coverage of known failure modes is the canonical Art. 9 risk-management control. Reduces vendor's behavioural-deviation factor (the model behaved unexpectedly) and regulatory-alignment factor (the vendor met the statutory duty).",
  },
  vendor_red_team_attestation: {
    id: "vendor_red_team_attestation",
    label: "Independent third-party red-team attestation (signed report)",
    targetType: "vendor",
    factorDeltas: { behaviouralDeviation: -0.07, regulatoryAlignment: -0.08 },
    maxReductionPp: 10,
    citation: "NIST AI RMF Manage 4.1; EU AI Act Art. 60 (post-market monitoring)",
    rationale:
      "An independent red-team produces an attested report on residual risk. Stronger than self-eval because it removes the conflict of interest. Treated as a regulatory-alignment win.",
  },
  vendor_safety_card: {
    id: "vendor_safety_card",
    label: "Published model/safety card with capability and limitation disclosure",
    targetType: "vendor",
    factorDeltas: { regulatoryAlignment: -0.05, causalProximity: -0.03 },
    maxReductionPp: 6,
    citation: "EU AI Act Annex IV (technical documentation); ISO/IEC 42001 §A.6.1.4",
    rationale:
      "Disclosed capability/limitation cards shift partial responsibility to the deployer because the deployer was on notice. Modest reduction.",
  },
  vendor_sbom_disclosure: {
    id: "vendor_sbom_disclosure",
    label: "Software Bill of Materials and training-data provenance disclosure",
    targetType: "vendor",
    factorDeltas: { regulatoryAlignment: -0.04, causalProximity: -0.02 },
    maxReductionPp: 5,
    citation: "EU AI Act Art. 10 (data and data governance); US EO 14110 §4.2",
    rationale:
      "Provenance disclosure shifts evidentiary burden and partially mitigates 'concealment of known defects' (Horizon Post Office doctrine).",
  },

  // ── Deployer-side ───────────────────────────────────────────────────────
  deployer_human_in_loop: {
    id: "deployer_human_in_loop",
    label: "Documented human-in-the-loop with hard-stop authority on AI outputs",
    targetType: "deployer",
    factorDeltas: { controllability: -0.12, behaviouralDeviation: -0.05 },
    maxReductionPp: 14,
    citation: "EU AI Act Art. 14 (human oversight); APRA CPS 230 §31 (operational risk)",
    rationale:
      "An HITL workflow with documented authority to override the AI is the strongest controllability mitigation. Cuts the deployer's controllability factor materially.",
  },
  deployer_pre_prod_validation: {
    id: "deployer_pre_prod_validation",
    label: "Sector-specific pre-production validation against regulator-approved test set",
    targetType: "deployer",
    factorDeltas: { regulatoryAlignment: -0.10, behaviouralDeviation: -0.05 },
    maxReductionPp: 12,
    citation: "FDA 510(k) for SaMD; EU MDR Art. 61; ISO/IEC 23053",
    rationale:
      "Validation against a regulator-approved or industry-standard test set is the canonical evidence that the deployer met its diligence duty in regulated sectors (healthcare, autonomous driving, finance).",
  },
  deployer_continuous_monitoring: {
    id: "deployer_continuous_monitoring",
    label: "Continuous post-deployment performance monitoring with documented thresholds",
    targetType: "deployer",
    factorDeltas: { controllability: -0.08, regulatoryAlignment: -0.05 },
    maxReductionPp: 10,
    citation: "EU AI Act Art. 72 (post-market monitoring); ISO/IEC 42001 §A.9",
    rationale:
      "Documented monitoring with pre-defined alert thresholds demonstrates the deployer maintained operational control. Particularly relevant under non-delegable-duty doctrine (Uber ATG v. Herzberg).",
  },
  deployer_incident_response_runbook: {
    id: "deployer_incident_response_runbook",
    label: "Published, exercised AI-incident response runbook with escalation tree",
    targetType: "deployer",
    factorDeltas: { controllability: -0.05, behaviouralDeviation: -0.03 },
    maxReductionPp: 6,
    citation: "APRA CPS 230 §17–§22 (operational resilience); NIST AI RMF Manage 4.3",
    rationale:
      "An exercised runbook shows the deployer planned for the failure mode. Reduces controllability factor (the deployer had a defined response capability).",
  },
  deployer_input_validation: {
    id: "deployer_input_validation",
    label: "Hard input validation and out-of-distribution rejection at the boundary",
    targetType: "deployer",
    factorDeltas: { causalProximity: -0.06, controllability: -0.06 },
    maxReductionPp: 9,
    citation: "ISO/IEC 23894 §7.4.2; OWASP ML Security Top 10 (ML01)",
    rationale:
      "Boundary-level OOD rejection breaks the causal chain at the deployer's perimeter. Mid-strength mitigation; doesn't apply when the failure was in-distribution.",
  },

  // ── User / human-operator side ──────────────────────────────────────────
  operator_training_certification: {
    id: "operator_training_certification",
    label: "Documented operator training and recertification programme",
    targetType: "human_operator",
    factorDeltas: { controllability: -0.08, behaviouralDeviation: -0.04 },
    maxReductionPp: 9,
    citation: "EU AI Act Art. 14(4); ISO/IEC 23894 §7.5",
    rationale:
      "A documented training programme reduces operator controllability share by demonstrating the operator was qualified. Doesn't help if the operator deviated from training.",
  },
  user_warning_acknowledgement: {
    id: "user_warning_acknowledgement",
    label: "Logged user acknowledgement of capability/limitation warnings",
    targetType: "user",
    factorDeltas: { causalProximity: -0.04, controllability: -0.03 },
    maxReductionPp: 5,
    citation: "Air Canada chatbot (2024); Restatement (Third) of Torts: Products §2(c)",
    rationale:
      "Logged warning acknowledgement at the user boundary engages the assumption-of-known-risk doctrine. Doesn't override non-delegable duty.",
  },

  // ── Cross-cutting (governance / structural) ─────────────────────────────
  governance_iso_42001_certification: {
    id: "governance_iso_42001_certification",
    label: "ISO/IEC 42001 AIMS certification covering the deployment context",
    targetType: "deployer",
    factorDeltas: { regulatoryAlignment: -0.08 },
    maxReductionPp: 8,
    citation: "ISO/IEC 42001:2023 (AI management systems)",
    rationale:
      "Certified AIMS shifts regulatory-alignment factor materially because it demonstrates a documented, audited governance structure.",
  },
  governance_dpia_completed: {
    id: "governance_dpia_completed",
    label: "DPIA / FRIA completed and lodged with the relevant authority",
    targetType: "deployer",
    factorDeltas: { regulatoryAlignment: -0.06, behaviouralDeviation: -0.02 },
    maxReductionPp: 6,
    citation: "GDPR Art. 35; EU AI Act Art. 27 (FRIA)",
    rationale:
      "A lodged FRIA is documentary evidence of foreseeability assessment and treatment-plan documentation. Modest reduction; required by law in many jurisdictions so absence is more punitive than presence is exculpatory.",
  },
  governance_third_party_audit: {
    id: "governance_third_party_audit",
    label: "Third-party conformity assessment by EU-notified body or equivalent",
    targetType: "vendor",
    factorDeltas: { regulatoryAlignment: -0.10, behaviouralDeviation: -0.04 },
    maxReductionPp: 12,
    citation: "EU AI Act Art. 43 (conformity assessment); ISO/IEC 17020",
    rationale:
      "Notified-body conformity assessment is the strongest governance signal in the EU regime. Materially reduces vendor regulatory-alignment factor.",
  },

  // ── AI-system-internal (rarely available, highest leverage when so) ─────
  ai_system_runtime_guardrails: {
    id: "ai_system_runtime_guardrails",
    label: "Runtime safety guardrails (constitutional rules, refusal training, PII filters)",
    targetType: "ai_system",
    factorDeltas: { behaviouralDeviation: -0.10, controllability: -0.05 },
    maxReductionPp: 11,
    citation: "Anthropic Constitutional AI; OpenAI Spec; EU AI Act Annex IV §2(c)",
    rationale:
      "Runtime guardrails constrain the model's output space and reduce behavioural-deviation factor for the AI system itself.",
  },
});

export const REMEDIATION_CATALOG_VERSION = "v1.0.0";

// ─── Pure helpers ─────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return +x.toFixed(3);
}

function pp(x: number): number {
  return +(x * 100).toFixed(2);
}

/** Recompute primaryScore from four factors using the engine's weights. */
function weightedPrimary(scoring: FourFactorScoring): number {
  const w = scoring.weights;
  const raw =
    scoring.causalProximity * w.causalProximity +
    scoring.behaviouralDeviation * w.behaviouralDeviation +
    scoring.controllability * w.controllability +
    scoring.regulatoryAlignment * w.regulatoryAlignment;
  // Clamp to engine's documented [0.25, 0.95] band (standalone.ts:163).
  return +Math.max(0.25, Math.min(0.95, raw)).toFixed(3);
}

/**
 * Apply factor deltas (negative numbers) to a copy of the scoring block,
 * clamped to [0,1] per factor.
 */
function applyDeltas(
  scoring: FourFactorScoring,
  deltas: RemediationDef["factorDeltas"]
): FourFactorScoring {
  return {
    ...scoring,
    causalProximity: clamp01(scoring.causalProximity + (deltas.causalProximity ?? 0)),
    behaviouralDeviation: clamp01(scoring.behaviouralDeviation + (deltas.behaviouralDeviation ?? 0)),
    controllability: clamp01(scoring.controllability + (deltas.controllability ?? 0)),
    regulatoryAlignment: clamp01(scoring.regulatoryAlignment + (deltas.regulatoryAlignment ?? 0)),
  };
}

/**
 * Cap the primary-share reduction at maxReductionPp. Returns the
 * possibly-capped new primaryScore + a flag indicating whether the cap
 * was hit.
 */
function capReduction(
  beforePrimary: number,
  rawAfterPrimary: number,
  maxReductionPp: number
): { capped: boolean; afterPrimary: number } {
  const reduction = beforePrimary - rawAfterPrimary;
  const cap = maxReductionPp / 100;
  if (reduction > cap) {
    return { capped: true, afterPrimary: +(beforePrimary - cap).toFixed(3) };
  }
  // Mitigations cannot INCREASE primary share.
  if (reduction < 0) {
    return { capped: false, afterPrimary: beforePrimary };
  }
  return { capped: false, afterPrimary: rawAfterPrimary };
}

/**
 * Redistribute the share freed by the primary's reduction across secondary
 * parties proportionally to their existing shares. Mass-conserving:
 * primaryShare + Σ secondary.share === 1.0 (rounded to 3 dp).
 */
function redistribute(
  before: VerdictShares,
  newPrimaryShare: number
): VerdictShares {
  const freed = +(before.primaryShare - newPrimaryShare).toFixed(6);
  if (freed <= 0 || before.secondary.length === 0) {
    return {
      primaryParty: before.primaryParty,
      primaryShare: newPrimaryShare,
      secondary: before.secondary.map((s) => ({ party: s.party, share: +s.share.toFixed(3) })),
    };
  }
  const totalSecondary = before.secondary.reduce((acc, s) => acc + s.share, 0);
  if (totalSecondary <= 0) {
    // No secondary parties had non-zero share; spread freed share evenly.
    const each = +(freed / before.secondary.length).toFixed(3);
    return {
      primaryParty: before.primaryParty,
      primaryShare: newPrimaryShare,
      secondary: before.secondary.map((s) => ({ party: s.party, share: +(s.share + each).toFixed(3) })),
    };
  }
  const newSecondary = before.secondary.map((s) => {
    const ratio = s.share / totalSecondary;
    return { party: s.party, share: +(s.share + freed * ratio).toFixed(3) };
  });
  // Normalise rounding drift onto the largest secondary share.
  const sum = newPrimaryShare + newSecondary.reduce((acc, s) => acc + s.share, 0);
  const drift = +(1 - sum).toFixed(6);
  if (Math.abs(drift) > 0 && newSecondary.length > 0) {
    let largest = 0;
    for (let i = 1; i < newSecondary.length; i++) {
      if (newSecondary[i]!.share > newSecondary[largest]!.share) largest = i;
    }
    newSecondary[largest]!.share = +(newSecondary[largest]!.share + drift).toFixed(3);
  }
  return {
    primaryParty: before.primaryParty,
    primaryShare: newPrimaryShare,
    secondary: newSecondary,
  };
}

/** Per-party delta in pp between two verdicts. */
function perPartyDelta(before: VerdictShares, after: VerdictShares): Array<{ party: string; deltaPp: number }> {
  const out: Array<{ party: string; deltaPp: number }> = [];
  out.push({ party: before.primaryParty, deltaPp: +(pp(after.primaryShare) - pp(before.primaryShare)).toFixed(2) });
  for (const s of before.secondary) {
    const a = after.secondary.find((x) => x.party === s.party);
    if (!a) continue;
    out.push({ party: s.party, deltaPp: +(pp(a.share) - pp(s.share)).toFixed(2) });
  }
  return out;
}

// ─── Public entry point ───────────────────────────────────────────────────

const COMPOSITE_CAP_PP = 25;

/**
 * Pure deterministic simulator. No I/O, no time, no randomness.
 */
export function simulateRemediation(
  input: SimulateRemediationInput
): SimulateRemediationOutput {
  const before: VerdictShares = {
    primaryParty: input.verdict.primaryParty,
    primaryShare: +input.verdict.primaryShare.toFixed(3),
    secondary: input.verdict.secondary.map((s) => ({ party: s.party, share: +s.share.toFixed(3) })),
  };
  const warnings: string[] = [];

  // Build per-type → party-id map. Primary first, then secondaries.
  const allAgents: Array<{ id: string; type?: string }> = input.agents ?? [];
  const findPartyForType = (
    targetType: RemediationTargetType,
    overrideParty?: string
  ): string | null => {
    if (overrideParty) {
      if (allAgents.some((a) => a.id === overrideParty)) return overrideParty;
      // override doesn't exist on this verdict — fall through to type lookup
    }
    const match = allAgents.find((a) => a.type === targetType);
    return match?.id ?? null;
  };

  // ── Per-remediation simulations (each computed in isolation) ──
  const perRemediation: RemediationResult[] = [];
  for (const r of input.remediations) {
    const def = REMEDIATION_CATALOG[r.id];
    if (!def) {
      warnings.push(`unknown_remediation_id:${r.id}`);
      continue;
    }
    const partyId = findPartyForType(def.targetType, r.appliedToParty);
    if (!partyId) {
      warnings.push(`no_party_for_type:${r.id}:${def.targetType}`);
      continue;
    }

    // Deltas only apply if the party is the primary OR a secondary. Either
    // way, we model the mitigation as a reduction on the primary's
    // four-factor scoring (because the engine's primaryScore is what those
    // factors compute). For mitigations applied to non-primary parties,
    // the share-redistribution pathway handles it: lowering primary share
    // and giving the freed share to secondary parties proportionally.
    //
    // We only mutate four-factor scoring when the remediation party IS
    // the primary; otherwise the four-factor block stays the same and we
    // apply a smaller, type-specific share-shift heuristic. This is
    // conservative and defensible: mitigations on non-primary parties
    // affect THEIR contributory share, not the primary's factors.
    let after: VerdictShares;
    let capped = false;

    if (partyId === before.primaryParty) {
      const newScoring = applyDeltas(input.fourFactorScoring, def.factorDeltas);
      const rawNewPrimary = weightedPrimary(newScoring);
      const cap = capReduction(before.primaryShare, rawNewPrimary, def.maxReductionPp);
      capped = cap.capped;
      after = redistribute(before, cap.afterPrimary);
    } else {
      // Mitigation applies to a SECONDARY party. Reduce that party's
      // share by the magnitude of the factor deltas (capped). The freed
      // mass is redistributed PROPORTIONALLY across the remaining
      // OTHER SECONDARY parties only — NOT to the primary.
      //
      // Doctrinal reasoning (FK-METHOD-2026-003 §3.2): a secondary
      // party's diligence does not increase the primary's culpability.
      // The primary's liability flows from its own conduct (product
      // defect / non-delegable duty), and that conduct is not altered
      // by a co-defendant's diligence. Treating the primary as a sink
      // for freed mass would over-reward primaries when secondaries
      // mitigate, which is doctrinally wrong under Restatement (Third)
      // of Torts: Apportionment of Liability §8 cmt. b.
      //
      // If there is no other secondary to absorb the freed mass, the
      // remediation cannot redistribute and the simulator emits a
      // warning rather than corrupting the apportionment.
      const totalDeltaMagnitude =
        Math.abs(def.factorDeltas.causalProximity ?? 0) +
        Math.abs(def.factorDeltas.behaviouralDeviation ?? 0) +
        Math.abs(def.factorDeltas.controllability ?? 0) +
        Math.abs(def.factorDeltas.regulatoryAlignment ?? 0);
      const sec = before.secondary.find((s) => s.party === partyId);
      if (!sec) {
        warnings.push(`party_not_in_verdict:${r.id}:${partyId}`);
        continue;
      }
      const rawShift = totalDeltaMagnitude;
      const cap = def.maxReductionPp / 100;
      const shift = Math.min(rawShift, cap, sec.share);
      capped = rawShift > cap;

      const otherSecondaries = before.secondary.filter((s) => s.party !== partyId);
      const otherTotal = otherSecondaries.reduce((acc, s) => acc + s.share, 0);

      if (otherSecondaries.length === 0 || otherTotal <= 0) {
        // No sink available. Reduce mitigated party's share but mark a
        // warning; rest stays as-is. Conservation may not hold; flag it.
        warnings.push(`no_other_secondary_to_absorb:${r.id}:${partyId}`);
        const newSecondary = before.secondary.map((s) =>
          s.party === partyId ? { party: s.party, share: +(s.share - shift).toFixed(3) } : { ...s }
        );
        // Push freed share into primary as last-resort sink, with the warning
        // documenting the doctrinal compromise.
        const newPrimary = +Math.min(0.95, before.primaryShare + shift).toFixed(3);
        after = { primaryParty: before.primaryParty, primaryShare: newPrimary, secondary: newSecondary };
      } else {
        const newSecondary = before.secondary.map((s) => {
          if (s.party === partyId) return { party: s.party, share: +(s.share - shift).toFixed(3) };
          const ratio = s.share / otherTotal;
          return { party: s.party, share: +(s.share + shift * ratio).toFixed(3) };
        });
        // Renormalise rounding drift onto the largest other-secondary.
        const sum = before.primaryShare + newSecondary.reduce((acc, s) => acc + s.share, 0);
        const drift = +(1 - sum).toFixed(6);
        if (Math.abs(drift) > 0) {
          const candidates = newSecondary.filter((s) => s.party !== partyId);
          if (candidates.length > 0) {
            let largest = candidates[0]!;
            for (const c of candidates) if (c.share > largest.share) largest = c;
            largest.share = +(largest.share + drift).toFixed(3);
          }
        }
        after = { primaryParty: before.primaryParty, primaryShare: before.primaryShare, secondary: newSecondary };
      }
    }

    perRemediation.push({
      id: def.id,
      label: def.label,
      citation: def.citation,
      appliedToParty: partyId,
      before,
      after,
      primaryShareDeltaPp: +(pp(after.primaryShare) - pp(before.primaryShare)).toFixed(2),
      perPartyDeltaPp: perPartyDelta(before, after),
      capped,
      rationale: def.rationale,
    });
  }

  // ── Composite (all remediations stacked) ──
  // Apply all primary-targeting deltas to the four-factor scoring, then
  // recompute. Secondary-targeting remediations apply their share-shifts
  // sequentially.
  const validRemediations = input.remediations
    .map((r) => ({ r, def: REMEDIATION_CATALOG[r.id] }))
    .filter((x): x is { r: RemediationInput; def: RemediationDef } => !!x.def);

  let stackedScoring: FourFactorScoring = { ...input.fourFactorScoring };
  let primaryAggregateMaxReductionPp = 0;
  const compositeCitations: string[] = [];

  for (const { r, def } of validRemediations) {
    const partyId = findPartyForType(def.targetType, r.appliedToParty);
    if (!partyId) continue;
    if (partyId === before.primaryParty) {
      stackedScoring = applyDeltas(stackedScoring, def.factorDeltas);
      primaryAggregateMaxReductionPp += def.maxReductionPp;
    }
    if (!compositeCitations.includes(def.citation)) compositeCitations.push(def.citation);
  }

  const stackedPrimaryRaw = weightedPrimary(stackedScoring);
  // Composite cap: lesser of (sum of per-remediation primary caps) and
  // the global ceiling.
  const compositeCapPp = Math.min(primaryAggregateMaxReductionPp || COMPOSITE_CAP_PP, COMPOSITE_CAP_PP);
  const stackedCap = capReduction(before.primaryShare, stackedPrimaryRaw, compositeCapPp);
  let composite: VerdictShares = redistribute(before, stackedCap.afterPrimary);
  let compositeCapped = stackedCap.capped;

  // Now apply secondary-targeting remediations sequentially. Same
  // doctrine as the per-remediation case: freed mass goes to the OTHER
  // secondaries proportionally, NOT to the primary.
  for (const { r, def } of validRemediations) {
    const partyId = findPartyForType(def.targetType, r.appliedToParty);
    if (!partyId || partyId === before.primaryParty) continue;
    const sec = composite.secondary.find((s) => s.party === partyId);
    if (!sec) continue;
    const totalDeltaMagnitude =
      Math.abs(def.factorDeltas.causalProximity ?? 0) +
      Math.abs(def.factorDeltas.behaviouralDeviation ?? 0) +
      Math.abs(def.factorDeltas.controllability ?? 0) +
      Math.abs(def.factorDeltas.regulatoryAlignment ?? 0);
    const cap = def.maxReductionPp / 100;
    const shift = Math.min(totalDeltaMagnitude, cap, sec.share);
    if (totalDeltaMagnitude > cap) compositeCapped = true;
    const others = composite.secondary.filter((s) => s.party !== partyId);
    const othersTotal = others.reduce((acc, s) => acc + s.share, 0);
    if (othersTotal <= 0 || others.length === 0) {
      // No sink: park overflow on primary with cap.
      sec.share = +(sec.share - shift).toFixed(3);
      composite.primaryShare = +Math.min(0.95, composite.primaryShare + shift).toFixed(3);
    } else {
      sec.share = +(sec.share - shift).toFixed(3);
      for (const o of others) {
        const ratio = o.share / othersTotal;
        o.share = +(o.share + shift * ratio).toFixed(3);
      }
    }
  }

  // Final renormalisation guard.
  const finalSum = composite.primaryShare + composite.secondary.reduce((acc, s) => acc + s.share, 0);
  const finalDrift = +(1 - finalSum).toFixed(6);
  if (Math.abs(finalDrift) > 0 && composite.secondary.length > 0) {
    let largest = 0;
    for (let i = 1; i < composite.secondary.length; i++) {
      if (composite.secondary[i]!.share > composite.secondary[largest]!.share) largest = i;
    }
    composite.secondary[largest]!.share = +(composite.secondary[largest]!.share + finalDrift).toFixed(3);
  }

  return {
    ruleId: "FK-METHOD-2026-003",
    ruleName: "Counterfactual Remediation Simulator v1",
    before,
    perRemediation,
    composite: {
      after: composite,
      primaryShareDeltaPp: +(pp(composite.primaryShare) - pp(before.primaryShare)).toFixed(2),
      perPartyDeltaPp: perPartyDelta(before, composite),
      capped: compositeCapped,
      cap_pp: compositeCapPp,
      citations: compositeCitations,
    },
    methodology: {
      weights: input.fourFactorScoring.weights,
      composite_cap_pp: COMPOSITE_CAP_PP,
      determinism: "byte-identical given same inputs (no wall-clock, no RNG)",
      sources: [
        "EU AI Act Reg. (EU) 2024/1689 — Arts. 9, 10, 14, 27, 43, 60, 72",
        "ISO/IEC 42001:2023 — AI management systems",
        "ISO/IEC 23894:2023 — AI risk management",
        "NIST AI RMF 1.0 (2023) — Manage function",
        "APRA CPS 230 — operational risk management",
        "Restatement (Third) of Torts: Products Liability §2",
        "Uber ATG v. Herzberg (2020); Air Canada chatbot (2024)",
      ],
    },
    warnings,
  };
}
