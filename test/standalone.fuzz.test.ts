import { describe, it, expect } from "vitest";
import { standaloneResponse } from "../src/standalone.js";

// Property / fuzz tests: generate a wide range of incident inputs and assert
// the engine's structural guarantees hold on ALL of them, not just the hand-
// picked fixtures in standalone.test.ts. This is the gate for shipping the
// demo: determinism + the recompute path must never break under varied input.

type AnyRec = Record<string, unknown>;

function analyze(body: unknown): Promise<AnyRec> {
  return standaloneResponse({ method: "POST", path: "/api/v1/incidents/analyze", body }) as Promise<AnyRec>;
}

function stableView(cert: AnyRec): AnyRec {
  const { _demo_generated_at, issuedAt, ...rest } = cert;
  void _demo_generated_at;
  void issuedAt;
  return rest;
}

// Deterministic PRNG (mulberry32) so the fuzz corpus itself is reproducible —
// a failing seed can be replayed exactly.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AGENT_TYPES = ["ai_system", "vendor", "deployer", "human_operator", "user", "third_party"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const JURISDICTIONS = ["AU", "US", "EU", "UK", "CA"];
const TAXONOMY = new Set([
  "specification_gaming", "reward_hacking", "distributional_shift", "capability_overhang",
  "goal_misgeneralisation", "prompt_injection", "jailbreak", "data_poisoning", "sensor_occlusion",
  "ods_non_compliance", "authority_boundary_violation", "oversight_mechanism_bypass",
  "cascading_multi_agent_failure", "supply_chain_dependency_failure", "model_drift",
  "adversarial_input", "hallucination",
]);
// Phrases that should (or should not) trip the deviation detector.
const TEXT_SNIPPETS = [
  "the model hallucinated a non-existent citation",
  "issued an unauthorised refund without human review",
  "a prompt injection bypassed the guardrail",
  "model drift degraded over time",
  "routine batch job finished normally",
  "the assistant summarised the document",
  "third party upstream service dependency failure",
];

function makeBody(rnd: () => number): unknown {
  const agentCount = 1 + Math.floor(rnd() * 4); // 1..4
  const eventCount = Math.floor(rnd() * 6); // 0..5
  const agents = Array.from({ length: agentCount }, (_, i) => ({
    id: `agent_${i}`,
    name: `Agent ${i}`,
    type: AGENT_TYPES[Math.floor(rnd() * AGENT_TYPES.length)],
  }));
  const events = Array.from({ length: eventCount }, (_, i) => {
    const e: AnyRec = { id: `ev_${i}`, type: rnd() < 0.5 ? "decision" : "ai_output" };
    if (rnd() < 0.7) e.actor_id = agents[Math.floor(rnd() * agents.length)]!.id;
    if (rnd() < 0.8) e.description = TEXT_SNIPPETS[Math.floor(rnd() * TEXT_SNIPPETS.length)];
    if (rnd() < 0.6) e.timestamp = `2024-0${1 + Math.floor(rnd() * 8)}-15T12:00:00Z`;
    return e;
  });
  const body: AnyRec = {
    title: TEXT_SNIPPETS[Math.floor(rnd() * TEXT_SNIPPETS.length)] + " incident",
    severity: SEVERITIES[Math.floor(rnd() * SEVERITIES.length)],
    jurisdiction: JURISDICTIONS[Math.floor(rnd() * JURISDICTIONS.length)],
    agents,
    events,
  };
  if (rnd() < 0.5) body.description = TEXT_SNIPPETS[Math.floor(rnd() * TEXT_SNIPPETS.length)];
  // Half the time supply an impact; half the time omit it (→ abstain path).
  if (rnd() < 0.5) body.financial_impact_cents = Math.floor(rnd() * 10_000_000);
  if (rnd() < 0.5) body.currency = "USD";
  return body;
}

describe("standaloneResponse — fuzz / property tests", () => {
  const ITERATIONS = 250;

  it(`holds all invariants across ${ITERATIONS} randomised incidents`, async () => {
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      const rnd = mulberry32(seed);
      const body = makeBody(rnd) as AnyRec;
      const agentCount = (body.agents as unknown[]).length;
      const eventCount = (body.events as unknown[]).length;

      const a = await analyze(body);
      const b = await analyze(body);

      // 1. Determinism (modulo wall-clock) + stable certificate id.
      expect(JSON.stringify(stableView(a)), `determinism @seed=${seed}`).toBe(JSON.stringify(stableView(b)));
      expect(a.certificateId, `certId stable @seed=${seed}`).toBe(b.certificateId);
      expect(String(a.certificateId)).toMatch(/^demo_[0-9a-f]+$/);

      const verdict = a.verdict as { kind: string; primaryShare: number; secondary: Array<{ share: number }> };

      // 2. Verdict kind tracks agent count.
      const expectedKind =
        agentCount <= 1 ? "single_party" : agentCount === 2 ? "shared_liability_two_party" : "shared_liability_three_party";
      expect(verdict.kind, `verdict kind @seed=${seed}`).toBe(expectedKind);

      // 3. Apportionment. A single identified party bears 100%. With multiple
      //    parties the [0.25,0.95] clamp and shares-sum-to-1.0 hold whenever
      //    cascade attenuation did NOT rebalance the split (it intentionally
      //    breaks both when it engages).
      expect(verdict.primaryShare).toBeGreaterThan(0);
      expect(verdict.primaryShare).toBeLessThanOrEqual(1);
      const cascadeApplied = Boolean((a.cascadeAttenuation as AnyRec | null)?.applied);
      if (agentCount === 1) {
        expect(verdict.primaryShare, `single-party 100% @seed=${seed}`).toBe(1.0);
        expect(verdict.secondary.length).toBe(0);
      } else if (!cascadeApplied) {
        expect(verdict.primaryShare, `clamp lo @seed=${seed}`).toBeGreaterThanOrEqual(0.25);
        expect(verdict.primaryShare, `clamp hi @seed=${seed}`).toBeLessThanOrEqual(0.95);
        const total = verdict.primaryShare + verdict.secondary.reduce((s, x) => s + x.share, 0);
        expect(total, `share sum @seed=${seed}`).toBeCloseTo(1.0, 2);
      }

      // 4. Damages abstain IFF no numeric financial_impact_cents was supplied.
      const hasImpact = typeof body.financial_impact_cents === "number";
      const damages = a.damages as AnyRec;
      if (hasImpact) {
        expect(damages.status, `damages computed @seed=${seed}`).toBeUndefined();
        expect(damages.totalCents as number).toBeGreaterThanOrEqual(0);
      } else {
        expect(damages.status, `damages abstain @seed=${seed}`).toBe("abstained");
        expect(a.actuarial as AnyRec).toHaveProperty("status", "abstained");
        expect(a.blastRadius as AnyRec).toHaveProperty("status", "abstained");
      }

      // 5. Every reported deviation is a real taxonomy mode with non-empty evidence.
      for (const d of a.deviationTaxonomy as Array<{ mode: string; evidence: string[] }>) {
        expect(TAXONOMY.has(d.mode), `valid mode '${d.mode}' @seed=${seed}`).toBe(true);
        expect(d.evidence.length, `evidence present @seed=${seed}`).toBeGreaterThan(0);
      }

      // 6. No resurrected fabricated-calibration claims.
      expect(JSON.stringify(a)).not.toContain("calibrationR2");
      expect(JSON.stringify(a)).not.toContain("\"resolvedOutcomesUsed\"");
      expect(a).toHaveProperty("_synthetic_fields");

      // 7. The recompute verification path PASSES on the cert's own input, and
      //    FAILS when the input is mutated — for every generated incident.
      const okay = (await standaloneResponse({
        method: "POST",
        path: "/api/v2/verify/recompute",
        body: { certificate: a, canonicalInput: body },
      })) as AnyRec;
      expect((okay.verification as AnyRec).verified, `recompute PASS @seed=${seed}`).toBe(true);

      const tampered = (await standaloneResponse({
        method: "POST",
        path: "/api/v2/verify/recompute",
        body: { certificate: a, canonicalInput: { ...body, severity: body.severity === "low" ? "critical" : "low" } },
      })) as AnyRec;
      expect((tampered.verification as AnyRec).verified, `recompute FAIL-on-tamper @seed=${seed}`).toBe(false);
      void eventCount;
    }
  });
});
