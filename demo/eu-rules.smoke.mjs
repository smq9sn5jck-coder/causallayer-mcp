// Plain-node smoke test for demo/eu-rules.js. No vitest dependency.
import { applyEuRuleSet, euGateEngages, RULE_SET_VERSION } from "./eu-rules.js";

let pass = 0, fail = 0;
const t = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else    { fail++; console.log(`✗ ${name}${detail ? "  " + detail : ""}`); }
};
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

const PROVIDER = { id: "p1", type: "vendor", eu_resident: true };
const DEPLOYER = { id: "d1", type: "deployer", eu_resident: true };
const USER = { id: "u1", type: "user", eu_resident: true };

t("RULE_SET_VERSION", RULE_SET_VERSION === "eu-v1");

t("gate: US blocks", euGateEngages("US", { high_risk_ai: true }) === false);
t("gate: AU blocks", euGateEngages("AU", { pld_compensable_damage: true }) === false);
t("gate: DE without trigger blocks", euGateEngages("DE", {}) === false);
t("gate: DE high-risk engages", euGateEngages("DE", { high_risk_ai: true }) === true);
t("gate: FR pld engages", euGateEngages("FR", { pld_compensable_damage: true }) === true);

const a = applyEuRuleSet({
  attributable: { [PROVIDER.id]: 0.10, [DEPLOYER.id]: 0.60, [USER.id]: 0.30 },
  actors: [PROVIDER, DEPLOYER, USER],
  flags: { high_risk_ai: true, provider_breach_was_unforeseeable: true },
});
t("EU-PLD-01 fires", a.applied_rules.some((r) => r.rule_id === "EU-PLD-01"));
t("EU-PLD-01 lifts provider recoverable above attributable",
  a.recoverable[PROVIDER.id] > 0.10,
  `recov=${a.recoverable[PROVIDER.id]}`);

const b = applyEuRuleSet({
  attributable: { [PROVIDER.id]: 0.80, [DEPLOYER.id]: 0.20 },
  actors: [PROVIDER, DEPLOYER],
  flags: {
    high_risk_ai: true,
    substantial_modification_present: true,
    substantial_modification_severity: 1.0,
    provider_breach_was_unforeseeable: true,
  },
});
t("EU-PLD-02 transfers majority to deployer at sev=1.0",
  b.attributable[DEPLOYER.id] > b.attributable[PROVIDER.id],
  `p=${b.attributable[PROVIDER.id]} d=${b.attributable[DEPLOYER.id]}`);

const c = applyEuRuleSet({
  attributable: { [PROVIDER.id]: 0.5, [DEPLOYER.id]: 0.5 },
  actors: [PROVIDER, DEPLOYER],
  flags: {
    high_risk_ai: true,
    deployer_used_contrary_to_instructions: true,
    human_oversight_unassigned_or_unqualified: true,
    deployer_input_data_unrepresentative: true,
    deployer_ignored_risk_signal: true,
    provider_breach_was_unforeseeable: true,
  },
});
const total26 = c.applied_rules
  .filter((r) => r.rule_id.startsWith("EU-AIA-26-"))
  .map((r) => r.delta_pp[DEPLOYER.id] || 0)
  .reduce((s, v) => s + v, 0);
t("Article 26 cap 35pp enforced", total26 <= 35.001 && total26 > 34.0, `total26=${total26}`);

const d = applyEuRuleSet({
  attributable: { [PROVIDER.id]: 0.5, [DEPLOYER.id]: 0.5 },
  actors: [PROVIDER, DEPLOYER],
  flags: {
    high_risk_ai: true,
    provider_failed_to_supply_instructions: true,
    deployer_used_contrary_to_instructions: true,
    provider_breach_was_unforeseeable: true,
  },
});
const r261 = d.applied_rules.find((r) => r.rule_id === "EU-AIA-26-1");
t("EU-AIA-9-B halves Art.26 modifiers when provider failed to supply instructions",
  r261 && close(r261.delta_pp[DEPLOYER.id], 6, 0.01),
  `dpp=${r261?.delta_pp[DEPLOYER.id]}`);

const e = applyEuRuleSet({
  attributable: { [PROVIDER.id]: 1.0 },
  actors: [PROVIDER],
  flags: { high_risk_ai: true, ai_is_opaque_black_box: true, provider_breach_was_unforeseeable: true },
});
t("EU-PLD-03 sets presumption_in_claimant_favour", e.presumption_in_claimant_favour === true);

const NON_EU = { id: "vendor_us", type: "vendor", eu_resident: false, unrecoverable: true };
const f = applyEuRuleSet({
  attributable: { [NON_EU.id]: 0.5, [DEPLOYER.id]: 0.5 },
  actors: [NON_EU, DEPLOYER],
  flags: { high_risk_ai: true, provider_breach_was_unforeseeable: true },
});
t("EU-PLD-05 strands non-EU recoverable", close(f.recoverable[NON_EU.id], 0));
t("EU-PLD-05 redistributes to deployer", close(f.recoverable[DEPLOYER.id], 1.0));

const g = applyEuRuleSet({
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
const sumA = Object.values(g.attributable).reduce((s, v) => s + v, 0);
const sumR = Object.values(g.recoverable).reduce((s, v) => s + v, 0);
t("attributable sums to 1.0", close(sumA, 1.0));
t("recoverable sums to 1.0", close(sumR, 1.0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
