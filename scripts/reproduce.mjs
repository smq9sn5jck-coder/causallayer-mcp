#!/usr/bin/env node
/**
 * reproduce.mjs — Skeptic-runnable reproducibility CLI for FaultKey demo.
 *
 * The point: anyone in the world should be able to clone this repo and run
 * one command that proves, byte-for-byte, that the FaultKey demo engine is
 * deterministic. No engine source access required, no special credentials,
 * no FaultKey-internal tooling.
 *
 * Three modes:
 *
 *   1. Single-scenario re-run + intra-run determinism (the fast skeptic test):
 *
 *      $ node scripts/reproduce.mjs --scenario=healthcare --runs=2
 *
 *      Hits mcp.faultkey.com/mcp twice with the SAME canonical input.
 *      Asserts every certificate field that should be deterministic
 *      (certificateId, request_hash, merkle_root, primary_share, total_cents)
 *      is byte-identical across the two runs. Exits 0 if PASS, 1 if FAIL.
 *
 *   2. Compare against a frozen historical proof (the audit-trail test):
 *
 *      $ node scripts/reproduce.mjs --baseline=proofs/2026-05-19.json
 *
 *      Re-runs every scenario in scripts/scenarios.data.json against the
 *      live engine and asserts the certificateIds are byte-identical to
 *      the ones recorded in the named historical proof file. Catches the
 *      case where a worker deploy silently broke determinism for an old
 *      input. Exits 0 if PASS, 1 if FAIL.
 *
 *   3. All scenarios, fresh run, no comparison (the smoke test):
 *
 *      $ node scripts/reproduce.mjs --all
 *
 *      Runs every scenario once and prints the resulting cert IDs.
 *      Useful for capturing the next baseline. Exits 0 if all returned
 *      a certificate, 1 if any failed.
 *
 * Flags:
 *   --scenario=<id>      One of the IDs in scripts/scenarios.data.json
 *   --runs=<N>           Number of times to call the engine (mode 1, default 2)
 *   --baseline=<path>    Path to a historical proof file to compare against (mode 2)
 *   --all                Run every scenario once (mode 3)
 *   --endpoint=<url>     MCP endpoint (default https://mcp.faultkey.com/mcp)
 *   --inter-delay-ms=<n> Pause between runs to avoid rate limits (default 6000)
 *   --json               Emit machine-readable JSON to stdout instead of human text
 *
 * Exit codes:
 *   0  — PASS (all assertions held)
 *   1  — FAIL (at least one determinism assertion failed)
 *   2  — Could not reach engine / could not initialise MCP session
 *   3  — Bad arguments / invalid scenario id / missing baseline file
 *
 * Zero runtime dependencies. Uses only Node 18+ built-in fetch and fs.
 *
 * License: Apache-2.0. Copyright 2026 FaultKey Protocol.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_FILE = resolve(__dirname, "scenarios.data.json");

// ─── Argument parsing ───────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    scenario: null,
    runs: 2,
    baseline: null,
    all: false,
    endpoint: process.env.FAULTKEY_MCP_URL || "https://mcp.faultkey.com/mcp",
    interDelayMs: 6000,
    json: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") a.help = true;
    else if (arg === "--all") a.all = true;
    else if (arg === "--json") a.json = true;
    else if (arg.startsWith("--scenario=")) a.scenario = arg.slice("--scenario=".length);
    else if (arg.startsWith("--runs=")) a.runs = Math.max(1, Number(arg.slice("--runs=".length)) || 2);
    else if (arg.startsWith("--baseline=")) a.baseline = arg.slice("--baseline=".length);
    else if (arg.startsWith("--endpoint=")) a.endpoint = arg.slice("--endpoint=".length);
    else if (arg.startsWith("--inter-delay-ms=")) a.interDelayMs = Math.max(0, Number(arg.slice("--inter-delay-ms=".length)) || 0);
  }
  return a;
}

function printHelp() {
  process.stdout.write(`reproduce.mjs — FaultKey demo determinism CLI

Modes:
  --scenario=<id> --runs=<N>     Re-run one scenario N times, assert byte-identical certs
  --baseline=<path>              Compare a fresh full run against a historical proof file
  --all                          Run every scenario once and print the resulting cert IDs

Common flags:
  --endpoint=<url>               MCP endpoint (default https://mcp.faultkey.com/mcp)
  --inter-delay-ms=<n>           Pause between calls (default 6000)
  --json                         Machine-readable output

Exit codes: 0 PASS · 1 FAIL · 2 unreachable · 3 bad args
`);
}

// ─── MCP transport (mirrors weekly-determinism.mjs) ─────────────────────
async function parseSseOrJson(text) {
  // The MCP streamable-HTTP transport returns either application/json
  // (single line) or text/event-stream (data: <json> blocks).
  if (text.startsWith("event:") || text.startsWith("data:")) {
    for (const block of text.split("\n\n")) {
      const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        return JSON.parse(dataLine.slice("data: ".length));
      } catch { /* try next */ }
    }
    throw new Error("could not parse SSE response");
  }
  return JSON.parse(text);
}

async function initSession(endpoint) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "faultkey-reproduce", version: "1.0" },
      },
    }),
  });
  const session = r.headers.get("mcp-session-id");
  if (!session) throw new Error("no MCP session id in initialize response");
  await fetch(endpoint, {
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

async function callSubmitIncident(endpoint, session, incident) {
  const t0 = Date.now();
  const r = await fetch(endpoint, {
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
      params: { name: "submit_incident", arguments: { ...incident, pii_acknowledged: true } },
    }),
  });
  const text = await r.text();
  const parsed = await parseSseOrJson(text);
  if (parsed.error) throw new Error(parsed.error.message || "MCP error");
  const result = parsed.result || {};
  if (result.isError) {
    const msg = result.content?.[0]?.text || "unspecified MCP error";
    throw new Error(`engine: ${msg.slice(0, 200)}`);
  }
  const content = result.content;
  if (!Array.isArray(content) || !content.length) throw new Error("empty content block");
  for (const block of content) {
    if (!block || typeof block.text !== "string") continue;
    try {
      const candidate = JSON.parse(block.text);
      if (candidate?.certificateId || candidate?.result?.certificateId) {
        const cert = candidate.result ?? candidate;
        return { cert, latency_ms: Date.now() - t0 };
      }
    } catch { /* skip */ }
  }
  throw new Error("no certificate in response");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Field extraction (the bytes a skeptic compares) ────────────────────
// These five fields MUST be byte-identical for identical canonical inputs.
// If any one drifts between runs, the determinism claim is broken.
function fingerprint(cert) {
  return {
    certificateId: cert?.certificateId ?? null,
    request_hash: cert?._demo_request_hash ?? cert?.requestHash ?? null,
    merkle_root: cert?.anchor?.merkleRoot ?? null,
    primary_share:
      typeof cert?.verdict?.primaryShare === "number" ? cert.verdict.primaryShare : null,
    total_cents: cert?.damages?.totalCents ?? null,
  };
}

function diff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      out.push({ field: k, run_a: a[k], run_b: b[k] });
    }
  }
  return out;
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  // Load canonical scenarios (single source of truth shared with weekly-determinism.mjs)
  const SCENARIOS = JSON.parse(await readFile(SCENARIOS_FILE, "utf8"));

  // Mode dispatch
  if (args.baseline) return runBaselineMode(args, SCENARIOS);
  if (args.all)      return runAllMode(args, SCENARIOS);
  if (args.scenario) return runSingleMode(args, SCENARIOS);

  printHelp();
  process.exit(3);
}

// ─── Mode 1: single scenario, N runs, intra-run determinism ─────────────
async function runSingleMode(args, SCENARIOS) {
  const sc = SCENARIOS.find((x) => x.id === args.scenario);
  if (!sc) {
    process.stderr.write(`unknown scenario: ${args.scenario}\nknown: ${SCENARIOS.map(s => s.id).join(", ")}\n`);
    process.exit(3);
  }
  if (!args.json) {
    process.stdout.write(`reproduce · scenario=${sc.id} · runs=${args.runs} · endpoint=${args.endpoint}\n\n`);
  }

  let session;
  try { session = await initSession(args.endpoint); }
  catch (e) { process.stderr.write(`unreachable: ${e.message}\n`); process.exit(2); }

  const fingerprints = [];
  for (let i = 0; i < args.runs; i++) {
    if (i > 0) await sleep(args.interDelayMs);
    try {
      const { cert, latency_ms } = await callSubmitIncident(args.endpoint, session, sc.incident);
      const fp = fingerprint(cert);
      fingerprints.push({ run: i + 1, latency_ms, ...fp });
      if (!args.json) {
        process.stdout.write(`  run ${i + 1}: cert=${(fp.certificateId || "—").slice(0, 32)} hash=${(fp.request_hash || "—").slice(0, 16)} ${latency_ms}ms\n`);
      }
    } catch (e) {
      process.stderr.write(`  run ${i + 1}: ERR ${e.message}\n`);
      process.exit(1);
    }
  }

  // Compare every pair: every field must be byte-identical across all runs.
  const diffs = [];
  for (let i = 1; i < fingerprints.length; i++) {
    const d = diff(fingerprints[0], fingerprints[i]);
    if (d.length) diffs.push({ comparing: [1, i + 1], drift: d });
  }
  const pass = diffs.length === 0;

  if (args.json) {
    process.stdout.write(JSON.stringify({ mode: "single", scenario: sc.id, runs: args.runs, fingerprints, pass, drift: diffs }, null, 2) + "\n");
  } else {
    process.stdout.write("\n");
    if (pass) process.stdout.write(`PASS · ${args.runs} runs produced byte-identical certificates\n`);
    else {
      process.stdout.write(`FAIL · determinism broken across ${args.runs} runs\n`);
      for (const d of diffs) {
        process.stdout.write(`  runs ${d.comparing.join(" vs ")}:\n`);
        for (const f of d.drift) {
          process.stdout.write(`    ${f.field}: ${JSON.stringify(f.run_a)} → ${JSON.stringify(f.run_b)}\n`);
        }
      }
    }
  }
  process.exit(pass ? 0 : 1);
}

// ─── Mode 2: compare full run against a historical baseline ─────────────
async function runBaselineMode(args, SCENARIOS) {
  if (!existsSync(args.baseline)) {
    process.stderr.write(`baseline file not found: ${args.baseline}\n`);
    process.exit(3);
  }
  const baseline = JSON.parse(await readFile(args.baseline, "utf8"));
  const baselineMap = new Map();
  for (const r of baseline.scenarios || []) baselineMap.set(r.id, r);

  if (!args.json) {
    process.stdout.write(`reproduce · baseline=${args.baseline} (${baseline.generated_at || "?"}) · endpoint=${args.endpoint}\n\n`);
  }

  let session;
  try { session = await initSession(args.endpoint); }
  catch (e) { process.stderr.write(`unreachable: ${e.message}\n`); process.exit(2); }

  const results = [];
  let failures = 0;
  for (let i = 0; i < SCENARIOS.length; i++) {
    if (i > 0) await sleep(args.interDelayMs);
    const sc = SCENARIOS[i];
    try {
      const { cert, latency_ms } = await callSubmitIncident(args.endpoint, session, sc.incident);
      const fp = fingerprint(cert);
      const expected = baselineMap.get(sc.id);
      const drift = expected ? diff(
        { certificateId: expected.certificate_id, request_hash: expected.request_hash, merkle_root: expected.merkle_root, primary_share: expected.primary_share, total_cents: expected.total_cents },
        fp,
      ) : [{ field: "scenario", run_a: "missing-from-baseline", run_b: "present-now" }];
      const ok = drift.length === 0;
      if (!ok) failures += 1;
      results.push({ id: sc.id, ok, fp, drift, latency_ms });
      if (!args.json) {
        process.stdout.write(`  ${ok ? "ok " : "FAIL"} ${sc.id.padEnd(24)} cert=${(fp.certificateId || "—").slice(0, 32)} ${latency_ms}ms\n`);
      }
    } catch (e) {
      failures += 1;
      results.push({ id: sc.id, ok: false, error: e.message });
      process.stdout.write(`  FAIL ${sc.id}: ${e.message}\n`);
    }
  }

  const pass = failures === 0;
  if (args.json) {
    process.stdout.write(JSON.stringify({ mode: "baseline", baseline: args.baseline, results, pass }, null, 2) + "\n");
  } else {
    process.stdout.write("\n");
    process.stdout.write(`${pass ? "PASS" : "FAIL"} · ${results.length - failures}/${results.length} scenarios reproduced from baseline\n`);
    if (!pass) {
      for (const r of results.filter((x) => !x.ok)) {
        process.stdout.write(`\n  ${r.id}:\n`);
        if (r.error) { process.stdout.write(`    ERROR ${r.error}\n`); continue; }
        for (const f of r.drift) {
          process.stdout.write(`    ${f.field}: baseline=${JSON.stringify(f.run_a)} → live=${JSON.stringify(f.run_b)}\n`);
        }
      }
    }
  }
  process.exit(pass ? 0 : 1);
}

// ─── Mode 3: all scenarios, single run, capture-only ────────────────────
async function runAllMode(args, SCENARIOS) {
  if (!args.json) {
    process.stdout.write(`reproduce · all scenarios · endpoint=${args.endpoint}\n\n`);
  }
  let session;
  try { session = await initSession(args.endpoint); }
  catch (e) { process.stderr.write(`unreachable: ${e.message}\n`); process.exit(2); }

  const results = [];
  let failures = 0;
  for (let i = 0; i < SCENARIOS.length; i++) {
    if (i > 0) await sleep(args.interDelayMs);
    const sc = SCENARIOS[i];
    try {
      const { cert, latency_ms } = await callSubmitIncident(args.endpoint, session, sc.incident);
      const fp = fingerprint(cert);
      results.push({ id: sc.id, label: sc.label, ok: true, latency_ms, ...fp });
      if (!args.json) process.stdout.write(`  ok  ${sc.id.padEnd(24)} cert=${(fp.certificateId || "—").slice(0, 32)} ${latency_ms}ms\n`);
    } catch (e) {
      failures += 1;
      results.push({ id: sc.id, label: sc.label, ok: false, error: e.message });
      if (!args.json) process.stdout.write(`  ERR ${sc.id}: ${e.message}\n`);
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ mode: "all", endpoint: args.endpoint, results }, null, 2) + "\n");
  } else {
    process.stdout.write("\n");
    process.stdout.write(`${failures === 0 ? "OK" : "PARTIAL"} · ${results.length - failures}/${results.length} scenarios returned a certificate\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { process.stderr.write(`fatal: ${err.stack || err.message}\n`); process.exit(2); });
