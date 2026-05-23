#!/usr/bin/env node
/**
 * weekly-determinism.mjs — Re-run all FaultKey demo scenarios against the
 * live MCP worker and commit a proof file.
 *
 * Run weekly (Mondays 12:00 UTC) via .github/workflows/weekly-determinism.yml.
 * The point: build a public, append-only log that ANY third party can verify
 * by re-running the same scenarios themselves and getting the same
 * certificateId / requestHash / merkleRoot byte-for-byte, forever.
 *
 * Output: proofs/YYYY-MM-DD.json
 * Format: { generated_at, engine_url, engine_version, rule_set_version,
 *           commit_sha, scenarios: [{ id, label, certificate_id,
 *           request_hash, merkle_root, primary_share, total_cents,
 *           latency_ms }] }
 *
 * Exit codes:
 *   0 — all scenarios returned a certificate (recommend commit)
 *   1 — at least one scenario failed (job should still commit, but flag)
 *
 * Zero runtime dependencies. Uses only Node's built-in fetch (Node 18+).
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROOFS_DIR = resolve(ROOT, "proofs");
const SCENARIOS_FILE = resolve(__dirname, "scenarios.data.json");
const MCP_URL = process.env.FAULTKEY_MCP_URL || "https://mcp.faultkey.com/mcp";

// ─── Canonical scenarios ─────────────────────────────────────
// Loaded from scripts/scenarios.data.json, which mirrors the home demo's
// scenarios.ts (same canonical input shape that the live engine accepts).
// If you change one, sync the other — any drift will be caught by this
// proof log because the certificateId will shift.
const SCENARIOS = JSON.parse(await readFile(SCENARIOS_FILE, "utf8"));

// (kept for diff context; the loaded constant above is what's used)
void [
  {
    id: "healthcare",
    label: "Healthcare — AI Dosage Error",
    incident: {
      title: "Healthcare AI gave dangerous medication dosing advice",
      description:
        "An AI chatbot deployed by MedAssist Corp using OpenAI's API gave a patient dangerous medication dosing advice. The patient followed the advice and was hospitalised. No physician was in the loop.",
      severity: "critical",
      jurisdiction: "AU",
      financial_impact_cents: 12500000,
      currency: "AUD",
      category: "healthcare_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "OpenAI", type: "vendor", vendor_name: "OpenAI", model_id: "gpt-4o-mini" },
        { id: "agent_deployer", name: "MedAssist Corp", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "patient", type: "user", operator_role: "end_user" },
      ],
      events: [
        { id: "evt_1", type: "ai_response", timestamp: "2026-04-10T09:14:00Z", description: "AI advised 5x normal dosage" },
        { id: "evt_2", type: "user_action", timestamp: "2026-04-10T09:18:00Z", description: "Patient followed advice" },
        { id: "evt_3", type: "harm_realised", timestamp: "2026-04-10T11:42:00Z", description: "Hospitalisation" },
      ],
    },
  },
  {
    id: "finance",
    label: "Finance — Algorithmic Mis-Selling",
    incident: {
      title: "AI advisor mis-categorised a retail investor's risk profile",
      description:
        "Algo financial advisor at NeoBank classified a retiree's risk tolerance as 'aggressive' due to a prompt-injection. Investor lost AUD 2.4M of retirement savings in high-volatility products.",
      severity: "critical",
      jurisdiction: "US",
      financial_impact_cents: 240000000,
      currency: "USD",
      category: "financial_advice_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "Anthropic", type: "vendor", vendor_name: "Anthropic", model_id: "claude-sonnet-4" },
        { id: "agent_deployer", name: "NeoBank", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "retiree investor", type: "user", operator_role: "end_user" },
      ],
      events: [
        { id: "evt_1", type: "prompt_injection", timestamp: "2026-03-02T14:00:00Z", description: "Adversarial prompt in chat" },
        { id: "evt_2", type: "ai_classification", timestamp: "2026-03-02T14:01:00Z", description: "Risk = aggressive" },
        { id: "evt_3", type: "trade_executed", timestamp: "2026-03-02T14:15:00Z", description: "Volatile derivatives bought" },
      ],
    },
  },
  {
    id: "legal",
    label: "Legal — Hallucinated Case Citations",
    incident: {
      title: "AI-drafted brief cited fabricated precedents",
      description:
        "Junior associate at a US law firm used a hallucinating AI to draft a brief that included six fabricated case citations. Court issued sanctions and the client incurred USD 640k in remedial work.",
      severity: "high",
      jurisdiction: "US",
      financial_impact_cents: 64000000,
      currency: "USD",
      category: "legal_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "OpenAI", type: "vendor", vendor_name: "OpenAI", model_id: "gpt-4" },
        { id: "agent_deployer", name: "BigLaw Firm", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "junior associate", type: "human_operator", operator_role: "professional_user" },
      ],
      events: [
        { id: "evt_1", type: "ai_response", timestamp: "2026-02-18T10:00:00Z", description: "Brief with hallucinated cites" },
        { id: "evt_2", type: "filing", timestamp: "2026-02-18T16:00:00Z", description: "Brief filed without verification" },
        { id: "evt_3", type: "sanctions", timestamp: "2026-03-01T09:00:00Z", description: "Court sanctioned the firm" },
      ],
    },
  },
  {
    id: "av",
    label: "Autonomous Vehicles — L3 Hand-off Failure",
    incident: {
      title: "L3 driver-assist disengaged without notifying driver",
      description:
        "L3 system on a passenger vehicle disengaged 1.2 seconds before a freeway exit, did not alert the driver, leading to a collision. EUR 3.2M in damages and one serious injury.",
      severity: "critical",
      jurisdiction: "EU",
      financial_impact_cents: 320000000,
      currency: "EUR",
      category: "autonomous_vehicle",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "AutoDrive Inc", type: "vendor", vendor_name: "AutoDrive Inc", model_id: "ADAS-L3-v3" },
        { id: "agent_deployer", name: "EuroAuto OEM", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "driver", type: "human_operator", operator_role: "supervisor" },
      ],
      events: [
        { id: "evt_1", type: "ai_decision", timestamp: "2026-01-15T08:30:00Z", description: "System disengaged silently" },
        { id: "evt_2", type: "human_inaction", timestamp: "2026-01-15T08:30:01Z", description: "Driver did not retake control" },
        { id: "evt_3", type: "harm_realised", timestamp: "2026-01-15T08:30:02Z", description: "Collision at 95 km/h" },
      ],
    },
  },
  {
    id: "copilot",
    label: "Code Copilot — License Leak",
    incident: {
      title: "AI code assistant emitted GPL code into a proprietary repo",
      description:
        "An AI code assistant suggested verbatim GPL-licensed code that was committed to a proprietary product. License-cleanup litigation cost USD 1.8M.",
      severity: "high",
      jurisdiction: "US",
      financial_impact_cents: 180000000,
      currency: "USD",
      category: "code_generation_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "GitHub", type: "vendor", vendor_name: "GitHub", model_id: "copilot-1.x" },
        { id: "agent_deployer", name: "SaaSCo", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "engineer", type: "human_operator", operator_role: "professional_user" },
      ],
      events: [
        { id: "evt_1", type: "ai_response", timestamp: "2025-11-04T11:00:00Z", description: "GPL snippet suggested verbatim" },
        { id: "evt_2", type: "merge", timestamp: "2025-11-04T15:00:00Z", description: "Merged into prod codebase" },
        { id: "evt_3", type: "audit_discovered", timestamp: "2026-02-20T09:00:00Z", description: "GPL leak found" },
      ],
    },
  },
  {
    id: "insurance",
    label: "Insurance — AI Claims Denial Bias",
    incident: {
      title: "Algorithm systematically denied valid health claims",
      description:
        "Insurer's ML-based claims engine systematically denied valid claims from a demographic cohort. Class-action settled for GBP 4.1M and regulatory fine pending.",
      severity: "high",
      jurisdiction: "UK",
      financial_impact_cents: 410000000,
      currency: "GBP",
      category: "insurance_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "ClaimsML Ltd", type: "vendor", vendor_name: "ClaimsML Ltd", model_id: "claims-engine-v2" },
        { id: "agent_deployer", name: "UK Mutual Insurer", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "policyholders", type: "user", operator_role: "end_user" },
      ],
      events: [
        { id: "evt_1", type: "ai_decision", timestamp: "2025-09-01T00:00:00Z", description: "Model trained on biased data" },
        { id: "evt_2", type: "denials_at_scale", timestamp: "2025-12-01T00:00:00Z", description: "Disparate impact observed" },
        { id: "evt_3", type: "regulator_action", timestamp: "2026-04-10T00:00:00Z", description: "FCA opened investigation" },
      ],
    },
  },
  {
    id: "medical-misdiagnosis",
    label: "Medical AI — NHS Radiology Misdiagnosis",
    incident: {
      title: "AI radiology system missed a critical finding",
      description:
        "NHS-deployed radiology triage AI labelled a chest X-ray as 'normal' when a stage-1 lung tumour was visible. Delayed diagnosis cost GBP 1.85M.",
      severity: "critical",
      jurisdiction: "UK",
      financial_impact_cents: 185000000,
      currency: "GBP",
      category: "medical_diagnostic_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "RadAI Diagnostics", type: "vendor", vendor_name: "RadAI Diagnostics", model_id: "radai-chest-v4" },
        { id: "agent_deployer", name: "NHS Trust", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "radiologist on duty", type: "human_operator", operator_role: "professional_user" },
      ],
      events: [
        { id: "evt_1", type: "ai_decision", timestamp: "2026-01-05T08:15:00Z", description: "AI scored finding 0.02" },
        { id: "evt_2", type: "human_concurrence", timestamp: "2026-01-05T08:22:00Z", description: "Radiologist agreed with AI" },
        { id: "evt_3", type: "harm_realised", timestamp: "2026-04-22T11:00:00Z", description: "Diagnosis delayed 16 weeks" },
      ],
    },
  },
  {
    id: "av-fatal",
    label: "Autonomous Vehicle — L4 Robotaxi Fatal Crash",
    incident: {
      title: "L4 robotaxi struck a pedestrian during merge maneuver",
      description:
        "L4 robotaxi operating in San Francisco merged into a turning lane and struck a pedestrian crossing against the light. Fatality. USD 12.5M.",
      severity: "critical",
      jurisdiction: "US",
      financial_impact_cents: 1250000000,
      currency: "USD",
      category: "autonomous_vehicle",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "RoboTaxi Co", type: "vendor", vendor_name: "RoboTaxi Co", model_id: "rt-stack-v6" },
        { id: "agent_deployer", name: "RoboTaxi Operations LLC", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "pedestrian", type: "third_party", operator_role: "bystander" },
      ],
      events: [
        { id: "evt_1", type: "ai_decision", timestamp: "2026-03-12T19:43:00Z", description: "Planner chose merge despite occlusion" },
        { id: "evt_2", type: "harm_realised", timestamp: "2026-03-12T19:43:02Z", description: "Pedestrian struck" },
      ],
    },
  },
  {
    id: "genai-copyright",
    label: "Generative AI — Pulitzer-Image Regurgitation",
    incident: {
      title: "Model regenerated a copyrighted photo near-verbatim",
      description:
        "Image generation model output a near-verbatim reproduction of a Pulitzer-winning photograph in response to a generic prompt. USD 6.4M settlement.",
      severity: "high",
      jurisdiction: "US",
      financial_impact_cents: 640000000,
      currency: "USD",
      category: "generative_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "ImageAI Inc", type: "vendor", vendor_name: "ImageAI Inc", model_id: "imgai-v3" },
        { id: "agent_deployer", name: "MediaCorp", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "editor", type: "human_operator", operator_role: "professional_user" },
      ],
      events: [
        { id: "evt_1", type: "ai_response", timestamp: "2026-02-08T13:10:00Z", description: "Near-verbatim image generated" },
        { id: "evt_2", type: "publication", timestamp: "2026-02-08T17:00:00Z", description: "Image published" },
        { id: "evt_3", type: "litigation", timestamp: "2026-03-15T00:00:00Z", description: "Copyright suit filed" },
      ],
    },
  },
  {
    id: "advice-fca",
    label: "AI Financial Advice — Robo-Adviser Mis-Selling",
    incident: {
      title: "Robo-adviser breached FCA/ASIC suitability rules",
      description:
        "Robo-adviser recommended high-fee SMSF strategies to risk-averse clients in breach of suitability obligations. AUD 8.9M restitution + regulatory penalties.",
      severity: "high",
      jurisdiction: "AU",
      financial_impact_cents: 890000000,
      currency: "AUD",
      category: "financial_advice_ai",
      deterministic_only: true,
      agents: [
        { id: "agent_vendor", name: "AdviceAI", type: "vendor", vendor_name: "AdviceAI", model_id: "adv-v2" },
        { id: "agent_deployer", name: "RoboAdvice Pty Ltd", type: "deployer", operator_role: "deployer" },
        { id: "agent_user", name: "retail clients", type: "user", operator_role: "end_user" },
      ],
      events: [
        { id: "evt_1", type: "ai_recommendation", timestamp: "2025-10-01T00:00:00Z", description: "Unsuitable strategy recommended" },
        { id: "evt_2", type: "regulator_action", timestamp: "2026-04-01T00:00:00Z", description: "ASIC opened investigation" },
      ],
    },
  },
];

// ─── MCP helpers ────────────────────────────────────────────────────────
async function parseSseOrJson(text) {
  if (text.includes("data:")) {
    const dataLine = text.split("\n").find((l) => l.trim().startsWith("data:"));
    if (!dataLine) throw new Error("Malformed SSE response");
    return JSON.parse(dataLine.replace(/^data:\s*/, "").trim());
  }
  return JSON.parse(text);
}

async function initSession() {
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "faultkey-weekly-determinism", version: "1.0" },
      },
    }),
  });
  const session = r.headers.get("mcp-session-id");
  if (!session) throw new Error("No MCP session id");
  await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Session-Id": session,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return session;
}

async function runScenario(session, incident) {
  const t0 = Date.now();
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Session-Id": session,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "submit_incident",
        arguments: { ...incident, pii_acknowledged: true },
      },
    }),
  });
  const text = await r.text();
  const parsed = await parseSseOrJson(text);
  if (parsed.error) throw new Error(parsed.error.message || "MCP error");
  const result = parsed.result || {};
  if (result.isError) {
    const msg = result.content?.[0]?.text || "unspecified MCP error";
    // Surface the rate-limit retry-after if the worker sent one.
    let retryAfter = 0;
    try {
      const parsedMsg = JSON.parse(msg);
      if (parsedMsg?.error === "DEMO_RATE_LIMITED" && typeof parsedMsg.retry_after_seconds === "number") {
        retryAfter = parsedMsg.retry_after_seconds;
      }
    } catch { /* not json */ }
    const err = new Error(`engine: ${msg.slice(0, 200)}`);
    err.retryAfter = retryAfter;
    throw err;
  }
  const content = result.content;
  if (!Array.isArray(content) || !content.length) throw new Error("empty content block");
  // Find a JSON-parseable block that carries a certificateId. The worker
  // sometimes returns it as content[0] (newer engine) or content[1] (older).
  // Also catch rate-limit blocks that arrive without `isError: true`.
  let cert = null;
  let rateLimitedRetryAfter = 0;
  for (const block of content) {
    if (!block || typeof block.text !== "string") continue;
    try {
      const candidate = JSON.parse(block.text);
      const hasCert = candidate?.certificateId || candidate?.result?.certificateId;
      if (hasCert) {
        cert = candidate;
        break;
      }
      if (candidate?.error === "DEMO_RATE_LIMITED" && typeof candidate.retry_after_seconds === "number") {
        rateLimitedRetryAfter = candidate.retry_after_seconds;
      }
    } catch {
      /* not JSON, skip */
    }
  }
  if (!cert) {
    if (rateLimitedRetryAfter > 0) {
      const err = new Error(`engine: DEMO_RATE_LIMITED (retry_after=${rateLimitedRetryAfter}s)`);
      err.retryAfter = rateLimitedRetryAfter;
      throw err;
    }
    throw new Error("no certificate in response");
  }
  return { cert, latency_ms: Date.now() - t0 };
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(PROOFS_DIR)) await mkdir(PROOFS_DIR, { recursive: true });

  console.log(`[weekly-determinism] engine = ${MCP_URL}`);
  console.log(`[weekly-determinism] scenarios = ${SCENARIOS.length}`);

  let session;
  try {
    session = await initSession();
  } catch (e) {
    console.error(`Could not initialise MCP session: ${e.message}`);
    process.exit(2);
  }

  const results = [];
  let failures = 0;
  const INTER_DELAY_MS = Number(process.env.FAULTKEY_INTER_DELAY_MS ?? 6000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    if (i > 0) await sleep(INTER_DELAY_MS);
    let attempt = 0;
    let outcome = null;
    while (attempt < 3 && !outcome) {
      attempt += 1;
      try {
        outcome = await runScenario(session, s.incident);
      } catch (e) {
        if (e.retryAfter && attempt < 3) {
          const wait = (e.retryAfter + 1) * 1000;
          console.log(`  retry ${s.id} after ${wait}ms (rate limit)`);
          await sleep(wait);
          // refresh session in case it was invalidated
          try { session = await initSession(); } catch { /* keep old */ }
          continue;
        }
        // not retryable
        failures += 1;
        results.push({ id: s.id, label: s.label, ok: false, error: e.message });
        console.log(`  ERR ${s.id}: ${e.message.split("\n")[0]}`);
        outcome = "FAILED";
      }
    }
    if (!outcome || outcome === "FAILED") continue;
    const { cert, latency_ms } = outcome;
    try {
      const result = cert.result ?? cert;
      results.push({
        id: s.id,
        label: s.label,
        certificate_id: result.certificateId ?? null,
        request_hash: result._demo_request_hash ?? result.requestHash ?? null,
        merkle_root: result?.anchor?.merkleRoot ?? null,
        primary_share:
          typeof result?.verdict?.primaryShare === "number"
            ? result.verdict.primaryShare
            : null,
        verdict_kind: typeof result?.verdict === "string" ? result.verdict : result?.verdict?.kind ?? null,
        rule_set_version: result?.ruleSetVersion ?? null,
        engine_version: result?.engineVersion ?? null,
        total_cents: result?.damages?.totalCents ?? null,
        currency: result?.damages?.currency ?? null,
        latency_ms,
        ok: true,
      });
      console.log(`  ok  ${s.id.padEnd(24)} cert=${(result.certificateId || "—").slice(0, 28)} ${latency_ms}ms`);
    } catch (e) {
      failures += 1;
      results.push({ id: s.id, label: s.label, ok: false, error: e.message });
      console.log(`  ERR ${s.id}: ${e.message}`);
    }
  }

  // ─── Pull commit metadata ───────────────────────────────────────
  let commit_sha = "unknown";
  try {
    commit_sha = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
  } catch {
    /* not in a git checkout */
  }

  const today = new Date().toISOString().slice(0, 10);
  const proof = {
    generated_at: new Date().toISOString(),
    engine_url: MCP_URL,
    engine_version: results.find((r) => r.engine_version)?.engine_version ?? null,
    rule_set_version: results.find((r) => r.rule_set_version)?.rule_set_version ?? null,
    commit_sha,
    scenario_count: SCENARIOS.length,
    success_count: results.filter((r) => r.ok).length,
    failure_count: failures,
    scenarios: results,
  };

  // ─── Compare against previous proof (the actual determinism test) ─
  await compareWithPrevious(proof);

  const proofFile = resolve(PROOFS_DIR, `${today}.json`);
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${proofFile}`);

  await updateReadme(proof, today);

  process.exit(failures === 0 ? 0 : 1);
}

async function compareWithPrevious(current) {
  // Find the most recent existing proof file (alphabetical-by-date sort).
  const { readdir } = await import("node:fs/promises");
  try {
    const files = (await readdir(PROOFS_DIR))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (!files.length) {
      console.log("\nNo previous proof to compare against — this is the baseline.");
      return;
    }
    const prevFile = resolve(PROOFS_DIR, files[files.length - 1]);
    const prev = JSON.parse(await readFile(prevFile, "utf8"));
    // Two notions of determinism:
    //   canonical_input_stable — the request_hash + merkle_root are
    //     derived from the canonical input. They MUST be identical across
    //     runs for the engine to be considered deterministic. This is the
    //     spec guarantee.
    //   certificate_id_stable — strictly stronger: same input → same
    //     cert id. If the worker mixes in a timestamp or nonce, this
    //     will be false even when canonical_input_stable is true.
    let canonicalStable = 0;
    let canonicalDrifted = 0;
    let certIdStable = 0;
    let certIdDrifted = 0;
    const drifts = [];
    for (const s of current.scenarios) {
      if (!s.ok) continue;
      const prevS = prev.scenarios.find((p) => p.id === s.id);
      if (!prevS || !prevS.ok) continue;
      const canonicalMatch = prevS.request_hash === s.request_hash && prevS.merkle_root === s.merkle_root;
      const certMatch = prevS.certificate_id === s.certificate_id;
      if (canonicalMatch) canonicalStable += 1; else canonicalDrifted += 1;
      if (certMatch) certIdStable += 1; else certIdDrifted += 1;
      if (!canonicalMatch || !certMatch) {
        drifts.push({
          id: s.id,
          canonical_match: canonicalMatch,
          cert_id_match: certMatch,
          prev: {
            certificate_id: prevS.certificate_id,
            request_hash: prevS.request_hash,
            merkle_root: prevS.merkle_root,
          },
          curr: {
            certificate_id: s.certificate_id,
            request_hash: s.request_hash,
            merkle_root: s.merkle_root,
          },
        });
      }
    }
    current.comparison = {
      previous_proof: files[files.length - 1],
      canonical_input_stable_count: canonicalStable,
      canonical_input_drifted_count: canonicalDrifted,
      certificate_id_stable_count: certIdStable,
      certificate_id_drifted_count: certIdDrifted,
      drifts,
    };
    console.log(`\nvs ${files[files.length - 1]}:`);
    console.log(`  canonical_input  stable: ${canonicalStable}  drifted: ${canonicalDrifted}`);
    console.log(`  certificate_id   stable: ${certIdStable}  drifted: ${certIdDrifted}`);
    if (canonicalDrifted > 0) {
      console.log("  CANONICAL DRIFT (SPEC VIOLATION):");
      for (const d of drifts.filter((x) => !x.canonical_match)) {
        console.log(`    ${d.id}: request_hash ${d.prev.request_hash} → ${d.curr.request_hash}`);
      }
    }
  } catch (e) {
    console.warn(`Could not compare with previous proof: ${e.message}`);
  }
}

async function updateReadme(proof, today) {
  const readmePath = resolve(PROOFS_DIR, "README.md");
  let history = [];
  try {
    if (existsSync(readmePath)) {
      const cur = await readFile(readmePath, "utf8");
      const m = cur.match(/<!-- history-begin -->([\s\S]*?)<!-- history-end -->/);
      if (m) {
        history = m[1]
          .trim()
          .split("\n")
          .filter((l) => l.startsWith("|"))
          .slice(2);
      }
    }
  } catch {
    /* first run */
  }

  const cmp = proof.comparison;
  // The Y/N tracks canonical-input stability — i.e., did same canonical
  // input produce the same request_hash + merkle_root as last week? That
  // is what the spec actually guarantees. Certificate-id stability is
  // tracked separately and not used for the badge.
  const canonStable = cmp ? (cmp.canonical_input_drifted_count === 0 ? "Y" : "N") : "—";
  const certStable = cmp ? (cmp.certificate_id_drifted_count === 0 ? "Y" : "N") : "—";
  const row = `| ${today} | ${proof.success_count}/${proof.scenario_count} | ${canonStable} | ${certStable} | \`${proof.engine_version || "—"}\` | \`${proof.commit_sha.slice(0, 7)}\` |`;
  // Prepend latest at top, deduplicate
  history = [row, ...history.filter((r) => !r.startsWith(`| ${today} |`))];
  history = history.slice(0, 104); // 2 years of weekly entries

  const consecutiveIdentical = countConsecutiveIdentical(history);

  const out = `# Determinism proofs

This directory contains weekly reproductions of all ${proof.scenario_count} FaultKey demo
scenarios against the live MCP worker at \`${proof.engine_url}\`. Every Monday at
12:00 UTC, GitHub Actions re-runs \`scripts/weekly-determinism.mjs\` and commits
a new \`YYYY-MM-DD.json\` proof file alongside this README.

The point: any third party can replay the same scenarios at any time and get
byte-identical \`certificateId\`, \`request_hash\`, and \`merkleRoot\` values.
That's what "deterministic" means in practice.

**Consecutive weeks with zero drift:** ${consecutiveIdentical}

| Date | Success | Canonical-input stable | Cert-id stable | Engine | Repo |
|------|---------|------------------------|----------------|--------|------|
<!-- history-begin -->
${history.join("\n")}
<!-- history-end -->

## Proof file format

Each \`YYYY-MM-DD.json\` contains:

\`\`\`json
{
  "generated_at": "ISO-8601 timestamp",
  "engine_url": "https://mcp.faultkey.com/mcp",
  "engine_version": "0.5.0-demo",
  "rule_set_version": "global-v1",
  "commit_sha": "<sha>",
  "scenarios": [
    {
      "id": "healthcare",
      "certificate_id": "fkcert_…",
      "request_hash": "<hash>",
      "merkle_root": "<root>",
      "primary_share": 0.41,
      "latency_ms": 380
    }
  ],
  "comparison": {
    "previous_proof": "YYYY-MM-DD.json",
    "identical_count": 10,
    "drifted_count": 0
  }
}
\`\`\`

## Verifying these proofs yourself

\`\`\`bash
git clone https://github.com/smq9sn5jck-coder/causallayer-mcp
cd causallayer-mcp
node scripts/weekly-determinism.mjs
diff <(jq -S . proofs/$(date +%F).json) <(jq -S . proofs/<latest-here>.json)
\`\`\`

If your file matches the committed file, the engine is deterministic.
If it doesn't, please open an issue — that's exactly the kind of drift this
log exists to catch.
`;

  await writeFile(readmePath, out, "utf8");
  console.log(`Updated ${readmePath}`);
}

function countConsecutiveIdentical(rows) {
  // Rows are formatted: `| YYYY-MM-DD | a/b | Y | Y | … |`. Counts
  // consecutive weeks where canonical-input was stable (col 3).
  let count = 0;
  for (const r of rows) {
    const cols = r.split("|").map((c) => c.trim());
    if (cols[3] === "Y") count += 1;
    else break;
  }
  return count;
}

main().catch((e) => {
  console.error(`fatal: ${e.message}`);
  process.exit(2);
});
