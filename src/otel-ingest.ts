/**
 * otel-ingest.ts — OpenTelemetry / OTLP JSON → FaultKey incident adapter.
 *
 * The customer already has distributed-tracing infrastructure (OpenTelemetry,
 * Jaeger, Datadog APM, Zipkin, New Relic). When an AI multi-agent failure
 * occurs, the trace is the most authoritative record of *what* happened. This
 * adapter converts that trace into the FaultKey `submit_incident` input shape
 * so the deterministic liability engine can produce a signed apportionment
 * certificate without the customer having to hand-write incident JSON.
 *
 * Supported input formats:
 *   - OTLP JSON (the OpenTelemetry standard, "resourceSpans" envelope)
 *
 * Out of scope (future):
 *   - Jaeger native JSON (use Jaeger's own --protocol=otlp converter)
 *   - Zipkin v2 JSON (use opentelemetry-collector to translate)
 *
 * Spec references:
 *   - OTLP JSON: https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding
 *   - W3C Trace Context: https://www.w3.org/TR/trace-context/
 *   - OpenTelemetry semantic conventions: https://opentelemetry.io/docs/specs/semconv/
 */

// ─── OTLP JSON minimal types ─────────────────────────────────────────────────
// Only the fields we actually use. Full schema is enormous; we accept it
// permissively and ignore unknown fields.

interface OtlpKeyValue {
  key: string;
  value?: { stringValue?: string; intValue?: string | number; boolValue?: boolean };
}

interface OtlpSpan {
  traceId: string; // 32-hex (per OTLP JSON spec)
  spanId: string; // 16-hex
  parentSpanId?: string;
  name: string;
  kind?: number; // 1=internal 2=server 3=client 4=producer 5=consumer
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OtlpKeyValue[];
  status?: { code?: number; message?: string }; // 0=unset 1=ok 2=error
  events?: Array<{ name: string; timeUnixNano?: string | number; attributes?: OtlpKeyValue[] }>;
}

interface OtlpScopeSpans {
  scope?: { name?: string; version?: string };
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpJson {
  resourceSpans?: OtlpResourceSpans[];
}

// ─── FaultKey incident shape (mirror of submit_incident input) ───────────────

export interface FaultKeyAgent {
  id: string;
  name: string;
  type: "ai_system" | "human_operator" | "vendor" | "deployer" | "user" | "third_party";
  operator_role?: "provider" | "deployer" | "user" | "vendor" | "regulator" | "auditor";
  vendor_name?: string;
  model_id?: string;
}

export interface FaultKeyEvent {
  id: string;
  type: string;
  timestamp: string; // ISO 8601
  actor_id?: string;
  description: string;
  trace_id?: string;
  span_id?: string;
  trace_source?: "opentelemetry";
}

export interface FaultKeyIncidentInput {
  title: string;
  description?: string;
  category?: string;
  severity?: "low" | "medium" | "high" | "critical";
  jurisdiction?: string;
  financial_impact_cents?: number | null;
  currency?: string;
  agents: FaultKeyAgent[];
  events: FaultKeyEvent[];
  deterministic_only: true;
  pii_acknowledged: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function attr(kvs: OtlpKeyValue[] | undefined, key: string): string | undefined {
  if (!kvs) return undefined;
  const found = kvs.find((kv) => kv.key === key);
  if (!found?.value) return undefined;
  if (typeof found.value.stringValue === "string") return found.value.stringValue;
  if (found.value.intValue !== undefined) return String(found.value.intValue);
  if (found.value.boolValue !== undefined) return String(found.value.boolValue);
  return undefined;
}

function nanoToIso(nano: string | number | undefined): string {
  if (nano === undefined || nano === null) return new Date().toISOString();
  // OTLP encodes timestamps as nanoseconds since epoch (string in JSON).
  const n = typeof nano === "string" ? Number(nano) : nano;
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  return new Date(Math.floor(n / 1_000_000)).toISOString();
}

function inferAgentType(span: OtlpSpan): FaultKeyAgent["type"] {
  // Heuristics based on OpenTelemetry GenAI semantic conventions:
  // https://opentelemetry.io/docs/specs/semconv/gen-ai/
  const sysName = attr(span.attributes, "gen_ai.system");
  if (sysName) return "ai_system";
  if (attr(span.attributes, "ai.model") || attr(span.attributes, "ai.model.id")) return "ai_system";
  if (attr(span.attributes, "user.id")) return "user";
  if (attr(span.attributes, "deployment.environment")) return "deployer";
  // Fallback by service name
  const service = attr(span.attributes, "service.name") ?? span.name;
  if (/openai|anthropic|gemini|llm|gpt|claude|model/i.test(service)) return "ai_system";
  if (/user|client|browser/i.test(service)) return "user";
  if (/proxy|gateway|deployer|api/i.test(service)) return "deployer";
  return "ai_system";
}

function inferOperatorRole(type: FaultKeyAgent["type"]): FaultKeyAgent["operator_role"] | undefined {
  switch (type) {
    case "ai_system":
      return "provider";
    case "deployer":
      return "deployer";
    case "user":
      return "user";
    case "vendor":
      return "vendor";
    default:
      return undefined;
  }
}

function inferSeverity(spans: OtlpSpan[]): FaultKeyIncidentInput["severity"] {
  const errorCount = spans.filter((s) => (s.status?.code ?? 0) === 2).length;
  if (errorCount === 0) return "low";
  if (errorCount === 1) return "medium";
  if (errorCount <= 3) return "high";
  return "critical";
}

// ─── Main: convertOtlpToIncident ─────────────────────────────────────────────

export interface OtelIngestOptions {
  title: string;
  category?: string;
  jurisdiction?: string;
  financial_impact_cents?: number | null;
  currency?: string;
  pii_acknowledged?: boolean;
}

export interface OtelIngestResult {
  incident: FaultKeyIncidentInput;
  stats: {
    spans_processed: number;
    spans_with_errors: number;
    agents_inferred: number;
    events_emitted: number;
    canonical_trace_id: string | null;
  };
  warnings: string[];
}

/**
 * Pure function — no I/O, no Cloudflare deps. Takes an OTLP JSON payload and
 * the minimum incident metadata the caller must supply (the trace itself
 * doesn't know what jurisdiction or damages are involved), and returns a
 * FaultKey incident plus stats and any warnings.
 *
 * Determinism: identical OTLP JSON + identical options ⇒ identical output.
 * (Span order is preserved; agent ids are derived from service.name; event
 * ids are derived from spanId.) This is critical because the engine's
 * canonical-input-hash relies on byte-stable input.
 */
export function convertOtlpToIncident(
  otlp: OtlpJson,
  options: OtelIngestOptions
): OtelIngestResult {
  const warnings: string[] = [];

  // Flatten all spans into a single ordered list, preserving resource scope.
  const allSpans: Array<OtlpSpan & { _resourceAttrs?: OtlpKeyValue[] }> = [];
  for (const rs of otlp.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        if (!span.spanId || !span.traceId) {
          warnings.push(`Skipped span without spanId/traceId: name=${span.name ?? "unnamed"}`);
          continue;
        }
        allSpans.push({ ...span, _resourceAttrs: rs.resource?.attributes });
      }
    }
  }

  if (allSpans.length === 0) {
    throw new Error(
      "OTLP payload contained zero usable spans. Expected at least one span with traceId+spanId."
    );
  }

  // Sort by start time so the causal chain reflects temporal order.
  allSpans.sort((a, b) => {
    const ta = Number(a.startTimeUnixNano ?? 0);
    const tb = Number(b.startTimeUnixNano ?? 0);
    return ta - tb;
  });

  // Canonical trace id = the trace id of the first (root-most) span. If the
  // trace mixes multiple traces we still pick one as canonical for the
  // incident's traceContext block; the per-event trace_ids stay accurate.
  const canonicalTraceId = allSpans[0]?.traceId ?? null;

  // Group spans by service.name (or a derivative) to infer distinct agents.
  // FaultKey expects parties with stable ids; we use a slug of service.name.
  const agentMap = new Map<string, FaultKeyAgent>();
  for (const span of allSpans) {
    const serviceName =
      attr(span._resourceAttrs, "service.name") ??
      attr(span.attributes, "service.name") ??
      attr(span.attributes, "gen_ai.system") ??
      "unknown_service";
    const agentId = `agent_${serviceName.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    if (agentMap.has(agentId)) continue;
    const type = inferAgentType(span);
    agentMap.set(agentId, {
      id: agentId,
      name: serviceName,
      type,
      operator_role: inferOperatorRole(type),
      vendor_name: attr(span.attributes, "gen_ai.system") ?? undefined,
      model_id: attr(span.attributes, "gen_ai.request.model") ?? attr(span.attributes, "ai.model") ?? undefined,
    });
  }

  if (agentMap.size === 0) {
    warnings.push("No service.name attribute found on any span; falling back to single 'agent_unknown'.");
    agentMap.set("agent_unknown", {
      id: "agent_unknown",
      name: "Unknown service",
      type: "ai_system",
      operator_role: "provider",
    });
  }

  const agents = Array.from(agentMap.values());

  // Convert spans → FaultKey events. Event id = `evt_<short_span_id>`. Description
  // = span.name + key attributes. trace/span ids preserved for evidence pointers.
  const events: FaultKeyEvent[] = allSpans.map((span) => {
    const serviceName =
      attr(span._resourceAttrs, "service.name") ??
      attr(span.attributes, "service.name") ??
      "unknown_service";
    const agentId = `agent_${serviceName.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    const isError = (span.status?.code ?? 0) === 2;
    const errorPart = isError && span.status?.message ? ` — ERROR: ${span.status.message}` : isError ? " — ERROR" : "";
    const modelPart = attr(span.attributes, "gen_ai.request.model")
      ? ` [model=${attr(span.attributes, "gen_ai.request.model")}]`
      : "";
    return {
      id: `evt_${span.spanId.slice(0, 12)}`,
      type: isError ? "error" : "agent_action",
      timestamp: nanoToIso(span.startTimeUnixNano),
      actor_id: agentId,
      description: `${span.name}${modelPart}${errorPart}`.trim().slice(0, 500),
      trace_id: span.traceId,
      span_id: span.spanId,
      trace_source: "opentelemetry",
    };
  });

  const severity = inferSeverity(allSpans);

  const incident: FaultKeyIncidentInput = {
    title: options.title,
    description:
      `Reconstructed from OpenTelemetry trace ${canonicalTraceId?.slice(0, 16) ?? "n/a"}…` +
      ` (${allSpans.length} spans, ${agents.length} agents).`,
    category: options.category ?? "ai_pipeline_failure",
    severity,
    jurisdiction: options.jurisdiction,
    financial_impact_cents: options.financial_impact_cents ?? null,
    currency: options.currency,
    agents,
    events,
    deterministic_only: true,
    pii_acknowledged: options.pii_acknowledged ?? false,
  };

  return {
    incident,
    stats: {
      spans_processed: allSpans.length,
      spans_with_errors: allSpans.filter((s) => (s.status?.code ?? 0) === 2).length,
      agents_inferred: agents.length,
      events_emitted: events.length,
      canonical_trace_id: canonicalTraceId,
    },
    warnings,
  };
}
