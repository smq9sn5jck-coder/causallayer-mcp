/**
 * FK-METHOD-2026-004 — Multi-jurisdiction overlay (jurisdiction.ts)
 *
 * Wraps the existing EU rule-set (eu-rules.ts) and adds parallel overlays
 * for AU (Australia), US (federal Restatement-Third baseline + selected
 * sector regs), UK, and CA. The function the buyer ultimately calls is
 * `compareJurisdictions()`, which takes one canonical apportionment and
 * returns the per-jurisdiction post-overlay shares side-by-side, plus
 * the citable rules that fired in each.
 *
 * --------------------------------------------------------------------
 * Honesty markers
 * --------------------------------------------------------------------
 * The EU overlay (FK-METHOD-2026-002 et al.) is a full implementation
 * grounded in the actual AI Act + revised PLD. The AU overlay is a
 * substantive first-cut grounded in the Civil Liability Act 2002 (NSW)
 * proportionate-liability regime, the Australian Consumer Law statutory
 * guarantees, and APRA CPS 230 third-party-risk obligations — all of
 * which are real, citable, and currently in force.
 *
 * The US, UK, and CA overlays in v1 are EXPLICITLY MARKED as research
 * stubs. They emit a single `applied_rules` entry pointing to the
 * authority that WILL govern the analysis (Restatement (Third) of Torts
 * §§7-9 for US, Consumer Protection Act 1987 + AI (Reg.) Bill 2024 for
 * UK, AIDA Bill C-27 + PIPEDA for CA), and they leave the input shares
 * unchanged. This is the only honest way to ship a multi-jurisdiction
 * comparison surface without inventing law that doesn't exist or
 * pretending we've finished research that we haven't.
 *
 * v2 will populate US, UK, CA with real numeric overlays once the
 * research debt clears. The catalog version bumps when that happens.
 *
 * --------------------------------------------------------------------
 * Authority anchors (EXACT cites, no paraphrasing)
 * --------------------------------------------------------------------
 *  AU
 *    - Civil Liability Act 2002 (NSW) Pt 4 — proportionate liability
 *      https://legislation.nsw.gov.au/view/html/inforce/current/act-2002-022
 *    - Australian Consumer Law (Schedule 2, Competition and Consumer Act 2010 (Cth))
 *      §§54-59, §§64-64A — statutory guarantees / non-excludability
 *      https://www.legislation.gov.au/F2010L02867/latest/text
 *    - APRA Prudential Standard CPS 230 — Operational Risk Management
 *      https://www.apra.gov.au/operational-risk-management-cps-230
 *    - Voluntary AI Safety Standard (DISR, Sept 2024)
 *      https://www.industry.gov.au/publications/voluntary-ai-safety-standard
 *
 *  US (stub)
 *    - Restatement (Third) of Torts: Apportionment of Liability §§7-9
 *      (American Law Institute, 2000)
 *    - Restatement (Third) of Torts: Products Liability §2(c) — failure to warn
 *      (American Law Institute, 1998)
 *    - Executive Order 14110 (rescinded Jan 2025) — referenced for transition
 *      https://www.federalregister.gov/d/2023-24283
 *
 *  UK (stub)
 *    - Consumer Protection Act 1987 c. 43 — Part I (product liability)
 *      https://www.legislation.gov.uk/ukpga/1987/43/contents
 *    - AI (Regulation) Bill HL Bill 11 (2024) — referenced as forthcoming
 *      https://bills.parliament.uk/bills/3942
 *
 *  CA (stub)
 *    - Artificial Intelligence and Data Act, Bill C-27 Part 3 (2022, in committee)
 *      https://www.parl.ca/DocumentViewer/en/44-1/bill/C-27/first-reading
 *    - PIPEDA RSC 1985 c. P-8.6 — privacy & automated-decision provisions
 *      https://laws-lois.justice.ca/eng/acts/p-8.6/
 *
 *  Mapping document: see docs/jurisdiction-overlay.md.
 */

import {
  applyEuRuleSet,
  euGateEngages,
  RULE_SET_VERSION as EU_RULE_SET_VERSION,
  type AppliedRule,
  type EuActor,
  type EuRuleFlags,
  type EuShareInput,
  type EuShareOutput,
} from "./eu-rules.js";

export const JURISDICTION_OVERLAY_VERSION = "v1.0.0" as const;
export type JurisdictionCode = "AU" | "EU" | "US" | "UK" | "CA";
export const SUPPORTED_JURISDICTIONS: readonly JurisdictionCode[] = [
  "AU",
  "EU",
  "US",
  "UK",
  "CA",
] as const;

// ── AU-specific actor + flags (parallel structure to EuActor / EuRuleFlags) ──
export type AuActor = {
  id: string;
  type: "ai_system" | "vendor" | "deployer" | "human_operator" | "user" | "third_party";
  /** APRA-regulated entity (bank, insurer, super fund, ADI). Triggers CPS 230. */
  apra_regulated?: boolean;
  /** Supplier of goods/services to a consumer under the ACL (most B2C cases). */
  acl_supplier?: boolean;
  /** Insolvent / unidentifiable / out-of-jurisdiction → NSW PLA reallocation gate. */
  unrecoverable?: boolean;
};
export type AuRuleFlags = {
  /** Damage falls within ACL major-failure / consumer-guarantee scope. */
  acl_major_failure?: boolean;
  /** Service was a "financial service" under §12BAB ASIC Act → CPS 230 reach. */
  is_apra_regulated_service?: boolean;
  /** APRA-regulated deployer materially failed §31 third-party risk obligations. */
  cps230_thirdparty_breach?: boolean;
  /** APRA-regulated deployer materially failed §17-§22 op-risk obligations. */
  cps230_operational_breach?: boolean;
  /** Deployer adhered to the Voluntary AI Safety Standard (mitigation). */
  vaiss_adherent?: boolean;
  /** Vendor failed to supply documentation analogous to AI Act Annex IV. */
  vendor_no_docs?: boolean;
};

/**
 * AU overlay (Australia). v1 is a substantive first-cut. The deltas are
 * conservative; the rationale for each rule cites specific sections.
 *
 * Combined modifier cap: ±25 pp pre-renormalisation.
 */
export function applyAuRuleSet(input: {
  attributable: Record<string, number>;
  actors: AuActor[];
  flags: AuRuleFlags;
}): {
  attributable: Record<string, number>;
  recoverable: Record<string, number>;
  joint_and_several_chain: string[];
  applied_rules: AppliedRule[];
  rule_set_version: "au-v1";
} {
  const applied: AppliedRule[] = [];
  const attributable = clone(input.attributable);
  const recoverable = clone(input.attributable);
  const vendor = input.actors.find((a) => a.type === "vendor") ?? null;
  const deployer = input.actors.find((a) => a.type === "deployer") ?? null;

  const AU_CAP = 0.25;
  let accumulated = 0;
  function shift(rule: AppliedRule, fromId: string, toId: string, basePp: number) {
    const headroom = Math.max(0, AU_CAP - accumulated);
    const applied_pp = Math.min(basePp, headroom);
    if (applied_pp <= 0) return;
    accumulated += applied_pp;
    bump(attributable, fromId, -applied_pp);
    bump(attributable, toId, +applied_pp);
    rule.delta_pp = {
      [fromId]: +(-applied_pp * 100).toFixed(2),
      [toId]: +(+applied_pp * 100).toFixed(2),
    };
    applied.push(rule);
  }

  // ── AU-ACL-01 — non-excludable consumer-guarantee floor (recoverable) ──
  // ACL §§54-59 + §64 means a vendor cannot contract out of statutory
  // guarantees in a B2C supply. Recoverable share is floored at 25% on
  // the supplier of record.
  const aclSupplier =
    input.actors.find((a) => a.acl_supplier) ?? vendor ?? null;
  if (aclSupplier && input.flags.acl_major_failure) {
    const FLOOR = 0.25;
    const before = recoverable[aclSupplier.id] ?? 0;
    if (before < FLOOR) {
      const delta = FLOOR - before;
      recoverable[aclSupplier.id] = FLOOR;
      applied.push({
        rule_id: "AU-ACL-01",
        authority_url:
          "https://www.legislation.gov.au/F2010L02867/latest/text",
        description:
          "Australian Consumer Law major-failure: supplier recoverable share floored at 25% (ACL §§54, 64).",
        delta_pp: { [aclSupplier.id]: +(delta * 100).toFixed(2) },
      });
    }
  }

  // ── AU-CPS230-01 — third-party-risk breach (deployer +12 pp) ───────────
  if (deployer && vendor && input.flags.cps230_thirdparty_breach) {
    shift(
      {
        rule_id: "AU-CPS230-01",
        authority_url:
          "https://www.apra.gov.au/operational-risk-management-cps-230",
        description:
          "APRA CPS 230 §31 third-party-risk breach: deployer attributable share +12 pp transferred from vendor.",
        delta_pp: {},
      },
      vendor.id,
      deployer.id,
      0.12
    );
  }

  // ── AU-CPS230-02 — operational-risk breach (deployer +8 pp) ────────────
  if (deployer && vendor && input.flags.cps230_operational_breach) {
    shift(
      {
        rule_id: "AU-CPS230-02",
        authority_url:
          "https://www.apra.gov.au/operational-risk-management-cps-230",
        description:
          "APRA CPS 230 §§17-22 operational-risk breach: deployer attributable share +8 pp transferred from vendor.",
        delta_pp: {},
      },
      vendor.id,
      deployer.id,
      0.08
    );
  }

  // ── AU-VAISS-01 — Voluntary AI Safety Standard adherence (deployer −5 pp) ─
  if (deployer && vendor && input.flags.vaiss_adherent) {
    shift(
      {
        rule_id: "AU-VAISS-01",
        authority_url:
          "https://www.industry.gov.au/publications/voluntary-ai-safety-standard",
        description:
          "Voluntary AI Safety Standard adherence: deployer attributable share −5 pp credited from vendor.",
        delta_pp: {},
      },
      deployer.id,
      vendor.id,
      0.05
    );
  }

  // ── AU-ACL-02 — vendor documentation failure (vendor +5 pp) ────────────
  if (vendor && deployer && input.flags.vendor_no_docs) {
    shift(
      {
        rule_id: "AU-ACL-02",
        authority_url:
          "https://www.legislation.gov.au/F2010L02867/latest/text",
        description:
          "ACL §§54+58 fitness/use disclosure failure: vendor attributable share +5 pp transferred from deployer.",
        delta_pp: {},
      },
      deployer.id,
      vendor.id,
      0.05
    );
  }

  // ── AU-PLA-01 — Civil Liability Act 2002 (NSW) reallocation ────────────
  // Stranded actors' recoverable shares redistribute to the remaining
  // recoverable defendants pro rata to existing share. This mirrors the
  // proportionate-liability "concurrent wrongdoer" mechanic (Pt 4).
  const chain = input.actors
    .map((a) => a.id)
    .filter((id) => (recoverable[id] ?? 0) > 0 && !input.actors.find((a) => a.id === id)?.unrecoverable);
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
        rule_id: "AU-PLA-01",
        authority_url:
          "https://legislation.nsw.gov.au/view/html/inforce/current/act-2002-022",
        description:
          "Civil Liability Act 2002 (NSW) Pt 4 proportionate liability: stranded shares reallocated pro rata.",
        delta_pp: deltas,
      });
    }
  }

  return {
    attributable: renormalise(attributable),
    recoverable: renormalise(recoverable),
    joint_and_several_chain: chain,
    applied_rules: applied,
    rule_set_version: "au-v1",
  };
}

/**
 * Stub overlay for jurisdictions where research is not yet at
 * publication grade. Returns the input shares unchanged and emits a
 * single `applied_rules` entry pointing to the authority anchor with a
 * `stub_pending_research` discriminator. This is intentional so the
 * surface is complete (a buyer can call all five jurisdictions) but
 * the research debt is visible in the response.
 */
function applyStubOverlay(
  jurisdiction: JurisdictionCode,
  attributable: Record<string, number>,
  ruleId: string,
  authorityUrl: string,
  description: string
): {
  attributable: Record<string, number>;
  recoverable: Record<string, number>;
  joint_and_several_chain: string[];
  applied_rules: AppliedRule[];
  rule_set_version: string;
} {
  return {
    attributable: clone(attributable),
    recoverable: clone(attributable),
    joint_and_several_chain: [],
    applied_rules: [
      {
        rule_id: ruleId,
        authority_url: authorityUrl,
        description: `STUB_PENDING_RESEARCH: ${description}`,
        delta_pp: {},
      },
    ],
    rule_set_version: `${jurisdiction.toLowerCase()}-stub-v1`,
  };
}

export type CompareInput = {
  /** Canonical pre-overlay apportionment from the engine. */
  attributable: Record<string, number>;
  /** All actors, with the union of all jurisdiction-specific role tags. */
  actors: Array<EuActor & AuActor>;
  /** Union of all jurisdiction-specific flags. */
  flags: EuRuleFlags & AuRuleFlags;
  /** Subset of jurisdictions to compute; defaults to all five. */
  jurisdictions?: readonly JurisdictionCode[];
  /** Existing engine `jurisdiction` field (for EU gate). */
  primaryJurisdiction?: string;
};

export type PerJurisdictionResult = {
  jurisdiction: JurisdictionCode;
  engaged: boolean;
  attributable: Record<string, number>;
  recoverable: Record<string, number>;
  joint_and_several_chain: string[];
  applied_rules: AppliedRule[];
  rule_set_version: string;
  /** True if this jurisdiction's overlay is a research stub in v1. */
  is_stub: boolean;
};

export type CompareOutput = {
  ruleId: "FK-METHOD-2026-004";
  ruleName: "Multi-Jurisdiction Overlay v1";
  catalogVersion: typeof JURISDICTION_OVERLAY_VERSION;
  before: { attributable: Record<string, number> };
  byJurisdiction: PerJurisdictionResult[];
  /** Side-by-side table: party → jurisdiction → attributable share. */
  matrix: {
    parties: string[];
    rows: Record<string, Record<JurisdictionCode, number | null>>;
  };
  /** Aggregated citation list across every jurisdiction that engaged. */
  citations: string[];
  warnings: string[];
};

/** Buyer-facing function: same input → 5 jurisdictions side-by-side. */
export function compareJurisdictions(input: CompareInput): CompareOutput {
  const targets = (input.jurisdictions ?? SUPPORTED_JURISDICTIONS) as readonly JurisdictionCode[];
  const warnings: string[] = [];
  const citations = new Set<string>();
  const byJurisdiction: PerJurisdictionResult[] = [];

  for (const jx of targets) {
    if (jx === "EU") {
      const gate = euGateEngages(input.primaryJurisdiction, input.flags);
      if (!gate) {
        byJurisdiction.push({
          jurisdiction: "EU",
          engaged: false,
          attributable: clone(input.attributable),
          recoverable: clone(input.attributable),
          joint_and_several_chain: [],
          applied_rules: [],
          rule_set_version: EU_RULE_SET_VERSION,
          is_stub: false,
        });
        continue;
      }
      const euInput: EuShareInput = {
        attributable: clone(input.attributable),
        actors: input.actors,
        flags: input.flags,
      };
      const out: EuShareOutput = applyEuRuleSet(euInput);
      for (const r of out.applied_rules) citations.add(r.authority_url);
      byJurisdiction.push({
        jurisdiction: "EU",
        engaged: true,
        attributable: out.attributable,
        recoverable: out.recoverable,
        joint_and_several_chain: out.joint_and_several_chain,
        applied_rules: out.applied_rules,
        rule_set_version: out.rule_set_version,
        is_stub: false,
      });
      continue;
    }

    if (jx === "AU") {
      const out = applyAuRuleSet({
        attributable: clone(input.attributable),
        actors: input.actors,
        flags: input.flags,
      });
      for (const r of out.applied_rules) citations.add(r.authority_url);
      byJurisdiction.push({
        jurisdiction: "AU",
        engaged: true,
        attributable: out.attributable,
        recoverable: out.recoverable,
        joint_and_several_chain: out.joint_and_several_chain,
        applied_rules: out.applied_rules,
        rule_set_version: out.rule_set_version,
        is_stub: false,
      });
      continue;
    }

    // US / UK / CA — research stubs in v1.
    const stubMeta: Record<"US" | "UK" | "CA", { id: string; url: string; desc: string }> = {
      US: {
        id: "US-RESTATEMENT-STUB-01",
        url: "https://www.ali.org/publications/show/torts-apportionment-liability/",
        desc:
          "United States overlay grounded in Restatement (Third) of Torts: Apportionment of Liability §§7-9 and Products Liability §2(c). Numeric overlay pending v2 research.",
      },
      UK: {
        id: "UK-CPA-STUB-01",
        url: "https://www.legislation.gov.uk/ukpga/1987/43/contents",
        desc:
          "United Kingdom overlay grounded in Consumer Protection Act 1987 Part I and AI (Regulation) Bill HL 11 (2024). Numeric overlay pending v2 research.",
      },
      CA: {
        id: "CA-AIDA-STUB-01",
        url:
          "https://www.parl.ca/DocumentViewer/en/44-1/bill/C-27/first-reading",
        desc:
          "Canada overlay grounded in AIDA (Bill C-27 Part 3) and PIPEDA. Numeric overlay pending v2 research.",
      },
    };
    const meta = stubMeta[jx as "US" | "UK" | "CA"];
    const out = applyStubOverlay(jx, input.attributable, meta.id, meta.url, meta.desc);
    citations.add(meta.url);
    warnings.push(`stub_pending_research:${jx}`);
    byJurisdiction.push({
      jurisdiction: jx,
      engaged: true,
      attributable: out.attributable,
      recoverable: out.recoverable,
      joint_and_several_chain: out.joint_and_several_chain,
      applied_rules: out.applied_rules,
      rule_set_version: out.rule_set_version,
      is_stub: true,
    });
  }

  // Build the side-by-side matrix.
  const parties = Array.from(
    new Set(byJurisdiction.flatMap((j) => Object.keys(j.attributable)))
  ).sort();
  const rows: Record<string, Record<JurisdictionCode, number | null>> = {};
  for (const p of parties) {
    rows[p] = { AU: null, EU: null, US: null, UK: null, CA: null };
    for (const j of byJurisdiction) {
      rows[p]![j.jurisdiction] = +(j.attributable[p] ?? 0).toFixed(3);
    }
  }

  return {
    ruleId: "FK-METHOD-2026-004",
    ruleName: "Multi-Jurisdiction Overlay v1",
    catalogVersion: JURISDICTION_OVERLAY_VERSION,
    before: { attributable: clone(input.attributable) },
    byJurisdiction,
    matrix: { parties, rows },
    citations: Array.from(citations).sort(),
    warnings,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────
function clone<T extends Record<string, number>>(o: T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(o)) out[k] = o[k]!;
  return out;
}
function bump(o: Record<string, number>, k: string, d: number) {
  o[k] = +(((o[k] ?? 0) + d)).toFixed(6);
}
function renormalise(o: Record<string, number>): Record<string, number> {
  const sum = Object.values(o).reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0) return clone(o);
  const out: Record<string, number> = {};
  for (const k of Object.keys(o)) out[k] = +(Math.max(0, o[k] ?? 0) / sum).toFixed(3);
  // Push rounding drift onto the largest party.
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  const drift = +(1 - total).toFixed(6);
  if (Math.abs(drift) > 0) {
    let largest = Object.keys(out)[0]!;
    for (const k of Object.keys(out)) if ((out[k] ?? 0) > (out[largest] ?? 0)) largest = k;
    out[largest] = +(((out[largest] ?? 0) + drift)).toFixed(3);
  }
  return out;
}
