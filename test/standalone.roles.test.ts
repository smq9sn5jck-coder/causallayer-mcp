import { describe, it, expect } from "vitest";
import { standaloneResponse, partitionAgentsByLiability } from "../src/standalone.js";

// ─── FK-METHOD-2026-004: role-aware liability partition ─────────────────────
// A liability-attribution engine must never allocate fault to a party that is
// structurally incapable of being liable: oversight bodies (regulator/auditor)
// and victims (the harmed party). These tests pin that contract, plus the
// FK-METHOD-2026-001/003 causal-proximity primary-selection invariants.

type AnyRec = Record<string, unknown>;

function analyze(body: unknown): Promise<AnyRec> {
  return standaloneResponse({
    method: "POST",
    path: "/api/v1/incidents/analyze",
    body,
  }) as Promise<AnyRec>;
}

function verdict(cert: AnyRec) {
  return cert.verdict as {
    kind: string;
    primaryParty: string;
    primaryShare: number;
    secondary: Array<{ party: string; share: number }>;
    nonLiableParties: Array<{ party: string; name: string; role: string; reason: string }>;
  };
}

function shareSum(v: ReturnType<typeof verdict>): number {
  return v.primaryShare + v.secondary.reduce((s, x) => s + x.share, 0);
}

// The canonical Uber ATG autonomous-vehicle fatality. Five parties: AI system
// (provider), deployer, safety driver (negligent operator), the pedestrian
// victim, and the NTSB (regulator).
const UBER_AV = {
  title: "Uber autonomous vehicle fatal pedestrian strike",
  description:
    "Self-driving Volvo struck and killed pedestrian Elaine Herzberg. Perception misclassified her; safety driver distracted; NTSB investigated.",
  severity: "critical",
  jurisdiction: "US",
  financial_impact_cents: 250000,
  currency: "AUD",
  agents: [
    { id: "ai-1", name: "Uber ATG Autonomous Driving System", type: "ai_system", operator_role: "provider" },
    { id: "deployer-1", name: "Uber Advanced Technologies Group", type: "deployer", operator_role: "deployer" },
    { id: "operator-1", name: "Rafaela Vasquez", type: "human_operator", operator_role: "user" },
    { id: "victim-1", name: "Elaine Herzberg", type: "user", operator_role: "user" },
    { id: "regulator-1", name: "National Transportation Safety Board", type: "third_party", operator_role: "regulator" },
  ],
  events: [
    { id: "e1", type: "deployment", actor_id: "deployer-1", description: "Uber ATG deployed the self-driving Volvo with safety driver Vasquez." },
    { id: "e2", type: "failure", actor_id: "ai-1", description: "Perception system misclassified the pedestrian; emergency braking disabled." },
    { id: "e3", type: "failure", actor_id: "operator-1", description: "Safety driver Vasquez was distracted and failed to intervene." },
    { id: "e4", type: "incident", actor_id: "ai-1", description: "Volvo struck pedestrian Elaine Herzberg." },
    { id: "e5", type: "harm", description: "Elaine Herzberg died from her injuries." },
    { id: "e6", type: "regulatory", actor_id: "regulator-1", description: "NTSB final report cited inadequate safety culture." },
  ],
};

describe("partitionAgentsByLiability — unit", () => {
  it("excludes regulators/auditors and pure victims, keeps actors", () => {
    const { liableAgents, nonLiableParties } = partitionAgentsByLiability(
      UBER_AV.agents,
      UBER_AV.events,
    );
    const liableIds = liableAgents.map((a) => a.id).sort();
    expect(liableIds).toEqual(["ai-1", "deployer-1", "operator-1"]);
    const nlIds = nonLiableParties.map((p) => p.party).sort();
    expect(nlIds).toEqual(["regulator-1", "victim-1"]);
  });

  it("never returns an empty liable set (safety net)", () => {
    // Degenerate: every party is a regulator. Exclusion would empty the set,
    // so the partition must keep them all liable instead.
    const allRegulators = {
      agents: [
        { id: "r1", name: "Reg One", type: "third_party", operator_role: "regulator" },
        { id: "r2", name: "Reg Two", type: "third_party", operator_role: "regulator" },
      ],
      events: [{ id: "e1", type: "failure", actor_id: "r1", description: "x" }],
    };
    const { liableAgents, nonLiableParties } = partitionAgentsByLiability(
      allRegulators.agents,
      allRegulators.events,
    );
    expect(liableAgents.length).toBe(2);
    expect(nonLiableParties.length).toBe(0);
  });

  it("keeps a negligent user/operator liable (actored a failure event)", () => {
    // operator-1 is operator_role 'user' but actors a failure event → stays liable.
    const { liableAgents } = partitionAgentsByLiability(UBER_AV.agents, UBER_AV.events);
    expect(liableAgents.some((a) => a.id === "operator-1")).toBe(true);
  });
});

describe("standaloneResponse — non-liable parties never bear fault", () => {
  it("never assigns share to a victim or regulator", async () => {
    const cert = await analyze(UBER_AV);
    const v = verdict(cert);
    const faultBearing = new Set([v.primaryParty, ...v.secondary.map((s) => s.party)]);
    expect(faultBearing.has("victim-1")).toBe(false);
    expect(faultBearing.has("regulator-1")).toBe(false);
  });

  it("lists the victim and regulator as explicit non-liable parties", async () => {
    const cert = await analyze(UBER_AV);
    const v = verdict(cert);
    const nlIds = v.nonLiableParties.map((p) => p.party).sort();
    expect(nlIds).toEqual(["regulator-1", "victim-1"]);
    for (const p of v.nonLiableParties) {
      expect(p.reason.length).toBeGreaterThan(10);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it("selects the AI system as primary (causal proximity, not array order)", async () => {
    const cert = await analyze(UBER_AV);
    const v = verdict(cert);
    expect(v.primaryParty).toBe("ai-1");
  });

  it("keeps shares summing to 1.0 across the liable set only", async () => {
    const cert = await analyze(UBER_AV);
    const v = verdict(cert);
    expect(shareSum(v)).toBeCloseTo(1.0, 2);
    // Exactly the three liable parties carry share.
    expect(v.secondary.length).toBe(2);
  });

  it("primary holds the largest single share (dominance invariant)", async () => {
    const cert = await analyze(UBER_AV);
    const v = verdict(cert);
    for (const s of v.secondary) expect(v.primaryShare).toBeGreaterThanOrEqual(s.share);
  });

  it("labels the verdict by liable-party count (three liable → three_party)", async () => {
    const cert = await analyze(UBER_AV);
    const v = verdict(cert);
    expect(v.kind).toBe("shared_liability_three_party");
  });

  it("is deterministic for the role-partitioned incident", async () => {
    const a = await analyze(UBER_AV);
    const b = await analyze(UBER_AV);
    expect(a.certificateId).toBe(b.certificateId);
  });
});

describe("standaloneResponse — causal-proximity primary selection", () => {
  it("ignores array order: primary is the most-actored root-cause agent", async () => {
    // Put the deployer first, but the AI actors the most/earliest failure events.
    const reordered = {
      ...UBER_AV,
      agents: [UBER_AV.agents[1], UBER_AV.agents[0], ...UBER_AV.agents.slice(2)],
    };
    const cert = await analyze(reordered);
    expect(verdict(cert).primaryParty).toBe("ai-1");
  });

  it("does not double-list the primary in secondary", async () => {
    const cert = await analyze(UBER_AV);
    const v = verdict(cert);
    expect(v.secondary.some((s) => s.party === v.primaryParty)).toBe(false);
  });
});
