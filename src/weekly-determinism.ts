/**
 * FK-METHOD-2026-005 — Weekly determinism cron (weekly-determinism.ts)
 *
 * Every Monday at 12:00 UTC, the worker's scheduled() handler invokes
 * `runWeeklyDeterminism()`. The function:
 *
 *   1. Iterates the canonical demo scenario suite (CANONICAL_SCENARIOS).
 *   2. For each scenario, calls the engine's submit_incident endpoint to
 *      produce a certificate.
 *   3. Calls the engine's verify_certificate_recompute endpoint with the
 *      same canonical input to obtain the recomputed certificate id and
 *      Merkle root.
 *   4. Compares (request_hash, certificate_id, merkle_root) between the
 *      first and second runs. Determinism PASS only if all three are
 *      bit-identical.
 *   5. Builds a manifest: { iso_week, scenario_count, all_pass,
 *      per_scenario: [...], manifest_sha256, ts }.
 *   6. Stores the manifest under `weekly:<iso_week>` in WEEKLY_PROOFS KV.
 *   7. Updates the rolling index `weekly:index` (last 52 entries).
 *
 * The manifest is also exposed publicly via GET /api/v2/proofs/weekly,
 * which returns either the latest manifest or the full rolling history.
 *
 * --------------------------------------------------------------------
 * Honesty markers
 * --------------------------------------------------------------------
 *  - The signing posture matches the rest of the demo. If ANCHOR_PRIVATE_KEY
 *    is bound, the manifest is Ed25519-signed and `signature_status` is
 *    "signed". Otherwise it's "unsigned_demo" and the integrity guarantee
 *    is SHA-256-only (sufficient for "is the engine still deterministic
 *    this week"; not sufficient for non-repudiation).
 *
 *  - The cron is also exposed as POST /api/v2/proofs/run-now gated by
 *    ADMIN_TOKEN so a GitHub Actions workflow can trigger it from outside
 *    Cloudflare's cron scheduler — useful when wrangler cron isn't
 *    configured yet, or for ad-hoc verification.
 *
 *  - The "canonical scenario suite" is the same one shown on /try (the
 *    public-facing demo). Adding or removing scenarios from the suite
 *    requires a docs/weekly-determinism.md changelog entry.
 *
 *  - This module makes no commitment about whether external observers
 *    can independently reproduce the manifest. They can — the canonical
 *    inputs are public and the engine is deterministic — and that's the
 *    point. The cron just publishes regular evidence; the proof is in
 *    third-party reproduction.
 */

export type CanonicalScenario = {
  id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  jurisdiction: string;
  /** Canonical, immutable input. Changes must bump the suite version. */
  input: {
    incident: {
      title: string;
      description: string;
      severity: string;
      jurisdiction: string;
      timestamp_utc: string; // FROZEN: never use Date.now() — must be deterministic.
    };
    agents: Array<{ id: string; type: string; name: string }>;
    events: Array<{ type: string; description: string; agent_id?: string }>;
  };
};

/**
 * The canonical suite. Each scenario's `timestamp_utc` is FROZEN — it does
 * not advance with wall-clock time. This is essential: the suite must be
 * deterministic week over week.
 *
 * Suite version: v1.0.0. Bump when scenarios are added/removed/edited.
 */
export const CANONICAL_SUITE_VERSION = "v1.0.0" as const;
export const CANONICAL_SCENARIOS: readonly CanonicalScenario[] = [
  {
    id: "loan",
    title: "AI auto-approved high-risk loan without human review",
    severity: "high",
    jurisdiction: "AU",
    input: {
      incident: {
        title: "AI auto-approved high-risk loan without human review",
        description:
          "Credit scoring model approved a $180,000 mortgage for a borrower with thin credit file. The model bypassed the mandatory human-in-the-loop check for applications exceeding $100k.",
        severity: "high",
        jurisdiction: "AU",
        timestamp_utc: "2026-01-01T00:00:00Z",
      },
      agents: [
        { id: "vendor", type: "vendor", name: "Anthropic Claude 3.5" },
        { id: "deployer", type: "deployer", name: "National Credit Corp" },
        { id: "user", type: "human_operator", name: "Loan Officer (bypassed)" },
      ],
      events: [
        { type: "application_received", description: "Mortgage application submitted via online portal" },
        { type: "model_inference", description: "Credit model scores applicant at 0.73 (borderline)", agent_id: "vendor" },
        { type: "threshold_bypass", description: "Auto-approval triggered despite >$100k threshold requiring human review", agent_id: "deployer" },
        { type: "loan_disbursed", description: "Funds transferred without human sign-off" },
      ],
    },
  },
  {
    id: "medical",
    title: "Triage AI downgraded chest pain patient to non-urgent",
    severity: "critical",
    jurisdiction: "AU",
    input: {
      incident: {
        title: "Triage AI downgraded chest pain patient to non-urgent",
        description:
          "Emergency department triage AI classified a 58-year-old male presenting with atypical chest pain as Category 4 (non-urgent). Patient suffered STEMI 45 minutes later.",
        severity: "critical",
        jurisdiction: "AU",
        timestamp_utc: "2026-01-01T00:00:00Z",
      },
      agents: [
        { id: "vendor", type: "vendor", name: "MedAssist AI v4.2" },
        { id: "deployer", type: "deployer", name: "St Vincent's Hospital" },
        { id: "user", type: "human_operator", name: "Triage Nurse (overridden)" },
      ],
      events: [
        { type: "patient_presentation", description: "58M presents with left shoulder pain, mild diaphoresis" },
        { type: "ai_triage", description: "AI classifies as Category 4 (non-urgent)", agent_id: "vendor" },
        { type: "nurse_override_rejected", description: "Nurse attempted to escalate but system required supervisor code", agent_id: "deployer" },
        { type: "cardiac_event", description: "Patient collapses — STEMI confirmed on ECG" },
      ],
    },
  },
  {
    id: "content",
    title: "Content filter failed to detect coordinated harassment",
    severity: "medium",
    jurisdiction: "EU",
    input: {
      incident: {
        title: "Content filter failed to detect coordinated harassment",
        description:
          "Automated content moderation system failed to flag a coordinated harassment campaign. 4,200 abusive posts remained live for 18 hours.",
        severity: "medium",
        jurisdiction: "EU",
        timestamp_utc: "2026-01-01T00:00:00Z",
      },
      agents: [
        { id: "vendor", type: "vendor", name: "OpenAI GPT-4o (moderation)" },
        { id: "deployer", type: "deployer", name: "SocialPlatform Inc" },
        { id: "user", type: "human_operator", name: "Trust & Safety Team" },
      ],
      events: [
        { type: "campaign_start", description: "Coordinated accounts begin posting using coded language" },
        { type: "filter_pass", description: "Content filter scores posts as 0.3 (below threshold)", agent_id: "vendor" },
        { type: "volume_spike", description: "4,200 posts in 6 hours — anomaly detection silent", agent_id: "deployer" },
        { type: "manual_report", description: "Target reports harassment; T&S team manually removes content" },
      ],
    },
  },
  {
    id: "coding",
    title: "Coding agent dropped production database",
    severity: "high",
    jurisdiction: "AU",
    input: {
      incident: {
        title: "Coding agent dropped production database",
        description:
          'Autonomous coding agent invoked DROP TABLE on production users table after user said "clean up the test data". No confirmation requested.',
        severity: "high",
        jurisdiction: "AU",
        timestamp_utc: "2026-01-01T00:00:00Z",
      },
      agents: [
        { id: "vendor", type: "vendor", name: "OpenAI GPT-5" },
        { id: "deployer", type: "deployer", name: "Acme Corp DevOps" },
        { id: "user", type: "human_operator", name: "Jane Doe (engineer)" },
      ],
      events: [
        { type: "prompt", description: "User says: clean up the test data", agent_id: "user" },
        { type: "tool_call", description: "Agent calls execute_sql with destructive statement", agent_id: "vendor" },
        { type: "db_drop", description: "DROP TABLE production.users executed without confirmation" },
        { type: "alert_fired", description: "Datadog alert fires; oncall paged" },
      ],
    },
  },
  {
    id: "hiring",
    title: "Resume screener systematically rejected candidates over 50",
    severity: "critical",
    jurisdiction: "EU",
    input: {
      incident: {
        title: "Resume screener systematically rejected candidates over 50",
        description:
          "AI resume screening tool showed statistically significant bias against candidates with graduation dates before 1996. 340 qualified candidates auto-rejected.",
        severity: "critical",
        jurisdiction: "EU",
        timestamp_utc: "2026-01-01T00:00:00Z",
      },
      agents: [
        { id: "vendor", type: "vendor", name: "HireBot AI v2.1" },
        { id: "deployer", type: "deployer", name: "TechCorp Recruiting" },
        { id: "user", type: "human_operator", name: "Head of People" },
      ],
      events: [
        { type: "screening_deployed", description: "AI screener activated for all engineering roles" },
        { type: "pattern_emerges", description: "Internal audit flags 94% rejection rate for 50+ candidates", agent_id: "deployer" },
        { type: "bias_confirmed", description: "Graduation year is proxy variable for age discrimination", agent_id: "vendor" },
        { type: "regulatory_notice", description: "EU DPA opens investigation under AI Act Article 10" },
      ],
    },
  },
];

export type PerScenarioResult = {
  scenario_id: string;
  pass: boolean;
  /** First-run hashes. */
  run1: { request_hash: string; certificate_id: string; merkle_root: string };
  /** Second-run hashes (recompute). */
  run2: { request_hash: string; certificate_id: string; merkle_root: string };
  /** Mismatching field names if pass === false. */
  mismatches: string[];
  duration_ms: number;
  error?: string;
};

export type WeeklyManifest = {
  ruleId: "FK-METHOD-2026-005";
  ruleName: "Weekly Determinism Proof";
  iso_week: string; // e.g. "2026-W21"
  ts_utc: string;
  suite_version: typeof CANONICAL_SUITE_VERSION;
  scenario_count: number;
  pass_count: number;
  fail_count: number;
  all_pass: boolean;
  per_scenario: PerScenarioResult[];
  manifest_sha256: string;
  /** "signed" | "unsigned_demo". */
  signature_status: "signed" | "unsigned_demo";
  /** Base64 Ed25519 signature over manifest_sha256. Empty string when unsigned. */
  signature: string;
  /** Engine version markers. */
  engine: {
    standalone: boolean;
    env: string;
  };
};

/** Return ISO week string like "2026-W21". */
export function isoWeek(d: Date = new Date()): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

/** SHA-256 hex via WebCrypto (Workers runtime). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Pure deterministic stringify (sort keys at every level). */
export function canonicalize(value: unknown): string {
  return JSON.stringify(value, replacer);
}
function replacer(_k: string, v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = (v as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return v;
}

export type DeterminismDeps = {
  /**
   * Calls the engine to score one scenario. Must return at minimum
   * the certificate_id, merkle_root, and the request_hash that was
   * used. The implementation in index.ts wires this to the standalone
   * engine; tests can stub it.
   */
  scoreOnce: (
    scenario: CanonicalScenario
  ) => Promise<{ request_hash: string; certificate_id: string; merkle_root: string }>;
  /** Optional Ed25519 signing of the manifest_sha256. */
  sign?: (manifestSha256Hex: string) => Promise<string>;
  env: { CAUSALLAYER_ENV: string; STANDALONE_DEMO?: string };
};

/** The actual cron worker entry point. */
export async function runWeeklyDeterminism(
  deps: DeterminismDeps
): Promise<WeeklyManifest> {
  const week = isoWeek();
  const ts = new Date().toISOString();
  const perScenario: PerScenarioResult[] = [];

  for (const sc of CANONICAL_SCENARIOS) {
    const t0 = Date.now();
    try {
      const r1 = await deps.scoreOnce(sc);
      const r2 = await deps.scoreOnce(sc);
      const mismatches: string[] = [];
      if (r1.request_hash !== r2.request_hash) mismatches.push("request_hash");
      if (r1.certificate_id !== r2.certificate_id) mismatches.push("certificate_id");
      if (r1.merkle_root !== r2.merkle_root) mismatches.push("merkle_root");
      perScenario.push({
        scenario_id: sc.id,
        pass: mismatches.length === 0,
        run1: r1,
        run2: r2,
        mismatches,
        duration_ms: Date.now() - t0,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      perScenario.push({
        scenario_id: sc.id,
        pass: false,
        run1: { request_hash: "", certificate_id: "", merkle_root: "" },
        run2: { request_hash: "", certificate_id: "", merkle_root: "" },
        mismatches: ["scoring_error"],
        duration_ms: Date.now() - t0,
        error: msg,
      });
    }
  }

  const passCount = perScenario.filter((r) => r.pass).length;
  const failCount = perScenario.length - passCount;
  const allPass = failCount === 0;

  // Build the canonical manifest body (signature/sha excluded from the hash input).
  const manifestBody = {
    ruleId: "FK-METHOD-2026-005" as const,
    ruleName: "Weekly Determinism Proof" as const,
    iso_week: week,
    ts_utc: ts,
    suite_version: CANONICAL_SUITE_VERSION,
    scenario_count: perScenario.length,
    pass_count: passCount,
    fail_count: failCount,
    all_pass: allPass,
    per_scenario: perScenario,
    engine: {
      standalone: deps.env.STANDALONE_DEMO === "true",
      env: deps.env.CAUSALLAYER_ENV,
    },
  };
  const sha = await sha256Hex(canonicalize(manifestBody));
  const signature = deps.sign ? await deps.sign(sha) : "";
  return {
    ...manifestBody,
    manifest_sha256: sha,
    signature_status: signature ? "signed" : "unsigned_demo",
    signature,
  };
}

/** Persist the manifest into KV under weekly:<iso_week> + update index. */
export async function persistManifest(
  kv: { get: (k: string) => Promise<string | null>; put: (k: string, v: string) => Promise<void> },
  manifest: WeeklyManifest
): Promise<void> {
  await kv.put(`weekly:${manifest.iso_week}`, JSON.stringify(manifest));
  // Maintain a rolling index (last 52 weeks).
  const indexJson = await kv.get("weekly:index");
  let index: string[] = [];
  if (indexJson) {
    try {
      index = JSON.parse(indexJson);
    } catch {
      index = [];
    }
  }
  if (!index.includes(manifest.iso_week)) {
    index.unshift(manifest.iso_week);
    if (index.length > 52) index = index.slice(0, 52);
    await kv.put("weekly:index", JSON.stringify(index));
  }
}

/** Read the last N manifests in reverse-chronological order. */
export async function readManifests(
  kv: { get: (k: string) => Promise<string | null> },
  limit = 12
): Promise<WeeklyManifest[]> {
  const indexJson = await kv.get("weekly:index");
  if (!indexJson) return [];
  let index: string[] = [];
  try {
    index = JSON.parse(indexJson);
  } catch {
    return [];
  }
  const out: WeeklyManifest[] = [];
  for (const wk of index.slice(0, limit)) {
    const raw = await kv.get(`weekly:${wk}`);
    if (raw) {
      try {
        out.push(JSON.parse(raw));
      } catch {
        /* skip corrupted */
      }
    }
  }
  return out;
}
