# FaultKey Engine — EU Jurisdiction Rule-Set Mapping (DRAFT for review)

**Document version:** 0.1 · 2026-05-22 · *Pre-implementation draft. No engine code has been changed.*
**Purpose:** propose a transparent, citation-anchored mapping from operative EU legal instruments to deterministic gates and modifiers in the FaultKey scoring engine.
**Reviewer instructions:** treat every modifier as a hypothesis. Strike, adjust, or veto any line item before any of this is committed to code. Each row stands or falls on its own.

---

## 1 · Scope and design constraints

This draft governs predictions where the incident's `jurisdiction` field is `EU` (any member state). It does not change rules for `US-fed`, `US-{state}`, `UK`, `AU`, or other jurisdictions, which retain their existing weights pending separate mapping exercises.

Three design constraints discipline every entry below:

1. **Every modifier cites the operative clause it derives from.** No coefficient may exist in code without a corresponding source URL on EUR-Lex. Any rule whose authority is the withdrawn AI Liability Directive (COM(2022) 496) is rejected outright.
2. **Modifiers gate, they do not curve-fit.** A rule applies when its trigger conditions are satisfied, with a fixed numeric effect; it never accepts a "tuned" coefficient calibrated against past resolved cases. This preserves the forward-deterministic property: every prediction made under `rule_set_version = "eu-v1"` is reproducible from the published rule-set alone.
3. **The aggregate of all EU modifiers must remain bounded.** No combination of triggers may push any actor's share below 0% or above 100%, and the per-actor sum must always equal 100%. The implementation will enforce this by post-normalisation, with a warning emitted whenever clipping occurs (so we can audit which rules are over-firing in practice).

The engine continues to expose two outputs: an *attributable* share (who caused the harm) and a *recoverable-from* share (against whom a claimant can practically enforce the judgment). Under EU joint-and-several rules these often diverge meaningfully and both numbers belong on the certificate.

## 2 · Gates — instruments that determine which rule-set applies at all

Two binary gates determine entry into the EU rule-set. If either fails the engine falls through to the prior global default.

| Gate | Trigger | Authority | Effect |
|---|---|---|---|
| G-EU-1 | Incident occurs in or affects a natural person located in an EU/EEA member state at the time of harm. | TFEU Art. 16 + AI Act Art. 2(1) (territorial scope) | Activates EU rule-set. |
| G-EU-2 | The AI system is "high-risk" within the meaning of AI Act Annex III, OR the incident damage falls within the revised PLD's compensable categories (death, personal injury including medically-certified psychological harm, property damage to non-professional property, destruction of non-professional data). | AI Act Art. 6 + Annex III; PLD 2024/2853 Art. 6 (damage scope) | Activates EU rule-set. |

If G-EU-1 holds but G-EU-2 fails, the engine applies a *partial* EU overlay (PLD strict-liability presumptions still apply for non-high-risk products) but does not invoke AI-Act-specific deployer-breach rules.

## 3 · Baseline shifts under the revised Product Liability Directive

The revised PLD installs strict no-fault liability across an expanded chain. Compared to the engine's pre-EU global default, this shifts the *recoverable-from* share toward the upstream provider/manufacturer chain even where the deployer is the more proximate cause. The mapping below proposes how that shift should manifest.

### 3.1 Strict-liability provider baseline (rule **EU-PLD-01**)

> **Trigger:** G-EU-2 satisfied, regardless of fault findings.
> **Effect:** sets a **floor** on provider/manufacturer recoverable-from share at 25%, on the theory that strict liability attaches without proof of fault. This floor only affects *recoverable-from*; the *attributable* share is computed as before.
> **Authority:** PLD 2024/2853 Recital 6 ("no-fault liability for defective products should apply to all movables, including software"); Recital 13 (software, including AI systems, is a product).
> **Open question for review:** is 25% the right floor? It is conservative — German strict-liability cases under §1 ProdHaftG often see provider shares above 50% — but a higher floor risks distorting cases where the deployer's intentional misuse is the real cause.

### 3.2 Substantial-modifier reattribution (rule **EU-PLD-02**)

> **Trigger:** the deployer (or any downstream party) fine-tunes, retrains, scaffolds with custom data, or otherwise materially modifies the AI system after it was placed on the EU market. "Material" is defined as: any modification that changes the system's intended purpose, its performance characteristics on benchmark tasks by more than 5 percentage points, or its risk profile under AI Act Art. 9.
> **Effect:** **transfers** between 30% and 70% of the original provider's *attributable* share to the modifier, scaled by the modifier's documented degree of change (with sources of evidence: published model cards, fine-tuning logs, evals).
> **Authority:** PLD 2024/2853 Art. 8 (substantial modifier deemed manufacturer).
> **Open question for review:** the 30–70% band is the engine's biggest discretionary lever. Should it be narrower (40–60%)? Should we publish a worked example for each end of the band so reviewers see the reasoning?

### 3.3 Black-box presumption (rule **EU-PLD-03**)

> **Trigger:** the AI system in question is not accompanied by, or its provider has not published, an artefact set sufficient to allow an independent expert to identify the proximate cause of the incident — minimally: training-data summary, model card, evaluation results on the relevant task, and a documented operating envelope.
> **Effect:** the certificate's `presumption_in_claimant_favour` flag is set to `true`. The engine does **not** reweight shares directly on this trigger; it instead increases the provider's *recoverable-from* share by the amount the claimant would otherwise have to prove via causation. Concretely: when the trigger fires, any portion of provider share that would have been "uncertain causation, presumed for claimant" is moved from `attributable_uncertain` to `recoverable_provider`.
> **Authority:** PLD 2024/2853 presumptions in Art. 10 (technical/scientific complexity, AI black-box).
> **Open question for review:** the trigger condition is binary in this draft. A more honest approach would scale presumption weight by *how* opaque the system is. Worth refining before code.

### 3.4 Disclosure-failure presumption (rule **EU-PLD-04**)

> **Trigger:** in the underlying litigation or regulatory record, a defendant has been formally ordered to disclose evidence under the Directive's procedural disclosure mechanism and has failed to do so within the order's deadline.
> **Effect:** that defendant's recoverable-from share moves to a 50% floor, regardless of attributable share. This implements the Directive's "presumption of defectiveness and causal link on disclosure failure" without curve-fitting it.
> **Authority:** PLD 2024/2853 Art. 9 (disclosure) and Art. 10 (presumptions).
> **Open question for review:** does the engine ever have *evidence* that a disclosure order has been violated? Probably not at the time of prediction. This rule may only fire on retrospective re-scoring after a court ruling. We should mark it `post-resolution-only` and not try to predict it forward.

### 3.5 Joint-and-several recoverable share (rule **EU-PLD-05**)

> **Trigger:** more than one EU-resident actor is liable.
> **Effect:** the certificate exposes a `joint_and_several_chain` field listing all jointly-liable actors. The recoverable-from share is computed as: each actor's attributable share, **plus** a pro-rata redistribution from any actor that is insolvent, outside the EU, or unidentifiable. The redistribution is to the EU-resident actors whose attributable share is closest in the chain (manufacturer's redistribution lands on importer/authorised rep; importer's lands on fulfilment service provider; etc.).
> **Authority:** PLD 2024/2853 Art. 12 (joint and several).

## 4 · AI Act Article 26 — deployer-breach modifiers

These are *additive* shifts to deployer share, each citing a specific paragraph of Article 26. They never reduce provider share below the EU-PLD-01 floor (the strict-liability protection is non-derogable).

| Rule | Trigger | Effect on deployer attributable share | Authority |
|---|---|---|---|
| **EU-AIA-26-1** | The deployer used the system contrary to written instructions for use accompanying it. | +12 percentage points | AI Act Art. 26(1) |
| **EU-AIA-26-2a** | The deployer assigned no human oversight, OR assigned oversight to a person without documented competence, training, or authority. | +10 percentage points | AI Act Art. 26(2) |
| **EU-AIA-26-2b** | Human oversight was nominally assigned but the assigned person was *not actually present or empowered* at the time of the incident. | +8 percentage points (non-stacking with 26-2a) | AI Act Art. 26(2) |
| **EU-AIA-26-4** | The deployer controlled the input data and that data was unrepresentative of the intended purpose, contributing to the harm. | +9 percentage points | AI Act Art. 26(4) |
| **EU-AIA-26-5a** | The deployer received a signal from the system suggesting elevated risk and failed to suspend operation or notify the provider. | +11 percentage points | AI Act Art. 26(5) ¶1 |
| **EU-AIA-26-5b** | A serious incident occurred and the deployer failed to notify provider and market-surveillance authority within the timeline implied by the regulation. | +6 percentage points | AI Act Art. 26(5) ¶2 |
| **EU-AIA-26-6** | The deployer destroyed or did not retain the at-least-six-months log generated by the system. | +5 percentage points (also raises evidentiary presumption — see EU-PLD-03 interaction) | AI Act Art. 26(6) |
| **EU-AIA-26-7** | The deployer is an employer who failed to inform workers' representatives before deploying the system, AND a worker was harmed by it. | +4 percentage points | AI Act Art. 26(7) |
| **EU-AIA-26-8** | The deployer is a public authority and the system is not registered in the Article 71 EU database. | +6 percentage points | AI Act Art. 26(8) |

The combined cap on Article 26 modifiers is +35 percentage points, after which post-normalisation rebalances. We treat the cap as an explicit guard against accumulated coefficients stretching past defensibility.

## 5 · Provider non-derogation under Article 9

Two reverse-direction rules are needed to prevent the Article 26 modifiers from accidentally exonerating the provider:

> **EU-AIA-9-A:** the provider's recoverable-from share is never reduced below 15% solely because the deployer breached Article 26, unless the provider can affirmatively prove that the breach was *not reasonably foreseeable* (Art. 9(5)(c) materially constrains "foreseeability" since providers must train and inform deployers, and must assume their general technical level).
>
> **EU-AIA-9-B:** if the provider failed to supply the Art. 13 instructions for use, every Art. 26 modifier triggered downstream is reduced by 50% (a deployer cannot have breached an instruction it never received).

Authority: AI Act Art. 9(5)(c) and Art. 13.

## 6 · New parties the engine must now address

Three parties become first-class actors under EU rules and need explicit fields in the input schema:

* **Substantial modifier** — distinct from "deployer" because the same entity can occupy both roles for different layers of the same system.
* **Online platform that holds itself out as supplier** — receives manufacturer share when the trigger of PLD Art. 8(2)(c) is satisfied.
* **Authorised representative / importer / fulfilment service provider** — receives the manufacturer's *recoverable-from* share when the manufacturer is non-EU.

For each, the engine input schema gains an optional `eu_chain_member` array; missing entries default to "not present" rather than zero.

## 7 · Certificate schema changes

The CausalCertificateV1 schema must add the following fields when the EU rule-set fires:

* `jurisdiction` — `"EU"` or member-state ISO code where known.
* `rule_set_version` — `"eu-v1"`. Cryptographically anchored alongside the existing aggregate root so reviewers can verify which rule-set was used.
* `presumption_in_claimant_favour` — boolean from EU-PLD-03 / EU-PLD-04.
* `joint_and_several_chain` — ordered list of EU-resident liable parties.
* `recoverable_share_per_actor` — separate from `attributable_share_per_actor`.
* `applied_rules` — array of rule IDs (`["EU-PLD-01", "EU-AIA-26-2a", ...]`) with each entry naming the source URL and the percentage points added or transferred. This is the audit trail.

## 8 · What this draft deliberately does **not** do

1. It does not encode any post-resolution outcome, settlement amount, or court finding into the engine's coefficients. The temptation to "tune to fit Moffatt" or "tune to fit Mata v. Avianca" is rejected.
2. It does not encode insurance policy coverage. That is a separate workstream (the "policy schedule mapping" project) and is intentionally outside the engine's first EU release. Mixing the two would let policy-side coefficients leak into liability attribution and corrupt the deterministic property.
3. It does not extend to general-purpose AI model providers under AI Act Articles 53–55. Those obligations exist but their interaction with downstream deployer fault is unsettled in case law; we will treat GPAI providers as ordinary providers under Article 16 until further authority emerges.
4. It does not modify any non-EU jurisdiction's rule-set. US, UK, AU paths remain on the existing global defaults until each has its own mapping draft.

## 9 · Implementation sequence (after this draft is approved)

The implementation phase will:

1. Add `jurisdiction` and `rule_set_version` to the input schema and to the certificate schema; default them to `"GLOBAL-DEFAULT"` and `"global-v0"` when absent so existing predictions remain valid.
2. Implement gates G-EU-1 and G-EU-2 in both `causallayer-mcp/src/engine.ts` and `demo/score.js`, with a unit test asserting byte-identical output.
3. Implement each rule in the order it appears in §3 and §4, with a per-rule unit test fixture (input → expected output) committed to the public repo.
4. Re-anchor a fresh batch of EU-flagged predictions under `rule_set_version = "eu-v1"`, separate Rekor entry, separate aggregate root.
5. Publish this mapping document on `/engine` as Appendix B (linked from the existing Appendix A), and from `/anchor-log` so reviewers of the EU certificates can audit the rule-set in one click.

## 10 · Questions for the reviewer (please answer before code)

> **Q1.** Is the 25% provider strict-liability floor in EU-PLD-01 defensible, too low, or too high?
> **Q2.** Should EU-PLD-02 (substantial modifier) cap the transferred share at 70%, or higher?
> **Q3.** EU-PLD-04 (disclosure failure) is post-resolution-only as drafted. Should the engine emit a *forward* "predicted likelihood of disclosure failure" instead, or is that overreach?
> **Q4.** The Article 26 per-rule percentage points (+12, +10, +9 …) are first-principles guesses. Should they all be the same value (e.g. +10) until empirical calibration data exists, to avoid false precision?
> **Q5.** Is `eu-v1` the right rule-set version label, or should it carry an effective-date marker (e.g. `eu-2026-08-02-v1`) tied to the AI Act's high-risk-obligations entry into force?
> **Q6.** Should the published rule-set include an *expected resolution-class* output (e.g. "court finding", "settlement", "regulator order") even though we cannot verify accuracy until cases resolve?
