// FaultKey demo CLI — EU rule-set v1, byte-identical mirror of src/eu-rules.ts.
// Authorities: AI Act Reg (EU) 2024/1689 + revised PLD Dir (EU) 2024/2853.
// AI Liability Directive COM(2022) 496 — withdrawn Feb 2025; not used.

export const RULE_SET_VERSION = "eu-v1";

const EU_JURISDICTIONS = new Set([
  "EU","EEA",
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
  "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
  "IS","LI","NO",
]);

export function euGateEngages(jurisdiction, flags) {
  if (!jurisdiction || !EU_JURISDICTIONS.has(jurisdiction)) return false;
  return Boolean(flags && (flags.high_risk_ai || flags.pld_compensable_damage));
}

const PROVIDER_TYPES = new Set(["ai_system", "vendor"]);
const DEPLOYER_TYPES = new Set(["deployer"]);

const round = (n, p = 6) => +n.toFixed(p);
const bump = (s, id, d) => { s[id] = Math.max(0, Math.min(1, (s[id] ?? 0) + d)); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const renormalise = (s) => {
  const t = Object.values(s).reduce((a, b) => a + b, 0);
  if (t <= 0) return s;
  const o = {};
  for (const k of Object.keys(s)) o[k] = round(s[k] / t);
  return o;
};

export function applyEuRuleSet(input) {
  const applied = [];
  const attributable = clone(input.attributable);
  const recoverable = clone(input.attributable);
  const provider = input.actors.find((a) => PROVIDER_TYPES.has(a.type));
  const deployer = input.actors.find((a) => DEPLOYER_TYPES.has(a.type));
  const f = input.flags || {};

  if (provider) {
    const FLOOR = 0.25;
    const before = recoverable[provider.id] ?? 0;
    if (before < FLOOR) {
      recoverable[provider.id] = FLOOR;
      applied.push({
        rule_id: "EU-PLD-01",
        authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#recital_6",
        description: "Strict-liability provider floor: recoverable share floored at 25% under PLD 2024/2853.",
        delta_pp: { [provider.id]: round((FLOOR - before) * 100, 2) },
      });
    }
  }

  if (f.substantial_modification_present && provider && deployer) {
    const sev = Math.max(0, Math.min(1, f.substantial_modification_severity ?? 0.5));
    const transferFraction = 0.3 + 0.4 * sev;
    const providerShare = attributable[provider.id] ?? 0;
    const transferred = providerShare * transferFraction;
    bump(attributable, provider.id, -transferred);
    bump(attributable, deployer.id, +transferred);
    applied.push({
      rule_id: "EU-PLD-02",
      authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_8",
      description: "Substantial modifier deemed manufacturer for the modification (PLD Art. 8).",
      delta_pp: {
        [provider.id]: round(-transferred * 100, 2),
        [deployer.id]: round(+transferred * 100, 2),
      },
    });
  }

  let presumption = false;
  if (f.ai_is_opaque_black_box) {
    presumption = true;
    applied.push({
      rule_id: "EU-PLD-03",
      authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_10",
      description: "Black-box presumption: technical/scientific complexity shifts evidentiary burden in claimant's favour (PLD Art. 10).",
      delta_pp: {},
    });
  }

  if (f.defendant_failed_disclosure_order) {
    presumption = true;
    for (const a of input.actors) {
      const cur = recoverable[a.id] ?? 0;
      if (cur > 0 && cur < 0.5) {
        recoverable[a.id] = 0.5;
        applied.push({
          rule_id: "EU-PLD-04",
          authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_9",
          description: "Disclosure failure presumption: recoverable share floored at 50% (PLD Art. 9 / Art. 10).",
          delta_pp: { [a.id]: round((0.5 - cur) * 100, 2) },
        });
      }
    }
  }

  if (deployer) {
    const reduction = f.provider_failed_to_supply_instructions ? 0.5 : 1.0;
    const ART26 = [
      ["deployer_used_contrary_to_instructions",          "EU-AIA-26-1",  0.12],
      ["human_oversight_unassigned_or_unqualified",       "EU-AIA-26-2a", 0.10],
      ["human_oversight_nominally_assigned_not_present",  "EU-AIA-26-2b", 0.08],
      ["deployer_input_data_unrepresentative",            "EU-AIA-26-4",  0.09],
      ["deployer_ignored_risk_signal",                    "EU-AIA-26-5a", 0.11],
      ["deployer_failed_serious_incident_notification",   "EU-AIA-26-5b", 0.06],
      ["deployer_destroyed_logs",                         "EU-AIA-26-6",  0.05],
      ["deployer_employer_no_worker_notice",              "EU-AIA-26-7",  0.04],
      ["deployer_public_authority_unregistered",          "EU-AIA-26-8",  0.06],
    ];
    const CAP = 0.35;
    let acc = 0;
    let twoAFired = false;
    for (const [key, id, base] of ART26) {
      if (!f[key]) continue;
      if (id === "EU-AIA-26-2a") twoAFired = true;
      if (id === "EU-AIA-26-2b" && twoAFired) continue;
      const headroom = Math.max(0, CAP - acc);
      const desired = base * reduction;
      const dpp = Math.min(desired, headroom);
      if (dpp <= 0) continue;
      acc += dpp;
      bump(attributable, deployer.id, +dpp);
      if (provider) bump(attributable, provider.id, -dpp);
      applied.push({
        rule_id: id,
        authority_url: "http://data.europa.eu/eli/reg/2024/1689/oj#article_26",
        description: `AI Act Art. 26 breach modifier (${id}). Reduction factor ${reduction} applied per EU-AIA-9-B.`,
        delta_pp: {
          [deployer.id]: round(dpp * 100, 2),
          ...(provider ? { [provider.id]: round(-dpp * 100, 2) } : {}),
        },
      });
    }
  }

  if (provider && !f.provider_breach_was_unforeseeable) {
    const FLOOR = 0.15;
    const cur = recoverable[provider.id] ?? 0;
    if (cur < FLOOR) {
      recoverable[provider.id] = FLOOR;
      applied.push({
        rule_id: "EU-AIA-9-A",
        authority_url: "http://data.europa.eu/eli/reg/2024/1689/oj#article_9",
        description: "Provider non-derogation floor: recoverable share floored at 15% absent proven unforeseeability (AI Act Art. 9(5)(c)).",
        delta_pp: { [provider.id]: round((FLOOR - cur) * 100, 2) },
      });
    }
  }

  const chain = input.actors
    .filter((a) => a.eu_resident)
    .map((a) => a.id)
    .filter((id) => (recoverable[id] ?? 0) > 0);
  const stranded = input.actors.filter((a) => a.unrecoverable);
  if (stranded.length > 0 && chain.length > 0) {
    let strandedTotal = 0;
    for (const a of stranded) { strandedTotal += recoverable[a.id] ?? 0; recoverable[a.id] = 0; }
    if (strandedTotal > 0) {
      const baseTotal = chain.reduce((s, id) => s + (recoverable[id] ?? 0), 0);
      const deltas = {};
      if (baseTotal > 0) {
        for (const id of chain) {
          const w = (recoverable[id] ?? 0) / baseTotal;
          const add = strandedTotal * w;
          recoverable[id] = (recoverable[id] ?? 0) + add;
          deltas[id] = round(add * 100, 2);
        }
      }
      applied.push({
        rule_id: "EU-PLD-05",
        authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_12",
        description: "Joint-and-several recoverable redistribution: stranded shares reallocated to EU-resident actors (PLD Art. 12).",
        delta_pp: deltas,
      });
    }
  }

  return {
    attributable: renormalise(attributable),
    recoverable: renormalise(recoverable),
    presumption_in_claimant_favour: presumption,
    joint_and_several_chain: chain,
    applied_rules: applied,
    rule_set_version: RULE_SET_VERSION,
  };
}
