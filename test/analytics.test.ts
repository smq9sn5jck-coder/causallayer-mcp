import { describe, it, expect } from "vitest";
import {
  isRealUserUaCategory,
  recordRealUser,
  recordFunnelStep,
  readRetention,
  readFunnel,
  snapshotNpmDownloads,
  readNpmTrend,
  utcDay,
} from "../src/analytics.js";

// ── Minimal in-memory KV mock (the subset analytics.ts uses) ────────────────
function makeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async list({ prefix, limit = 1000 }: { prefix: string; limit?: number }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    },
  };
}
function envWith() {
  const kv = makeKV();
  return { env: { LEDGER: kv } as unknown as Parameters<typeof recordRealUser>[0], kv };
}
function dayOffset(i: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - i);
  return utcDay(d);
}

describe("analytics — bot classification", () => {
  it("treats crawlers/empty as non-real and MCP/browser clients as real", () => {
    expect(isRealUserUaCategory("search-bot")).toBe(false);
    expect(isRealUserUaCategory("seo-bot")).toBe(false);
    expect(isRealUserUaCategory("empty")).toBe(false);
    expect(isRealUserUaCategory(null)).toBe(false);
    for (const c of ["claude-desktop", "claude-code", "cursor", "cline", "browser-chrome", "node"]) {
      expect(isRealUserUaCategory(c)).toBe(true);
    }
  });
});

describe("analytics — retention", () => {
  it("counts DAU/WAU/MAU distinctly and splits new vs returning", async () => {
    const { env } = envWith();
    const today = utcDay();
    // pid_a: seen yesterday and today → returning. pid_b: only today → new.
    await recordRealUser(env, "pid_a", "cursor", dayOffset(1));
    await recordRealUser(env, "pid_a", "cursor", today);
    await recordRealUser(env, "pid_b", "claude-code", today);

    const r = await readRetention(env);
    expect(r.dau).toBe(2); // both today
    expect(r.wau).toBe(2); // pid_a + pid_b within 7d
    expect(r.mau).toBe(2);
    expect(r.new_today).toBe(1); // pid_b first-seen today
    expect(r.returning_today).toBe(1); // pid_a first-seen earlier
    expect(r.returning_rate).toBeCloseTo(0.5, 3);
    expect(r.real_user_ua_today.cursor).toBe(1);
    expect(r.real_user_ua_today["claude-code"]).toBe(1);
    expect(r.stickiness).toBeCloseTo(1.0, 3); // dau == mau here
  });

  it("does not double-count a pid seen on multiple days into WAU", async () => {
    const { env } = envWith();
    await recordRealUser(env, "pid_x", "cline", dayOffset(2));
    await recordRealUser(env, "pid_x", "cline", dayOffset(1));
    await recordRealUser(env, "pid_x", "cline", utcDay());
    const r = await readRetention(env);
    expect(r.wau).toBe(1);
    expect(r.dau).toBe(1);
  });
});

describe("analytics — funnel", () => {
  it("aggregates steps over the window and computes conversion rates", async () => {
    const { env } = envWith();
    for (let i = 0; i < 10; i++) await recordFunnelStep(env, "visit");
    for (let i = 0; i < 4; i++) await recordFunnelStep(env, "mcp_connect");
    for (let i = 0; i < 2; i++) await recordFunnelStep(env, "report_generated");
    await recordFunnelStep(env, "lead_submitted");

    const f = await readFunnel(env, 7);
    expect(f.steps.visit).toBe(10);
    expect(f.steps.mcp_connect).toBe(4);
    expect(f.steps.report_generated).toBe(2);
    expect(f.steps.lead_submitted).toBe(1);
    expect(f.conversion.visit_to_mcp_connect).toBeCloseTo(0.4, 3);
    expect(f.conversion.mcp_connect_to_report_generated).toBeCloseTo(0.5, 3);
  });
});

describe("analytics — npm downloads", () => {
  it("stores a snapshot from the registry and reads it back as a trend", async () => {
    const { env } = envWith();
    const fakeFetch = async (url: string) => {
      expect(url).toContain("api.npmjs.org/downloads/point/last-day/causallayer-mcp");
      return new Response(JSON.stringify({ downloads: 137, day: dayOffset(1), package: "causallayer-mcp" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const snap = await snapshotNpmDownloads(env as never, fakeFetch);
    expect(snap.ok).toBe(true);
    expect(snap.downloads).toBe(137);

    const trend = await readNpmTrend(env as never, 30);
    expect(trend.latest?.downloads).toBe(137);
    expect(trend.total_window).toBe(137);
    expect(trend.by_day.length).toBe(1);
  });

  it("abstains gracefully when the registry returns no data (e.g. scoped pkg)", async () => {
    const { env } = envWith();
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: "package downloads not found" }), { status: 404 });
    const snap = await snapshotNpmDownloads(env as never, fakeFetch);
    expect(snap.ok).toBe(false);
    expect(snap.downloads).toBeNull();
  });
});
