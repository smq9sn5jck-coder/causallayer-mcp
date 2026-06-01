import { describe, it, expect } from "vitest";
import {
  applyCascadeAttenuation,
  type CascadeEvent,
  type CascadeAgentRef,
} from "../src/cascade.js";

// Cascade attenuation sub-linearly reduces each agent's share based on how
// deep it sits in a multi-agent causal chain, then redistributes the freed
// mass so the shares still sum to 1.0. These tests pin mass conservation, the
// k=0 / alpha=0 no-op cases, monotonicity, and determinism.

function sum(shares: Record<string, number>): number {
  return Object.values(shares).reduce((s, v) => s + v, 0);
}

// A → B → C chain via caused_by linkage.
const CHAIN_EVENTS: CascadeEvent[] = [
  { id: "e1", type: "decision", agent: "A" },
  { id: "e2", type: "decision", agent: "B", caused_by: "e1" },
  { id: "e3", type: "decision", agent: "C", caused_by: "e2" },
];
const CHAIN_AGENTS: CascadeAgentRef[] = [
  { id: "A", type: "ai_system" },
  { id: "B", type: "deployer" },
  { id: "C", type: "user" },
];
const CHAIN_SHARES = { A: 0.5, B: 0.3, C: 0.2 };

describe("applyCascadeAttenuation — mass conservation", () => {
  it("keeps attenuated shares summing to 1.0", () => {
    const out = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS);
    expect(sum(out.attenuated_shares)).toBeCloseTo(1.0, 3);
  });

  it("preserves the original shares verbatim for diffing", () => {
    const out = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS);
    expect(out.original_shares).toEqual(CHAIN_SHARES);
  });
});

describe("applyCascadeAttenuation — engagement conditions", () => {
  it("engages on a genuine multi-agent chain (k > 0, multiplier < 1)", () => {
    const out = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS);
    expect(out.applied).toBe(true);
    const deepest = out.agents.find((a) => a.agent_id === "A")!;
    expect(deepest.k).toBeGreaterThan(0);
    expect(deepest.multiplier).toBeLessThan(1);
  });

  it("is a no-op when all events belong to one agent (k = 0)", () => {
    const events: CascadeEvent[] = [
      { id: "e1", type: "decision", agent: "A" },
      { id: "e2", type: "decision", agent: "A", caused_by: "e1" },
    ];
    const out = applyCascadeAttenuation({ A: 1.0 }, events, [{ id: "A" }]);
    expect(out.applied).toBe(false);
    expect(out.agents.every((a) => a.multiplier === 1)).toBe(true);
    expect(out.attenuated_shares).toEqual({ A: 1.0 });
  });

  it("is disabled (identity) when alpha = 0", () => {
    const out = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS, { alpha: 0 });
    expect(out.applied).toBe(false);
    expect(out.attenuated_shares).toEqual(CHAIN_SHARES);
    expect(out.total_redistributed).toBe(0);
  });
});

describe("applyCascadeAttenuation — attenuation curve", () => {
  it("follows multiplier = 1 / (1 + alpha·ln(1+k))", () => {
    const out = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS);
    for (const a of out.agents) {
      const expected = +(1 / (1 + 0.15 * Math.log(1 + a.k))).toFixed(6);
      expect(a.multiplier).toBeCloseTo(expected, 6);
    }
  });

  it("is monotone non-increasing in chain depth (deeper → smaller multiplier)", () => {
    const out = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS);
    const byK = [...out.agents].sort((x, y) => x.k - y.k);
    for (let i = 1; i < byK.length; i++) {
      expect(byK[i].multiplier).toBeLessThanOrEqual(byK[i - 1].multiplier);
    }
  });
});

describe("applyCascadeAttenuation — determinism", () => {
  it("returns byte-identical output for identical input", () => {
    const a = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS);
    const b = applyCascadeAttenuation(CHAIN_SHARES, CHAIN_EVENTS, CHAIN_AGENTS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
