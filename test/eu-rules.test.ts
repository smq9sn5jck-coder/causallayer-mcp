import { describe, it, expect } from "vitest";
import { applyEuRuleSet, euGateEngages, RULE_SET_VERSION } from "../src/eu-rules";

const PROVIDER = { id: "provider_1", type: "vendor" as const, eu_resident: true };
const DEPLOYER = { id: "deployer_1", type: "deployer" as const, eu_resident: true };
const USER = { id: "user_1", type: "user" as const, eu_resident: true };

describe("EU rule-set v1", () => {
  it("exposes the right rule_set_version", () => {
    expect(RULE_SET_VERSION).toBe("eu-v1");
  });

  it("euGateEngages returns false for non-EU jurisdiction", () => {
    expect(euGateEngages("US", { high_risk_ai: true })).toBe(false);
    expect(euGateEngages("AU", { pld_compensable_damage: true })).toBe(false);
  });

  it("euGateEngages returns false for EU jurisdiction without trigger", () => {
    expect(euGateEngages("DE", {})).toBe(false);
  });

  it("euGateEngages returns true for EU + high-risk", () => {
    expect(euGateEngages("DE", { high_risk_ai: true })).toBe(true);
    expect(euGateEngages("FR", { pld_compensable_damage: true })).toBe(true);
  });

  it("EU-PLD-01: provider recoverable floor of 25% applies even when attributable is lower", () => {
    const out = applyEuRuleSet({
      attributable: { [PROVIDER.id]: 0.10, [DEPLOYER.id]: 0.60, [USER.id]: 0.30 },
      actors: [PROVIDER, DEPLOYER, USER],
      flags: { high_risk_ai: true, provider_breach_was_unforeseeable: true },
    });
    // Recoverable provider share floored to 25% before renormalisation, so >= 25/(25+60+30).
    const recovProvider = out.recoverable[PROVIDER.id]!;
    expect(recovProvider).toBeGreaterThan(0.10);
    expect(out.applied_rules.find((r) => r.rule_id === "EU-PLD-01")).toBeTruthy();
  });

  it("EU-PLD-02: substantial modifier transfers between 30%–70% of provider share", () => {
    const out = applyEuRuleSet({
      attributable: { [PROVIDER.id]: 0.80, [DEPLOYER.id]: 0.20 },
      actors: [PROVIDER, DEPLOYER],
      flags: {
        high_risk_ai: true,
        substantial_modification_present: true,
        substantial_modification_severity: 1.0,
        provider_breach_was_unforeseeable: true,
      },
    });
    // Severity 1.0 → 70% of 0.80 = 0.56 transferred. Pre-norm provider 0.24, deployer 0.76.
    expect(out.attributable[PROVIDER.id]!).toBeLessThan(out.attributable[DEPLOYER.id]!);
    expect(out.applied_rules.find((r) => r.rule_id === "EU-PLD-02")).toBeTruthy();
  });

  it("Article 26 modifiers are capped at +35pp combined", () => {
    const out = applyEuRuleSet({
      attributable: { [PROVIDER.id]: 0.5, [DEPLOYER.id]: 0.5 },
      actors: [PROVIDER, DEPLOYER],
      flags: {
        high_risk_ai: true,
        deployer_used_contrary_to_instructions: true, // 12
        human_oversight_unassigned_or_unqualified: true, // 10
        deployer_input_data_unrepresentative: true, // 9
        deployer_ignored_risk_signal: true, // 11 — but cap is 35
        provider_breach_was_unforeseeable: true,
      },
    });
    // Sum of base would be 42, capped at 35.
    const art26 = out.applied_rules.filter((r) => r.rule_id.startsWith("EU-AIA-26-"));
    const totalDeployerPp = art26
      .map((r) => r.delta_pp[DEPLOYER.id] ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(totalDeployerPp).toBeLessThanOrEqual(35.001);
    expect(totalDeployerPp).toBeGreaterThan(34.0);
  });

  it("EU-AIA-9-B halves all Article 26 deltas if provider failed to supply instructions", () => {
    const out = applyEuRuleSet({
      attributable: { [PROVIDER.id]: 0.5, [DEPLOYER.id]: 0.5 },
      actors: [PROVIDER, DEPLOYER],
      flags: {
        high_risk_ai: true,
        provider_failed_to_supply_instructions: true,
        deployer_used_contrary_to_instructions: true,
        provider_breach_was_unforeseeable: true,
      },
    });
    const art26 = out.applied_rules.find((r) => r.rule_id === "EU-AIA-26-1");
    expect(art26).toBeTruthy();
    // 0.12 base × 0.5 reduction = 0.06 (6 pp)
    expect(art26!.delta_pp[DEPLOYER.id]).toBeCloseTo(6, 1);
  });

  it("Black-box presumption sets the flag on output", () => {
    const out = applyEuRuleSet({
      attributable: { [PROVIDER.id]: 1.0 },
      actors: [PROVIDER],
      flags: { high_risk_ai: true, ai_is_opaque_black_box: true, provider_breach_was_unforeseeable: true },
    });
    expect(out.presumption_in_claimant_favour).toBe(true);
  });

  it("Joint-and-several: stranded actor's recoverable share is redistributed to EU-resident actors", () => {
    const NON_EU = { id: "vendor_us", type: "vendor" as const, eu_resident: false, unrecoverable: true };
    const out = applyEuRuleSet({
      attributable: { [NON_EU.id]: 0.5, [DEPLOYER.id]: 0.5 },
      actors: [NON_EU, DEPLOYER],
      flags: { high_risk_ai: true, provider_breach_was_unforeseeable: true },
    });
    // Non-EU vendor recoverable should be 0; deployer should receive the full redistribution.
    expect(out.recoverable[NON_EU.id]).toBeCloseTo(0, 3);
    expect(out.recoverable[DEPLOYER.id]).toBeCloseTo(1.0, 3);
    expect(out.applied_rules.find((r) => r.rule_id === "EU-PLD-05")).toBeTruthy();
  });

  it("Output sums to 1.0 within tolerance for both attributable and recoverable", () => {
    const out = applyEuRuleSet({
      attributable: { [PROVIDER.id]: 0.4, [DEPLOYER.id]: 0.4, [USER.id]: 0.2 },
      actors: [PROVIDER, DEPLOYER, USER],
      flags: {
        high_risk_ai: true,
        deployer_used_contrary_to_instructions: true,
        deployer_destroyed_logs: true,
        ai_is_opaque_black_box: true,
        provider_breach_was_unforeseeable: false,
      },
    });
    const sumA = Object.values(out.attributable).reduce((s, v) => s + v, 0);
    const sumR = Object.values(out.recoverable).reduce((s, v) => s + v, 0);
    expect(sumA).toBeCloseTo(1.0, 3);
    expect(sumR).toBeCloseTo(1.0, 3);
  });
});
