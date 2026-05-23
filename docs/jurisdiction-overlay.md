# FK-METHOD-2026-004 — Multi-Jurisdiction Overlay

**Status:** v1.0.0 — shipped 2026-05-23
**Tool:** `query_jurisdiction_overlay`
**Endpoints:** `POST /api/v2/jurisdiction/overlay`, `GET /api/v2/jurisdiction/catalog`
**Module:** `src/jurisdiction.ts`
**Rule-set version markers:** `eu-v1`, `au-v1`, `us-stub-v1`, `uk-stub-v1`, `ca-stub-v1`

---

## 1. The question this rule answers

A canonical engine apportionment is jurisdiction-neutral. The same incident can produce a different recoverable share against the same defendant in Berlin, Sydney, New York, London, and Toronto because each jurisdiction has different statutes, different presumptions, and different non-delegable duties. Buyers and underwriters need a single call that returns "this is your apportionment, side-by-side, in every jurisdiction that matters" — with the specific statutory authority that drove each delta.

That is the only product surface that lets a global insurer or a multinational deployer make a sourcing or coverage decision without retaining counsel in five jurisdictions.

## 2. What v1 actually ships

| Jurisdiction | Status | Authority anchors used | Behaviour |
|---|---|---|---|
| **EU** (incl. EEA) | Full implementation (eu-v1) | AI Act Reg. 2024/1689 Arts. 9, 13, 26; revised PLD 2024/2853 Arts. 6–12 | Wraps the existing `eu-rules.ts` module verbatim. Engages only when the EU gate fires (high-risk AI under Annex III **or** PLD-compensable damage). |
| **AU** (Australia, NSW-anchored) | Full implementation (au-v1) | Civil Liability Act 2002 (NSW) Pt 4; Australian Consumer Law (Sch. 2 CCA 2010) §§54–59, 64–64A; APRA CPS 230 §§17–22, 31; DISR Voluntary AI Safety Standard (Sept 2024) | Five rules: ACL major-failure floor (AU-ACL-01), CPS 230 third-party-risk breach (AU-CPS230-01), CPS 230 operational-risk breach (AU-CPS230-02), VAISS adherence credit (AU-VAISS-01), ACL documentation failure (AU-ACL-02), proportionate-liability reallocation (AU-PLA-01). Combined modifier cap ±25 pp. |
| **US** | Research stub (us-stub-v1) | Restatement (Third) of Torts: Apportionment §§7–9; Restatement (Third) of Torts: Products Liability §2(c) | Returns input shares unchanged plus a single `applied_rules` entry pointing to the authority anchor with `STUB_PENDING_RESEARCH` description. Warning `stub_pending_research:US` emitted. |
| **UK** | Research stub (uk-stub-v1) | Consumer Protection Act 1987 c. 43 Pt I; AI (Regulation) Bill HL 11 (2024) | Same stub semantics. |
| **CA** | Research stub (ca-stub-v1) | AIDA Bill C-27 Pt 3; PIPEDA RSC 1985 c. P-8.6 | Same stub semantics. |

The stub design is the deliberately honest move. Shipping invented numeric overlays for jurisdictions where the research is not at publication grade would compromise the credibility of every other rule in the engine. The surface is complete (every `query_jurisdiction_overlay` call returns all five jurisdictions), but the response self-discloses which overlays are stubs via `is_stub: true` and a `stub_pending_research:<jx>` warning.

## 3. The AU overlay in detail

### 3.1 Why NSW as the anchor

The Civil Liability Act 2002 (NSW) Pt 4 codifies proportionate liability for "claims for economic loss or damage to property in an action for damages arising from a failure to take reasonable care" (s 34(1)(a)). The Commonwealth Trade Practices Act 1974 (now the Competition and Consumer Act 2010) was federalised, but proportionate-liability mechanics remain state-level. NSW is used as the anchor because it has the most appellate-tested formulation; ACT, VIC, QLD, WA, SA, TAS, and NT enacted substantially similar regimes between 2003 and 2005.

### 3.2 Rule-by-rule

**AU-ACL-01 — ACL major-failure floor (recoverable).** The Australian Consumer Law guarantees in §§54–59 (acceptable quality, fitness for disclosed purpose, supply by description) cannot be excluded under §64. When `acl_major_failure: true` and an ACL supplier is identified, the supplier's recoverable share is floored at 25%. This is conservative; the cap is informed by the fact that the ACL is a non-delegable consumer-protection regime, but courts in *Vautin v BY Winddown* and *ACCC v Valve Corporation (No 3)* declined to convert "non-excludable" into "100% supplier-recoverable" — they treated the guarantee as a floor against structural exclusion, not as a strict liability ceiling. 25% is at the conservative end of that range.

**AU-CPS230-01 — CPS 230 third-party-risk breach.** APRA CPS 230 took effect 1 July 2025 and §31 imposes an explicit obligation on regulated entities to assess, monitor, and manage third-party risk including material technology service providers. A documented breach of §31 transfers 12 pp of attributable share from the vendor to the deployer (the APRA-regulated entity) because the regulated entity bore the supervisory duty.

**AU-CPS230-02 — CPS 230 operational-risk breach.** §§17–22 require the regulated entity to "manage operational risks effectively." A documented breach transfers 8 pp from vendor to deployer.

**AU-VAISS-01 — Voluntary AI Safety Standard adherence credit.** The DISR Voluntary AI Safety Standard (Sept 2024) is an opt-in framework. When the deployer can demonstrate adherence, 5 pp shifts back from deployer to vendor — recognising the deployer did the work the regulator asked for.

**AU-ACL-02 — Documentation failure.** When the vendor failed to supply documentation analogous to AI Act Annex IV (intended use, performance metrics, known limits), 5 pp shifts from deployer to vendor under ACL §§54+58 (fitness/use disclosure obligations).

**AU-PLA-01 — Proportionate-liability reallocation.** When one or more concurrent wrongdoers is `unrecoverable` (insolvent, unidentifiable, out of jurisdiction), their recoverable share redistributes pro rata to the remaining recoverable defendants. This mirrors the operative effect of NSW PLA Pt 4 — a plaintiff bears the loss of insolvent concurrent wrongdoers, not the remaining defendants, but their *recoverable* share against the remaining defendants is proportionally larger.

### 3.3 Combined modifier cap

The four shifting rules (CPS230-01/02, VAISS-01, ACL-02) are subject to a combined ±25 pp cap before final renormalisation. This prevents stacking from producing implausibly large transfers and mirrors the Art. 26 cap in eu-rules.

## 4. The EU overlay

`compareJurisdictions` calls `applyEuRuleSet` from `eu-rules.ts` verbatim — no changes. The EU overlay is a separately citable methodology (FK-METHOD-2026-001) and is not redocumented here. See `docs/eu-rules.md` (if present) or the inline header in `src/eu-rules.ts`.

The EU gate (`euGateEngages`) is honoured: if `primaryJurisdiction` is not in the EU/EEA and neither `high_risk_ai` nor `pld_compensable_damage` is set, the EU overlay returns `engaged: false` and the input shares unchanged.

## 5. The stub design

US, UK, and CA overlays in v1 deliberately do not perform numeric reallocation. Each returns:

```json
{
  "jurisdiction": "US",
  "engaged": true,
  "is_stub": true,
  "attributable": { /* identical to input */ },
  "applied_rules": [
    {
      "rule_id": "US-RESTATEMENT-STUB-01",
      "authority_url": "https://www.ali.org/publications/show/torts-apportionment-liability/",
      "description": "STUB_PENDING_RESEARCH: United States overlay grounded in Restatement (Third) of Torts: Apportionment of Liability §§7–9 ...",
      "delta_pp": {}
    }
  ],
  "rule_set_version": "us-stub-v1"
}
```

The `STUB_PENDING_RESEARCH:` prefix and the `stub_pending_research:US` warning are the contract: any consumer of this surface can detect a stub jurisdiction in O(1) and decline to act on it. v2 populates US first (Restatement (Third) §§7–9 is adoptable in 35+ states essentially verbatim, so a federal-baseline overlay is tractable).

## 6. Determinism

The function is pure. No randomness, no time, no environment access. The 33-test smoke suite (`/tmp/test_jurisdiction.mjs`) verifies:

- five jurisdictions returned, in stable order
- `is_stub` flag correct for each
- warnings emitted for each stub
- EU and AU rules apply non-trivially
- attributable sums to ≈1.0 ± 0.01 in every overlay
- AU deployer share grows when CPS 230 breach is flagged
- bit-identical output across two consecutive calls
- subset filter respected
- EU gate disengages on non-EU primary jurisdiction

## 7. Pricing

`query_jurisdiction_overlay` is priced at the same rate as `verify_certificate` (1 credit) because it is a read-only inference over canonical input. There is no anchoring, no key access, and no engine state.

## 8. Versioning

The catalog version (`JURISDICTION_OVERLAY_VERSION = "v1.0.0"`) bumps when:

- a new jurisdiction is added,
- an existing stub is promoted to a full overlay, or
- a numeric coefficient changes.

Per-jurisdiction `rule_set_version` (e.g. `au-v1`, `us-stub-v1`) lets consumers pin to a specific overlay independently.

## 9. Worked example

```bash
curl -s -X POST https://mcp.faultkey.com/api/v2/jurisdiction/overlay \
  -H 'content-type: application/json' \
  -d '{
    "attributable": { "vendor1": 0.55, "deployer1": 0.30, "user1": 0.15 },
    "actors": [
      { "id": "vendor1", "type": "vendor", "eu_chain_member": ["manufacturer"], "eu_resident": true, "acl_supplier": true },
      { "id": "deployer1", "type": "deployer", "eu_resident": true, "apra_regulated": true },
      { "id": "user1", "type": "user", "eu_resident": true }
    ],
    "flags": {
      "high_risk_ai": true,
      "pld_compensable_damage": true,
      "deployer_used_contrary_to_instructions": true,
      "acl_major_failure": true,
      "cps230_thirdparty_breach": true
    },
    "primaryJurisdiction": "EU"
  }' | jq '.matrix.rows'
```

Returns a parties × jurisdictions matrix that an underwriter can pin straight into a comparison spreadsheet.

## 10. What v1 is not

- v1 is **not** a substitute for jurisdictional counsel. The output is a structured argument supported by exact citations; it is not a legal opinion.
- v1 makes **no prediction** about how a court would weigh competing rules. Where two overlays produce different shares, that is the product working as designed: the same incident *does* produce different liability under different regimes, and the buyer's job is to choose which regime governs.
- v1 does **not** model conflict-of-laws or forum selection. A separate FK-METHOD-2026-005 will address that once the underlying jurisdictional overlays are all promoted from stub status.

## 11. Authority changelog

- **2026-05-23** — v1.0.0 ships. EU + AU full; US, UK, CA stubs.
- **(planned) v1.1.0** — promote US to full (Restatement-baseline overlay).
- **(planned) v1.2.0** — promote UK to full once AI (Regulation) Bill becomes law or is formally withdrawn.
- **(planned) v1.3.0** — promote CA to full once AIDA Bill C-27 emerges from committee.
