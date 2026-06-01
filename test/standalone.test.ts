import { describe, it, expect } from "vitest";
import { standaloneResponse } from "../src/standalone.js";

// The standalone engine is the heart of the product: a deterministic liability
// scorer. Its contract is "same canonical input → same certificate". These
// tests pin that guarantee plus the numeric invariants the verdict must hold.

type AnyRec = Record<string, unknown>;

function analyze(body: unknown): Promise<AnyRec> {
  return standaloneResponse({
    method: "POST",
    path: "/api/v1/incidents/analyze",
    body,
  }) as Promise<AnyRec>;
}

/** Strip wall-clock fields that are intentionally non-deterministic. */
function stableView(cert: AnyRec): AnyRec {
  const { _demo_generated_at, issuedAt, ...rest } = cert;
  void _demo_generated_at;
  void issuedAt;
  return rest;
}

const TWO_AGENT_ONE_EVENT = {
  title: "Chatbot gave unauthorised refund",
  severity: "high",
  jurisdiction: "AU",
  // Damages are only computed from a caller-supplied impact; the engine now
  // abstains rather than fabricating one, so tests that assert damages figures
  // must provide it explicitly.
  financial_impact_cents: 5_000_00,
  agents: [
    { id: "agent_ai", type: "ai_system", name: "Support Bot" },
    { id: "agent_deployer", type: "deployer", name: "Acme Corp" },
  ],
  events: [
    {
      id: "ev1",
      type: "decision",
      actor_id: "agent_ai",
      description: "Bot issued an unauthorised refund without human review.",
    },
  ],
};

describe("standaloneResponse — determinism", () => {
  it("produces byte-identical output (modulo wall-clock) for identical input", async () => {
    const a = await analyze(TWO_AGENT_ONE_EVENT);
    const b = await analyze(TWO_AGENT_ONE_EVENT);
    expect(JSON.stringify(stableView(a))).toBe(JSON.stringify(stableView(b)));
  });

  it("keeps certificateId wall-clock-independent (stable across runs)", async () => {
    const a = await analyze(TWO_AGENT_ONE_EVENT);
    const b = await analyze(TWO_AGENT_ONE_EVENT);
    expect(a.certificateId).toBe(b.certificateId);
    expect(String(a.certificateId)).toMatch(/^demo_[0-9a-f]+$/);
  });

  it("is sensitive to input: changing severity changes the certificate", async () => {
    const high = await analyze(TWO_AGENT_ONE_EVENT);
    const critical = await analyze({ ...TWO_AGENT_ONE_EVENT, severity: "critical" });
    expect(critical.certificateId).not.toBe(high.certificateId);
    expect(critical._demo_request_hash).not.toBe(high._demo_request_hash);
  });

  it("derives the request hash purely from method/path/body", async () => {
    const a = await analyze(TWO_AGENT_ONE_EVENT);
    const b = await analyze({ ...TWO_AGENT_ONE_EVENT });
    expect(a._demo_request_hash).toBe(b._demo_request_hash);
  });
});

describe("standaloneResponse — verdict invariants", () => {
  it("keeps the primary share within the engine's [0.25, 0.95] clamp", async () => {
    const cert = await analyze(TWO_AGENT_ONE_EVENT);
    const verdict = cert.verdict as { primaryShare: number };
    expect(verdict.primaryShare).toBeGreaterThanOrEqual(0.25);
    expect(verdict.primaryShare).toBeLessThanOrEqual(0.95);
  });

  it("apportions primary + secondary shares to 1.0 when cascade does not engage", async () => {
    // 2 agents but only 1 event → cascade attenuation requires >=2 events, so
    // the raw apportionment (which must sum to 1.0) is preserved.
    const cert = await analyze(TWO_AGENT_ONE_EVENT);
    const verdict = cert.verdict as { primaryShare: number; secondary: Array<{ share: number }> };
    const total = verdict.primaryShare + verdict.secondary.reduce((s, x) => s + x.share, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });

  it("labels the verdict kind from the agent count", async () => {
    const one = await analyze({ ...TWO_AGENT_ONE_EVENT, agents: [{ id: "a", type: "ai_system" }] });
    const two = await analyze(TWO_AGENT_ONE_EVENT);
    const three = await analyze({
      ...TWO_AGENT_ONE_EVENT,
      agents: [
        { id: "a", type: "ai_system" },
        { id: "b", type: "deployer" },
        { id: "c", type: "user" },
      ],
    });
    expect((one.verdict as AnyRec).kind).toBe("single_party");
    expect((two.verdict as AnyRec).kind).toBe("shared_liability_two_party");
    expect((three.verdict as AnyRec).kind).toBe("shared_liability_three_party");
  });

  it("marks the response as demo mode with a disclaimer", async () => {
    const cert = await analyze(TWO_AGENT_ONE_EVENT);
    expect(cert._demo_mode).toBe(true);
    expect(String(cert._demo_disclaimer)).toContain("DEMO RESULT");
  });

  it("never emits punitive damages below the critical severity tier", async () => {
    const high = await analyze(TWO_AGENT_ONE_EVENT);
    const critical = await analyze({ ...TWO_AGENT_ONE_EVENT, severity: "critical" });
    expect((high.damages as AnyRec).punitiveCents).toBe(0);
    expect((critical.damages as AnyRec).punitiveCents as number).toBeGreaterThan(0);
  });
});

describe("standaloneResponse — evidence-derived scoring (no hash fabrication)", () => {
  it("ABSTAINS on damages when no financial_impact_cents is supplied", async () => {
    const { financial_impact_cents, ...noImpact } = TWO_AGENT_ONE_EVENT;
    void financial_impact_cents;
    const cert = await analyze(noImpact);
    const damages = cert.damages as AnyRec;
    expect(damages.status).toBe("abstained");
    expect(damages).not.toHaveProperty("totalCents");
    // Dollar modules abstain in lockstep; liability shares are still reported.
    expect((cert.actuarial as AnyRec).status).toBe("abstained");
    expect((cert.blastRadius as AnyRec).status).toBe("abstained");
    expect((cert.underwriting as AnyRec).expectedAnnualLossCents).toBeNull();
  });

  it("computes damages from a supplied impact (no hash seeding)", async () => {
    const cert = await analyze(TWO_AGENT_ONE_EVENT);
    const damages = cert.damages as AnyRec;
    expect(damages.status).toBeUndefined();
    expect(damages.totalCents as number).toBeGreaterThan(0);
  });

  it("derives deviation modes from the incident text, not a hash", async () => {
    const cert = await analyze(TWO_AGENT_ONE_EVENT);
    const modes = (cert.deviationTaxonomy as Array<{ mode: string; evidence: string[] }>).map((d) => d.mode);
    // The refund-without-review text should surface these modes:
    expect(modes).toContain("authority_boundary_violation");
    expect(modes).toContain("oversight_mechanism_bypass");
  });

  it("reports NO deviations when the text contains none", async () => {
    const cert = await analyze({
      ...TWO_AGENT_ONE_EVENT,
      title: "Routine batch job completed",
      events: [{ id: "ev1", type: "info", actor_id: "agent_ai", description: "Job finished." }],
    });
    expect((cert.deviationTaxonomy as unknown[]).length).toBe(0);
  });

  it("drops the fabricated calibration claims (no R2 / 725 resolved-outcomes)", async () => {
    const cert = await analyze(TWO_AGENT_ONE_EVENT);
    expect(cert.damages as AnyRec).not.toHaveProperty("calibrationR2");
    expect(cert.crossCaseCalibration as AnyRec).not.toHaveProperty("resolvedOutcomesUsed");
    expect((cert.crossCaseCalibration as AnyRec).performed).toBe(false);
    expect(JSON.stringify(cert)).not.toContain("725");
  });

  it("returns precedents by real factor overlap, with shared factors shown", async () => {
    const cert = await analyze(TWO_AGENT_ONE_EVENT);
    const precedents = cert.precedents as Array<{ similarity: number; sharedFactors: string[] }>;
    expect(precedents.length).toBeGreaterThan(0);
    for (const p of precedents) {
      expect(p.similarity).toBeGreaterThan(0);
      expect(p.sharedFactors.length).toBeGreaterThan(0);
    }
    // Sorted descending by similarity.
    const sims = precedents.map((p) => p.similarity);
    expect([...sims].sort((a, b) => b - a)).toEqual(sims);
  });
});

describe("standaloneResponse — recompute verification path", () => {
  it("PASSES when the certificate is recomputed from its own canonical input", async () => {
    const canonicalInput = TWO_AGENT_ONE_EVENT;
    const certificate = await analyze(canonicalInput);
    const res = (await standaloneResponse({
      method: "POST",
      path: "/api/v2/verify/recompute",
      body: { certificate, canonicalInput },
    })) as AnyRec;
    expect((res.verification as AnyRec).verified).toBe(true);
  });

  it("FAILS when the canonical input is altered after issuance", async () => {
    const certificate = await analyze(TWO_AGENT_ONE_EVENT);
    const res = (await standaloneResponse({
      method: "POST",
      path: "/api/v2/verify/recompute",
      body: { certificate, canonicalInput: { ...TWO_AGENT_ONE_EVENT, severity: "low" } },
    })) as AnyRec;
    expect((res.verification as AnyRec).verified).toBe(false);
  });

  it("reports missing fields when certificate/canonicalInput are absent", async () => {
    const res = (await standaloneResponse({
      method: "POST",
      path: "/api/v2/verify/recompute",
      body: {},
    })) as AnyRec;
    expect(res.error).toBe("missing_required_fields");
  });
});

describe("standaloneResponse — input validation on structured endpoints", () => {
  it("rejects an empty attributable map on the jurisdiction overlay", async () => {
    const res = (await standaloneResponse({
      method: "POST",
      path: "/api/v2/jurisdiction/overlay",
      body: { actors: [] },
    })) as AnyRec;
    expect(res.error).toBe("missing_required_fields");
  });

  it("rejects a gate request missing the action object", async () => {
    const res = (await standaloneResponse({
      method: "POST",
      path: "/api/v2/gate/evaluate",
      body: {},
    })) as AnyRec;
    expect(res.error).toBe("missing_required_fields");
  });

  it("requires a rationale when overriding gate thresholds", async () => {
    const res = (await standaloneResponse({
      method: "POST",
      path: "/api/v2/gate/evaluate",
      body: {
        action: {
          action_id: "act1",
          action_type: "send_email",
          acting_agent_id: "agent_ai",
          acting_agent_type: "ai_system",
          severity_estimate: "high",
        },
        overrides: { allow_below: 0.2 },
      },
    })) as AnyRec;
    expect(res.error).toBe("override_missing_rationale");
  });
});
