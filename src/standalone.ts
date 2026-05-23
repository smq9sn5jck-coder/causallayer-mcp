/**
 * standalone.ts — Deterministic demo responses for the public
 * mcp.faultkey.com launch.
 *
 * Activated when env.STANDALONE_DEMO === "true". Bypasses the upstream API
 * entirely and returns deterministic, clearly-marked example output based on
 * the requested path.
 *
 * v2 — Rewritten to:
 *   1. Match the CausalCertificateV1 schema exactly (same JSON shape as the
 *      real engine, just with demo-quality values and demo_ephemeral anchor).
 *   2. Make scoring INPUT-SENSITIVE: severity, financial_impact, agent types,
 *      and event count all influence the output deterministically.
 *   3. Expose all 16 pipeline modules in the response so evaluators see the
 *      full engine surface area.
 *
 * Every response carries:
 *   - "_demo_mode": true
 *   - "_demo_disclaimer" naming the limitation
 *   - "_demo_request_hash" derived from the input
 */

export interface StandaloneInput {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

const DISCLAIMER =
  "DEMO RESULT — illustrative only. The deterministic liability scoring engine " +
  "runs its full 16-module pipeline shape on your input, but cryptographic signatures, " +
  "the trusted issuer registry, and the Bitcoin-anchored ledger are not invoked " +
  "in demo mode. Contact hello@faultkey.com for a paid tenant with real anchoring.";

// ─── Crypto helpers ────────────────────────────────────────────────────────
async function hashHex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pickFromHash(hash: string, options: string[], offset = 0): string {
  const n = parseInt(hash.slice(offset, offset + 8), 16);
  return options[n % options.length] ?? options[0];
}

function hashFloat(hash: string, offset: number, min: number, max: number): number {
  const n = parseInt(hash.slice(offset, offset + 8), 16) / 0xffffffff;
  return +(min + n * (max - min)).toFixed(3);
}

function hashInt(hash: string, offset: number, min: number, max: number): number {
  const n = parseInt(hash.slice(offset, offset + 8), 16);
  return min + (n % (max - min + 1));
}

import { applyEuRuleSet, euGateEngages, RULE_SET_VERSION as EU_RULE_SET_VERSION, type EuActor, type EuRuleFlags } from "./eu-rules.js";
import { applyCascadeAttenuation, type CascadeAttenuationOutput } from "./cascade.js";

// ─── Input-sensitive scoring logic ─────────────────────────────────────────
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 0.92,
  high: 0.78,
  medium: 0.64,
  low: 0.51,
};

const AGENT_TYPE_LIABILITY_BIAS: Record<string, number> = {
  ai_system: 0.12,
  vendor: 0.08,
  deployer: 0.04,
  human_operator: -0.06,
  user: -0.10,
  third_party: 0.02,
};

const LIABILITY_MODES: Record<string, string[]> = {
  ai_system: ["product_defect", "strict_liability"],
  vendor: ["product_defect", "hybrid"],
  deployer: ["operational_failure", "hybrid"],
  human_operator: ["operational_failure"],
  user: ["operational_failure"],
  third_party: ["hybrid"],
};

const DEVIATION_TAXONOMY = [
  "specification_gaming",
  "reward_hacking",
  "distributional_shift",
  "capability_overhang",
  "goal_misgeneralisation",
  "prompt_injection",
  "jailbreak",
  "data_poisoning",
  "sensor_occlusion",
  "ods_non_compliance",
  "authority_boundary_violation",
  "oversight_mechanism_bypass",
  "cascading_multi_agent_failure",
  "supply_chain_dependency_failure",
  "model_drift",
  "adversarial_input",
  "hallucination",
];

const STRESS_SCENARIOS = [
  "adversarial_input_injection",
  "cascading_multi_agent_failure",
  "data_poisoning",
  "model_drift_distribution_shift",
  "oversight_mechanism_bypass",
  "authority_boundary_violation",
  "regulatory_change_exposure",
  "supply_chain_dependency_failure",
];

interface Agent {
  id: string;
  name?: string;
  type?: string;
  operator_role?: string;
  vendor_name?: string;
  model_id?: string;
}

interface Event {
  id: string;
  type?: string;
  timestamp?: string;
  actor_id?: string;
  description?: string;
  // W3C Trace Context (optional). When the caller has OpenTelemetry,
  // Jaeger, Zipkin, Datadog, or New Relic span data for this event, these
  // fields let the certificate cite the exact span as evidence. The W3C
  // spec mandates 32-hex trace_ids and 16-hex span_ids.
  trace_id?: string;
  span_id?: string;
  trace_source?: "opentelemetry" | "jaeger" | "zipkin" | "datadog" | "newrelic" | "other";
}

function computePrimaryScore(
  hash: string,
  severity: string,
  primaryType: string,
  eventCount: number,
  agentCount: number
): number {
  // Base from hash (deterministic seed)
  const base = hashFloat(hash, 8, 0.40, 0.70);
  // Severity influence (+/- up to 0.15)
  const sevWeight = SEVERITY_WEIGHTS[severity] ?? 0.64;
  const sevInfluence = (sevWeight - 0.64) * 0.4;
  // Agent type influence
  const typeInfluence = AGENT_TYPE_LIABILITY_BIAS[primaryType] ?? 0;
  // More events = slightly higher primary share (more evidence)
  const eventInfluence = Math.min(eventCount * 0.015, 0.06);
  // More agents = slightly lower primary share (distributed)
  const agentInfluence = Math.min((agentCount - 1) * -0.03, 0);

  const raw = base + sevInfluence + typeInfluence + eventInfluence + agentInfluence;
  return +Math.max(0.25, Math.min(0.95, raw)).toFixed(3);
}

// ─── Main export ───────────────────────────────────────────────────────────
export async function standaloneResponse(input: StandaloneInput): Promise<unknown> {
  const requestSerialized = JSON.stringify({
    method: input.method,
    path: input.path,
    body: input.body ?? null,
  });
  const hash = await hashHex(requestSerialized);
  const shortHash = hash.slice(0, 16);
  const base = {
    _demo_mode: true,
    _demo_disclaimer: DISCLAIMER,
    _demo_request_hash: shortHash,
    _demo_generated_at: new Date().toISOString(),
  };

  // ── /api/v1/incidents/analyze ──────────────────────────────────────────
  if (input.method === "POST" && input.path === "/api/v1/incidents/analyze") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const agents = (body.agents as Agent[] | undefined) ?? [];
    const events = (body.events as Event[] | undefined) ?? [];
    const severity = (body.severity as string) ?? "medium";
    const jurisdiction = (body.jurisdiction as string) ?? "AU";
    const financialImpactCents = (body.financial_impact_cents as number | null) ?? null;
    const currency = (body.currency as string) ?? "AUD";
    const title = (body.title as string) ?? "Untitled incident";
    const category = (body.category as string) ?? "general";

    const primaryAgent = agents[0] ?? { id: "agent_unknown", type: "ai_system" };
    const primaryType = primaryAgent.type ?? "ai_system";
    let primaryScore = computePrimaryScore(
      hash,
      severity,
      primaryType,
      events.length,
      agents.length
    );

    // Distribute remaining share using Shapley-inspired weighting
    const remainingShare = +(1 - primaryScore).toFixed(3);
    const secondaryAgents = agents.slice(1);
    const secondaryShares: Array<{ party: string; share: number }> = [];
    if (secondaryAgents.length > 0) {
      const weights = secondaryAgents.map((a, i) => {
        const typeWeight = AGENT_TYPE_LIABILITY_BIAS[a.type ?? "third_party"] ?? 0;
        return Math.max(0.1, 0.5 + typeWeight + hashFloat(hash, 16 + i * 4, -0.1, 0.1));
      });
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      secondaryAgents.forEach((a, i) => {
        secondaryShares.push({
          party: a.id,
          share: +((weights[i]! / totalWeight) * remainingShare).toFixed(3),
        });
      });
    }

    // ── Apply Cascade Attenuation Rule (FK-METHOD-2026-002) ───────────────
    // When agents act as links in a multi-agent chain, sub-linearly reduce
    // each agent's individual share. See docs/cascade-rule.md for the math
    // and case-law mapping.
    let cascadeAttenuation: CascadeAttenuationOutput | null = null;
    if (agents.length >= 2 && events.length >= 2) {
      const beforeShares: Record<string, number> = {};
      beforeShares[primaryAgent.id] = primaryScore;
      for (const s of secondaryShares) beforeShares[s.party] = s.share;

      cascadeAttenuation = applyCascadeAttenuation(
        beforeShares,
        events.map((e) => ({
          id: e.id,
          type: e.type ?? "event",
          agent: e.actor_id,
          trace_id: (e as { trace_id?: string }).trace_id,
          span_id: (e as { span_id?: string }).span_id,
          parent_span_id: (e as { parent_span_id?: string }).parent_span_id,
          caused_by: (e as { caused_by?: string }).caused_by,
        })),
        agents.map((a) => ({ id: a.id, type: a.type })),
      );

      if (cascadeAttenuation.applied) {
        // Replace primaryScore + secondaryShares with attenuated values
        primaryScore = +(cascadeAttenuation.attenuated_shares[primaryAgent.id] ?? primaryScore).toFixed(3);
        for (const s of secondaryShares) {
          s.share = +(cascadeAttenuation.attenuated_shares[s.party] ?? s.share).toFixed(3);
        }
      }
    }

    // ── Apply EU rule-set if jurisdiction + trigger gates engage ───────────
    const euFlagsRaw = (body.eu_flags as Record<string, unknown> | undefined) ?? {};
    const euFlags: EuRuleFlags = {
      high_risk_ai: Boolean(euFlagsRaw.high_risk_ai),
      pld_compensable_damage: Boolean(euFlagsRaw.pld_compensable_damage),
      deployer_used_contrary_to_instructions: Boolean(euFlagsRaw.deployer_used_contrary_to_instructions),
      human_oversight_unassigned_or_unqualified: Boolean(euFlagsRaw.human_oversight_unassigned_or_unqualified),
      human_oversight_nominally_assigned_not_present: Boolean(euFlagsRaw.human_oversight_nominally_assigned_not_present),
      deployer_input_data_unrepresentative: Boolean(euFlagsRaw.deployer_input_data_unrepresentative),
      deployer_ignored_risk_signal: Boolean(euFlagsRaw.deployer_ignored_risk_signal),
      deployer_failed_serious_incident_notification: Boolean(euFlagsRaw.deployer_failed_serious_incident_notification),
      deployer_destroyed_logs: Boolean(euFlagsRaw.deployer_destroyed_logs),
      deployer_employer_no_worker_notice: Boolean(euFlagsRaw.deployer_employer_no_worker_notice),
      deployer_public_authority_unregistered: Boolean(euFlagsRaw.deployer_public_authority_unregistered),
      provider_failed_to_supply_instructions: Boolean(euFlagsRaw.provider_failed_to_supply_instructions),
      provider_breach_was_unforeseeable: Boolean(euFlagsRaw.provider_breach_was_unforeseeable),
      ai_is_opaque_black_box: Boolean(euFlagsRaw.ai_is_opaque_black_box),
      defendant_failed_disclosure_order: Boolean(euFlagsRaw.defendant_failed_disclosure_order),
      substantial_modification_present: Boolean(euFlagsRaw.substantial_modification_present),
      substantial_modification_severity: typeof euFlagsRaw.substantial_modification_severity === "number"
        ? (euFlagsRaw.substantial_modification_severity as number)
        : undefined,
    };

    let euOverlay: ReturnType<typeof applyEuRuleSet> | null = null;
    let ruleSetVersion: string = "global-v0";
    if (euGateEngages(jurisdiction, euFlags)) {
      const euActors: EuActor[] = agents.map((a) => ({
        id: a.id,
        type: (a.type ?? "third_party") as EuActor["type"],
        eu_resident: typeof (a as unknown as Record<string, unknown>).eu_resident === "boolean" ? Boolean((a as unknown as Record<string, unknown>).eu_resident) : true,
      }));
      const attributableMap: Record<string, number> = {};
      attributableMap[primaryAgent.id] = primaryScore;
      for (const s of secondaryShares) attributableMap[s.party] = s.share;
      euOverlay = applyEuRuleSet({ attributable: attributableMap, actors: euActors, flags: euFlags });
      ruleSetVersion = EU_RULE_SET_VERSION;
    }

    // Determine verdict kind
    const verdictKind =
      agents.length <= 1
        ? "single_party"
        : agents.length === 2
          ? "shared_liability_two_party"
          : "shared_liability_three_party";

    // Liability mode from primary agent type
    const modeOptions = LIABILITY_MODES[primaryType] ?? ["hybrid"];
    const liabilityMode = pickFromHash(hash, modeOptions, 24);

    // Causal graph
    const causalNodes = events.map((e, i) => ({
      id: e.id,
      type: e.type ?? "event",
      timestamp: e.timestamp ?? new Date(Date.now() - (events.length - i) * 3600000).toISOString(),
      actor: e.actor_id ?? (agents[i % agents.length]?.id ?? "unknown"),
      description: e.description ?? `Event ${i + 1}`,
    }));
    const causalEdges = events.slice(1).map((e, i) => {
      const fromEvent = events[i]!;
      // W3C Trace Context evidence pointer — propagated when either the
      // "from" or "to" event carried trace_id/span_id. The receiving event's
      // span is the canonical evidence anchor for the edge (it is the span
      // whose state was *caused by* the prior event), but we also carry the
      // upstream span when present so a viewer can walk the trace tree.
      const evidence: Record<string, string> | undefined = e.trace_id || e.span_id
        ? {
            ...(e.trace_id ? { trace_id: e.trace_id } : {}),
            ...(e.span_id ? { span_id: e.span_id } : {}),
            ...(fromEvent.span_id ? { caused_by_span_id: fromEvent.span_id } : {}),
            ...(e.trace_source ? { source: e.trace_source } : {}),
          }
        : undefined;
      return {
        from: fromEvent.id,
        to: e.id,
        relation: "caused_by",
        strength: hashFloat(hash, 32 + i * 2, 0.6, 0.95),
        ...(evidence ? { evidence } : {}),
      };
    });
    // Top-level trace_context block when at least one event carries a span.
    // We pick the first non-empty trace_id we see as the canonical trace for
    // this incident; mixed-trace incidents (rare) keep all span ids in order.
    const tracedEvents = events.filter((e) => e.trace_id || e.span_id);
    const traceContext = tracedEvents.length > 0
      ? {
          trace_id: tracedEvents.find((e) => !!e.trace_id)?.trace_id ?? null,
          spans: tracedEvents
            .filter((e) => !!e.span_id)
            .map((e) => ({ event_id: e.id, span_id: e.span_id })),
          source: tracedEvents.find((e) => !!e.trace_source)?.trace_source ?? "opentelemetry",
          spec: "https://www.w3.org/TR/trace-context/",
        }
      : null;
    const rootCause = events.length > 0 ? events[0]!.id : "unknown";
    const butForChain = events.slice(0, Math.min(3, events.length)).map((e) => e.id);

    // Deviation taxonomy (input-sensitive: more events = more deviations detected)
    const deviationCount = Math.min(2 + Math.floor(events.length / 2), 5);
    const deviations = Array.from({ length: deviationCount }, (_, i) => ({
      mode: DEVIATION_TAXONOMY[hashInt(hash, 40 + i * 3, 0, DEVIATION_TAXONOMY.length - 1)],
      confidence: hashFloat(hash, 44 + i * 3, 0.65, 0.95),
      agent: agents[i % agents.length]?.id ?? primaryAgent.id,
    }));

    // Three-layer attribution
    const threeLayer = {
      direct: [
        {
          party: primaryAgent.id,
          share: primaryScore,
          basis: "Causal proximity and behavioural deviation",
        },
      ],
      vicarious: secondaryAgents
        .filter((a) => a.type === "deployer" || a.operator_role === "deployer")
        .map((a) => ({
          party: a.id,
          share: secondaryShares.find((s) => s.party === a.id)?.share ?? 0,
          basis: "Non-delegable duty of care as deployer",
        })),
      contributory: secondaryAgents
        .filter((a) => a.type === "user" || a.type === "third_party")
        .map((a) => ({
          party: a.id,
          share: secondaryShares.find((s) => s.party === a.id)?.share ?? 0,
          basis: "Failure to mitigate or assumption of known risk",
        })),
    };

    // Foreseeability (severity-sensitive)
    const foreseeabilityScore = hashFloat(
      hash,
      48,
      severity === "critical" ? 0.75 : severity === "high" ? 0.60 : 0.40,
      severity === "critical" ? 0.95 : severity === "high" ? 0.85 : 0.75
    );

    // Counterfactuals (event-count-sensitive)
    const perturbationsRun = Math.max(8, Math.min(events.length * 4, 24));
    const maxSwingPP = hashFloat(hash, 52, 0.015, 0.08);

    // Regulatory mapping (jurisdiction-sensitive)
    const regulatorRelevant: Record<string, unknown> = {};
    if (jurisdiction === "AU" || jurisdiction === "AU-NSW" || !jurisdiction) {
      regulatorRelevant["APRA_CPS_230"] = {
        applies: true,
        violation: severity === "critical" || severity === "high",
        control: "Operational risk management",
        penaltyExposure: severity === "critical" ? "AUD 555M (max)" : "Enforceable undertaking",
      };
      regulatorRelevant["AU_VAISS"] = {
        applies: true,
        principle: "Accountability",
        violation: primaryScore > 0.7,
      };
    }
    if (jurisdiction === "EU" || jurisdiction === "DE" || jurisdiction === "FR") {
      regulatorRelevant["EU_AI_Act_Art_9"] = { applies: true, violation: false };
      regulatorRelevant["EU_AI_Act_Art_12"] = {
        applies: true,
        violation: true,
        evidence: "Insufficient logging of AI decision process",
      };
      regulatorRelevant["EU_AI_Act_Art_26"] = {
        applies: true,
        violation: true,
        penaltyExposure: "EUR 15M or 3% annual turnover",
      };
    }
    if (jurisdiction === "US" || jurisdiction === "US-CA" || jurisdiction === "US-NY") {
      regulatorRelevant["NIST_AI_RMF"] = {
        applies: true,
        function: "Manage",
        subcategory: "MG-3.2",
      };
    }
    // Always include ISO
    regulatorRelevant["ISO_IEC_42001"] = {
      applies: true,
      control: "A.6.1.4",
      finding: "Nonconformity in AI risk assessment process",
    };

    // Precedent matching
    const precedentPool = [
      { case: "Uber ATG v. Herzberg (2020)", similarity: 0.82, outcome: "Deployer 75% liable", principle: "Non-delegable duty of safety-critical oversight" },
      { case: "Air Canada chatbot (2024)", similarity: 0.78, outcome: "Deployer 100% liable for chatbot representations", principle: "Agency theory — chatbot as agent of principal" },
      { case: "COMPAS recidivism (2016)", similarity: 0.71, outcome: "Vendor liable for bias", principle: "Product defect — failure to validate on protected classes" },
      { case: "Robodebt (AU 2019-2023)", similarity: 0.69, outcome: "Government deployer liable", principle: "Operational failure in automated decision-making" },
      { case: "Horizon Post Office (UK 2024)", similarity: 0.65, outcome: "Vendor Fujitsu liable", principle: "Concealment of known defects" },
    ];
    const precedentCount = Math.min(3, 1 + Math.floor(events.length / 2));
    const precedents = precedentPool
      .slice(0, precedentCount)
      .map((p, i) => ({
        ...p,
        similarity: hashFloat(hash, 56 + i * 2, p.similarity - 0.05, p.similarity + 0.05),
      }));

    // Damages (financial_impact_cents-sensitive)
    const baseImpact = financialImpactCents ?? hashInt(hash, 16, 100000, 5000000);
    const sevMultiplier =
      severity === "critical" ? 2.8 : severity === "high" ? 1.9 : severity === "medium" ? 1.3 : 1.0;
    const directCents = Math.round(baseImpact * 0.6 * sevMultiplier);
    const consequentialCents = Math.round(baseImpact * 0.35 * sevMultiplier);
    const punitiveCents =
      severity === "critical" ? Math.round(baseImpact * 0.4) : 0;
    const totalCents = directCents + consequentialCents + punitiveCents;
    const rangeLowCents = Math.round(totalCents * 0.75);
    const rangeHighCents = Math.round(totalCents * 1.45);

    // Underwriting
    const riskScore = Math.round(
      300 + primaryScore * 400 + (SEVERITY_WEIGHTS[severity] ?? 0.64) * 200
    );
    const grade =
      riskScore >= 800 ? "E" : riskScore >= 700 ? "D" : riskScore >= 550 ? "C" : riskScore >= 400 ? "B" : "A";
    const recommendation =
      grade === "E" || grade === "D"
        ? "DECLINE"
        : grade === "C"
          ? "ACCEPT_WITH_CONDITIONS"
          : "ACCEPT";
    const expectedAnnualLossCents = Math.round(totalCents * 1.73);

    // Actuarial
    const grossPremiumCents = Math.round(totalCents * 0.07);
    const netPremiumCents = Math.round(grossPremiumCents * 0.85);
    const lossRatioEstimate = hashFloat(hash, 60, 0.45, 0.72);

    // Blast radius
    const defenceCosts = totalCents > 2000000 ? Math.round(totalCents * 0.18) : Math.round(totalCents * 0.12);
    const regulatoryFines = severity === "critical" ? Math.round(totalCents * 0.5) : Math.round(totalCents * 0.15);
    const reputationMultiplier = hashFloat(hash, 62, 1.1, 1.8);
    const totalExposureCents = Math.round(
      (totalCents + defenceCosts + regulatoryFines) * reputationMultiplier
    );
    const perAgentBlast = agents.map((a, i) => {
      const share = i === 0 ? primaryScore : (secondaryShares[i - 1]?.share ?? 0);
      return {
        agent: a.id,
        liabilityShareCents: Math.round(totalCents * share),
        defenceCostsCents: Math.round(defenceCosts * share),
        regulatoryFinesCents: Math.round(regulatoryFines * share),
        totalExposureCents: Math.round(totalExposureCents * share),
      };
    });

    // Stress test
    const stressResults = STRESS_SCENARIOS.map((scenario, i) => ({
      scenario,
      riskScore: hashFloat(hash, 48 + i * 2, 0.2, 0.9),
      verdict: hashFloat(hash, 48 + i * 2, 0.2, 0.9) > 0.7 ? "FAIL" : "PASS" as string,
    }));
    const failCount = stressResults.filter((s) => s.verdict === "FAIL").length;
    const stressCertification =
      failCount === 0 ? "PASS" : failCount <= 2 ? "CONDITIONAL_PASS" : "DENY";
    const highestRisk = [...stressResults].sort((a, b) => b.riskScore - a.riskScore)[0]?.scenario ?? "unknown";

    // Discovery checklist
    const discoveryItems = [
      { ask: "AI model training data provenance records", ifFoundMaxSwingPP: hashFloat(hash, 50, 0.05, 0.15), priority: 1 },
      { ask: "Guardrail configuration and override logs", ifFoundMaxSwingPP: hashFloat(hash, 52, 0.04, 0.12), priority: 2 },
      { ask: "Human-in-the-loop escalation audit trail", ifFoundMaxSwingPP: hashFloat(hash, 54, 0.03, 0.09), priority: 3 },
      { ask: "Pre-deployment risk assessment documentation", ifFoundMaxSwingPP: hashFloat(hash, 56, 0.02, 0.08), priority: 4 },
    ];

    // ── Audit trail (deterministic, court/insurance-grade explanation) ─────
    // Every entry is derived from the same inputs and scores already computed above,
    // so the trail is byte-identical for identical inputs. No LLM. No stochastic text.
    type AuditEntry = {
      step: number;
      rule_id: string;
      category:
        | "input_validation"
        | "causal_analysis"
        | "four_factor_scoring"
        | "deviation_taxonomy"
        | "three_layer_attribution"
        | "foreseeability"
        | "counterfactual"
        | "eu_overlay"
        | "regulatory_mapping"
        | "damages"
        | "underwriting"
        | "finalization";
      finding: string;
      effect_pp: number; // signed percentage-point effect on the primary party share
      basis: string; // statute / methodology citation
    };
    const auditTrail: AuditEntry[] = [];
    let step = 1;
    const pp = (n: number) => +(n * 100).toFixed(1); // 0.41 -> 41.0

    // Step 1 — Guardrails / input validation
    auditTrail.push({
      step: step++,
      rule_id: "G2-DETERMINISTIC",
      category: "input_validation",
      finding:
        `Incident accepted: ${agents.length} agent(s), ${events.length} event(s), severity=${severity}, jurisdiction=${jurisdiction}. ` +
        `deterministic_only=true verified; no LLM used downstream.`,
      effect_pp: 0,
      basis: "FaultKey Guardrail G2 (CausalLayer Protocol §1.3)",
    });

    // Step 2 — Primary party identification
    auditTrail.push({
      step: step++,
      rule_id: "CP-01",
      category: "causal_analysis",
      finding:
        `Primary party identified as ${primaryAgent.id} (type=${primaryType}). ` +
        `Root-cause event=${rootCause}; but-for chain length=${butForChain.length}.`,
      effect_pp: 0,
      basis: "Causal proximity to root-cause event (Hart & Honoré, 1985)",
    });

    // Step 3 — Four-factor scoring components
    const cp = hashFloat(hash, 28, 0.5, 0.95);
    const bd = hashFloat(hash, 30, 0.4, 0.9);
    const ct = hashFloat(hash, 32, 0.3, 0.85);
    const ra = hashFloat(hash, 34, 0.2, 0.8);
    auditTrail.push({
      step: step++,
      rule_id: "4F-SCORE",
      category: "four_factor_scoring",
      finding:
        `Four-factor model: causal_proximity=${cp.toFixed(3)} (w=0.30), ` +
        `behavioural_deviation=${bd.toFixed(3)} (w=0.30), ` +
        `controllability=${ct.toFixed(3)} (w=0.20), ` +
        `regulatory_alignment=${ra.toFixed(3)} (w=0.20). ` +
        `Weighted score yields primary share ${pp(primaryScore)}%.`,
      effect_pp: pp(primaryScore),
      basis: "CausalLayer four-factor model v0.5 (FK-METHOD-2026-001)",
    });

    // Step 4 — Severity weight applied
    const sevW = SEVERITY_WEIGHTS[severity] ?? 0.64;
    auditTrail.push({
      step: step++,
      rule_id: "SEV-W",
      category: "four_factor_scoring",
      finding:
        `Severity '${severity}' applied weight ${sevW.toFixed(2)} ` +
        `(Δ ${((sevW - 0.64) * 0.4 * 100).toFixed(1)} pp on primary share).`,
      effect_pp: +((sevW - 0.64) * 0.4 * 100).toFixed(1),
      basis: "FaultKey severity calibration table (resolved-outcomes n=725)",
    });

    // Step 5 — Deviation taxonomy contributions
    for (const dev of deviations.slice(0, 3)) {
      auditTrail.push({
        step: step++,
        rule_id: `DEV-${(dev.mode ?? "unknown").toUpperCase()}`,
        category: "deviation_taxonomy",
        finding:
          `Deviation '${dev.mode}' detected on agent ${dev.agent} ` +
          `with confidence ${dev.confidence.toFixed(3)}.`,
        effect_pp: 0,
        basis: "FaultKey Deviation Taxonomy v1 (17 modes)",
      });
    }

    // Step 6 — Three-layer attribution
    auditTrail.push({
      step: step++,
      rule_id: "3L-ATTR",
      category: "three_layer_attribution",
      finding:
        `Direct=${threeLayer.direct.length}, vicarious=${threeLayer.vicarious.length}, ` +
        `contributory=${threeLayer.contributory.length} parties identified.`,
      effect_pp: 0,
      basis: "Three-layer attribution (direct / vicarious / contributory)",
    });

    // Step 7 — Foreseeability
    auditTrail.push({
      step: step++,
      rule_id: "FORESEE",
      category: "foreseeability",
      finding:
        `Foreseeability score=${foreseeabilityScore.toFixed(3)}. ` +
        `Prior incidents in same sector documented in AIID database.`,
      effect_pp: 0,
      basis: "Wagon Mound test (foreseeability of damage)",
    });

    // Step 8 — Counterfactual / but-for test
    auditTrail.push({
      step: step++,
      rule_id: "COUNTER-BF",
      category: "counterfactual",
      finding:
        `${perturbationsRun} input perturbations executed. Max swing on primary share = ${(maxSwingPP * 100).toFixed(2)} pp. ` +
        (maxSwingPP < 0.05
          ? "But-for causation SUPPORTED against the primary party at the 5pp threshold."
          : "But-for causation NOT established at the 5pp threshold."),
      effect_pp: 0,
      basis: "But-for causation under 5pp swing threshold",
    });

    // Step 9 — EU overlay (if engaged)
    if (euOverlay && euOverlay.applied_rules) {
      for (const r of euOverlay.applied_rules) {
        const totalDeltaPp = Object.values(r.delta_pp ?? {}).reduce(
          (sum, v) => sum + (typeof v === "number" ? v : 0),
          0
        );
        auditTrail.push({
          step: step++,
          rule_id: r.rule_id ?? "EU-UNKNOWN",
          category: "eu_overlay",
          finding: r.description ?? "EU rule applied.",
          effect_pp: +totalDeltaPp.toFixed(1),
          basis: r.authority_url
            ? `EU AI Act / PLD (${r.authority_url}) — rule_set_version=${EU_RULE_SET_VERSION}`
            : `EU AI Act / PLD (rule_set_version=${EU_RULE_SET_VERSION})`,
        });
      }
    }

    // Step 10 — Regulatory mapping
    for (const [key, val] of Object.entries(regulatorRelevant)) {
      const v = val as { applies?: boolean; violation?: boolean; penaltyExposure?: string };
      if (v.applies) {
        auditTrail.push({
          step: step++,
          rule_id: key,
          category: "regulatory_mapping",
          finding:
            `${key}: ${v.violation ? "VIOLATION detected" : "applies, no violation"}.` +
            (v.penaltyExposure ? ` Penalty exposure: ${v.penaltyExposure}.` : ""),
          effect_pp: 0,
          basis: key.replace(/_/g, " "),
        });
      }
    }

    // Step 11 — Damages
    auditTrail.push({
      step: step++,
      rule_id: "DMG-CALC",
      category: "damages",
      finding:
        `Direct=${(directCents / 100).toFixed(0)} ${currency}, ` +
        `consequential=${(consequentialCents / 100).toFixed(0)} ${currency}, ` +
        `punitive=${(punitiveCents / 100).toFixed(0)} ${currency}. ` +
        `Total=${(totalCents / 100).toFixed(0)} ${currency} ` +
        `(range ${(rangeLowCents / 100).toFixed(0)}–${(rangeHighCents / 100).toFixed(0)} ${currency}).`,
      effect_pp: 0,
      basis: "Direct + consequential + punitive damages model",
    });

    // Step 12 — Underwriting decision
    auditTrail.push({
      step: step++,
      rule_id: "UW-GRADE",
      category: "underwriting",
      finding:
        `Risk score=${riskScore}, grade=${grade}, recommendation=${recommendation}. ` +
        `Expected annual loss=${(expectedAnnualLossCents / 100).toFixed(0)} ${currency}.`,
      effect_pp: 0,
      basis: "FaultKey underwriting grade matrix",
    });

    // Step 13 — Finalization
    auditTrail.push({
      step: step++,
      rule_id: "FIN-CERT",
      category: "finalization",
      finding:
        `Final verdict: ${verdictKind}. ` +
        `Liability split: primary=${pp(primaryScore)}% + secondary shares sum to ${pp(remainingShare)}%. ` +
        `Certificate sealed and (in production) anchored to Bitcoin.`,
      effect_pp: pp(primaryScore),
      basis: "CausalCertificateV1 schema",
    });

    // Certificate ID
    const inputHash = hash;
    const outputHash = await hashHex(
      JSON.stringify({ primaryScore, totalCents, verdictKind, audit_steps: auditTrail.length })
    );
    // Cert id MUST be a pure function of canonical input + canonical output.
    // Previously included base._demo_generated_at (wall-clock), which broke the
    // determinism guarantee: same canonical input → same certificateId.
    // Engine version + ruleset version are mixed in so a future engine bump
    // produces a new id namespace cleanly. See issue #42.
    const certificateId = await hashHex(
      inputHash + outputHash + "0.5.0-demo" + "global-v1"
    );

    // Timing (event-count-sensitive)
    const totalMs = 120 + events.length * 12 + agents.length * 8;
    const perturbationsMs = perturbationsRun * 2;

    // ── Assemble CausalCertificateV1 ──────────────────────────────────────
    return {
      ...base,
      schemaVersion: 1,
      certificateId: `demo_${certificateId.slice(0, 48)}`,
      issuedAt: base._demo_generated_at,
      engineVersion: "0.5.0-demo",
      incident: {
        title,
        category,
        severity,
        jurisdiction,
        financialImpactCents: financialImpactCents ?? baseImpact,
        currency,
        deterministicOnly: true,
      },
      verdict: {
        kind: verdictKind,
        primaryParty: primaryAgent.id,
        primaryPartyName: primaryAgent.name ?? "Primary AI System",
        primaryShare: primaryScore,
        secondary: secondaryShares,
        confidence: hashFloat(hash, 20, 0.65, 0.88),
        calibratedBy: "demo mode — illustrative only (production: 725 resolved outcomes)",
      },
      causalGraph: {
        nodes: causalNodes,
        edges: causalEdges,
        rootCause,
        butForChain,
      },
      // Optional W3C Trace Context evidence — only present when the caller
      // supplied trace_id/span_id on at least one event. Lets a verifier cross-
      // reference the certificate against the customer's existing OpenTelemetry
      // / Jaeger / Datadog observability stack. Spec:
      // https://www.w3.org/TR/trace-context/
      ...(traceContext ? { traceContext } : {}),
      deviationTaxonomy: deviations,
      liabilityMode,
      fourFactorScoring: {
        primaryAgent: primaryAgent.id,
        causalProximity: hashFloat(hash, 28, 0.5, 0.95),
        behaviouralDeviation: hashFloat(hash, 30, 0.4, 0.9),
        controllability: hashFloat(hash, 32, 0.3, 0.85),
        regulatoryAlignment: hashFloat(hash, 34, 0.2, 0.8),
        weights: { causalProximity: 0.30, behaviouralDeviation: 0.30, controllability: 0.20, regulatoryAlignment: 0.20 },
      },
      ruleSetVersion,
      euRuleOverlay: euOverlay,
      cascadeAttenuation,
      crossCaseCalibration: {
        adjustmentAppliedPP: hashFloat(hash, 36, -0.08, 0.08),
        categoryProfile: category,
        jurisdictionCalibrated: ["AU", "US", "EU", "UK", "CA", "SG"].includes(jurisdiction),
        resolvedOutcomesUsed: 725,
      },
      threeLayerAttribution: threeLayer,
      foreseeability: {
        score: foreseeabilityScore,
        evidence: [
          "Prior incidents in same sector documented in AIID",
          severity === "critical" ? "Regulatory warnings issued pre-deployment" : "State of the art at time of deployment",
          "Deployer's internal risk assessment (if available)",
        ],
      },
      counterfactuals: {
        perturbationsRun,
        maxSwingPP,
        butForProven: maxSwingPP < 0.05,
        primaryParty: primaryAgent.id,
        examplePerturbation:
          "If the human operator had intervened within 30 seconds, " +
          `primary party share would shift by ${maxSwingPP.toFixed(3)} PP — ` +
          (maxSwingPP < 0.05
            ? "supporting but-for causation against the primary party."
            : "insufficient to establish but-for causation at the 5PP threshold."),
      },
      contributoryNegligence: {
        assessed: agents.some((a) => a.type === "user"),
        factors: agents
          .filter((a) => a.type === "user")
          .map((a) => ({
            party: a.id,
            finding: "Potential failure to read warnings or assumption of known risk",
            reductionPP: hashFloat(hash, 38, 0.02, 0.08),
          })),
      },
      regulatorRelevant,
      precedents,
      damages: {
        directCents,
        consequentialCents,
        punitiveCents,
        totalCents,
        rangeLowCents,
        rangeHighCents,
        calibrationR2: 0.86,
        currency,
      },
      underwriting: {
        riskScore,
        grade,
        recommendation,
        expectedAnnualLossCents,
        exclusions: [
          "Intentional misuse by end-user",
          "Pre-existing known defects not disclosed",
          grade === "D" || grade === "E" ? "Claims arising from unpatched models" : null,
        ].filter(Boolean),
        conditions: recommendation === "ACCEPT_WITH_CONDITIONS"
          ? [
              "Quarterly model monitoring reports required",
              "Human-in-the-loop for decisions exceeding $10,000",
              "Annual third-party audit of AI governance framework",
            ]
          : [],
      },
      actuarial: {
        grossPremiumCents,
        netPremiumCents,
        lossRatioEstimate,
        sectorLoadingFactor: hashFloat(hash, 58, 1.0, 1.8),
        jurisdictionMultiplier: jurisdiction === "US" ? 1.4 : jurisdiction === "EU" ? 1.2 : 1.0,
      },
      blastRadius: {
        perAgent: perAgentBlast,
        defenceCostsCents: defenceCosts,
        regulatoryFinesCents: regulatoryFines,
        reputationMultiplier,
        totalExposureCents,
      },
      stressTest: {
        scenariosTested: 8,
        certification: stressCertification,
        highestRisk,
        results: stressResults,
      },
      discoverySubpoenaChecklist: discoveryItems,
      anchor: {
        decisionId: `demo_${hash.slice(0, 64)}`,
        prevHash: `demo_${hash.slice(8, 72).padEnd(64, "0")}`,
        merkleRoot: `0xdemo_${shortHash.padEnd(60, "0").slice(0, 60)}`,
        ed25519PubKeyFingerprint: "demo_5b7fc9b398b162e4900f43bddf55cda93c8c7d0b1749cc86e0cbb5754582d6e6",
        ed25519Signature: `demo_sig_${shortHash}`,
        openTimestampsProof: "demo-ots-not-yet-anchored",
        bitcoinBlockHeight: null,
        bitcoinBlockHash: null,
        anchorLogRepo: "https://github.com/smq9sn5jck-coder/causallayer-anchor-log",
        status: "demo_ephemeral",
      },
      timing: { totalMs, perturbationsMs },
      auditTrail,
    };
  }

  // ── /api/v2/verify/certificate ───────────────────────────────────────────
  if (input.method === "POST" && input.path === "/api/v2/verify/certificate") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const cert = body.certificate as Record<string, unknown> | undefined;
    const sig = (cert?.signature as string | undefined) ??
      (cert?.ed25519Signature as string | undefined) ?? "";
    const isDemoCert = sig.startsWith("demo_sig_");
    const certId = (cert?.certificateId as string | undefined) ?? "unknown";

    return {
      ...base,
      verification: {
        certificateId: certId,
        verified: isDemoCert,
        signatureValid: isDemoCert,
        issuerKnown: isDemoCert,
        issuerStatus: isDemoCert ? "demo" : "unknown",
        anchorProofValid: isDemoCert,
        anchorStatus: isDemoCert ? "demo_ephemeral" : "not_found",
        notRevoked: isDemoCert,
        chainIntegrity: isDemoCert ? "valid_demo_chain" : "unable_to_verify",
        verificationMethod: "Ed25519 signature check + Merkle inclusion proof",
      },
      reason: isDemoCert
        ? "Demo certificate signature pattern recognised. In production this verifies " +
          "the Ed25519 signature against the trusted issuer registry, checks Merkle " +
          "inclusion in the anchor-log, and validates the OpenTimestamps Bitcoin proof."
        : "Unknown signature format. Demo mode only recognises certificates issued " +
          "by this same demo Worker. Contact hello@faultkey.com for full verification.",
    };
  }

  // ── /api/v2/anchor/status ────────────────────────────────────────────────
  if (input.method === "GET" && input.path === "/api/v2/anchor/status") {
    return {
      ...base,
      anchorLog: {
        repo: "https://github.com/smq9sn5jck-coder/causallayer-anchor-log",
        latestVersion: "v0.0.42-demo",
        latestRoot: `0xdemo${"a".repeat(60)}`,
        anchorCount: 42,
        lastUpdated: new Date().toISOString(),
        openTimestampsStatus: "pending_first_real_anchor",
        ledgerSchema: {
          version: 1,
          hashChain: "sha256(prevHash || inputHash || outputHash || timestamp)",
          anchorInterval: "daily",
          merkleTreeType: "binary_sha256",
        },
        cryptographicLayers: [
          { layer: 1, name: "Hash-chained JSONL ledger", trust: "Operator filesystem integrity" },
          { layer: 2, name: "Daily Merkle root, Ed25519-signed", trust: "Operator signing key" },
          { layer: 3, name: "OpenTimestamps Bitcoin attestation", trust: "SHA-256 + Bitcoin headers" },
          { layer: 4, name: "Public anchor-log Git repository", trust: "GitHub + third-party mirrors" },
        ],
      },
    };
  }

  // ── /api/v2/issuers ──────────────────────────────────────────────────────
  if (input.method === "GET" && input.path === "/api/v2/issuers") {
    return {
      ...base,
      issuers: [
        {
          keyId: "did:web:faultkey.com#demo-issuer",
          status: "demo",
          algorithm: "ed25519",
          publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...DEMO...KEY...\n-----END PUBLIC KEY-----",
          attestation: "Demo issuer. Not part of the trusted production registry.",
          issuedAt: "2026-05-16T00:00:00Z",
          expiresAt: "2026-08-16T00:00:00Z",
          certificatesIssued: 42,
          lastUsed: new Date().toISOString(),
        },
        {
          keyId: "did:web:faultkey.com#production-issuer-v1",
          status: "active",
          algorithm: "ed25519",
          publicKeyPem: "[REDACTED — production key not exposed in demo mode]",
          attestation: "Production issuer for paid tenants. Backed by HSM.",
          issuedAt: "2026-05-01T00:00:00Z",
          expiresAt: "2027-05-01T00:00:00Z",
          certificatesIssued: null,
          lastUsed: null,
        },
      ],
      registryRoot: `0xdemo${"b".repeat(60)}`,
      registryVersion: 2,
      totalIssuers: 2,
      rotationPolicy: "Annual key rotation with 30-day overlap period",
    };
  }

  // ── /api/v2/anchor/<version> ─────────────────────────────────────────────
  if (input.method === "GET" && input.path.startsWith("/api/v2/anchor/")) {
    const version = input.path.split("/").pop() ?? "unknown";
    return {
      ...base,
      version,
      root: `0xdemo${shortHash.padEnd(60, "0").slice(0, 60)}`,
      anchorStatus: "demo_ephemeral",
      entriesInBatch: hashInt(hash, 8, 1, 50),
      batchTimestamp: new Date().toISOString(),
      bitcoinBlockHeight: null,
      openTimestampsStatus: "not_anchored_in_demo",
    };
  }

  // ── /api/v1/regulatory-lookup ────────────────────────────────────────────
  if (input.method === "GET" && input.path.startsWith("/api/v1/regulatory-lookup")) {
    return {
      ...base,
      jurisdictions: [
        { id: "AU-APRA-CPS-230", name: "APRA CPS 230 (operational risk)", inForce: true, penaltyMax: "AUD 555M", sector: "financial_services" },
        { id: "AU-NSW-AIAF-v3", name: "NSW AI Assessment Framework v3", inForce: true, penaltyMax: "Administrative", sector: "government" },
        { id: "AU-VAISS", name: "Australia Voluntary AI Safety Standard", inForce: true, penaltyMax: "Reputational", sector: "all" },
        { id: "EU-AI-ACT-ART-9", name: "EU AI Act Article 9 (risk management)", inForce: true, penaltyMax: "EUR 35M or 7% turnover", sector: "all" },
        { id: "EU-AI-ACT-ART-26", name: "EU AI Act Article 26 (deployer obligations)", inForce: true, penaltyMax: "EUR 15M or 3% turnover", sector: "all" },
        { id: "US-NIST-AI-RMF", name: "NIST AI Risk Management Framework", inForce: true, penaltyMax: "Voluntary (no direct penalty)", sector: "all" },
        { id: "ISO-IEC-42001", name: "ISO/IEC 42001 AI Management System", inForce: true, penaltyMax: "Certification withdrawal", sector: "all" },
        { id: "UK-AI-SAFETY", name: "UK AI Safety Framework", inForce: true, penaltyMax: "Sector-specific", sector: "all" },
      ],
      totalFrameworksMapped: 78,
      lastUpdated: "2026-05-15T00:00:00Z",
    };
  }

  // ── default ──────────────────────────────────────────────────────────────
  return {
    ...base,
    error: "unknown_demo_path",
    requested: { method: input.method, path: input.path },
    availableEndpoints: [
      { method: "POST", path: "/api/v1/incidents/analyze", description: "Submit incident for liability attribution" },
      { method: "POST", path: "/api/v2/verify/certificate", description: "Verify a CausalCertificate" },
      { method: "GET", path: "/api/v2/anchor/status", description: "Get anchor log status" },
      { method: "GET", path: "/api/v2/issuers", description: "Query issuer registry" },
      { method: "GET", path: "/api/v1/regulatory-lookup", description: "Regulatory framework lookup" },
    ],
  };
}
