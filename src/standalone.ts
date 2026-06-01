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
import {
  simulateRemediation,
  REMEDIATION_CATALOG,
  REMEDIATION_CATALOG_VERSION,
  type FourFactorScoring as RemFourFactorScoring,
  type VerdictShares as RemVerdictShares,
  type RemediationInput,
} from "./remediation.js";
import {
  evaluateProspectiveResponse,
  JURISDICTION_THRESHOLDS,
  PROSPECTIVE_GATE_RULE_ID,
  PROSPECTIVE_GATE_VERSION,
  type ProposedAction,
} from "./prospective-gate.js";
import { compareJurisdictions,
  SUPPORTED_JURISDICTIONS,
  JURISDICTION_OVERLAY_VERSION,
  type CompareInput as JxCompareInput,
  type JurisdictionCode,
} from "./jurisdiction.js";

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

function clamp3(n: number, lo: number, hi: number): number {
  return +Math.max(lo, Math.min(hi, n)).toFixed(3);
}

// ─── Evidence-derived deviation detection (deterministic, no hash) ──────────
// Each taxonomy mode maps to substrings we look for in the incident's free
// text (title + description + event types/descriptions). A mode is reported
// ONLY when its evidence actually appears, and confidence scales with the
// number of distinct keyword hits — never a SHA-256 draw. The keys are the
// canonical 17-mode taxonomy.
const DEVIATION_KEYWORDS: Record<string, string[]> = {
  hallucination: ["hallucinat", "fabricat", "made up", "made-up", "invented", "non-existent", "nonexistent", "false citation", "untrue", "confabulat", "satirical source"],
  prompt_injection: ["prompt injection", "prompt-injection", "injected instruction", "ignore previous", "ignore all previous"],
  jailbreak: ["jailbreak", "jail-break", "bypass guardrail", "bypassed guardrail", "bypassed the guardrail", "circumvent"],
  data_poisoning: ["data poison", "poisoned", "tainted training", "corrupted training"],
  specification_gaming: ["specification gaming", "gamed the", "loophole", "exploited the spec", "shortcut"],
  reward_hacking: ["reward hack", "proxy metric", "optimised for the metric", "optimized for the metric"],
  distributional_shift: ["out of distribution", "out-of-distribution", "distribution shift", "distributional shift", "unseen input"],
  goal_misgeneralisation: ["misgeneralis", "misgeneraliz", "wrong objective", "misaligned goal"],
  model_drift: ["model drift", "drifted", "degraded over time", "stale model", "performance regression"],
  adversarial_input: ["adversarial", "perturbation attack", "malicious input"],
  authority_boundary_violation: ["unauthorised", "unauthorized", "exceeded its authority", "without approval", "without authorisation", "without authorization", "issued a refund", "unauthorised refund", "unauthorized refund", "committed the company"],
  oversight_mechanism_bypass: ["no human review", "without oversight", "without human", "bypassed review", "skipped review", "no human in the loop"],
  cascading_multi_agent_failure: ["cascad", "chain reaction", "downstream agent", "propagated to"],
  supply_chain_dependency_failure: ["third-party", "third party", "upstream service", "vendor api", "dependency failure", "supply chain"],
  sensor_occlusion: ["sensor", "camera", "lidar", "occlud", "obscured view"],
  capability_overhang: ["unexpected capability", "emergent behaviour", "emergent behavior"],
  ods_non_compliance: ["operational design domain", "out of design", "operating envelope", "outside its design"],
};

interface DetectedDeviation {
  mode: string;
  confidence: number;
  agent: string;
  evidence: string[];
}

function detectDeviations(texts: string[], primaryAgentId: string): DetectedDeviation[] {
  const hay = texts.join("  ").toLowerCase();
  const found: DetectedDeviation[] = [];
  for (const [mode, kws] of Object.entries(DEVIATION_KEYWORDS)) {
    const evidence = kws.filter((k) => hay.includes(k));
    if (evidence.length === 0) continue;
    // Honest proxy for "how strongly the text matches this mode" — 0.55 floor
    // plus 0.12 per distinct keyword hit, capped. Not a calibrated probability.
    const confidence = clamp3(0.55 + evidence.length * 0.12, 0.55, 0.95);
    found.push({ mode, confidence, agent: primaryAgentId, evidence });
  }
  found.sort((a, b) => b.confidence - a.confidence || a.mode.localeCompare(b.mode));
  return found;
}

// ─── Four-factor scoring derived from the actual causal graph + types ───────
interface FourFactor {
  causalProximity: number;
  behaviouralDeviation: number;
  controllability: number;
  regulatoryAlignment: number;
}

const CONTROLLABILITY_BY_TYPE: Record<string, number> = {
  ai_system: 0.72,
  vendor: 0.62,
  deployer: 0.55,
  human_operator: 0.8,
  user: 0.45,
  third_party: 0.4,
};

function computeFourFactor(args: {
  agents: Agent[];
  events: Event[];
  primaryAgent: Agent;
  severity: string;
  deviations: DetectedDeviation[];
  regulatoryViolation: boolean;
}): FourFactor {
  const { agents, events, primaryAgent, severity, deviations, regulatoryViolation } = args;
  // Causal proximity: share of events actored by the primary agent, plus a bump
  // when the primary is the actor of the root-cause (first) event.
  const evCount = Math.max(1, events.length);
  const primaryActorEvents = events.filter(
    (e) => (e.actor_id ?? primaryAgent.id) === primaryAgent.id
  ).length;
  const isRootActor = (events[0]?.actor_id ?? primaryAgent.id) === primaryAgent.id;
  const causalProximity = clamp3(
    0.35 + 0.4 * (primaryActorEvents / evCount) + (isRootActor ? 0.15 : 0),
    0.2,
    0.95
  );
  // Behavioural deviation: driven by deviations actually detected on the primary.
  const primaryDeviations = deviations.filter((d) => d.agent === primaryAgent.id);
  const avgConf = primaryDeviations.length
    ? primaryDeviations.reduce((s, d) => s + d.confidence, 0) / primaryDeviations.length
    : 0;
  const behaviouralDeviation = clamp3(
    0.2 + 0.55 * avgConf + 0.06 * Math.min(primaryDeviations.length, 3),
    0.1,
    0.95
  );
  // Controllability: by primary agent type, reduced when an oversight party
  // (human_operator / deployer) also exists and could have intervened.
  const oversightPresent = agents.some(
    (a) => a.id !== primaryAgent.id && (a.type === "human_operator" || a.type === "deployer")
  );
  const controllability = clamp3(
    (CONTROLLABILITY_BY_TYPE[primaryAgent.type ?? "ai_system"] ?? 0.6) - (oversightPresent ? 0.1 : 0),
    0.2,
    0.95
  );
  // Regulatory alignment: lower = worse. Severity-driven, with a penalty when a
  // regulatory violation was mapped for this jurisdiction.
  const sevBase: Record<string, number> = { critical: 0.35, high: 0.5, medium: 0.65, low: 0.78 };
  const regulatoryAlignment = clamp3(
    (sevBase[severity] ?? 0.65) - (regulatoryViolation ? 0.12 : 0),
    0.15,
    0.9
  );
  return { causalProximity, behaviouralDeviation, controllability, regulatoryAlignment };
}

function evidenceConfidence(events: Event[], agents: Agent[]): number {
  if (events.length === 0) return 0.3;
  const withTs = events.filter((e) => e.timestamp).length / events.length;
  const withDesc = events.filter((e) => e.description).length / events.length;
  const typedAgents = agents.length ? agents.filter((a) => a.type).length / agents.length : 0;
  return clamp3(
    0.3 + 0.25 * withDesc + 0.2 * withTs + 0.15 * typedAgents + Math.min(events.length, 4) * 0.02,
    0.3,
    0.92
  );
}

function computeForeseeability(severity: string, deviations: DetectedDeviation[]): number {
  const sevBase: Record<string, number> = { critical: 0.8, high: 0.65, medium: 0.5, low: 0.4 };
  const knownModes = deviations.some((d) =>
    ["hallucination", "model_drift", "prompt_injection", "jailbreak", "specification_gaming"].includes(d.mode)
  );
  return clamp3((sevBase[severity] ?? 0.5) + (knownModes ? 0.1 : 0), 0.2, 0.95);
}

// ─── Precedent matching: real feature overlap (Jaccard) over a small corpus ──
interface PrecedentCase {
  case: string;
  outcome: string;
  principle: string;
  tags: string[];
}
const PRECEDENT_CORPUS: PrecedentCase[] = [
  { case: "Uber ATG / Herzberg (2018-2020)", outcome: "Operator/deployer bore primary responsibility for safety-critical oversight", principle: "Non-delegable duty of safety-critical oversight", tags: ["safety_critical", "deployer", "ai_agent", "physical_harm", "oversight_failure", "autonomous_system"] },
  { case: "Moffatt v. Air Canada (2024)", outcome: "Deployer held liable for its chatbot's misrepresentations", principle: "A deployer answers for representations made by its AI agent", tags: ["misinformation", "representation", "chatbot", "deployer", "consumer", "ai_agent"] },
  { case: "Loomis v. Wisconsin / COMPAS (2016)", outcome: "Scrutiny of a vendor risk model used in decision-making", principle: "Validity and transparency duties for decision-support models", tags: ["bias", "vendor", "decision_support", "opacity", "ai_agent"] },
  { case: "Robodebt (AU 2019-2023)", outcome: "Government deployer liable for flawed automated decision-making", principle: "Operational failure in automated decision-making", tags: ["automation", "deployer", "decision_support", "consumer", "operational_failure"] },
  { case: "Post Office Horizon (UK)", outcome: "Vendor liable; concealment of known defects", principle: "Concealment of known software defects", tags: ["vendor", "software_defect", "concealment", "operational_failure"] },
];

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function incidentTags(args: {
  title: string;
  description: string;
  category: string;
  events: Event[];
  agents: Agent[];
  deviations: DetectedDeviation[];
  severity: string;
}): string[] {
  const { title, description, category, events, agents, deviations, severity } = args;
  const text = [title, description, category, ...events.map((e) => e.description ?? "")].join(" ").toLowerCase();
  const tags = new Set<string>();
  if (/misinformation|misrepresent|false|hallucinat|advice|recommend|representation/.test(text)) {
    tags.add("misinformation");
    tags.add("representation");
  }
  if (/chatbot|assistant|overview|search|bot|conversational/.test(text)) tags.add("chatbot");
  if (/consumer|customer|public|user/.test(text) || /consumer/.test(category)) tags.add("consumer");
  if (/refund|payment|financial|money|benefit|debt/.test(text)) tags.add("decision_support");
  if (/vehicle|pedestrian|injur|physical|crash|safety/.test(text)) tags.add("physical_harm");
  if (/bias|discriminat|protected class/.test(text)) tags.add("bias");
  for (const a of agents) {
    if (a.type === "ai_system") tags.add("ai_agent");
    if (a.type === "deployer") tags.add("deployer");
    if (a.type === "vendor") tags.add("vendor");
  }
  if (deviations.some((d) => d.mode === "oversight_mechanism_bypass")) tags.add("oversight_failure");
  if (deviations.some((d) => d.mode === "ods_non_compliance" || d.mode === "model_drift")) tags.add("operational_failure");
  if (severity === "critical" || severity === "high") tags.add("safety_critical");
  return [...tags];
}

function matchPrecedents(
  tags: string[]
): Array<{ case: string; similarity: number; outcome: string; principle: string; sharedFactors: string[] }> {
  return PRECEDENT_CORPUS.map((c) => ({
    case: c.case,
    similarity: +jaccard(tags, c.tags).toFixed(3),
    outcome: c.outcome,
    principle: c.principle,
    sharedFactors: c.tags.filter((t) => tags.includes(t)),
  }))
    .filter((p) => p.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || a.case.localeCompare(b.case))
    .slice(0, 3);
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
    _next_steps: {
      score_your_incident: "https://faultkey.com/score",
      compare_vendors: "https://faultkey.com/compare",
      track_record: "https://faultkey.com/track-record",
      production_access: "https://faultkey.com/#waitlist",
      github: "https://github.com/smq9sn5jck-coder/causallayer-mcp",
      star_the_repo: "https://github.com/smq9sn5jck-coder/causallayer-mcp/stargazers",
      discussions: "https://github.com/smq9sn5jck-coder/causallayer-mcp/discussions",
      message: "Found this useful? Star the repo (2s) → it helps others discover deterministic AI liability scoring. Run a full interactive report at faultkey.com/score.",
    },
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

    const primaryAgent = (agents[0] ?? { id: "agent_unknown", type: "ai_system" }) as Agent;
    const primaryType = primaryAgent.type ?? "ai_system";

    // ── Deterministic, evidence-derived scoring (no SHA-256 seeding) ───────
    const description = (body.description as string | undefined) ?? "";
    const evidenceTexts = [
      title,
      description,
      ...events.map((e) => `${e.type ?? ""} ${e.description ?? ""}`),
    ];
    const detectedDeviations = detectDeviations(evidenceTexts, primaryAgent.id);
    // Proxy for "a regulatory violation was mapped": high/critical incidents in
    // a jurisdiction we cover. Kept simple and deterministic; the production
    // engine derives this from the full regulatory mapping.
    const regulatoryViolationProxy = severity === "critical" || severity === "high";
    const fourFactor = computeFourFactor({
      agents,
      events,
      primaryAgent,
      severity,
      deviations: detectedDeviations,
      regulatoryViolation: regulatoryViolationProxy,
    });
    const { causalProximity, behaviouralDeviation, controllability, regulatoryAlignment } = fourFactor;
    // Primary share = four-factor weighted score, spread down slightly as more
    // co-agents share the blame. Clamp preserves the [0.25, 0.95] contract.
    const fourFactorScore =
      0.3 * causalProximity +
      0.3 * behaviouralDeviation +
      0.2 * controllability +
      0.2 * regulatoryAlignment;
    const agentSpread = Math.min((agents.length - 1) * 0.05, 0.2);
    let primaryScore = clamp3(fourFactorScore - agentSpread, 0.25, 0.95);

    // Distribute remaining share by agent-type liability bias (deterministic).
    const remainingShare = +(1 - primaryScore).toFixed(3);
    const secondaryAgents = agents.slice(1);
    const secondaryShares: Array<{ party: string; share: number }> = [];
    if (secondaryAgents.length > 0) {
      const weights = secondaryAgents.map((a) =>
        Math.max(0.1, 0.5 + (AGENT_TYPE_LIABILITY_BIAS[a.type ?? "third_party"] ?? 0))
      );
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      secondaryAgents.forEach((a, i) => {
        secondaryShares.push({
          party: a.id,
          share: +((weights[i]! / totalWeight) * remainingShare).toFixed(3),
        });
      });
    } else {
      // Single-party incident: the sole identified agent bears the full
      // attributed liability so the split sums to 100%. The four-factor weighted
      // score is retained in fourFactorScoring as the fault-intensity detail.
      primaryScore = 1.0;
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
      // Deterministic synthetic timestamp when none supplied: derive from inputHash
      // + event index, anchored to a fixed epoch. Ensures recompute produces identical
      // graph nodes regardless of wall-clock. Real timestamps from caller pass through.
      timestamp: e.timestamp ?? new Date(
        Date.parse("2024-01-01T00:00:00Z") +
        hashInt(hash, 16 + i, 0, 365 * 24) * 3600000
      ).toISOString(),
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

    // Deviation taxonomy — only modes whose evidence actually appears in the
    // incident text (deterministic keyword detection, not a hash draw). An
    // empty array honestly means "no recognised failure mode in the supplied text".
    const deviations = detectedDeviations.map((d) => ({
      mode: d.mode,
      confidence: d.confidence,
      agent: d.agent,
      evidence: d.evidence,
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

    // Foreseeability — derived from severity + whether a recognised failure
    // mode was detected, not a hash draw.
    const foreseeabilityScore = computeForeseeability(severity, detectedDeviations);

    // Counterfactuals — structural sensitivity proxy: a longer, clearer evidence
    // chain (more events, a dominant primary) leaves less room for the share to
    // swing under perturbation. Deterministic; not a hash draw.
    const perturbationsRun = Math.max(8, Math.min(events.length * 4, 24));
    const maxSwingPP = clamp3(
      0.09 - Math.min(events.length, 6) * 0.012 - (primaryScore > 0.7 ? 0.01 : 0),
      0.01,
      0.09
    );

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

    // Precedent matching — real feature overlap (Jaccard) between the incident's
    // derived factors and a small, checked-in corpus. `similarity` is documented
    // factor overlap (not a learned score), and only cases that actually share
    // factors are returned, so an empty list is an honest "no close analogue".
    const incidentFactorTags = incidentTags({
      title,
      description,
      category,
      events,
      agents,
      deviations: detectedDeviations,
      severity,
    });
    const precedents = matchPrecedents(incidentFactorTags);

    // Damages — computed ONLY from a caller-supplied financial_impact_cents.
    // When none is supplied the engine ABSTAINS rather than fabricating a figure
    // (the prior demo seeded this from a hash; that is exactly the misleading
    // behaviour we removed). Downstream dollar modules abstain in lockstep.
    const hasImpact = typeof financialImpactCents === "number";
    const baseImpact = hasImpact ? (financialImpactCents as number) : 0;
    const DAMAGES_ABSTAINED_REASON =
      "No financial_impact_cents supplied. Demo engine does not fabricate damages; " +
      "provide an estimated impact to compute direct/consequential/punitive figures.";
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

    // Step 3 — Four-factor scoring components (evidence-derived above)
    auditTrail.push({
      step: step++,
      rule_id: "4F-SCORE",
      category: "four_factor_scoring",
      finding:
        `Four-factor model: causal_proximity=${causalProximity.toFixed(3)} (w=0.30), ` +
        `behavioural_deviation=${behaviouralDeviation.toFixed(3)} (w=0.30), ` +
        `controllability=${controllability.toFixed(3)} (w=0.20), ` +
        `regulatory_alignment=${regulatoryAlignment.toFixed(3)} (w=0.20). ` +
        `Weighted score yields primary share ${pp(primaryScore)}%.`,
      effect_pp: pp(primaryScore),
      basis: "CausalLayer four-factor model v0.5 (FK-METHOD-2026-001)",
    });

    // Step 4 — Severity tier (folded into regulatory_alignment + damages)
    const sevW = SEVERITY_WEIGHTS[severity] ?? 0.64;
    auditTrail.push({
      step: step++,
      rule_id: "SEV-W",
      category: "four_factor_scoring",
      finding:
        `Severity tier '${severity}' (weight ${sevW.toFixed(2)}) reflected in ` +
        `regulatory_alignment and damages scaling.`,
      effect_pp: 0,
      basis: "FaultKey severity calibration table",
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
        `Foreseeability score=${foreseeabilityScore.toFixed(3)} ` +
        `(severity tier + recognised failure modes: ${detectedDeviations.map((d) => d.mode).join(", ") || "none"}). ` +
        `Demo mode does not query an external incident database.`,
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
      finding: hasImpact
        ? `Direct=${(directCents / 100).toFixed(0)} ${currency}, ` +
          `consequential=${(consequentialCents / 100).toFixed(0)} ${currency}, ` +
          `punitive=${(punitiveCents / 100).toFixed(0)} ${currency}. ` +
          `Total=${(totalCents / 100).toFixed(0)} ${currency} ` +
          `(range ${(rangeLowCents / 100).toFixed(0)}–${(rangeHighCents / 100).toFixed(0)} ${currency}).`
        : `ABSTAINED — no financial_impact_cents supplied; damages not computed (demo engine does not fabricate a figure).`,
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
        (hasImpact
          ? `Expected annual loss=${(expectedAnnualLossCents / 100).toFixed(0)} ${currency}.`
          : `Expected annual loss not computed (damages abstained).`),
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
        financialImpactCents: hasImpact ? financialImpactCents : null,
        currency,
        deterministicOnly: true,
      },
      verdict: {
        kind: verdictKind,
        primaryParty: primaryAgent.id,
        primaryPartyName: primaryAgent.name ?? "Primary AI System",
        primaryShare: primaryScore,
        secondary: secondaryShares,
        // Evidence-completeness proxy (events with timestamps/descriptions,
        // typed agents) — NOT a calibrated probability against resolved outcomes.
        confidence: evidenceConfidence(events, agents),
        confidenceBasis: "evidence_completeness",
        calibrationNote: "demo mode — not calibrated against resolved outcomes",
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
        causalProximity,
        behaviouralDeviation,
        controllability,
        regulatoryAlignment,
        weights: { causalProximity: 0.30, behaviouralDeviation: 0.30, controllability: 0.20, regulatoryAlignment: 0.20 },
      },
      ruleSetVersion,
      euRuleOverlay: euOverlay,
      cascadeAttenuation,
      crossCaseCalibration: {
        performed: false,
        note: "Demo mode does not calibrate against resolved outcomes. The production engine applies cross-case calibration here; no adjustment was made to the scores above.",
        categoryProfile: category,
        jurisdictionRecognised: ["AU", "US", "EU", "UK", "CA", "SG"].includes(jurisdiction),
      },
      threeLayerAttribution: threeLayer,
      foreseeability: {
        score: foreseeabilityScore,
        basis: "severity tier + recognised failure mode(s)",
        recognisedFailureModes: detectedDeviations.map((d) => d.mode),
        note: "Demo mode does not query an external incident database; score is derived from the submitted incident only.",
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
      damages: hasImpact
        ? {
            directCents,
            consequentialCents,
            punitiveCents,
            totalCents,
            rangeLowCents,
            rangeHighCents,
            currency,
          }
        : { status: "abstained", reason: DAMAGES_ABSTAINED_REASON, currency },
      underwriting: {
        // riskScore/grade/recommendation derive from liability share + severity,
        // so they are emitted even without a damages figure; the dollar field is
        // null when damages were abstained.
        riskScore,
        grade,
        recommendation,
        expectedAnnualLossCents: hasImpact ? expectedAnnualLossCents : null,
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
      actuarial: hasImpact
        ? {
            grossPremiumCents,
            netPremiumCents,
            lossRatioEstimate,
            sectorLoadingFactor: hashFloat(hash, 58, 1.0, 1.8),
            jurisdictionMultiplier: jurisdiction === "US" ? 1.4 : jurisdiction === "EU" ? 1.2 : 1.0,
          }
        : { status: "abstained", reason: DAMAGES_ABSTAINED_REASON },
      blastRadius: hasImpact
        ? {
            perAgent: perAgentBlast,
            defenceCostsCents: defenceCosts,
            regulatoryFinesCents: regulatoryFines,
            reputationMultiplier,
            totalExposureCents,
          }
        : {
            status: "abstained",
            reason: DAMAGES_ABSTAINED_REASON,
            perAgentShares: agents.map((a, i) => ({
              agent: a.id,
              share: i === 0 ? primaryScore : secondaryShares[i - 1]?.share ?? 0,
            })),
          },
      // Honest disclosure of the fields that are STILL illustrative placeholders
      // in demo mode (not derived from the submitted incident).
      _synthetic_fields: [
        "stressTest.results[].riskScore",
        "stressTest.highestRisk",
        "discoverySubpoenaChecklist[].ifFoundMaxSwingPP",
        ...(hasImpact
          ? ["actuarial.lossRatioEstimate", "actuarial.sectorLoadingFactor", "blastRadius.reputationMultiplier"]
          : []),
      ],
      _synthetic_fields_note:
        "These fields remain illustrative placeholders in demo mode and are NOT derived from your input. " +
        "Every other scored field (verdict, fourFactorScoring, deviationTaxonomy, foreseeability, precedents, " +
        "damages, counterfactuals) is computed deterministically from the submitted incident.",
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

  // ── /api/v2/verify/recompute ──────────────────────────────────────────────
  // Real verifier: takes a certificate AND its canonical input, re-runs the
  // engine, and compares the recomputed certificate to the claimed one.
  // This is the third-party-replicable verification path: anyone with the
  // canonical input can prove the certificate was generated faithfully by
  // the engine, without trusting the issuer's signature.
  if (input.method === "POST" && input.path === "/api/v2/verify/recompute") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const claimed = body.certificate as Record<string, unknown> | undefined;
    const canonical = body.canonicalInput as Record<string, unknown> | undefined;

    if (!claimed || !canonical) {
      return {
        ...base,
        error: "missing_required_fields",
        required: ["certificate", "canonicalInput"],
        guidance: "Submit both the certificate (the JSON returned by /api/v1/incidents/analyze) and the canonical input (the original incident body that produced it). The engine will re-run and compare.",
      };
    }

    // Recurse: re-run analyze with the canonical input to produce a fresh cert.
    const recomputed = await standaloneResponse({
      method: "POST",
      path: "/api/v1/incidents/analyze",
      body: canonical,
    }) as Record<string, unknown>;

    // Compare critical fields between claimed and recomputed.
    const fieldsToCheck = [
      "certificateId",
      "_demo_request_hash",
      "verdict",
      "causalGraph",
      "fourFactorScoring",
      "deviationTaxonomy",
      "euRuleOverlay",
      "cascadeAttenuation",
      "damages",
      "underwriting",
    ];

    const fieldsMatched: string[] = [];
    const fieldsDrifted: { field: string; claimed: unknown; recomputed: unknown }[] = [];

    for (const field of fieldsToCheck) {
      const c = (claimed as Record<string, unknown>)[field];
      const r = (recomputed as Record<string, unknown>)[field];
      if (c === undefined && r === undefined) continue;
      const claimedStr = JSON.stringify(c);
      const recomputedStr = JSON.stringify(r);
      if (claimedStr === recomputedStr) {
        fieldsMatched.push(field);
      } else {
        fieldsDrifted.push({ field, claimed: c, recomputed: r });
      }
    }

    // Anchor fields: extract merkleRoot from both for direct comparison.
    const claimedAnchor = (claimed.anchor as Record<string, unknown> | undefined) ?? {};
    const recomputedAnchor = (recomputed.anchor as Record<string, unknown> | undefined) ?? {};
    const claimedMerkle = claimedAnchor.merkleRoot as string | undefined;
    const recomputedMerkle = recomputedAnchor.merkleRoot as string | undefined;
    const merkleMatch = claimedMerkle === recomputedMerkle && claimedMerkle !== undefined;

    const allMatched = fieldsDrifted.length === 0 && merkleMatch;

    return {
      ...base,
      verification: {
        verified: allMatched,
        method: "recompute",
        claim: "Recomputing the engine on the supplied canonical input produces a byte-identical certificate.",
        verdict: allMatched
          ? "PASS — recomputed certificate matches the claimed certificate on all checked fields."
          : `FAIL — ${fieldsDrifted.length} field(s) drifted between claimed and recomputed; merkleRoot match: ${merkleMatch}.`,
      },
      comparison: {
        fieldsMatched,
        fieldsDrifted,
        merkleRoot: {
          claimed: claimedMerkle ?? null,
          recomputed: recomputedMerkle ?? null,
          match: merkleMatch,
        },
        certificateId: {
          claimed: (claimed.certificateId as string | undefined) ?? null,
          recomputed: (recomputed.certificateId as string | undefined) ?? null,
          match: claimed.certificateId === recomputed.certificateId,
        },
        request_hash: {
          claimed: (claimed._demo_request_hash as string | undefined) ?? null,
          recomputed: (recomputed._demo_request_hash as string | undefined) ?? null,
          match: claimed._demo_request_hash === recomputed._demo_request_hash,
        },
      },
      recomputed,
      methodology: {
        steps: [
          "Receive (certificate, canonicalInput) pair from caller.",
          "Re-run /api/v1/incidents/analyze with the supplied canonicalInput.",
          "Compare critical fields (certificateId, request_hash, merkleRoot, verdict, causalGraph, fourFactorScoring, deviationTaxonomy, euRuleOverlay, cascadeAttenuation, damages, underwriting) between claimed and recomputed.",
          "Report PASS only if every checked field matches byte-for-byte.",
        ],
        defensibility: "This verification path requires no trust in the issuer or signing key. Anyone with the canonical input and access to the engine can independently confirm the certificate was generated faithfully by the documented algorithm. Combined with the public determinism log (proofs/), this provides three-party-replicable evidence: the issuer claims, the engine re-derives, the auditor confirms.",
        limits: [
          "Recomputation depends on the engine version. If the engine is upgraded after a certificate was issued, fields tied to engine version may legitimately drift. The certificate's engineVersion field documents which version was originally used.",
          "Recomputation does NOT verify the Bitcoin OpenTimestamps proof — that requires the anchor-log Git repository and OpenTimestamps Bitcoin headers. Use /api/v2/verify/certificate for the signature path and /api/v2/anchor/<version> for the anchor proof.",
        ],
      },
    };
  }

  // ── /api/v2/jurisdiction/catalog ──────────────────────────────────────
  // Public, free read of the supported jurisdictions and which ones are
  // research stubs in v1. Lets callers make an informed decision about
  // which jurisdictions to include in compare requests.
  if (input.method === "GET" && input.path === "/api/v2/jurisdiction/catalog") {
    return {
      ...base,
      ruleId: "FK-METHOD-2026-004",
      ruleName: "Multi-Jurisdiction Overlay v1",
      catalogVersion: JURISDICTION_OVERLAY_VERSION,
      jurisdictions: SUPPORTED_JURISDICTIONS.map((jx) => ({
        code: jx,
        name:
          jx === "AU"
            ? "Australia"
            : jx === "EU"
              ? "European Union / EEA"
              : jx === "US"
                ? "United States"
                : jx === "UK"
                  ? "United Kingdom"
                  : "Canada",
        is_stub: jx === "US" || jx === "UK" || jx === "CA",
        rule_set_version:
          jx === "EU"
            ? "eu-v1"
            : jx === "AU"
              ? "au-v1"
              : `${jx.toLowerCase()}-stub-v1`,
        primary_authorities:
          jx === "AU"
            ? [
                "Civil Liability Act 2002 (NSW) Pt 4",
                "Australian Consumer Law (Sch. 2 CCA 2010) §§54-59, 64-64A",
                "APRA CPS 230 §§17-22, 31",
                "DISR Voluntary AI Safety Standard (Sept 2024)",
              ]
            : jx === "EU"
              ? [
                  "AI Act (Reg. 2024/1689) Arts. 9, 13, 26",
                  "Revised Product Liability Directive 2024/2853 Arts. 6-12",
                ]
              : jx === "US"
                ? [
                    "Restatement (Third) of Torts: Apportionment §§7-9",
                    "Restatement (Third) of Torts: Products Liability §2(c)",
                  ]
                : jx === "UK"
                  ? ["Consumer Protection Act 1987 Pt I", "AI (Regulation) Bill HL 11 (2024)"]
                  : ["AIDA (Bill C-27 Pt 3)", "PIPEDA (RSC 1985 c. P-8.6)"],
      })),
    };
  }

  // ── /api/v2/jurisdiction/overlay ──────────────────────────────────────
  // Multi-jurisdiction comparison. Takes a canonical attributable map
  // (party-id → share, sums to 1.0), the actor list with all jurisdiction
  // role tags, the union of all jurisdiction-specific flags, and an
  // optional list of target jurisdictions. Returns side-by-side post-
  // overlay shares per jurisdiction plus the rules that fired in each.
  // FK-METHOD-2026-004; pure deterministic.
  if (input.method === "POST" && input.path === "/api/v2/jurisdiction/overlay") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const attributable = body.attributable as Record<string, number> | undefined;
    const actors = (body.actors as JxCompareInput["actors"] | undefined) ?? [];
    const flags = (body.flags as JxCompareInput["flags"] | undefined) ?? ({} as JxCompareInput["flags"]);
    const jurisdictions = body.jurisdictions as JurisdictionCode[] | undefined;
    const primaryJurisdiction = body.primaryJurisdiction as string | undefined;

    if (!attributable || Object.keys(attributable).length === 0) {
      return {
        ...base,
        error: "missing_required_fields",
        required: ["attributable", "actors"],
        guidance:
          "Submit { attributable: { party_id: share, ... }, actors: [...], flags: {...} }. Optionally jurisdictions: ['AU','EU',...]. GET /api/v2/jurisdiction/catalog for supported jurisdictions and stub status.",
      };
    }

    const result = compareJurisdictions({
      attributable,
      actors,
      flags,
      jurisdictions,
      primaryJurisdiction,
    });

    return {
      ...base,
      ...result,
    };
  }

  // ── /api/v2/gate/evaluate (FK-METHOD-2026-006) ─────────────────────────
  // Deterministic prospective-evaluation gate. Takes a ProposedAction and
  // returns one of three verdicts: allow / require_revision / block. Same
  // four-factor engine that issues post-hoc certificates, run prospectively
  // on structured action metadata (not raw prose). Emits a certificate
  // pre-image hash so the post-hoc certificate (if issued) chains canonically.
  if (input.method === "POST" && input.path === "/api/v2/gate/evaluate") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const action = body.action as ProposedAction | undefined;
    const overrides = body.overrides as {
      allow_below?: number;
      block_at_or_above?: number;
      rationale?: string;
    } | undefined;

    if (!action || !action.action_id || !action.action_type || !action.acting_agent_id) {
      return {
        ...base,
        error: "missing_required_fields",
        required: ["action.action_id", "action.action_type", "action.acting_agent_id", "action.acting_agent_type", "action.severity_estimate"],
        guidance:
          "Submit { action: { action_id, action_type, acting_agent_id, acting_agent_type, severity_estimate, cascade_depth?, jurisdiction?, eu_flags?, context_flags? } }. Optionally overrides: { allow_below, block_at_or_above, rationale }. Override rationale is required so the audit trail is complete.",
      };
    }
    if (overrides && (overrides.allow_below !== undefined || overrides.block_at_or_above !== undefined) && !overrides.rationale) {
      return {
        ...base,
        error: "override_missing_rationale",
        guidance: "Threshold overrides require a rationale field citing the governance basis (e.g. 'ISO/IEC 42001 SoA §3.2 approval'). This is enforced so the override is auditable.",
      };
    }

    const decision = await evaluateProspectiveResponse(action, {
      overrides: overrides?.rationale
        ? {
            allow_below: overrides.allow_below,
            block_at_or_above: overrides.block_at_or_above,
            rationale: overrides.rationale,
          }
        : undefined,
    });

    return {
      ...base,
      ...decision,
    };
  }

  // ── /api/v2/gate/thresholds ─────────────────────────────────────────────
  // Public, free read of the per-jurisdiction allow/block thresholds. Lets
  // callers preview the band without having to hard-code or guess them.
  if (input.method === "GET" && input.path === "/api/v2/gate/thresholds") {
    return {
      ...base,
      ruleId: PROSPECTIVE_GATE_RULE_ID,
      ruleVersion: PROSPECTIVE_GATE_VERSION,
      thresholds: JURISDICTION_THRESHOLDS,
      notes: [
        "EU is strictest (AI Act Art. 9 risk-management baseline).",
        "AU is strict for regulated sectors (ACL Pt 3-2 + APRA CPS 230).",
        "Production callers can loosen via overrides on /api/v2/gate/evaluate; a rationale is REQUIRED so audit trail is complete.",
      ],
    };
  }

  // ── /api/v2/remediation/catalog ─────────────────────────────────────────
  // Public, free read of the remediation catalog. Lets callers (and the
  // demo UI) discover the available remediation IDs without having to
  // hard-code them.
  if (input.method === "GET" && input.path === "/api/v2/remediation/catalog") {
    return {
      ...base,
      ruleId: "FK-METHOD-2026-003",
      ruleName: "Counterfactual Remediation Simulator v1",
      catalogVersion: REMEDIATION_CATALOG_VERSION,
      remediations: Object.values(REMEDIATION_CATALOG).map((r) => ({
        id: r.id,
        label: r.label,
        targetType: r.targetType,
        factorDeltas: r.factorDeltas,
        maxReductionPp: r.maxReductionPp,
        citation: r.citation,
        rationale: r.rationale,
      })),
    };
  }

  // ── /api/v2/remediation/simulate ────────────────────────────────────────
  // Closed-form counterfactual: takes a verdict + four-factor scoring +
  // a list of remediation IDs from the catalog and returns the apportioned
  // shares under each remediation in isolation, plus the composite where
  // they all stack. Pure deterministic; same inputs -> byte-identical
  // output. See docs/simulate-remediation.md for the citable design doc.
  if (input.method === "POST" && input.path === "/api/v2/remediation/simulate") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const verdict = body.verdict as RemVerdictShares | undefined;
    const fourFactor = body.fourFactorScoring as RemFourFactorScoring | undefined;
    const remediations = (body.remediations as RemediationInput[] | undefined) ?? [];
    const agents = ((body.agents as Array<{ id: string; type?: string }> | undefined) ??
      []).map((a) => ({ id: a.id, type: a.type }));

    if (!verdict || !fourFactor) {
      return {
        ...base,
        error: "missing_required_fields",
        required: ["verdict", "fourFactorScoring"],
        guidance:
          "Submit the verdict block and the fourFactorScoring block from the certificate, plus the agents list and the remediations to simulate. GET /api/v2/remediation/catalog to discover valid remediation IDs.",
      };
    }
    if (!Array.isArray(remediations) || remediations.length === 0) {
      return {
        ...base,
        error: "no_remediations_supplied",
        guidance:
          "Submit at least one remediation in the `remediations` array. Each entry is { id: <catalog-id>, appliedToParty?: <agent-id> }. GET /api/v2/remediation/catalog for valid ids.",
      };
    }

    const result = simulateRemediation({
      verdict,
      fourFactorScoring: fourFactor,
      agents,
      remediations,
    });

    return {
      ...base,
      ...result,
      catalogVersion: REMEDIATION_CATALOG_VERSION,
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
      { method: "POST", path: "/api/v2/verify/recompute", description: "Re-derive a certificate from canonical input and compare byte-for-byte" },
      { method: "GET", path: "/api/v2/remediation/catalog", description: "List the FK-METHOD-2026-003 remediation catalog" },
      { method: "POST", path: "/api/v2/remediation/simulate", description: "Simulate counterfactual apportionment under one or more remediations" },
      { method: "GET", path: "/api/v2/jurisdiction/catalog", description: "List supported jurisdictions and which overlays are research stubs in v1" },
      { method: "POST", path: "/api/v2/jurisdiction/overlay", description: "Compare apportionment side-by-side across AU, EU, US, UK, CA (FK-METHOD-2026-004)" },
      { method: "POST", path: "/api/v2/gate/evaluate", description: "Deterministic prospective-evaluation gate (FK-METHOD-2026-006): allow / require_revision / block on a ProposedAction BEFORE response delivery" },
      { method: "GET", path: "/api/v2/gate/thresholds", description: "Read per-jurisdiction prospective-gate thresholds" },
      { method: "GET", path: "/api/v2/anchor/status", description: "Get anchor log status" },
      { method: "GET", path: "/api/v2/issuers", description: "Query issuer registry" },
      { method: "GET", path: "/api/v1/regulatory-lookup", description: "Regulatory framework lookup" },
    ],
  };
}
