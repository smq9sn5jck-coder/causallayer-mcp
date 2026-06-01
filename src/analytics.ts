/**
 * src/analytics.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Adoption-validation analytics, layered on top of the existing event log.
 *
 * Three concerns, all best-effort and PII-free, stored under the `an:` prefix
 * in the LEDGER KV namespace (distinct from the `evt:` and `tlm:` namespaces):
 *
 *   1. Retention — first/last-seen + daily-unique of REAL users (a pseudonymous
 *      id, not a person id) so /admin/stats can report DAU/WAU/MAU and a
 *      new-vs-returning split. Lets us answer "do real users come back".
 *   2. Funnel + bot filtering — counts the qualifying steps
 *      (visit → mcp_connect → report_generated → lead_submitted →
 *      checkout_started → checkout_completed), counting only non-bot traffic,
 *      so the headline numbers exclude crawlers/CI/self.
 *   3. npm downloads — a daily snapshot of the npm registry download count,
 *      the only legitimate server-side proxy for "npm users". Collected by the
 *      Worker cron and surfaced as a trend.
 *
 * Everything here NEVER throws and NEVER blocks the user-facing response.
 */

import type { BillingEnv } from "./billing.js";

// ─── Bot / real-user classification ─────────────────────────────────────────

/**
 * UA categories (from events.uaCategory) that are NOT real users: crawlers,
 * SEO tools, and empty/unknown agents. Everything else — MCP clients
 * (claude-*, cursor, cline, continue), browsers, and scripted API clients —
 * counts as a real interaction for adoption purposes.
 */
export const BOT_UA_CATEGORIES = new Set<string>([
  "search-bot",
  "seo-bot",
  "empty",
]);

export function isRealUserUaCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return !BOT_UA_CATEGORIES.has(category);
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

export type FunnelStep =
  | "visit"
  | "mcp_connect"
  | "report_generated"
  | "lead_submitted"
  | "checkout_started"
  | "checkout_completed";

export const FUNNEL_STEPS: FunnelStep[] = [
  "visit",
  "mcp_connect",
  "report_generated",
  "lead_submitted",
  "checkout_started",
  "checkout_completed",
];

// ─── Key helpers + TTLs ─────────────────────────────────────────────────────

const TTL_DAILY_PID = 60 * 60 * 24 * 45; // 45d — powers DAU/WAU/MAU windows
const TTL_SEEN = 60 * 60 * 24 * 200; // 200d — first/last-seen for retention
const TTL_FUNNEL = 60 * 60 * 24 * 90; // 90d
const TTL_NPM = 60 * 60 * 24 * 400; // 400d — long trend line

export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(i: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - i);
  return utcDay(d);
}

async function bump(kv: KVNamespace, key: string, ttl: number): Promise<void> {
  const cur = Number.parseInt((await kv.get(key)) || "0", 10);
  await kv.put(key, String(cur + 1), { expirationTtl: ttl });
}

// ─── Recording (write path) ─────────────────────────────────────────────────

/**
 * Record one real-user interaction for retention. `pid` is a stable
 * pseudonymous id (see events.stablePseudoId) — coarse, not a person id.
 * Sets daily-unique, first-seen (once), and last-seen.
 */
export async function recordRealUser(
  env: BillingEnv,
  pid: string,
  uaCategory: string,
  day: string = utcDay()
): Promise<void> {
  try {
    if (!env.LEDGER || !pid) return;
    await env.LEDGER.put(`an:real:${day}:pid:${pid}`, "1", { expirationTtl: TTL_DAILY_PID });
    await bump(env.LEDGER, `an:real:${day}:total`, TTL_DAILY_PID);
    await bump(env.LEDGER, `an:real:${day}:ua:${uaCategory}`, TTL_DAILY_PID);
    // first-seen is written once; last-seen on every interaction.
    const firstKey = `an:first:${pid}`;
    if (!(await env.LEDGER.get(firstKey))) {
      await env.LEDGER.put(firstKey, day, { expirationTtl: TTL_SEEN });
    }
    await env.LEDGER.put(`an:last:${pid}`, day, { expirationTtl: TTL_SEEN });
  } catch {
    /* best effort */
  }
}

/** Increment a funnel step counter for the given UTC day. */
export async function recordFunnelStep(
  env: BillingEnv,
  step: FunnelStep,
  day: string = utcDay()
): Promise<void> {
  try {
    if (!env.LEDGER) return;
    await bump(env.LEDGER, `an:funnel:${day}:${step}`, TTL_FUNNEL);
  } catch {
    /* best effort */
  }
}

// ─── Retention (read path) ──────────────────────────────────────────────────

export interface RetentionStats {
  generated_at: string;
  dau: number; // distinct real pids seen today (UTC)
  wau: number; // distinct real pids over the last 7 days
  mau: number; // distinct real pids over the last 30 days
  stickiness: number; // DAU / MAU, 0..1 (rounded)
  new_today: number;
  returning_today: number;
  returning_rate: number; // returning / (new + returning), 0..1
  real_user_ua_today: Record<string, number>;
}

async function distinctPidsOverDays(env: BillingEnv, dayCount: number): Promise<Set<string>> {
  const pids = new Set<string>();
  for (let i = 0; i < dayCount; i++) {
    const day = daysAgo(i);
    const list = await env.LEDGER.list({ prefix: `an:real:${day}:pid:`, limit: 1000 });
    for (const k of list.keys) pids.add(k.name.slice(`an:real:${day}:pid:`.length));
  }
  return pids;
}

export async function readRetention(env: BillingEnv): Promise<RetentionStats> {
  const out: RetentionStats = {
    generated_at: new Date().toISOString(),
    dau: 0,
    wau: 0,
    mau: 0,
    stickiness: 0,
    new_today: 0,
    returning_today: 0,
    returning_rate: 0,
    real_user_ua_today: {},
  };
  try {
    const today = utcDay();
    const todayPids = await distinctPidsOverDays(env, 1);
    out.dau = todayPids.size;
    out.wau = (await distinctPidsOverDays(env, 7)).size;
    out.mau = (await distinctPidsOverDays(env, 30)).size;
    out.stickiness = out.mau > 0 ? +(out.dau / out.mau).toFixed(3) : 0;

    // New vs returning: a pid is "new" if its first-seen day is today.
    for (const pid of todayPids) {
      const first = await env.LEDGER.get(`an:first:${pid}`);
      if (first === today) out.new_today++;
      else out.returning_today++;
    }
    const denom = out.new_today + out.returning_today;
    out.returning_rate = denom > 0 ? +(out.returning_today / denom).toFixed(3) : 0;

    // Real-user UA breakdown for today.
    const uaList = await env.LEDGER.list({ prefix: `an:real:${today}:ua:`, limit: 100 });
    for (const k of uaList.keys) {
      const cat = k.name.slice(`an:real:${today}:ua:`.length);
      out.real_user_ua_today[cat] = Number.parseInt((await env.LEDGER.get(k.name)) || "0", 10);
    }
  } catch {
    /* best effort — return whatever was gathered */
  }
  return out;
}

// ─── Funnel (read path) ─────────────────────────────────────────────────────

export interface FunnelStats {
  window_days: number;
  steps: Record<FunnelStep, number>;
  conversion: Record<string, number>; // step→step conversion rates, 0..1
}

export async function readFunnel(env: BillingEnv, windowDays = 7): Promise<FunnelStats> {
  const steps = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])) as Record<FunnelStep, number>;
  try {
    for (let i = 0; i < windowDays; i++) {
      const day = daysAgo(i);
      for (const step of FUNNEL_STEPS) {
        const v = Number.parseInt((await env.LEDGER.get(`an:funnel:${day}:${step}`)) || "0", 10);
        steps[step] += v;
      }
    }
  } catch {
    /* best effort */
  }
  const conversion: Record<string, number> = {};
  for (let i = 1; i < FUNNEL_STEPS.length; i++) {
    const prev = FUNNEL_STEPS[i - 1]!;
    const cur = FUNNEL_STEPS[i]!;
    conversion[`${prev}_to_${cur}`] = steps[prev] > 0 ? +(steps[cur] / steps[prev]).toFixed(3) : 0;
  }
  return { window_days: windowDays, steps, conversion };
}

// ─── npm downloads ──────────────────────────────────────────────────────────

export interface NpmEnv {
  LEDGER: KVNamespace;
  NPM_PACKAGE?: string; // defaults to "causallayer-mcp"
}

export interface NpmSnapshot {
  date: string; // npm's reported day (YYYY-MM-DD)
  package: string;
  downloads: number | null; // null when the registry has no data (e.g. scoped pkg unsupported)
  ok: boolean;
  fetched_at: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Snapshot yesterday's npm download count for the configured package and store
 * it under `an:npm:{date}`. Idempotent per day. Intended to be called from the
 * Worker cron. `fetchImpl` is injectable for tests.
 */
export async function snapshotNpmDownloads(
  env: NpmEnv,
  fetchImpl: FetchLike = fetch
): Promise<NpmSnapshot> {
  const pkg = env.NPM_PACKAGE || "causallayer-mcp";
  const snap: NpmSnapshot = {
    date: utcDay(),
    package: pkg,
    downloads: null,
    ok: false,
    fetched_at: new Date().toISOString(),
  };
  try {
    const url = `https://api.npmjs.org/downloads/point/last-day/${pkg}`;
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as { downloads?: number; day?: string };
      if (typeof body.downloads === "number") {
        snap.downloads = body.downloads;
        snap.ok = true;
      }
      if (typeof body.day === "string") snap.date = body.day;
    }
  } catch {
    /* leave snap.ok = false */
  }
  try {
    if (env.LEDGER) {
      await env.LEDGER.put(`an:npm:${snap.date}`, JSON.stringify(snap), { expirationTtl: TTL_NPM });
      await env.LEDGER.put("an:npm:last", JSON.stringify(snap), { expirationTtl: TTL_NPM });
    }
  } catch {
    /* best effort */
  }
  return snap;
}

export interface NpmTrend {
  package: string;
  latest: NpmSnapshot | null;
  total_window: number; // sum of downloads across the window (known days only)
  by_day: Array<{ date: string; downloads: number | null }>;
}

export async function readNpmTrend(env: NpmEnv, windowDays = 30): Promise<NpmTrend> {
  const pkg = env.NPM_PACKAGE || "causallayer-mcp";
  const out: NpmTrend = { package: pkg, latest: null, total_window: 0, by_day: [] };
  try {
    const lastRaw = await env.LEDGER.get("an:npm:last");
    if (lastRaw) out.latest = JSON.parse(lastRaw) as NpmSnapshot;
    for (let i = 1; i <= windowDays; i++) {
      const day = daysAgo(i);
      const raw = await env.LEDGER.get(`an:npm:${day}`);
      if (!raw) continue;
      const s = JSON.parse(raw) as NpmSnapshot;
      out.by_day.push({ date: s.date, downloads: s.downloads });
      if (typeof s.downloads === "number") out.total_window += s.downloads;
    }
  } catch {
    /* best effort */
  }
  out.by_day.reverse(); // oldest → newest
  return out;
}
