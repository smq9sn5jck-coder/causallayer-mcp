#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * demo/score.js
 *
 * Standalone Node CLI that runs the *same* deterministic scoring engine
 * shipped to the browser at https://faultkey.com/try.
 *
 *   $ node demo/score.js --scenario loan
 *   $ node demo/score.js --scenario medical
 *   $ node demo/score.js --scenario content
 *   $ node demo/score.js --scenario hiring
 *   $ node demo/score.js --scenario av
 *   $ node demo/score.js --input ./my-scenario.json
 *
 * The point of this file is the reproducibility contract:
 *
 *   For any scenario, the input_hash and output_hash printed here MUST equal
 *   the input_hash and output_hash shown in the "DETERMINISTIC PROOF" panel
 *   on https://faultkey.com/try when the same scenario is selected. If they
 *   don't match, the engine is broken — file an issue at
 *   https://github.com/smq9sn5jck-coder/causallayer-mcp/issues.
 *
 * No external dependencies. Node >= 18.
 */
/* eslint-disable */

// ═══════════════════════════════════════════════════════════════════
// HASHES (kept byte-identical to client/src/pages/Try.tsx)
// ═══════════════════════════════════════════════════════════════════
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

// FNV-1a-style 32-bit hash, split + xored to produce a 16-hex-char digest.
// This is the *demo-grade* hash used by the public engine for stable
// input/output identification. Production uses SHA-256; the demo intentionally
// uses a smaller hash so the values fit on one line in the certificate UI.
function hashHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") +
    ((h >>> 0) ^ 0xdeadbeef).toString(16).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════════════
// DETERMINISTIC LIABILITY SCORING ENGINE
// (mirror of client/src/pages/Try.tsx deterministicScore — line for line)
// ═══════════════════════════════════════════════════════════════════
function deterministicScore(args) {
  const agents = args.agents || [];
  const events = args.events || [];
  const severity = args.severity || "medium";
  const jurisdiction = args.jurisdiction || "AU";
  const category = args.category || "general";
  const financialImpact = args.financial_impact_cents || 0;
  const currency = args.currency || "AUD";

  // Step 1: actor-event participation matrix
  const actorEvents = {};
  agents.forEach((a) => { actorEvents[a.id] = { agent: a, events: [], weight: 0 }; });
  events.forEach((ev, idx) => {
    if (actorEvents[ev.actor_id]) {
      actorEvents[ev.actor_id].events.push({ ...ev, position: idx });
    }
  });

  // Step 2: ad · ml · m2 (m3 is enforced structurally below)
  const typeWeights = {
    inference: 3.0, data_retrieval: 2.5, auto_rejection: 2.8,
    human_review: 1.5, human_override_missed: 2.0, human_intervention_missed: 2.2,
    policy_check: 1.8, content_scan: 2.2, scoring: 2.0,
    sensor_degradation: 2.8, inference_failure: 3.5, resume_scan: 2.0,
    data_input: 1.2, default: 1.5,
  };
  const roleWeights = { provider: 2.5, deployer: 1.8, vendor: 2.0, user: 1.0 };
  const totalEvents = events.length;

  Object.keys(actorEvents).forEach((actorId) => {
    const actor = actorEvents[actorId];
    let weight = 0;
    actor.events.forEach((ev) => {
      const positionFactor = 1.0 + (ev.position / Math.max(totalEvents - 1, 1)) * 1.5;
      const typeFactor = typeWeights[ev.type] || typeWeights.default;
      const roleFactor = roleWeights[actor.agent.operator_role] || 1.0;
      weight += positionFactor * typeFactor * roleFactor;
    });
    actor.weight = weight; // m3: actors with no events stay at 0
  });

  // Step 3: normalise
  const totalWeight = Object.values(actorEvents).reduce((s, a) => s + a.weight, 0);
  const liabilityShares = [];
  Object.values(actorEvents).forEach((actor) => {
    if (actor.weight > 0) {
      liabilityShares.push({
        name: actor.agent.name,
        type: actor.agent.type,
        role: actor.agent.operator_role,
        share: totalWeight > 0 ? actor.weight / totalWeight : 0,
        vendor: actor.agent.vendor_name || null,
        model: actor.agent.model_id || null,
      });
    }
  });
  liabilityShares.sort((a, b) => b.share - a.share);

  // Step 4: verdict
  const primary = liabilityShares[0] || { name: "Unknown", type: "unknown", role: "unknown", share: 0 };
  let verdict = "UNDETERMINED";
  if (primary.type === "ai_system" && primary.role === "provider") verdict = "AI_PROVIDER_AT_FAULT";
  else if (primary.type === "third_party" || primary.type === "vendor") verdict = "THIRD_PARTY_DATA_PROVIDER_AT_FAULT";
  else if (primary.type === "human_operator") verdict = "HUMAN_OPERATOR_AT_FAULT";
  else if (primary.type === "ai_system" && primary.role === "deployer") verdict = "DEPLOYER_SYSTEM_AT_FAULT";

  // Step 5: damages
  const titleHash = hashCode(args.title || "");
  const damageMultiplier = 0.7 + (Math.abs(titleHash % 100) / 100) * 0.6;
  const baseDamages = financialImpact || computeDefaultDamages(severity, category);
  const estimatedDamages = Math.round(baseDamages * damageMultiplier);

  return {
    _engine: "faultkey-deterministic-v1",
    _mode: "public_demo",
    verdict,
    liability: {
      primary_party: {
        name: primary.name,
        type: primary.type,
        role: primary.role,
        share: Math.round(primary.share * 1000) / 1000,
      },
      secondary_parties: liabilityShares.slice(1).map((p) => ({
        name: p.name, type: p.type, role: p.role, share: Math.round(p.share * 1000) / 1000,
      })),
      methodology: "deterministic_causal_contribution",
      factors_applied: ["ad_position_weight", "ml_event_type_severity", "m2_operator_role_duty", "m3_but_for_test", "last_clear_chance"],
    },
    damages: { estimated_cents: estimatedDamages, currency, basis: financialImpact > 0 ? "claimant_stated" : "category_default", multiplier_applied: damageMultiplier.toFixed(3) },
    deterministic_proof: {
      input_hash: hashHex(JSON.stringify(args)),
      output_hash: hashHex(verdict + JSON.stringify(liabilityShares.map((l) => l.share))),
      reproducible: true,
      note: "Running identical inputs will always produce identical liability scores",
    },
  };
}

function computeDefaultDamages(severity, category) {
  const severityBase = { critical: 5000000, high: 1000000, medium: 250000, low: 50000 };
  const categoryMult = { healthcare: 3.0, autonomous_systems: 5.0, financial_services: 2.0, employment: 1.5, content_moderation: 0.8 };
  return (severityBase[severity] || 250000) * (categoryMult[category] || 1.0);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIOS (verbatim copy of client/src/pages/Try.tsx SCENARIOS)
// IDs match the browser exactly: loan, medical, content, hiring, av
// ═══════════════════════════════════════════════════════════════════
const SCENARIOS = {
  loan: {
    title: "AI Loan Denial - Incorrect Credit Data",
    description: "AI mortgage system denied qualified applicant based on incorrect third-party data.",
    category: "financial_services", severity: "high", jurisdiction: "AU",
    financial_impact_cents: 4500000, currency: "AUD",
    agents: [
      { id: "ai-1", name: "Anthropic Claude 3.5", type: "ai_system", operator_role: "provider", vendor_name: "Anthropic", model_id: "claude-3.5-sonnet" },
      { id: "vendor-1", name: "National Credit Corp", type: "third_party", operator_role: "vendor" },
      { id: "human-1", name: "Loan Officer", type: "human_operator", operator_role: "deployer" },
    ],
    events: [
      { id: "e1", type: "data_retrieval", timestamp: "2026-05-20T09:00:00Z", actor_id: "vendor-1", description: "Credit data retrieved from National Credit Corp API \u2014 returned stale record from 2019" },
      { id: "e2", type: "inference", timestamp: "2026-05-20T09:00:01Z", actor_id: "ai-1", description: "Claude 3.5 processed loan application using stale credit data, output: DENY" },
      { id: "e3", type: "human_review", timestamp: "2026-05-20T09:05:00Z", actor_id: "human-1", description: "Loan officer accepted AI denial without independent credit verification" },
    ],
    deterministic_only: true,
  },
  medical: {
    title: "AI Triage Misclassification - Cardiac Event",
    description: "AI triage system classified chest pain as low-priority, delaying treatment by 4 hours.",
    category: "healthcare", severity: "critical", jurisdiction: "EU",
    financial_impact_cents: 25000000, currency: "EUR",
    agents: [
      { id: "ai-1", name: "OpenAI GPT-4", type: "ai_system", operator_role: "provider", vendor_name: "OpenAI", model_id: "gpt-4-turbo" },
      { id: "sys-1", name: "Hospital EHR System", type: "vendor", operator_role: "vendor" },
      { id: "human-1", name: "Triage Nurse", type: "human_operator", operator_role: "deployer" },
    ],
    events: [
      { id: "e1", type: "data_input", timestamp: "2026-05-19T14:00:00Z", actor_id: "sys-1", description: "Patient vitals entered \u2014 elevated BP and chest pain noted in EHR" },
      { id: "e2", type: "inference", timestamp: "2026-05-19T14:00:02Z", actor_id: "ai-1", description: "GPT-4 classified case as low-priority based on age demographics bias" },
      { id: "e3", type: "human_override_missed", timestamp: "2026-05-19T14:01:00Z", actor_id: "human-1", description: "Nurse followed AI recommendation without physical assessment" },
    ],
    deterministic_only: true,
  },
  content: {
    title: "Wrongful Content Removal - Whistleblower Post",
    description: "AI content moderation removed factual whistleblower post about corporate fraud.",
    category: "content_moderation", severity: "medium", jurisdiction: "US",
    financial_impact_cents: 500000, currency: "USD",
    agents: [
      { id: "ai-1", name: "Meta LLaMA 3", type: "ai_system", operator_role: "provider", vendor_name: "Meta", model_id: "llama-3-70b" },
      { id: "sys-1", name: "Policy Engine v4.2", type: "ai_system", operator_role: "deployer" },
      { id: "human-1", name: "Human Reviewer", type: "human_operator", operator_role: "user" },
    ],
    events: [
      { id: "e1", type: "content_scan", timestamp: "2026-05-18T08:00:00Z", actor_id: "ai-1", description: "LLaMA 3 flagged whistleblower post as misinformation with 0.72 confidence" },
      { id: "e2", type: "policy_check", timestamp: "2026-05-18T08:00:01Z", actor_id: "sys-1", description: "Policy engine auto-escalated to removal without context window analysis" },
      { id: "e3", type: "human_review", timestamp: "2026-05-18T10:00:00Z", actor_id: "human-1", description: "Human reviewer upheld removal after 8-second review without reading full post" },
    ],
    deterministic_only: true,
  },
  hiring: {
    title: "AI Hiring Discrimination - Parental Leave Gap",
    description: "AI screening tool rejected 15-year experience candidate due to 2-year parental leave gap.",
    category: "employment", severity: "high", jurisdiction: "EU",
    financial_impact_cents: 8000000, currency: "EUR",
    agents: [
      { id: "ai-1", name: "Microsoft Copilot HR", type: "ai_system", operator_role: "provider", vendor_name: "Microsoft", model_id: "copilot-hr-v2" },
      { id: "sys-1", name: "ATS Platform", type: "vendor", operator_role: "deployer" },
      { id: "human-1", name: "HR Manager", type: "human_operator", operator_role: "deployer" },
    ],
    events: [
      { id: "e1", type: "resume_scan", timestamp: "2026-05-17T11:00:00Z", actor_id: "ai-1", description: "Copilot HR flagged 2-year employment gap as negative signal without gap-reason analysis" },
      { id: "e2", type: "scoring", timestamp: "2026-05-17T11:00:01Z", actor_id: "sys-1", description: "ATS assigned score 23/100 based on AI flag, below 40-point threshold" },
      { id: "e3", type: "auto_rejection", timestamp: "2026-05-17T11:05:00Z", actor_id: "human-1", description: "HR manager batch-approved 47 AI rejections without individual review" },
    ],
    deterministic_only: true,
  },
  av: {
    title: "AV Perception Failure - Pedestrian Detection in Rain",
    description: "Self-driving vehicle failed to brake for pedestrian crossing. Lidar degraded by heavy rain.",
    category: "autonomous_systems", severity: "critical", jurisdiction: "AU",
    financial_impact_cents: 50000000, currency: "AUD",
    agents: [
      { id: "ai-1", name: "Waymo Perception Stack", type: "ai_system", operator_role: "provider", vendor_name: "Waymo", model_id: "perception-v5" },
      { id: "sys-1", name: "Sensor Fusion Module", type: "ai_system", operator_role: "deployer" },
      { id: "human-1", name: "Safety Driver", type: "human_operator", operator_role: "user" },
    ],
    events: [
      { id: "e1", type: "sensor_degradation", timestamp: "2026-05-16T19:30:00Z", actor_id: "sys-1", description: "Lidar point cloud degraded 60% due to heavy rain \u2014 no automatic fallback to camera-only mode" },
      { id: "e2", type: "inference_failure", timestamp: "2026-05-16T19:30:01Z", actor_id: "ai-1", description: "Perception stack failed to detect pedestrian at 12m despite clear camera feed available" },
      { id: "e3", type: "human_intervention_missed", timestamp: "2026-05-16T19:30:02Z", actor_id: "human-1", description: "Safety driver monitoring dashboard screen, not road ahead" },
    ],
    deterministic_only: true,
  },
};

// ═══════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════
function parseArgs(argv) {
  const out = { scenario: null, input: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario" || a === "-s") out.scenario = argv[++i];
    else if (a === "--input" || a === "-i") out.input = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.log(`faultkey demo/score.js  \u00b7  deterministic liability scoring (public demo engine)

Usage:
  node demo/score.js --scenario <id>      Run a preset scenario
  node demo/score.js --input <file.json>  Run with a custom scenario from a JSON file
  node demo/score.js --json               Print the full result as JSON
  node demo/score.js --help               Show this help

Scenarios:
  loan      \u00b7  AI Loan Denial (financial_services / AU)
  medical   \u00b7  Medical Triage (healthcare / EU)
  content   \u00b7  Content Moderation (content_moderation / US)
  hiring    \u00b7  Hiring AI (employment / EU)
  av        \u00b7  Autonomous Vehicle (autonomous_systems / AU)

Examples:
  node demo/score.js --scenario loan
  node demo/score.js --scenario medical --json
  node demo/score.js --input ./my-incident.json

This script is the public, byte-identical mirror of the engine running at
https://faultkey.com/try. The input_hash and output_hash printed below should
match what /try shows in the DETERMINISTIC PROOF panel for the same scenario.
If they don't \u2014 file an issue, that's a bug.
`);
}

function pretty(result, scenarioId) {
  const r = result;
  const dollars = (cents, ccy) => {
    const v = (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${ccy} ${v}`;
  };
  const lines = [];
  lines.push("");
  lines.push("\u250C\u2500 faultkey \u00b7 deterministic public demo engine v1 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510");
  lines.push(`\u2502 scenario   : ${scenarioId}`);
  lines.push(`\u2502 verdict    : ${r.verdict.replace(/_/g, " ")}`);
  lines.push("\u2502");
  lines.push(`\u2502 LIABILITY ALLOCATION`);
  const primary = r.liability.primary_party;
  lines.push(`\u2502   ${(primary.share * 100).toFixed(1).padStart(5)}%  ${primary.name}  (${primary.role})`);
  r.liability.secondary_parties.forEach((p) => {
    lines.push(`\u2502   ${(p.share * 100).toFixed(1).padStart(5)}%  ${p.name}  (${p.role})`);
  });
  lines.push("\u2502");
  lines.push(`\u2502 damages    : ${dollars(r.damages.estimated_cents, r.damages.currency)}  (\u00d7${r.damages.multiplier_applied})`);
  lines.push(`\u2502 factors    : ${r.liability.factors_applied.join(" + ")}`);
  lines.push("\u2502");
  lines.push(`\u2502 DETERMINISTIC PROOF  (must match /try DETERMINISTIC PROOF panel)`);
  lines.push(`\u2502   input_hash : ${r.deterministic_proof.input_hash}`);
  lines.push(`\u2502   output_hash: ${r.deterministic_proof.output_hash}`);
  lines.push(`\u2502   reproducible: ${r.deterministic_proof.reproducible}`);
  lines.push("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518");
  lines.push("");
  return lines.join("\n");
}

(function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.scenario && !args.input)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  let scenarioArgs;
  let scenarioId;
  if (args.input) {
    const fs = require("fs");
    const path = require("path");
    const p = path.resolve(args.input);
    if (!fs.existsSync(p)) {
      console.error(`error: input file not found: ${p}`);
      process.exit(2);
    }
    scenarioArgs = JSON.parse(fs.readFileSync(p, "utf8"));
    scenarioId = "custom";
  } else {
    if (!SCENARIOS[args.scenario]) {
      console.error(`error: unknown scenario "${args.scenario}". Try: loan | medical | content | hiring | av`);
      process.exit(2);
    }
    scenarioArgs = SCENARIOS[args.scenario];
    scenarioId = args.scenario;
  }

  const result = deterministicScore(scenarioArgs);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(pretty(result, scenarioId));
  }
})();
