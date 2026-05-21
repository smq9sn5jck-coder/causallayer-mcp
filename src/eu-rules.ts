/**
 * FaultKey Engine — EU Jurisdiction Rule-Set v1 (rule_set_version: "eu-v1")
 *
 * Implements deterministic, statute-cited gates and modifiers for incidents
 * scored under EU law. Every rule cites its operative clause; no coefficient
 * exists without a corresponding source URL.
 *
 * Authorities (verified primary sources):
 *   - Regulation (EU) 2024/1689 (AI Act)
 *       http://data.europa.eu/eli/reg/2024/1689/oj
 *   - Directive (EU) 2024/2853 (revised Product Liability Directive)
 *       http://data.europa.eu/eli/dir/2024/2853/oj
 *
 * The proposed AI Liability Directive (COM(2022) 496) was formally withdrawn
 * by the European Commission in February 2025 (notice published in the
 * Official Journal on 6 October 2025). It is NOT used as authority anywhere
 * in this module.
 *
 * Mapping document: see eu-rules-research/02-mapping-draft.md (committed
 * separately for public review).
 */

export const RULE_SET_VERSION = "eu-v1" as const;

// ─── Types ────────────────────────────────────────────────────────────────

export type EuActor = {
  id: string;
  /** Existing agent type tag from the engine input. */
  type: "ai_system" | "vendor" | "deployer" | "human_operator" | "user" | "third_party";
  /** Optional EU-chain role; multiple may apply. */
  eu_chain_member?: Array<
    | "manufacturer"
    | "authorised_representative"
    | "importer"
    | "fulfilment_service_provider"
    | "distributor"
    | "online_platform_self_supplier"
    | "substantial_modifier"
  >;
  /** True if the actor is established in the EU/EEA. */
  eu_resident?: boolean;
  /** True if the actor is known to be insolvent / unidentifiable / out-of-reach. */
  unrecoverable?: boolean;
};

export type EuRuleFlags = {
  /** AI Act Annex III high-risk system. */
  high_risk_ai: boolean;
  /** Damage type falls within revised PLD compensable categories (death, personal injury, etc.). */
  pld_compensable_damage?: boolean;

  // ── Article 26 deployer-breach triggers ────────────────────────────────
  deployer_used_contrary_to_instructions?: boolean;          // 26(1)
  human_oversight_unassigned_or_unqualified?: boolean;       // 26(2) — primary
  human_oversight_nominally_assigned_not_present?: boolean;  // 26(2) — secondary
  deployer_input_data_unrepresentative?: boolean;            // 26(4)
  deployer_ignored_risk_signal?: boolean;                    // 26(5) ¶1
  deployer_failed_serious_incident_notification?: boolean;   // 26(5) ¶2
  deployer_destroyed_logs?: boolean;                         // 26(6)
  deployer_employer_no_worker_notice?: boolean;              // 26(7)
  deployer_public_authority_unregistered?: boolean;          // 26(8)

  // ── Provider-side reverse triggers ─────────────────────────────────────
  provider_failed_to_supply_instructions?: boolean;          // 9(5)(c) / 13
  provider_breach_was_unforeseeable?: boolean;               // 9(5)(c) limit

  // ── PLD presumption triggers ───────────────────────────────────────────
  ai_is_opaque_black_box?: boolean;                          // EU-PLD-03
  defendant_failed_disclosure_order?: boolean;               // EU-PLD-04 (post-resolution only)

  // ── Substantial modifier ───────────────────────────────────────────────
  substantial_modification_present?: boolean;                // EU-PLD-02
  /** Modifier-side documented degree of change in [0,1]; scales transferred share. */
  substantial_modification_severity?: number;
};

export type EuShareInput = {
  /** Map of actor.id → attributable share (raw, pre-EU). Sum should be ~1.0 within tolerance. */
  attributable: Record<string, number>;
  actors: EuActor[];
  flags: EuRuleFlags;
};

export type AppliedRule = {
  rule_id: string;
  authority_url: string;
  description: string;
  /** Per-actor delta in percentage points applied by this rule. */
  delta_pp: Record<string, number>;
};

export type EuShareOutput = {
  /** Shares after EU rule-set is applied; numerically distinct from attributable. */
  attributable: Record<string, number>;
  recoverable: Record<string, number>;
  presumption_in_claimant_favour: boolean;
  joint_and_several_chain: string[];
  applied_rules: AppliedRule[];
  rule_set_version: typeof RULE_SET_VERSION;
};

// ─── Gates ─────────────────────────────────────────────────────────────────

/**
 * Gate G-EU-1 + G-EU-2.
 *
 * Returns true if EU rule-set should engage at all.
 *  - jurisdiction must be EU/EEA
 *  - either the AI is high-risk under AI Act Annex III, or the damage falls
 *    within the revised PLD's compensable categories.
 *
 * Authority: TFEU Art. 16; AI Act Art. 2(1) and Art. 6 + Annex III;
 *            PLD 2024/2853 Art. 6.
 */
export function euGateEngages(
  jurisdiction: string | undefined,
  flags: { high_risk_ai?: boolean; pld_compensable_damage?: boolean }
): boolean {
  if (!jurisdiction) return false;
  const EU_JURISDICTIONS = new Set([
    "EU", "EEA",
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
    "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
    "IS","LI","NO",
  ]);
  if (!EU_JURISDICTIONS.has(jurisdiction)) return false;
  return Boolean(flags.high_risk_ai || flags.pld_compensable_damage);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const PROVIDER_TYPES: Array<EuActor["type"]> = ["ai_system", "vendor"];
const DEPLOYER_TYPES: Array<EuActor["type"]> = ["deployer"];

function pickProvider(actors: EuActor[]): EuActor | undefined {
  return actors.find((a) => PROVIDER_TYPES.includes(a.type));
}
function pickDeployer(actors: EuActor[]): EuActor | undefined {
  return actors.find((a) => DEPLOYER_TYPES.includes(a.type));
}
function clone(s: Record<string, number>): Record<string, number> {
  return JSON.parse(JSON.stringify(s));
}

/** Renormalise so all actor shares sum to 1.0 (avoids drift from clipping). */
function renormalise(shares: Record<string, number>): Record<string, number> {
  const total = Object.values(shares).reduce((s, v) => s + v, 0);
  if (total <= 0) return shares;
  const out: Record<string, number> = {};
  for (const k of Object.keys(shares)) out[k] = +(shares[k]! / total).toFixed(6);
  return out;
}

/** Apply a delta to one actor's share, clamping to [0,1]. */
function bump(shares: Record<string, number>, id: string, deltaFraction: number): void {
  const current = shares[id] ?? 0;
  shares[id] = Math.max(0, Math.min(1, current + deltaFraction));
}

// ─── Rule-set entry point ──────────────────────────────────────────────────

/**
 * Apply the eu-v1 rule-set to a pre-computed attributable share map.
 * The function is pure; it returns a new object and does not mutate input.
 *
 * Combined modifier cap on Article 26 deployer-breach rules: +35 pp before
 * post-normalisation. This is enforced after all rules accumulate, then the
 * map is renormalised to sum to 1.0.
 */
export function applyEuRuleSet(input: EuShareInput): EuShareOutput {
  const applied: AppliedRule[] = [];
  const attributable = clone(input.attributable);
  const recoverable = clone(input.attributable);
  const provider = pickProvider(input.actors);
  const deployer = pickDeployer(input.actors);

  // ── EU-PLD-01 — strict-liability provider floor (recoverable only) ────
  if (provider) {
    const PROVIDER_FLOOR = 0.25;
    const before = recoverable[provider.id] ?? 0;
    if (before < PROVIDER_FLOOR) {
      const delta = PROVIDER_FLOOR - before;
      recoverable[provider.id] = PROVIDER_FLOOR;
      applied.push({
        rule_id: "EU-PLD-01",
        authority_url:
          "http://data.europa.eu/eli/dir/2024/2853/oj#recital_6",
        description:
          "Strict-liability provider floor: recoverable share floored at 25% under PLD 2024/2853.",
        delta_pp: { [provider.id]: +(delta * 100).toFixed(2) },
      });
    }
  }

  // ── EU-PLD-02 — substantial-modifier reattribution (attributable) ──────
  if (
    input.flags.substantial_modification_present &&
    provider &&
    deployer
  ) {
    const sev = Math.max(
      0,
      Math.min(1, input.flags.substantial_modification_severity ?? 0.5)
    );
    // Linear interpolation between 30% and 70% of provider share.
    const transferFraction = 0.3 + 0.4 * sev;
    const providerShare = attributable[provider.id] ?? 0;
    const transferred = providerShare * transferFraction;
    bump(attributable, provider.id, -transferred);
    bump(attributable, deployer.id, +transferred);
    applied.push({
      rule_id: "EU-PLD-02",
      authority_url:
        "http://data.europa.eu/eli/dir/2024/2853/oj#article_8",
      description:
        "Substantial modifier deemed manufacturer for the modification (PLD Art. 8).",
      delta_pp: {
        [provider.id]: +(-transferred * 100).toFixed(2),
        [deployer.id]: +(+transferred * 100).toFixed(2),
      },
    });
  }

  // ── EU-PLD-03 — black-box presumption flag ─────────────────────────────
  let presumption = false;
  if (input.flags.ai_is_opaque_black_box) {
    presumption = true;
    applied.push({
      rule_id: "EU-PLD-03",
      authority_url:
        "http://data.europa.eu/eli/dir/2024/2853/oj#article_10",
      description:
        "Black-box presumption: technical/scientific complexity shifts evidentiary burden in claimant's favour (PLD Art. 10).",
      delta_pp: {},
    });
  }

  // ── EU-PLD-04 — disclosure-failure presumption (recoverable floor) ─────
  if (input.flags.defendant_failed_disclosure_order) {
    presumption = true;
    // Apply 50% floor to all named defendants who failed disclosure.
    // We model this as: every recoverable share that is non-zero is
    // floored at 50% per defendant who failed; this is a coarse model
    // and intentionally fires only post-resolution.
    for (const a of input.actors) {
      if ((recoverable[a.id] ?? 0) > 0 && (recoverable[a.id] ?? 0) < 0.5) {
        const before = recoverable[a.id] ?? 0;
        recoverable[a.id] = 0.5;
        applied.push({
          rule_id: "EU-PLD-04",
          authority_url:
            "http://data.europa.eu/eli/dir/2024/2853/oj#article_9",
          description:
            "Disclosure failure presumption: recoverable share floored at 50% (PLD Art. 9 / Art. 10).",
          delta_pp: { [a.id]: +((0.5 - before) * 100).toFixed(2) },
        });
      }
    }
  }

  // ── Article 26 deployer-breach modifiers (capped at +35 pp combined) ──
  if (deployer) {
    const article26: Array<[keyof EuRuleFlags, string, string, number]> = [
      ["deployer_used_contrary_to_instructions",
        "EU-AIA-26-1",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.12],
      ["human_oversight_unassigned_or_unqualified",
        "EU-AIA-26-2a",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.10],
      ["human_oversight_nominally_assigned_not_present",
        "EU-AIA-26-2b",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.08],
      ["deployer_input_data_unrepresentative",
        "EU-AIA-26-4",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.09],
      ["deployer_ignored_risk_signal",
        "EU-AIA-26-5a",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.11],
      ["deployer_failed_serious_incident_notification",
        "EU-AIA-26-5b",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.06],
      ["deployer_destroyed_logs",
        "EU-AIA-26-6",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.05],
      ["deployer_employer_no_worker_notice",
        "EU-AIA-26-7",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.04],
      ["deployer_public_authority_unregistered",
        "EU-AIA-26-8",
        "http://data.europa.eu/eli/reg/2024/1689/oj#article_26", 0.06],
    ];

    // Special case: 26-2a and 26-2b do not stack; if both flagged, take 26-2a.
    let twoAFired = false;

    let accumulated = 0;
    const ART26_CAP = 0.35;
    const articleApplied: AppliedRule[] = [];

    // EU-AIA-9-B reduces all Art. 26 deltas by 50% if provider failed to
    // supply instructions for use.
    const reductionFactor = input.flags.provider_failed_to_supply_instructions ? 0.5 : 1.0;

    for (const [flagKey, ruleId, url, basePp] of article26) {
      if (!input.flags[flagKey]) continue;
      if (ruleId === "EU-AIA-26-2a") twoAFired = true;
      if (ruleId === "EU-AIA-26-2b" && twoAFired) continue;

      const headroom = Math.max(0, ART26_CAP - accumulated);
      const desired = basePp * reductionFactor;
      const applied_pp = Math.min(desired, headroom);
      if (applied_pp <= 0) continue;
      accumulated += applied_pp;
      bump(attributable, deployer.id, +applied_pp);
      if (provider) bump(attributable, provider.id, -applied_pp);
      articleApplied.push({
        rule_id: ruleId,
        authority_url: url,
        description: `AI Act Art. 26 breach modifier (${ruleId}). Reduction factor ${reductionFactor} applied per EU-AIA-9-B.`,
        delta_pp: {
          [deployer.id]: +(applied_pp * 100).toFixed(2),
          ...(provider ? { [provider.id]: +(-applied_pp * 100).toFixed(2) } : {}),
        },
      });
    }
    applied.push(...articleApplied);
  }

  // ── EU-AIA-9-A — provider non-derogation floor (recoverable) ───────────
  // Provider recoverable share never falls below 15% solely from Art. 26
  // shifts unless the breach was unforeseeable.
  if (provider && !input.flags.provider_breach_was_unforeseeable) {
    const FLOOR = 0.15;
    const cur = recoverable[provider.id] ?? 0;
    if (cur < FLOOR) {
      recoverable[provider.id] = FLOOR;
      applied.push({
        rule_id: "EU-AIA-9-A",
        authority_url:
          "http://data.europa.eu/eli/reg/2024/1689/oj#article_9",
        description:
          "Provider non-derogation floor: recoverable share floored at 15% absent proven unforeseeability (AI Act Art. 9(5)(c)).",
        delta_pp: { [provider.id]: +((FLOOR - cur) * 100).toFixed(2) },
      });
    }
  }

  // ── Joint-and-several recoverable redistribution (EU-PLD-05) ──────────
  // Any actor marked unrecoverable has their recoverable share redistributed
  // among the remaining EU-resident actors in proportion to existing share.
  const chain = input.actors
    .filter((a) => a.eu_resident)
    .map((a) => a.id)
    .filter((id) => (recoverable[id] ?? 0) > 0);

  const stranded = input.actors.filter((a) => a.unrecoverable);
  if (stranded.length > 0 && chain.length > 0) {
    let strandedTotal = 0;
    for (const a of stranded) {
      strandedTotal += recoverable[a.id] ?? 0;
      recoverable[a.id] = 0;
    }
    if (strandedTotal > 0) {
      const baseTotal = chain.reduce((s, id) => s + (recoverable[id] ?? 0), 0);
      const deltas: Record<string, number> = {};
      if (baseTotal > 0) {
        for (const id of chain) {
          const w = (recoverable[id] ?? 0) / baseTotal;
          const add = strandedTotal * w;
          recoverable[id] = (recoverable[id] ?? 0) + add;
          deltas[id] = +(add * 100).toFixed(2);
        }
      }
      applied.push({
        rule_id: "EU-PLD-05",
        authority_url:
          "http://data.europa.eu/eli/dir/2024/2853/oj#article_12",
        description:
          "Joint-and-several recoverable redistribution: stranded shares reallocated to EU-resident actors (PLD Art. 12).",
        delta_pp: deltas,
      });
    }
  }

  // ── Final renormalisation ─────────────────────────────────────────────
  const attributableFinal = renormalise(attributable);
  const recoverableFinal = renormalise(recoverable);

  return {
    attributable: attributableFinal,
    recoverable: recoverableFinal,
    presumption_in_claimant_favour: presumption,
    joint_and_several_chain: chain,
    applied_rules: applied,
    rule_set_version: RULE_SET_VERSION,
  };
}
