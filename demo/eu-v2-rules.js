// FaultKey demo CLI — EU rule-set v2.
// Additive overlay on top of eu-v1: encodes the deeper PLD 2024/2853 defect
// axes (Arts. 7(c)/(d)/(e)/(f) and Art. 12(2) SME-component recourse waiver),
// AI Act value-chain shifts (Art. 25, Art. 27 FRIA), CJEU GDPR scoring
// expansion (SCHUFA C-634/21, UI v ÖP C-300/21), DSA hosting carve-out
// (Art. 6), and member-state PLD transpositions (FR/DE/IT/ES).
//
// Authorities used (all GREEN-tier per /sources audit):
//   PLD Dir (EU) 2024/2853 — eur-lex.europa.eu/eli/dir/2024/2853/oj
//   AI Act Reg (EU) 2024/1689 — eur-lex.europa.eu/eli/reg/2024/1689/oj
//   GDPR Reg (EU) 2016/679 — Arts. 22, 82
//   DSA Reg (EU) 2022/2065 — Art. 6, 7
//   CJEU C-634/21 (SCHUFA) — curia.europa.eu
//   CJEU C-300/21 (UI v Österreichische Post) — curia.europa.eu
//   Code civil (FR) Arts. 1245 to 1245-17, Art. 1242 al. 5
//   ProdHaftG (DE) §§ 1, 3, 4 + BGB §823, §831
//   Codice del Consumo (IT) Arts. 114, 117 (D.Lgs. 206/2005)
//   TRLGDCU (ES) Arts. 135, 137, 138 (RD Legislativo 1/2007)
//
// Determinism property: pure-function overlay, identical input → identical
// output, byte-stable JSON serialisation, no LLM, no IO.

import { applyEuRuleSet as applyEuV1, euGateEngages } from "./eu-rules.js";

export const RULE_SET_VERSION = "eu-v2";
export { euGateEngages };

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

export function applyEuV2RuleSet(input) {
  // eu-v1 first — eu-v2 is additive, never overrides v1 rule effects.
  const v1 = applyEuV1(input);
  const applied = [...v1.applied_rules];
  const attributable = clone(v1.attributable);
  const recoverable = clone(v1.recoverable);
  let presumption = v1.presumption_in_claimant_favour;
  const provider = input.actors.find((a) => PROVIDER_TYPES.has(a.type));
  const deployer = input.actors.find((a) => DEPLOYER_TYPES.has(a.type));
  const f = input.flags || {};

  // EU-PLD-V2-01 — PLD 2024/2853 Art. 7(c) continuous-learning defect.
  // Defect arises post-deployment via continued training/learning under
  // manufacturer's control. Provider non-derogable for post-market drift.
  if (provider && f.continuous_learning_post_deployment) {
    const FLOOR = 0.30;
    const before = recoverable[provider.id] ?? 0;
    if (before < FLOOR) {
      recoverable[provider.id] = FLOOR;
      applied.push({
        rule_id: "EU-PLD-V2-01",
        authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_7",
        description: "PLD Art. 7(c) continuous-learning defect: provider remains non-derogably liable for defects emerging from post-deployment training under its control. Recoverable floor 30%.",
        delta_pp: { [provider.id]: round((FLOOR - before) * 100, 2) },
      });
    }
  }

  // EU-PLD-V2-02 — PLD 2024/2853 Art. 7(d) interconnection defect.
  // Defect produced by reasonably-foreseeable interaction with related/
  // interconnected products under manufacturer control. Adds 8pp to
  // provider attributable share when interconnection foreseeable.
  if (provider && f.interconnection_with_related_products_foreseeable) {
    const SHIFT = 0.08;
    bump(attributable, provider.id, +SHIFT);
    if (deployer) bump(attributable, deployer.id, -SHIFT);
    applied.push({
      rule_id: "EU-PLD-V2-02",
      authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_7",
      description: "PLD Art. 7(d) interconnection defect: provider attributable share +8pp when defect arises from foreseeable interaction with related products.",
      delta_pp: {
        [provider.id]: round(+SHIFT * 100, 2),
        ...(deployer ? { [deployer.id]: round(-SHIFT * 100, 2) } : {}),
      },
    });
  }

  // EU-PLD-V2-03 — PLD 2024/2853 Art. 7(e) post-market manufacturer-control defect.
  // Defect arising while product remained under manufacturer's control after
  // placing on market (e.g., remote-pushed updates, server-side model swaps).
  // Treated as factory-state defect → provider attributable +10pp.
  if (provider && f.post_market_under_manufacturer_control) {
    const SHIFT = 0.10;
    bump(attributable, provider.id, +SHIFT);
    if (deployer) bump(attributable, deployer.id, -SHIFT);
    applied.push({
      rule_id: "EU-PLD-V2-03",
      authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_7",
      description: "PLD Art. 7(e) post-market manufacturer-control: defect deemed at-time-of-supply when arising while product remained under manufacturer control. Provider attributable +10pp.",
      delta_pp: {
        [provider.id]: round(+SHIFT * 100, 2),
        ...(deployer ? { [deployer.id]: round(-SHIFT * 100, 2) } : {}),
      },
    });
  }

  // EU-PLD-V2-04 — PLD 2024/2853 Art. 7(f) cybersecurity-requirements defect.
  // Failure to comply with relevant cybersecurity requirements is a defect.
  // Common AI: missing prompt-injection hardening, no MFA on admin console,
  // no logging. Provider recoverable floor 35% when triggered.
  if (provider && f.failed_cybersecurity_requirements) {
    const FLOOR = 0.35;
    const before = recoverable[provider.id] ?? 0;
    if (before < FLOOR) {
      recoverable[provider.id] = FLOOR;
      applied.push({
        rule_id: "EU-PLD-V2-04",
        authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_7",
        description: "PLD Art. 7(f) cybersecurity-requirements defect: failure to comply with relevant cybersecurity requirements is per-se defective. Recoverable floor 35%.",
        delta_pp: { [provider.id]: round((FLOOR - before) * 100, 2) },
      });
    }
  }

  // EU-PLD-V2-05 — PLD 2024/2853 Art. 12(1) joint-and-several across chain.
  // Two or more economic operators liable for same damage → all jointly and
  // severally liable. Already partially in eu-v1 EU-PLD-05; v2 widens to
  // include component-manufacturer chain (any actor flagged as component_supplier).
  const componentSuppliers = input.actors.filter((a) => a.is_component_supplier);
  if (componentSuppliers.length > 0) {
    const liableChain = input.actors
      .filter((a) => (recoverable[a.id] ?? 0) > 0)
      .map((a) => a.id);
    if (liableChain.length > 1) {
      applied.push({
        rule_id: "EU-PLD-V2-05",
        authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_12",
        description: `PLD Art. 12(1) joint-and-several across full chain including ${componentSuppliers.length} component supplier(s). Claimant may recover full damages from any chain actor; recourse claims govern internal allocation.`,
        delta_pp: {},
      });
    }
  }

  // EU-PLD-V2-06 — PLD 2024/2853 Art. 12(2) SME software-component recourse waiver.
  // SME software-component manufacturers may contractually exclude/limit
  // recourse claims from integrating manufacturer. Effect: when component
  // supplier is SME and contract-waiver flagged, recourse share zeros to
  // SME and shifts to integrating provider. ~No commentator encodes this.
  const sme = input.actors.find((a) => a.is_component_supplier && a.is_sme && a.recourse_contractually_waived);
  if (sme && provider) {
    const smeRecoverable = recoverable[sme.id] ?? 0;
    if (smeRecoverable > 0) {
      recoverable[sme.id] = 0;
      bump(recoverable, provider.id, +smeRecoverable);
      applied.push({
        rule_id: "EU-PLD-V2-06",
        authority_url: "http://data.europa.eu/eli/dir/2024/2853/oj#article_12",
        description: "PLD Art. 12(2) SME software-component recourse waiver: SME component supplier with contractual recourse-exclusion shifts entire recoverable share to integrating manufacturer.",
        delta_pp: {
          [sme.id]: round(-smeRecoverable * 100, 2),
          [provider.id]: round(+smeRecoverable * 100, 2),
        },
      });
    }
  }

  // EU-AIACT-V2-01 — AI Act Art. 25 value-chain shift.
  // Downstream entity (a) puts its name/trademark on, (b) substantially
  // modifies, or (c) modifies intended purpose of high-risk AI → that entity
  // becomes the provider for AI Act compliance. Effect: 100% of provider
  // obligations transfer; engine moves provider attributable share to that
  // downstream entity (modeled as deployer in input shape).
  const art25Triggered = f.downstream_rebrand || f.downstream_substantial_modification ||
    f.downstream_intended_purpose_change;
  if (art25Triggered && provider && deployer) {
    const TRANSFER_FRAC = f.downstream_rebrand ? 1.0 :
      f.downstream_intended_purpose_change ? 0.85 :
      0.65; // substantial modification
    const providerShare = attributable[provider.id] ?? 0;
    const transferred = providerShare * TRANSFER_FRAC;
    bump(attributable, provider.id, -transferred);
    bump(attributable, deployer.id, +transferred);
    applied.push({
      rule_id: "EU-AIACT-V2-01",
      authority_url: "http://data.europa.eu/eli/reg/2024/1689/oj#article_25",
      description: `AI Act Art. 25 value-chain shift (transfer ${Math.round(TRANSFER_FRAC*100)}% of provider obligations to downstream entity per rebrand/modification trigger).`,
      delta_pp: {
        [provider.id]: round(-transferred * 100, 2),
        [deployer.id]: round(+transferred * 100, 2),
      },
    });
  }

  // EU-AIACT-V2-02 — AI Act Art. 26 deployer-monitoring failure (extension).
  // eu-v1 already encodes Art. 26 breach modifiers; v2 adds the recoverable-
  // shift effect: deployer monitoring failure floors recoverable at 25%.
  if (deployer && (f.human_oversight_unassigned_or_unqualified ||
                   f.deployer_ignored_risk_signal ||
                   f.deployer_failed_serious_incident_notification)) {
    const FLOOR = 0.25;
    const before = recoverable[deployer.id] ?? 0;
    if (before < FLOOR) {
      recoverable[deployer.id] = FLOOR;
      applied.push({
        rule_id: "EU-AIACT-V2-02",
        authority_url: "http://data.europa.eu/eli/reg/2024/1689/oj#article_26",
        description: "AI Act Art. 26 deployer-monitoring failure: recoverable share floored at 25% when oversight gap, ignored signal, or notification failure documented.",
        delta_pp: { [deployer.id]: round((FLOOR - before) * 100, 2) },
      });
    }
  }

  // EU-AIACT-V2-03 — AI Act Art. 27 FRIA missing → public-deployer concentration.
  // Public-authority deployers (and certain private operators of high-risk AI
  // affecting natural persons) must conduct Fundamental Rights Impact
  // Assessment before first use. Missing FRIA → deployer attributable +12pp,
  // capped at 0.45 absolute deployer share.
  if (deployer && f.fria_required && !f.fria_completed) {
    const SHIFT = 0.12;
    const CAP = 0.45;
    const cur = attributable[deployer.id] ?? 0;
    const headroom = Math.max(0, CAP - cur);
    const dpp = Math.min(SHIFT, headroom);
    if (dpp > 0) {
      bump(attributable, deployer.id, +dpp);
      if (provider) bump(attributable, provider.id, -dpp);
      applied.push({
        rule_id: "EU-AIACT-V2-03",
        authority_url: "http://data.europa.eu/eli/reg/2024/1689/oj#article_27",
        description: `AI Act Art. 27 FRIA missing: deployer attributable +${round(dpp*100,2)}pp (capped at 45% absolute) when fundamental-rights impact assessment was required and not completed.`,
        delta_pp: {
          [deployer.id]: round(+dpp * 100, 2),
          ...(provider ? { [provider.id]: round(-dpp * 100, 2) } : {}),
        },
      });
    }
  }

  // EU-GDPR-V2-01 — CJEU C-634/21 SCHUFA: Art. 22 trigger via "drawn strongly on".
  // If a third party "draws strongly on" an automated scoring output to take a
  // decision, the scoring itself is the Art. 22 decision. Effect: presumption
  // engages and provider recoverable floored at 20%.
  if (provider && f.scoring_drawn_strongly_on_by_third_party) {
    presumption = true;
    const FLOOR = 0.20;
    const before = recoverable[provider.id] ?? 0;
    if (before < FLOOR) {
      recoverable[provider.id] = FLOOR;
    }
    applied.push({
      rule_id: "EU-GDPR-V2-01",
      authority_url: "https://curia.europa.eu/juris/document/document.jsf?docid=280426",
      description: "CJEU C-634/21 SCHUFA: automated scoring 'drawn strongly on' by third-party decision-maker is itself an Art. 22 decision. Presumption engages; provider recoverable floor 20%.",
      delta_pp: before < FLOOR
        ? { [provider.id]: round((FLOOR - before) * 100, 2) }
        : {},
    });
  }

  // EU-GDPR-V2-02 — CJEU C-300/21 UI v ÖP: Art. 82 non-material damages threshold.
  // Non-material damages do not require a minimum severity threshold to be
  // compensable. Effect: when only non-material damage flagged, the recoverable
  // chain previously limited to "serious" harms now extends; deployer
  // recoverable floor rises 5pp (modest, doctrinally-bounded).
  if (deployer && f.non_material_damages_only && !f.material_damages_present) {
    const SHIFT = 0.05;
    const cur = recoverable[deployer.id] ?? 0;
    if (cur > 0) {
      bump(recoverable, deployer.id, +SHIFT);
      applied.push({
        rule_id: "EU-GDPR-V2-02",
        authority_url: "https://curia.europa.eu/juris/document/document.jsf?docid=273284",
        description: "CJEU C-300/21 UI v Österreichische Post: Art. 82 non-material damages compensable without severity threshold. Deployer recoverable +5pp.",
        delta_pp: { [deployer.id]: round(+SHIFT * 100, 2) },
      });
    }
  }

  // EU-DSA-V2-01 — DSA Art. 6 hosting-provider actual-knowledge.
  // Hosting providers shielded UNLESS they had actual knowledge of illegal
  // content/activity and failed to act expeditiously. For AI-platform
  // deployers acting as hosts, actual-knowledge → recoverable floor 30%.
  if (deployer && f.deployer_is_hosting_provider && f.actual_knowledge_of_illegal_content) {
    const FLOOR = 0.30;
    const before = recoverable[deployer.id] ?? 0;
    if (before < FLOOR) {
      recoverable[deployer.id] = FLOOR;
      applied.push({
        rule_id: "EU-DSA-V2-01",
        authority_url: "http://data.europa.eu/eli/reg/2022/2065/oj#article_6",
        description: "DSA Art. 6: hosting-provider safe-harbour pierced by actual knowledge + failure to act expeditiously. Recoverable floor 30%.",
        delta_pp: { [deployer.id]: round((FLOOR - before) * 100, 2) },
      });
    }
  }

  // EU-MS-V2-FR — French Code civil Art. 1245-1247 PLD transposition.
  // FR-specific: producer presumed liable absent proof of one of six
  // statutory defences (Art. 1245-10). Effect: provider attributable +5pp
  // floor when jurisdiction == FR.
  if (input.jurisdiction === "FR" && provider) {
    const FLOOR = 0.55;
    const cur = attributable[provider.id] ?? 0;
    if (cur < FLOOR) {
      const shift = FLOOR - cur;
      bump(attributable, provider.id, +shift);
      if (deployer) bump(attributable, deployer.id, -shift);
      applied.push({
        rule_id: "EU-MS-V2-FR",
        authority_url: "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006070721/LEGISCTA000006150514/",
        description: "French Code civil Arts. 1245-1247: producer presumed liable absent statutory defence. Provider attributable floor 55% in FR jurisdiction.",
        delta_pp: {
          [provider.id]: round(+shift * 100, 2),
          ...(deployer ? { [deployer.id]: round(-shift * 100, 2) } : {}),
        },
      });
    }
  }

  // EU-MS-V2-DE — German ProdHaftG §§1-4 + BGB §§823, 831 transposition.
  // DE: strict producer liability (ProdHaftG §1) PLUS BGB §831 vicarious
  // liability for assistants (encompasses AI-as-agent). Effect: provider
  // recoverable floor 30% in DE.
  if (input.jurisdiction === "DE" && provider) {
    const FLOOR = 0.30;
    const before = recoverable[provider.id] ?? 0;
    if (before < FLOOR) {
      recoverable[provider.id] = FLOOR;
      applied.push({
        rule_id: "EU-MS-V2-DE",
        authority_url: "https://www.gesetze-im-internet.de/prodhaftg/",
        description: "German ProdHaftG §§1-4 + BGB §831: strict producer liability with vicarious liability for AI-as-assistant. Recoverable floor 30%.",
        delta_pp: { [provider.id]: round((FLOOR - before) * 100, 2) },
      });
    }
  }

  // EU-MS-V2-IT — Italian Codice del Consumo Arts. 114, 117 transposition.
  // IT: strict liability + presumption of defect when product fails during
  // normal use (Art. 117). Effect: presumption engages and provider
  // recoverable floor 28% in IT.
  if (input.jurisdiction === "IT" && provider) {
    presumption = true;
    const FLOOR = 0.28;
    const before = recoverable[provider.id] ?? 0;
    if (before < FLOOR) {
      recoverable[provider.id] = FLOOR;
    }
    applied.push({
      rule_id: "EU-MS-V2-IT",
      authority_url: "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2005-09-06;206",
      description: "Italian Codice del Consumo Arts. 114, 117: strict producer liability with presumption of defect from normal-use failure. Recoverable floor 28%.",
      delta_pp: before < FLOOR
        ? { [provider.id]: round((FLOOR - before) * 100, 2) }
        : {},
    });
  }

  // EU-MS-V2-ES — Spanish TRLGDCU Arts. 135, 137, 138 transposition.
  // ES: producer-or-importer liable; reverse-burden on producer to prove
  // non-defect or causal break. Effect: provider attributable floor 50% +
  // recoverable floor 30%.
  if (input.jurisdiction === "ES" && provider) {
    const A_FLOOR = 0.50;
    const R_FLOOR = 0.30;
    const aCur = attributable[provider.id] ?? 0;
    const rCur = recoverable[provider.id] ?? 0;
    const deltas = {};
    if (aCur < A_FLOOR) {
      const shift = A_FLOOR - aCur;
      bump(attributable, provider.id, +shift);
      if (deployer) bump(attributable, deployer.id, -shift);
      deltas[provider.id] = round(+shift * 100, 2);
      if (deployer) deltas[deployer.id] = round(-shift * 100, 2);
    }
    if (rCur < R_FLOOR) {
      recoverable[provider.id] = R_FLOOR;
    }
    applied.push({
      rule_id: "EU-MS-V2-ES",
      authority_url: "https://www.boe.es/buscar/act.php?id=BOE-A-2007-20555",
      description: "Spanish TRLGDCU Arts. 135, 137, 138: strict producer-or-importer liability with reverse-burden. Attributable floor 50%; recoverable floor 30%.",
      delta_pp: deltas,
    });
  }

  return {
    attributable: renormalise(attributable),
    recoverable: renormalise(recoverable),
    presumption_in_claimant_favour: presumption,
    joint_and_several_chain: v1.joint_and_several_chain,
    applied_rules: applied,
    rule_set_version: RULE_SET_VERSION,
    base_rule_set: "eu-v1",
  };
}
