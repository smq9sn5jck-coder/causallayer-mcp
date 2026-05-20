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
    const primaryScore = computePrimaryScore(
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
    const causalEdges = events.slice(1).map((e, i) => ({
      from: events[i]!.id,
      to: e.id,
      relation: "caused_by",
      strength: hashFloat(hash, 32 + i * 2, 0.6, 0.95),
    }));
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

    // Certificate ID
    const inputHash = hash;
    const outputHash = await hashHex(JSON.stringify({ primaryScore, totalCents, verdictKind }));
    const certificateId = await hashHex(inputHash + outputHash + base._demo_generated_at);

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
