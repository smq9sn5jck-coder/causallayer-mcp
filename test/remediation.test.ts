import { describe, it, expect } from "vitest";
import {
  simulateRemediation,
  REMEDIATION_CATALOG,
  type SimulateRemediationInput,
  type VerdictShares,
} from "../src/remediation.js";

// The remediation simulator is mass-conserving share math: applying a
// mitigation reduces the primary's share, redistributes the freed mass, and
// caps how far any single (or composite) mitigation can move the verdict.
// These tests pin those invariants — the kind of off-by-a-bit errors that are
// easy to introduce and hard to spot by eye.

const WEIGHTS = { causalProximity: 0.3, behaviouralDeviation: 0.3, controllability: 0.2, regulatoryAlignment: 0.2 };

// Primary is a vendor so vendor-targeted catalog entries hit the PRIMARY path
// (factor-delta → recompute → redistribute), which must conserve mass.
const VERDICT: VerdictShares = {
  primaryParty: "vendor1",
  primaryShare: 0.7,
  secondary: [{ party: "deployer1", share: 0.3 }],
};

function baseInput(remediationIds: string[]): SimulateRemediationInput {
  return {
    verdict: VERDICT,
    fourFactorScoring: {
      primaryAgent: "vendor1",
      causalProximity: 0.8,
      behaviouralDeviation: 0.7,
      controllability: 0.6,
      regulatoryAlignment: 0.5,
      weights: WEIGHTS,
    },
    agents: [
      { id: "vendor1", type: "vendor" },
      { id: "deployer1", type: "deployer" },
    ],
    remediations: remediationIds.map((id) => ({ id })),
  };
}

function shareSum(v: VerdictShares): number {
  return v.primaryShare + v.secondary.reduce((s, x) => s + x.share, 0);
}

describe("simulateRemediation — mass conservation", () => {
  it("keeps each per-remediation result's shares summing to 1.0", () => {
    const out = simulateRemediation(baseInput(["vendor_adversarial_eval_suite"]));
    expect(out.perRemediation).toHaveLength(1);
    for (const r of out.perRemediation) {
      expect(shareSum(r.after)).toBeCloseTo(1.0, 2);
    }
  });

  it("keeps the composite result's shares summing to 1.0", () => {
    const out = simulateRemediation(
      baseInput(["vendor_adversarial_eval_suite", "vendor_red_team_attestation", "vendor_safety_card"]),
    );
    expect(shareSum(out.composite.after)).toBeCloseTo(1.0, 2);
  });
});

describe("simulateRemediation — directional & cap invariants", () => {
  it("never increases the primary's share (mitigations only reduce or hold)", () => {
    const out = simulateRemediation(baseInput(["vendor_adversarial_eval_suite"]));
    for (const r of out.perRemediation) {
      expect(r.primaryShareDeltaPp).toBeLessThanOrEqual(0);
    }
  });

  it("respects each remediation's per-mitigation reduction cap", () => {
    const out = simulateRemediation(baseInput(["vendor_adversarial_eval_suite"]));
    const r = out.perRemediation[0];
    const cap = REMEDIATION_CATALOG["vendor_adversarial_eval_suite"].maxReductionPp;
    expect(Math.abs(r.primaryShareDeltaPp)).toBeLessThanOrEqual(cap + 1e-6);
  });

  it("clamps the composite reduction to the global 25pp ceiling", () => {
    const out = simulateRemediation(
      baseInput(["vendor_adversarial_eval_suite", "vendor_red_team_attestation", "vendor_safety_card"]),
    );
    // Sum of per-mitigation caps (12+10+6=28) exceeds the global ceiling → 25.
    expect(out.composite.cap_pp).toBe(25);
    expect(Math.abs(out.composite.primaryShareDeltaPp)).toBeLessThanOrEqual(out.composite.cap_pp + 1e-6);
  });
});

describe("simulateRemediation — robustness", () => {
  it("warns and skips unknown remediation ids without throwing", () => {
    const out = simulateRemediation(baseInput(["does_not_exist"]));
    expect(out.perRemediation).toHaveLength(0);
    expect(out.warnings).toContain("unknown_remediation_id:does_not_exist");
  });

  it("warns when no agent matches a remediation's target type", () => {
    const input = baseInput(["deployer_human_in_loop"]);
    // Remove the deployer so the deployer-targeted remediation has no party.
    input.agents = [{ id: "vendor1", type: "vendor" }];
    input.verdict = { primaryParty: "vendor1", primaryShare: 1.0, secondary: [] };
    const out = simulateRemediation(input);
    expect(out.warnings.some((w) => w.startsWith("no_party_for_type:"))).toBe(true);
  });

  it("is deterministic: identical input → byte-identical output", () => {
    const a = simulateRemediation(baseInput(["vendor_adversarial_eval_suite"]));
    const b = simulateRemediation(baseInput(["vendor_adversarial_eval_suite"]));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
