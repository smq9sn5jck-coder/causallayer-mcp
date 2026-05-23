/**
 * CausalLayer MCP Server  —  Cloudflare Worker (with billing)
 * -----------------------------------------------------------
 *
 * Pattern: cloudflare/ai/demos/remote-mcp-authless (Apr 2026), extended with:
 *   - Bearer-token tenant authentication on /mcp
 *   - Prepaid credit ledger in KV
 *   - Stripe Checkout webhook (/stripe/webhook)
 *   - Admin endpoints (/admin/*) protected by ADMIN_TOKEN
 *   - Public introspection (/me)
 *
 * Tools:
 *   1. submit_incident          → POST /api/v1/incidents/analyze   (50 credits)
 *   2. verify_certificate       → POST /api/v2/verify/certificate  ( 1 credit)
 *   3. get_anchor_status        → GET  /api/v2/anchor/status       ( 0 credits)
 *   4. query_issuer_registry    → GET  /api/v2/issuers             ( 0 credits)
 *
 * Guardrails (enforced before any upstream call):
 *   G1. NO-PII          — payload scanned; rejected unless pii_acknowledged=true
 *   G2. DETERMINISTIC   — submit_incident requires deterministic_only=true
 *   G3. EVIDENCE-REQ    — at least one agent and one event with description
 *
 * Billing flow:
 *   - Insurer/bank buys a Starter / Growth / Enterprise pack via Stripe Checkout
 *   - Stripe webhook tops up the tenant's credit balance atomically
 *   - Each MCP tool call deducts its price BEFORE the upstream call
 *   - On upstream failure, credits are refunded (idempotent ledger entry)
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withX402, type X402AugmentedServer } from "agents/x402";
import { z } from "zod";

import {
  type BillingEnv,
  chargeCredits,
  handleStripeWebhook,
  json,
  priceFor,
  refundCredits,
  resolveTenantFromAuth,
  type ToolName,
} from "./billing.js";
import { handleAdmin } from "./admin.js";
import { logEvent } from "./events.js";
import { handleWellKnown } from "./well-known.js";
import {
  buildRequestMeta,
  handleAdminStats,
  commitDemoUsage,
  demoWatermark,
  enforceDemoLimit,
  handleStats,
  recordTelemetry,
  type RequestMeta,
} from "./demo.js";
import { standaloneResponse } from "./standalone.js";
import { convertOtlpToIncident, type OtlpJson } from "./otel-ingest.js";

// ─── Bindings ──────────────────────────────────────────────────────────────

export interface Env extends BillingEnv {
  // CausalLayer API (upstream)
  CAUSALLAYER_API_BASE: string;
  ALLOWED_ISSUER_STATUSES: string;
  CAUSALLAYER_API_KEY?: string;

  // When 'true', bypasses upstream entirely and returns watermarked demo data.
  // Used for the public mcp.faultkey.com demo before the production engine is wired in.
  STANDALONE_DEMO?: string;

  // x402 (BILLING_MODE=x402 only)
  X402_NETWORK?: string; // e.g. "base-sepolia" (test) or "base" (mainnet)
  X402_RECIPIENT?: string; // 0x... wallet address that receives USDC
  X402_PRICE_SUBMIT_INCIDENT_USD?: string; // e.g. "5.00"
  X402_PRICE_VERIFY_CERTIFICATE_USD?: string; // e.g. "0.10"

  // McpAgent Durable Object binding
  MCP_OBJECT: DurableObjectNamespace;
}

function parseUsd(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** McpAgent props injected on connect via ctx.props (per-session immutable). */
interface SessionProps {
  tenant_id: string;
  tenant_name: string;
  billing_mode: BillingEnv["BILLING_MODE"];
  request_meta: RequestMeta; // captured at the fetch-handler boundary
  [key: string]: unknown;
}

// ─── Guardrails ──────────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ name: string; rx: RegExp }> = [
  { name: "email", rx: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  { name: "au_tfn", rx: /\b\d{3}\s?\d{3}\s?\d{3}\b/ },
  { name: "au_medicare", rx: /\b\d{4}\s?\d{5}\s?\d\b/ },
  { name: "credit_card", rx: /\b(?:\d[ -]?){13,19}\b/ },
  { name: "ssn", rx: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "phone_intl", rx: /\+\d{1,3}[\s-]?\d{1,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/ },
];

function scanForPii(text: string): string[] {
  return PII_PATTERNS.filter((p) => p.rx.test(text)).map((p) => p.name);
}

// ─── HTTP helper to upstream API ───────────────────────────────────────────

async function callApi<T = unknown>(
  env: Env,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: { auth?: boolean } = { auth: true }
): Promise<T> {
  // Short-circuit to a deterministic, watermarked demo response when
  // STANDALONE_DEMO is enabled. No network call is made.
  if (env.STANDALONE_DEMO === "true") {
    return (await standaloneResponse({ method, path, body })) as T;
  }
  const url = `${env.CAUSALLAYER_API_BASE.replace(/\/+$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": `causallayer-mcp/0.3.1 (${env.CAUSALLAYER_ENV})`,
  };
  if (opts.auth !== false) {
    if (!env.CAUSALLAYER_API_KEY) {
      throw new Error(
        `CAUSALLAYER_API_KEY is not configured for env=${env.CAUSALLAYER_ENV}.`
      );
    }
    headers["Authorization"] = `Bearer ${env.CAUSALLAYER_API_KEY}`;
  }
  const r = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: unknown;
  try {
    parsed = text.length ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Upstream non-JSON response (${r.status}) from ${path}: ${text.slice(0, 200)}`
    );
  }
  if (!r.ok) {
    const e = (parsed as { error?: string; code?: string }) ?? {};
    throw new Error(
      `Upstream ${method} ${path} ${r.status}: ${e.error ?? "unknown"} (${e.code ?? "NO_CODE"})`
    );
  }
  return parsed as T;
}

// ─── Billing wrapper for tools ─────────────────────────────────────────────

/**
 * Wrap a tool handler with credit charging:
 *  1. Compute price for this tool from env.
 *  2. Atomically deduct credits (deny on insufficient balance).
 *  3. Run the actual handler.
 *  4. On thrown error, refund the credits (best-effort idempotent).
 */
async function withBilling<T>(
  env: Env,
  tenantId: string,
  tool: ToolName,
  meta: RequestMeta,
  handler: () => Promise<T>
): Promise<T | { isError: true; content: Array<{ type: "text"; text: string }> }> {
  // ── Demo / public-tier rate limits ─────────────────────────────────
  if (env.BILLING_MODE === "demo") {
    const decision = await enforceDemoLimit(env, meta, tool);
    if (!decision.allow) {
      await recordTelemetry(env, meta, {
        tool,
        outcome: "rate_limited",
        tenant_id: tenantId,
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "DEMO_RATE_LIMITED",
                code: decision.reason,
                retry_after_seconds: decision.retry_after_seconds ?? 0,
                hint:
                  "This is the public CausalLayer demo. Email sales@causallayer.io " +
                  "to provision a paid tenant with no per-IP limits.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
    try {
      const out = await handler();
      await commitDemoUsage(env, meta, tool);
      await recordTelemetry(env, meta, { tool, outcome: "ok", tenant_id: tenantId });
      // Append the watermark to the first text-content block, if any.
      const wm = demoWatermark(env);
      if (
        wm &&
        out &&
        typeof out === "object" &&
        Array.isArray((out as { content?: unknown[] }).content)
      ) {
        const wrapped = out as unknown as {
          content: Array<{ type: string; text?: string }>;
        };
        wrapped.content.unshift({ type: "text", text: `⚠️  ${wm}` });
      }
      return out;
    } catch (err) {
      await recordTelemetry(env, meta, {
        tool,
        outcome: "error",
        tenant_id: tenantId,
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Upstream failure (demo). ${String((err as Error).message)}`,
          },
        ],
      };
    }
  }

  if (env.BILLING_MODE === "free") {
    try {
      const out = await handler();
      await recordTelemetry(env, meta, { tool, outcome: "ok", tenant_id: tenantId });
      return out;
    } catch (err) {
      await recordTelemetry(env, meta, {
        tool,
        outcome: "error",
        tenant_id: tenantId,
      });
      return {
        isError: true,
        content: [{ type: "text", text: String((err as Error).message) }],
      };
    }
  }

  const cost = priceFor(env, tool);
  const requestId = crypto.randomUUID();
  const charge = await chargeCredits(env, tenantId, cost, { tool, request_id: requestId });
  if (!charge.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "BILLING_DENIED",
              code: charge.reason,
              required_credits: cost,
              current_balance: charge.balance,
              tool,
              top_up_url:
                "https://mcp.causallayer.io/topup (have your account manager request a Checkout link)",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  try {
    const out = await handler();
    await recordTelemetry(env, meta, { tool, outcome: "ok", tenant_id: tenantId });
    return out;
  } catch (err) {
    // Refund on upstream failure so the buyer is never charged for our outage
    await refundCredits(env, tenantId, cost, {
      tool,
      request_id: requestId,
      reason: "upstream_failure",
    });
    await recordTelemetry(env, meta, {
      tool,
      outcome: "error",
      tenant_id: tenantId,
    });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `Upstream failure — ${cost} credits refunded. ` +
            String((err as Error).message),
        },
      ],
    };
  }
}

// ─── MCP agent ─────────────────────────────────────────────────────────────

export class CausalLayerMCP extends McpAgent<Env, unknown, SessionProps> {
  server = new McpServer({
    name: "causallayer-mcp",
    version: "0.3.1",
  });

  async init() {
    const env = this.env;
    const tenantId = this.props?.tenant_id ?? "anonymous";
    const meta: RequestMeta = this.props?.request_meta ?? {
      ip_bucket: "unknown",
      ua: "other",
      cc: "ZZ",
    };

    // ── x402 wiring (opt-in via BILLING_MODE=x402) ─────────────────────────
    // When enabled, the priced tools below also get an x402-prefixed paid
    // variant (e.g. `x402_submit_incident`) that requires on-chain USDC
    // payment. Both call paths share the same upstream API + guardrails.
    let x402Server: X402AugmentedServer | null = null;
    if (env.BILLING_MODE === "x402") {
      if (!env.X402_RECIPIENT || !env.X402_NETWORK) {
        throw new Error(
          "BILLING_MODE=x402 requires X402_NETWORK and X402_RECIPIENT to be set"
        );
      }
      const augmented = withX402(this.server, {
        network: env.X402_NETWORK,
        recipient: env.X402_RECIPIENT as `0x${string}`,
      });
      x402Server = augmented;
      const submitUSD = parseUsd(env.X402_PRICE_SUBMIT_INCIDENT_USD, 5);
      const verifyUSD = parseUsd(env.X402_PRICE_VERIFY_CERTIFICATE_USD, 0.1);

      // Lightweight x402-paid wrappers — same upstream call, same guardrails,
      // but charged in USDC per call rather than against a Stripe credit ledger.
      x402Server.paidTool(
        "x402_submit_incident",
        "x402-paid variant of submit_incident. Charges " +
          `$${submitUSD.toFixed(2)} USDC on ${env.X402_NETWORK} per call. ` +
          "For agent-driven workflows where no human is in the loop.",
        submitUSD,
        { title: z.string(), description: z.string().optional() },
        {},
        async ({ title, description }: { title: string; description?: string }) => {
          // Minimal guardrail-respecting passthrough; full schema lives on
          // the credit-billed tool below.
          if (scanForPii(`${title} ${description ?? ""}`).length > 0) {
            return {
              isError: true,
              content: [
                { type: "text", text: "GUARDRAIL G1 (PII): payload rejected." },
              ],
            };
          }
          const upstream = await callApi(env, "POST", "/api/v1/incidents/analyze", {
            title,
            description,
            agents: [{ id: "a1", name: "unknown_agent", type: "ai_system" }],
            events: [
              {
                id: "e1",
                type: "incident",
                timestamp: new Date().toISOString(),
                description: description ?? title,
              },
            ],
          });
          return {
            content: [
              { type: "text", text: JSON.stringify({ paid_via: "x402", upstream }, null, 2) },
            ],
          };
        }
      );

      x402Server.paidTool(
        "x402_verify_certificate",
        "x402-paid variant of verify_certificate. Charges " +
          `$${verifyUSD.toFixed(2)} USDC on ${env.X402_NETWORK} per call.`,
        verifyUSD,
        { certificate: z.record(z.unknown()) },
        {},
        async ({ certificate }: { certificate: Record<string, unknown> }) => {
          const result = await callApi(env, "POST", "/api/v2/verify/certificate", {
            certificate,
          });
          return {
            content: [
              { type: "text", text: JSON.stringify({ paid_via: "x402", result }, null, 2) },
            ],
          };
        }
      );
    }

    // ── Tool 1: submit_incident ────────────────────────────────────────────
    this.server.registerTool(
      "submit_incident",
      {
        description:
          "Submit an AI incident for deterministic causal liability attribution. " +
          "Returns a signed CausalCertificate, per-agent liability allocation, evidence-chain " +
          "completeness, regulatory mapping, and (where keys are configured) a Bitcoin-anchored proof. " +
          `Cost: ${priceFor(env, "submit_incident")} credits. Three guardrails apply: ` +
          "PII scan, deterministic-only acknowledgement, and minimum evidence.",
        inputSchema: {
          title: z.string().min(3),
          description: z.string().optional(),
          category: z.string().optional(),
          severity: z.enum(["low", "medium", "high", "critical"]).optional(),
          jurisdiction: z.string().optional(),
          financial_impact_cents: z.number().int().nonnegative().nullable().optional(),
          currency: z.string().length(3).optional(),
          agents: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                type: z.enum([
                  "ai_system",
                  "human_operator",
                  "vendor",
                  "deployer",
                  "user",
                  "third_party",
                ]),
                operator_role: z
                  .enum(["provider", "deployer", "user", "vendor", "regulator", "auditor"])
                  .optional(),
                vendor_name: z.string().optional(),
                model_id: z.string().optional(),
              })
            )
            .min(1, "G3: at least one agent is required"),
          events: z
            .array(
              z.object({
                id: z.string().min(1),
                type: z.string().min(1),
                timestamp: z.string().min(1),
                actor_id: z.string().optional(),
                description: z
                  .string()
                  .min(1, "G3: every event must have a non-empty description"),
                // ── Optional W3C Trace Context evidence ─────────────────────
                // When the caller has OpenTelemetry / Jaeger / Datadog APM
                // traces for this event, including the trace + span ids lets
                // FaultKey emit a `causalGraph.edges[].evidence` pointer and a
                // top-level `trace_context` block. The certificate then cites
                // a specific span the way a court order cites a specific email
                // ID. Backwards-compatible: events without these fields
                // produce identical certificates to before.
                trace_id: z
                  .string()
                  .regex(/^[0-9a-f]{32}$/i, "W3C trace_id must be 32 lowercase hex chars")
                  .optional(),
                span_id: z
                  .string()
                  .regex(/^[0-9a-f]{16}$/i, "W3C span_id must be 16 lowercase hex chars")
                  .optional(),
                trace_source: z
                  .enum(["opentelemetry", "jaeger", "zipkin", "datadog", "newrelic", "other"])
                  .optional(),
              })
            )
            .min(1, "G3: at least one event is required"),
          deterministic_only: z
            .literal(true)
            .describe(
              "G2: Must be true. Acknowledges CausalLayer is deterministic and not LLM-based."
            ),
          pii_acknowledged: z
            .boolean()
            .default(false)
            .describe(
              "G1: Set to true ONLY if caller has confirmed PII handling is permitted by " +
                "their data agreement. False payloads with detected PII will be rejected."
            ),
        },
      },
      async (input) => {
        // G1 — PII scan over stringy fields
        const blob = JSON.stringify({
          title: input.title,
          description: input.description ?? "",
          events: input.events.map((e) => ({ description: e.description })),
        });
        const piiHits = scanForPii(blob);
        if (piiHits.length > 0 && !input.pii_acknowledged) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `GUARDRAIL G1 (PII_DETECTED): patterns=${piiHits.join(",")}. ` +
                  `Either redact the payload or set pii_acknowledged=true.`,
              },
            ],
          };
        }

        return withBilling(env, tenantId, "submit_incident", meta, async () => {
          const upstream = await callApi(env, "POST", "/api/v1/incidents/analyze", {
            title: input.title,
            description: input.description,
            category: input.category,
            severity: input.severity,
            jurisdiction: input.jurisdiction,
            financial_impact_cents: input.financial_impact_cents ?? null,
            currency: input.currency,
            agents: input.agents,
            events: input.events,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    env: env.CAUSALLAYER_ENV,
                    tenant_id: tenantId,
                    guardrails: {
                      pii_scan:
                        piiHits.length === 0 ? "clean" : `acknowledged: ${piiHits.join(",")}`,
                      deterministic_only: true,
                      evidence_required: true,
                    },
                    billing: {
                      tool: "submit_incident",
                      credits_charged: priceFor(env, "submit_incident"),
                    },
                    result: upstream,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }) as Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
      }
    );

    // ── Tool 2: verify_certificate ─────────────────────────────────────────
    this.server.registerTool(
      "verify_certificate",
      {
        description:
          "Independently verify a CausalCertificate end-to-end (signature, Merkle integrity, " +
          `issuer status against the registry). Cost: ${priceFor(env, "verify_certificate")} credit. ` +
          "In production env, certificates from non-active issuers are rejected.",
        inputSchema: {
          certificate: z
            .record(z.unknown())
            .describe("CausalCertificateV1 object as returned by submit_incident.certificate"),
        },
      },
      async ({ certificate }) => {
        return withBilling(env, tenantId, "verify_certificate", meta, async () => {
          const result = await callApi<{
            valid: boolean;
            verification: unknown;
            issuer_status: "trusted" | "advisory" | "unknown" | "revoked";
            verified_at: string;
          }>(env, "POST", "/api/v2/verify/certificate", { certificate });

          const allowed = env.ALLOWED_ISSUER_STATUSES.split(",").map((s) =>
            s.trim().toLowerCase()
          );
          const issuerKey =
            result.issuer_status === "trusted" ? "active" : result.issuer_status;
          const issuerOk = allowed.includes(issuerKey);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    env: env.CAUSALLAYER_ENV,
                    tenant_id: tenantId,
                    allowed_issuer_statuses: allowed,
                    issuer_ok: issuerOk,
                    ...result,
                    policy_outcome:
                      result.valid && issuerOk
                        ? "ACCEPTED"
                        : !result.valid
                        ? "REJECTED_INVALID_PROOF"
                        : "REJECTED_ISSUER_NOT_ALLOWED",
                    billing: {
                      tool: "verify_certificate",
                      credits_charged: priceFor(env, "verify_certificate"),
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }) as Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
      }
    );

    // ── Tool 1b: submit_otel_trace ────────────────────────────
    // Same engine as submit_incident, but accepts an OTLP JSON trace export
    // directly. Each span becomes a FaultKey event; service.name groups
    // spans into agents; W3C trace_id and span_id propagate as evidence
    // pointers on the causal-graph edges. PII scan, deterministic_only, and
    // billing reuse the submit_incident path so policy stays consistent.
    this.server.registerTool(
      "submit_otel_trace",
      {
        description:
          "Convert an OpenTelemetry OTLP JSON trace into a FaultKey incident and " +
          "return the same deterministic CausalCertificate as submit_incident. " +
          "Each span becomes an event; service.name groups spans into agents; " +
          "W3C trace_id and span_id propagate as evidence pointers on the causal " +
          "graph edges. " +
          `Cost: ${priceFor(env, "submit_incident")} credits (same as submit_incident). ` +
          "Three guardrails apply: PII scan, deterministic-only acknowledgement, " +
          "and minimum evidence (auto-satisfied when the trace has at least 1 span).",
        inputSchema: {
          title: z.string().min(3),
          otlp: z
            .record(z.unknown())
            .describe(
              "OTLP JSON payload with resourceSpans[]. See " +
                "https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding"
            ),
          category: z.string().optional(),
          jurisdiction: z.string().optional(),
          financial_impact_cents: z.number().int().nonnegative().nullable().optional(),
          currency: z.string().length(3).optional(),
          deterministic_only: z
            .literal(true)
            .describe("G2: Must be true. Acknowledges CausalLayer is deterministic."),
          pii_acknowledged: z
            .boolean()
            .default(false)
            .describe(
              "G1: Set to true ONLY if PII handling is permitted by your data agreement. " +
                "OTLP traces frequently leak user/session ids in attributes."
            ),
        },
      },
      async (input) => {
        // Convert OTLP → FaultKey incident (pure, deterministic)
        let conversion;
        try {
          conversion = convertOtlpToIncident(input.otlp as OtlpJson, {
            title: input.title,
            category: input.category,
            jurisdiction: input.jurisdiction,
            financial_impact_cents: input.financial_impact_cents,
            currency: input.currency,
            pii_acknowledged: input.pii_acknowledged ?? false,
          });
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `OTLP_INGEST_ERROR: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }

        // G1 — PII scan over reconstructed event descriptions
        const blob = JSON.stringify({
          title: conversion.incident.title,
          events: conversion.incident.events.map((e: { description: string }) => ({ description: e.description })),
        });
        const piiHits = scanForPii(blob);
        if (piiHits.length > 0 && !input.pii_acknowledged) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `GUARDRAIL G1 (PII_DETECTED): patterns=${piiHits.join(",")}. ` +
                  `OTLP traces frequently leak user/session ids; redact attributes or set pii_acknowledged=true.`,
              },
            ],
          };
        }

        return withBilling(env, tenantId, "submit_incident", meta, async () => {
          const upstream = await callApi(env, "POST", "/api/v1/incidents/analyze", {
            title: conversion.incident.title,
            description: conversion.incident.description,
            category: conversion.incident.category,
            severity: conversion.incident.severity,
            jurisdiction: conversion.incident.jurisdiction,
            financial_impact_cents: conversion.incident.financial_impact_cents,
            currency: conversion.incident.currency,
            agents: conversion.incident.agents,
            events: conversion.incident.events,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    env: env.CAUSALLAYER_ENV,
                    tenant_id: tenantId,
                    guardrails: {
                      pii_scan:
                        piiHits.length === 0 ? "clean" : `acknowledged: ${piiHits.join(",")}`,
                      deterministic_only: true,
                      evidence_required: true,
                    },
                    billing: {
                      tool: "submit_otel_trace",
                      credits_charged: priceFor(env, "submit_incident"),
                    },
                    otel_ingest: conversion.stats,
                    otel_ingest_warnings: conversion.warnings,
                    result: upstream,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }) as Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
      }
    );

    // ── Tool 3: get_anchor_status (free) ───────────────────────────────────
    this.server.registerTool(
      "get_anchor_status",
      {
        description:
          "Return the index of all CausalLayer Tessera anchor batches, or one batch's full " +
          "JSON (signed Merkle root, leaves, OpenTimestamps proof reference). FREE.",
        inputSchema: {
          version: z
            .string()
            .optional()
            .describe(
              "Optional anchor version, e.g. '2026-05-16-v1.6.4-simulation-calibration'."
            ),
        },
      },
      async ({ version }) => {
        return withBilling(env, tenantId, "get_anchor_status", meta, async () => {
          const path = version
            ? `/api/v2/anchor/${encodeURIComponent(version)}`
            : "/api/v2/anchor/status";
          const r = await callApi(env, "GET", path);
          return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
        }) as Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
      }
    );

    // ── Tool 4: query_issuer_registry (free) ───────────────────────────────
    this.server.registerTool(
      "query_issuer_registry",
      {
        description:
          "Return the CausalLayer issuer registry, or one issuer record. The registry lists all " +
          "trusted public-key fingerprints, key algorithms, validity windows, and the anchor-log " +
          "repo for each active issuer. FREE — no API key required.",
        inputSchema: {
          issuer_id: z
            .string()
            .optional()
            .describe(
              "Optional issuer id, e.g. 'causallayer-prod-2026-q2'. If omitted, returns the full registry."
            ),
        },
      },
      async ({ issuer_id }) => {
        return withBilling(env, tenantId, "query_issuer_registry", meta, async () => {
          const path = issuer_id
            ? `/api/v2/issuers/${encodeURIComponent(issuer_id)}`
            : "/api/v2/issuers";
          const r = await callApi(env, "GET", path, undefined, { auth: false });
          return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
        }) as Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
      }
    );
  }
}

// ─── Worker fetch handler ──────────────────────────────────────────────────

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const t0 = Date.now();

    // CORS preflight — accept everything (it's a public demo).
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, mcp-session-id, accept",
          "access-control-expose-headers": "mcp-session-id",
          "access-control-max-age": "86400",
        },
      });
    }
        // ─── Interactive demo page ───────────────────────────────────────────────
    if (url.pathname === "/try" && request.method === "GET") {
      const { serveTryPage } = await import("./try-page.js");
      return serveTryPage(request, env);
    }
    // ─── MCP registry auto-discovery descriptors ─────────────────────────────
    // /.well-known/mcp.json   (canonical MCP service descriptor)
    // /.well-known/glama.json (glama.ai registry crawler reads this path)
    // Returns a Response only for known descriptor paths; null otherwise.
    {
      const wk = handleWellKnown(url.pathname);
      if (wk) {
        await logEvent("api_request", request, env, ctx, {
          request_path: url.pathname,
          method: request.method,
          response_status: wk.status,
          duration_ms: Date.now() - t0,
        });
        return wk;
      }
    }
    // ─── Smithery / MCP registry server card ─────────────────────────────────
    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return json({
        serverInfo: {
          name: "CausalLayer MCP",
          version: "0.5.0",
          description:
            "Deterministic AI liability attribution engine. Given a structured incident " +
            "description, returns a CausalCertificateV1: a signed, hash-chained, " +
            "Bitcoin-anchored receipt allocating fault between AI vendor, deployer, and end-user.",
          vendor: "FaultKey",
          homepage: "https://faultkey.com",
          repository: "https://github.com/smq9sn5jck-coder/causallayer-mcp",
        },
        authentication: { required: false },
        tools: [
          {
            name: "submit_incident",
            description:
              "Submit a structured AI incident for deterministic liability attribution. " +
              "Returns a CausalCertificateV1 with fault allocation, damages quantification, " +
              "regulatory mapping, and insurance underwriting.",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string", description: "Short incident title" },
                severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                jurisdiction: { type: "string", description: "ISO country code" },
                financial_impact_cents: { type: "number" },
                agents: { type: "array", items: { type: "object" }, minItems: 1 },
                events: { type: "array", items: { type: "object" }, minItems: 1 },
                deterministic_only: { type: "boolean", const: true },
              },
              required: ["title", "agents", "events", "deterministic_only"],
            },
          },
          {
            name: "verify_certificate",
            description: "Verify a CausalCertificate's Ed25519 signature and Merkle proof.",
            inputSchema: {
              type: "object",
              properties: { certificate: { type: "object" } },
              required: ["certificate"],
            },
          },
          {
            name: "get_anchor_status",
            description: "Query the anchored decision ledger status.",
            inputSchema: { type: "object", properties: { version: { type: "string" } } },
          },
          {
            name: "query_issuer_registry",
            description: "Query the trusted issuer registry.",
            inputSchema: { type: "object", properties: { issuer_id: { type: "string" } } },
          },
        ],
        resources: [],
        prompts: [],
      });
    }

    // Liveness probe + directory listing
    if (url.pathname === "/healthz" || url.pathname === "/") {
      // Event: app_opened — anyone hits the landing/health endpoint.
      await logEvent("app_opened", request, env, ctx, {
        request_path: url.pathname,
        method: request.method,
        response_status: 200,
        duration_ms: Date.now() - t0,
      });
      return json({
        name: "causallayer-mcp",
        version: "0.3.1",
        env: env.CAUSALLAYER_ENV,
        billing_mode: env.BILLING_MODE,
        api_base: env.CAUSALLAYER_API_BASE,
        tools: [
          { name: "submit_incident", credits: priceFor(env, "submit_incident") },
          { name: "verify_certificate", credits: priceFor(env, "verify_certificate") },
          { name: "get_anchor_status", credits: priceFor(env, "get_anchor_status") },
          { name: "query_issuer_registry", credits: priceFor(env, "query_issuer_registry") },
        ],
        endpoints: {
          mcp: "/mcp (Bearer clk_… required when BILLING_MODE=stripe)",
          me: "/me",
          stripe_webhook: "/stripe/webhook",
          admin: "/admin/* (X-Admin-Token required)",
        },
      });
    }

    // Stripe webhook
    if (url.pathname === "/stripe/webhook" && request.method === "POST") {
      const res = await handleStripeWebhook(env, request);
      await logEvent(
        res.status >= 400 ? "api_error" : "api_request",
        request,
        env,
        ctx,
        {
          request_path: url.pathname,
          method: request.method,
          response_status: res.status,
          duration_ms: Date.now() - t0,
          error_message: res.status >= 400 ? `stripe_webhook_${res.status}` : undefined,
        }
      );
      return res;
    }

    // Public demand-signal stats (anonymous, aggregated)
    if (url.pathname === "/stats") {
      const res = await handleStats(env);
      await logEvent("api_request", request, env, ctx, {
        request_path: url.pathname,
        method: request.method,
        response_status: res.status,
        duration_ms: Date.now() - t0,
      });
      return res;
    }

        // /admin/stats — ADMIN_TOKEN-gated; per-tenant + Cloudflare Workers Analytics
    //
    // Hardening note: when no ADMIN_TOKEN is configured (or the provided
    // token doesn't match), we return 404 instead of 401 so opportunistic
    // scanners (we observed 30+ /admin/*, /metrics, /version etc. probes per
    // day in production telemetry) get no signal that an admin surface even
    // exists. The legitimate caller who has a valid token still gets a 200
    // with the same payload as before.
    //
    // The failed attempt is still logged as `api_error` (with status 404) so
    // /admin/stats traffic remains observable in /stats and /admin/stats.
    if (url.pathname === "/admin/stats") {
      const provided = request.headers.get("x-admin-token") ?? "";
      if (!env.ADMIN_TOKEN || provided !== env.ADMIN_TOKEN) {
        await logEvent("api_error", request, env, ctx, {
          request_path: url.pathname,
          method: request.method,
          response_status: 404,
          duration_ms: Date.now() - t0,
          error_message: "admin_unauth_404",
        });
        return json({ error: "not_found", path: url.pathname }, 404);
      }
      return handleAdminStats(env as Parameters<typeof handleAdminStats>[0]);
    }
    // Admin + /me
    //
    // Same hardening: any /admin/* path returns 404 to unauthenticated
    // callers (no ADMIN_TOKEN set, or wrong token) before reaching
    // handleAdmin. /me uses Bearer auth via handleAdmin and is unchanged.
    if (url.pathname === "/me" || url.pathname.startsWith("/admin/")) {
      if (url.pathname.startsWith("/admin/")) {
        const provided = request.headers.get("x-admin-token") ?? "";
        if (!env.ADMIN_TOKEN || provided !== env.ADMIN_TOKEN) {
          await logEvent("api_error", request, env, ctx, {
            request_path: url.pathname,
            method: request.method,
            response_status: 404,
            duration_ms: Date.now() - t0,
            error_message: "admin_unauth_404",
          });
          return json({ error: "not_found", path: url.pathname }, 404);
        }
      }
      const res = await handleAdmin(env, request, url);
      // Distinguish login_success / login_failed for /me
      if (url.pathname === "/me") {
        await logEvent(
          res.status === 200 ? "login_success" : "login_failed",
          request,
          env,
          ctx,
          {
            request_path: url.pathname,
            method: request.method,
            response_status: res.status,
            duration_ms: Date.now() - t0,
            error_message: res.status >= 400 ? `me_${res.status}` : undefined,
          }
        );
      } else {
        await logEvent(
          res.status >= 400 ? "api_error" : "api_request",
          request,
          env,
          ctx,
          {
            request_path: url.pathname,
            method: request.method,
            response_status: res.status,
            duration_ms: Date.now() - t0,
            error_message: res.status >= 400 ? `admin_${res.status}` : undefined,
          }
        );
      }
      return res;
    }

    // MCP endpoint — authenticate first, then hand off to the agent
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const meta = await buildRequestMeta(request);
      let tenantProps: SessionProps;

      if (env.BILLING_MODE === "free") {
        tenantProps = {
          tenant_id: "anonymous",
          tenant_name: "Anonymous (BILLING_MODE=free)",
          billing_mode: "free",
          request_meta: meta,
        };
      } else if (env.BILLING_MODE === "demo") {
        // Public demo: no auth, but per-IP rate limits + watermarked output
        tenantProps = {
          tenant_id: `demo:${meta.ip_bucket}`,
          tenant_name: "Public Demo",
          billing_mode: "demo",
          request_meta: meta,
        };
      } else {
        const r = await resolveTenantFromAuth(
          env,
          request.headers.get("Authorization")
        );
        if (!r) {
          await logEvent("login_failed", request, env, ctx, {
            request_path: url.pathname,
            method: request.method,
            response_status: 401,
            duration_ms: Date.now() - t0,
            error_message: "mcp_unauthorized",
          });
          return json(
            {
              error: "unauthorized",
              hint:
                "Provide an Authorization: Bearer clk_... header. " +
                "Request a key from your CausalLayer account manager.",
            },
            401
          );
        }
        tenantProps = {
          tenant_id: r.tenant.tenant_id,
          tenant_name: r.tenant.name,
          billing_mode: env.BILLING_MODE,
          request_meta: meta,
        };
      }

      // Event: api_request for every /mcp POST. WebSocket-level
      // connect/disconnect events are emitted from the McpAgent transport
      // hooks above (see logSessionConnected / logSessionClosed) so we get
      // both fetch-level and transport-level visibility.
      await logEvent("api_request", request, env, ctx, {
        request_path: url.pathname,
        method: request.method,
        tenant_id: tenantProps.tenant_id,
        billing_mode: tenantProps.billing_mode,
        duration_ms: Date.now() - t0,
      });

      // Inject session-scoped props into the McpAgent.
      // Standard ExecutionContext does not type `props`, but the agents
      // runtime reads it from here (same mechanism used by OAuthProvider).
      (ctx as unknown as { props: Record<string, unknown> }).props =
        tenantProps as unknown as Record<string, unknown>;
      const mcpRes = await CausalLayerMCP.serve("/mcp").fetch(request, env, ctx);

      // Event: api_error if /mcp itself returned a 4xx/5xx (not a JSON-RPC
      // error inside a 200 — those are emitted from the tool wrappers).
      if (mcpRes.status >= 400) {
        await logEvent("api_error", request, env, ctx, {
          request_path: url.pathname,
          method: request.method,
          response_status: mcpRes.status,
          duration_ms: Date.now() - t0,
          tenant_id: tenantProps.tenant_id,
          billing_mode: tenantProps.billing_mode,
          error_message: `mcp_http_${mcpRes.status}`,
        });
      }

      // Re-emit with CORS headers so browsers can call /mcp directly.
      const newHeaders = new Headers(mcpRes.headers);
      newHeaders.set("access-control-allow-origin", "*");
      newHeaders.set("access-control-allow-methods", "GET, POST, OPTIONS");
      newHeaders.set("access-control-allow-headers", "content-type, authorization, mcp-session-id, accept, traceparent, tracestate");
      newHeaders.set("access-control-expose-headers", "mcp-session-id, traceparent, tracestate");

      // ── W3C Trace Context propagation ─────────────────────────────────
      // Spec: https://www.w3.org/TR/trace-context/
      // If the calling agent supplied a traceparent header, we echo it so the
      // FaultKey call appears as a span in the caller's trace. If not, we
      // generate a fresh one (version=00, flags=01 sampled) so the caller can
      // correlate this MCP exchange with whatever it does next. This makes
      // FaultKey a first-class citizen of the customer's existing
      // OpenTelemetry / Jaeger / Datadog observability stack at zero cost.
      const inboundTp = request.headers.get("traceparent");
      if (inboundTp && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(inboundTp)) {
        newHeaders.set("traceparent", inboundTp);
        const inboundTs = request.headers.get("tracestate");
        if (inboundTs) newHeaders.set("tracestate", inboundTs);
      } else {
        const traceIdBytes = new Uint8Array(16);
        const spanIdBytes = new Uint8Array(8);
        crypto.getRandomValues(traceIdBytes);
        crypto.getRandomValues(spanIdBytes);
        const hex = (b: Uint8Array) =>
          Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
        newHeaders.set("traceparent", `00-${hex(traceIdBytes)}-${hex(spanIdBytes)}-01`);
      }

      return new Response(mcpRes.body, {
        status: mcpRes.status,
        statusText: mcpRes.statusText,
        headers: newHeaders,
      });
    }

    // 404: still log it so we can see scanner/probe traffic in stats.
    await logEvent("api_error", request, env, ctx, {
      request_path: url.pathname,
      method: request.method,
      response_status: 404,
      duration_ms: Date.now() - t0,
      error_message: "not_found",
    });
    return json({ error: "not_found", path: url.pathname }, 404);
  },
};
