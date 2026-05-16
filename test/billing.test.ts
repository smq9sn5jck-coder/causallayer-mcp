/**
 * Smoke tests for billing.ts pure functions.
 *
 * These do NOT spin up a Worker; they verify the credit ledger and Stripe
 * signature logic against an in-memory KV mock. Full end-to-end tests should
 * be done with `wrangler dev` against a real KV namespace.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  type BillingEnv,
  chargeCredits,
  creditsForPriceId,
  getCredits,
  hashApiKey,
  priceFor,
  refundCredits,
  topUpCredits,
  verifyStripeSignature,
} from "../src/billing.js";

// ── In-memory KV mock ──────────────────────────────────────────────────────

class MemKV {
  store = new Map<string, string>();
  async get(key: string, type?: "json"): Promise<unknown> {
    const v = this.store.get(key);
    if (v == null) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeEnv(overrides: Partial<BillingEnv> = {}): BillingEnv {
  return {
    LEDGER: new MemKV() as unknown as KVNamespace,
    PRICE_SUBMIT_INCIDENT: "50",
    PRICE_VERIFY_CERTIFICATE: "1",
    PRICE_GET_ANCHOR_STATUS: "0",
    PRICE_QUERY_ISSUER_REGISTRY: "0",
    BILLING_MODE: "stripe",
    CAUSALLAYER_ENV: "dev",
    STRIPE_PRICE_STARTER: "price_starter_test",
    STRIPE_PRICE_GROWTH: "price_growth_test",
    STRIPE_PRICE_ENTERPRISE: "price_enterprise_test",
    ...overrides,
  };
}

describe("priceFor", () => {
  const env = makeEnv();
  it("returns the configured credit cost for each tool", () => {
    expect(priceFor(env, "submit_incident")).toBe(50);
    expect(priceFor(env, "verify_certificate")).toBe(1);
    expect(priceFor(env, "get_anchor_status")).toBe(0);
    expect(priceFor(env, "query_issuer_registry")).toBe(0);
  });
  it("returns 0 if env is malformed", () => {
    const bad = makeEnv({ PRICE_SUBMIT_INCIDENT: "not-a-number" });
    expect(priceFor(bad, "submit_incident")).toBe(0);
  });
});

describe("creditsForPriceId", () => {
  const env = makeEnv();
  it("maps configured price ids to pack sizes", () => {
    expect(creditsForPriceId(env, "price_starter_test")).toBe(1000);
    expect(creditsForPriceId(env, "price_growth_test")).toBe(10_000);
    expect(creditsForPriceId(env, "price_enterprise_test")).toBe(100_000);
    expect(creditsForPriceId(env, "price_unknown")).toBe(0);
  });
});

describe("hashApiKey", () => {
  it("produces a stable 64-char hex digest", async () => {
    const a = await hashApiKey("clk_aaaaaaaa");
    const b = await hashApiKey("clk_aaaaaaaa");
    const c = await hashApiKey("clk_bbbbbbbb");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("credit ledger", () => {
  let env: BillingEnv;
  beforeEach(() => {
    env = makeEnv();
  });

  it("starts at zero balance for a new tenant", async () => {
    const c = await getCredits(env, "t_new");
    expect(c.balance).toBe(0);
    expect(c.lifetime_purchased).toBe(0);
    expect(c.lifetime_consumed).toBe(0);
  });

  it("topUpCredits → chargeCredits → refundCredits round-trips", async () => {
    await topUpCredits(env, "t_x", 100, "cs_test_1", "evt_test_1");
    let c = await getCredits(env, "t_x");
    expect(c.balance).toBe(100);
    expect(c.lifetime_purchased).toBe(100);

    const charged = await chargeCredits(env, "t_x", 30, {
      tool: "verify_certificate",
      request_id: "req_1",
    });
    expect(charged.ok).toBe(true);
    if (charged.ok) {
      expect(charged.balance).toBe(70);
    }
    c = await getCredits(env, "t_x");
    expect(c.balance).toBe(70);
    expect(c.lifetime_consumed).toBe(30);

    await refundCredits(env, "t_x", 30, {
      tool: "verify_certificate",
      request_id: "req_1",
      reason: "upstream_failure",
    });
    c = await getCredits(env, "t_x");
    expect(c.balance).toBe(100);
    expect(c.lifetime_consumed).toBe(0);
  });

  it("denies on insufficient balance", async () => {
    await topUpCredits(env, "t_y", 5, "cs_test_2", "evt_test_2");
    const r = await chargeCredits(env, "t_y", 50, {
      tool: "submit_incident",
      request_id: "req_2",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("INSUFFICIENT_CREDITS");
      expect(r.balance).toBe(5);
    }
  });

  it("zero-cost charges always succeed without touching balance", async () => {
    await topUpCredits(env, "t_z", 10, "cs_test_3", "evt_test_3");
    const r = await chargeCredits(env, "t_z", 0, {
      tool: "get_anchor_status",
      request_id: "req_3",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tx_id).toBe("free");
    const c = await getCredits(env, "t_z");
    expect(c.balance).toBe(10);
  });

  it("topUpCredits is idempotent on stripe_event_id", async () => {
    await topUpCredits(env, "t_dup", 100, "cs_dup", "evt_dup");
    await topUpCredits(env, "t_dup", 100, "cs_dup", "evt_dup"); // replay
    const c = await getCredits(env, "t_dup");
    expect(c.balance).toBe(100); // not 200
  });
});

describe("verifyStripeSignature", () => {
  it("rejects missing signature header", async () => {
    const ok = await verifyStripeSignature("body", null, "whsec_test");
    expect(ok).toBe(false);
  });

  it("rejects malformed header", async () => {
    const ok = await verifyStripeSignature("body", "garbage", "whsec_test");
    expect(ok).toBe(false);
  });

  it("accepts a valid HMAC-SHA256 signature", async () => {
    const secret = "whsec_test_abc";
    const body = '{"id":"evt_test"}';
    const t = Math.floor(Date.now() / 1000).toString();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
    const bytes = new Uint8Array(sig);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    const header = `t=${t},v1=${hex}`;
    const ok = await verifyStripeSignature(body, header, secret);
    expect(ok).toBe(true);
  });

  it("rejects an outdated timestamp", async () => {
    const secret = "whsec_test_abc";
    const body = "x";
    // timestamp 10 minutes ago
    const t = (Math.floor(Date.now() / 1000) - 600).toString();
    const header = `t=${t},v1=00`;
    const ok = await verifyStripeSignature(body, header, secret);
    expect(ok).toBe(false);
  });
});
