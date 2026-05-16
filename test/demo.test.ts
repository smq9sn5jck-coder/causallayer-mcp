/**
 * Smoke tests for demo.ts: rate-limit + telemetry pure functions.
 *
 * These do NOT spin up a Worker; they verify behaviour against an in-memory
 * KV mock that supports the subset of the KVNamespace API we use
 * (`get`, `put` with `expirationTtl`, `list({prefix})`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  type RequestMeta,
  buildRequestMeta,
  commitDemoUsage,
  enforceDemoLimit,
  recordTelemetry,
  handleStats,
} from "../src/demo.js";
import type { BillingEnv } from "../src/billing.js";

class MemKV {
  store = new Map<string, { v: string; expires?: number }>();
  async get(key: string): Promise<string | null> {
    const r = this.store.get(key);
    if (!r) return null;
    if (r.expires && r.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return r.v;
  }
  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number }
  ): Promise<void> {
    const expires = opts?.expirationTtl
      ? Date.now() + opts.expirationTtl * 1000
      : undefined;
    this.store.set(key, { v: value, expires });
  }
  async list(opts: { prefix: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
  }> {
    return {
      keys: [...this.store.keys()]
        .filter((k) => k.startsWith(opts.prefix))
        .slice(0, opts.limit ?? 1000)
        .map((name) => ({ name })),
    };
  }
}

function makeEnv(mode: BillingEnv["BILLING_MODE"] = "demo"): BillingEnv {
  return {
    LEDGER: new MemKV() as unknown as KVNamespace,
    PRICE_SUBMIT_INCIDENT: "50",
    PRICE_VERIFY_CERTIFICATE: "1",
    PRICE_GET_ANCHOR_STATUS: "0",
    PRICE_QUERY_ISSUER_REGISTRY: "0",
    BILLING_MODE: mode,
    CAUSALLAYER_ENV: "sandbox",
  };
}

const meta: RequestMeta = { ip_bucket: "abcdef0123456789", ua: "claude", cc: "AU" };

describe("buildRequestMeta", () => {
  it("extracts ip bucket, ua bucket, cc from a Request", async () => {
    const req = new Request("https://x", {
      headers: {
        "cf-connecting-ip": "203.0.113.42",
        "cf-ipcountry": "AU",
        "user-agent": "Claude/1.0",
      },
    });
    const m = await buildRequestMeta(req);
    expect(m.cc).toBe("AU");
    expect(m.ua).toBe("claude");
    expect(m.ip_bucket).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("enforceDemoLimit", () => {
  let env: BillingEnv;
  beforeEach(() => {
    env = makeEnv("demo");
  });

  it("allows in non-demo mode unconditionally", async () => {
    const free = makeEnv("free");
    const d = await enforceDemoLimit(free, meta, "submit_incident");
    expect(d.allow).toBe(true);
  });

  it("allows the first call and denies the burst replay", async () => {
    const d1 = await enforceDemoLimit(env, meta, "submit_incident");
    expect(d1.allow).toBe(true);
    await commitDemoUsage(env, meta, "submit_incident");
    const d2 = await enforceDemoLimit(env, meta, "submit_incident");
    expect(d2.allow).toBe(false);
    expect(d2.reason).toBe("burst");
  });

  it("denies after the per-IP daily cap on submit_incident", async () => {
    // Hit the cap manually
    const day = new Date().toISOString().slice(0, 10);
    const k = `demo:ip:${day}:${meta.ip_bucket}:submit_incident`;
    await env.LEDGER.put(k, "5");
    const d = await enforceDemoLimit(env, meta, "submit_incident");
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("daily_per_ip");
  });

  it("denies after global daily cap", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.LEDGER.put(`demo:global:${day}:submit_incident`, "1000");
    // pick a different IP so per-IP doesn't trigger first
    const m2 = { ...meta, ip_bucket: "1111111111111111" };
    const d = await enforceDemoLimit(env, m2, "submit_incident");
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("daily_global");
  });
});

describe("recordTelemetry + handleStats", () => {
  it("records a call and surfaces it in /stats", async () => {
    const env = makeEnv("demo");
    await recordTelemetry(env, meta, { tool: "submit_incident", outcome: "ok" });
    await recordTelemetry(env, meta, { tool: "submit_incident", outcome: "ok" });
    await recordTelemetry(env, { ...meta, ip_bucket: "ffffffffffffffff" }, {
      tool: "verify_certificate",
      outcome: "ok",
    });

    const r = await handleStats(env);
    const body = (await r.json()) as { days: Record<string, Record<string, number>> };
    const today = new Date().toISOString().slice(0, 10);
    const d = body.days[today];
    expect(d.tool_submit_incident).toBe(2);
    expect(d.tool_verify_certificate).toBe(1);
    expect(d.outcome_ok).toBe(3);
    expect(d.unique_ips).toBe(2);
    expect(d.ua_claude).toBe(3);
  });
});
