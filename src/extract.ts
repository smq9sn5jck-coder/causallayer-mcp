/**
 * extract_incident — Claude-powered Structured Extractor (MCP Tool)
 * -----------------------------------------------------------------
 * Parses unstructured text (news articles, court filings, emails, PDFs,
 * incident reports) into a typed FaultKey incident JSON schema suitable
 * for direct submission to submit_incident.
 *
 * Architecture:
 *   Raw text → [Claude Sonnet] → Structured JSON → (caller feeds to submit_incident)
 *
 * The deterministic scoring path remains LLM-free. This tool is an
 * optional pre-processing step that converts messy human-world text
 * into the structured format the engine requires.
 */

import { z } from "zod";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExtractEnv {
  ANTHROPIC_API_KEY?: string;
}

export interface ExtractedIncident {
  title: string;
  description: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  jurisdiction: string;
  financial_impact_cents: number | null;
  currency: string;
  agents: Array<{
    id: string;
    name: string;
    type: "ai_system" | "human_operator" | "vendor" | "deployer" | "user" | "third_party";
    operator_role?: "provider" | "deployer" | "user" | "vendor" | "regulator" | "auditor";
    vendor_name?: string;
    model_id?: string;
  }>;
  events: Array<{
    id: string;
    type: string;
    timestamp: string;
    actor_id?: string;
    description: string;
  }>;
  deterministic_only: true;
  pii_acknowledged: boolean;
  _extraction_notes?: string;
}

// ─── Input schema for the MCP tool ──────────────────────────────────────────

export const extractInputSchema = {
  text: z
    .string()
    .min(20, "Input text must be at least 20 characters")
    .max(50000, "Input text must be under 50,000 characters")
    .describe(
      "Unstructured text to extract from. Can be a news article, court filing, " +
      "incident report, email, PDF text, log output, or any description of an AI incident."
    ),
  context_hint: z
    .string()
    .optional()
    .describe(
      "Optional hint about the source type (e.g., 'court filing', 'news article', " +
      "'internal incident report') to improve extraction accuracy."
    ),
  jurisdiction_hint: z
    .string()
    .optional()
    .describe(
      "Optional ISO country code hint if the jurisdiction is known (e.g., 'AU', 'US', 'EU')."
    ),
};

// ─── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract structured AI incident data from unstructured text. Given raw input (news articles, court filings, emails, PDFs, logs, transcripts) and the target FaultKey incident schema:

1. Read the schema first. Note required vs optional fields, enums, and format constraints.
2. Scan the input for each field. Prefer explicit values over inferred ones. If a required field is genuinely absent, use your best judgment based on context.
3. Normalize as you extract: trim whitespace, coerce dates to ISO 8601, convert currency amounts to cents (integer), collapse enum synonyms to their canonical value.
4. Emit a single JSON object that validates against the schema. No prose, no markdown fences — just the JSON.

TARGET SCHEMA:
{
  "title": "string (3-100 chars, concise incident title)",
  "description": "string (detailed narrative of what happened)",
  "category": "string (one of: healthcare, financial_services, employment, autonomous_systems, insurance, content_moderation, legal_ip, consumer_protection, biometric, general)",
  "severity": "low | medium | high | critical",
  "jurisdiction": "string (ISO 3166-1 alpha-2 country code, e.g., US, AU, EU, GB, CA)",
  "financial_impact_cents": "integer | null (damages in cents, e.g., $125,000 = 12500000)",
  "currency": "string (3-letter ISO 4217, e.g., USD, AUD, EUR)",
  "agents": [
    {
      "id": "string (a1, a2, a3...)",
      "name": "string (entity name)",
      "type": "ai_system | human_operator | vendor | deployer | user | third_party",
      "operator_role": "provider | deployer | user | vendor | regulator | auditor (optional)",
      "vendor_name": "string (optional, parent company if applicable)",
      "model_id": "string (optional, specific model identifier)"
    }
  ],
  "events": [
    {
      "id": "string (e1, e2, e3...)",
      "type": "string (incident | deployment | failure | harm | response | regulatory)",
      "timestamp": "string (ISO 8601, use best estimate if exact date unknown)",
      "actor_id": "string (optional, references agent id)",
      "description": "string (what happened in this event)"
    }
  ],
  "deterministic_only": true,
  "pii_acknowledged": false,
  "_extraction_notes": "string (optional, note any ambiguities or assumptions made)"
}

RULES:
- Always include at least 1 agent and 1 event (required by the FaultKey engine).
- For agents: identify the AI system, its vendor/provider, the deployer, and any affected users.
- For events: reconstruct the causal chain chronologically. Include deployment, incident trigger, harm, and any response/regulatory action.
- If financial damages are mentioned, convert to cents. If a range is given, use the midpoint.
- If jurisdiction is ambiguous, infer from court names, regulatory bodies, or company locations.
- Set pii_acknowledged to false unless the text explicitly discusses PII handling consent.
- Never fabricate information not present or reasonably inferable from the input text.`;

// ─── Core extraction function ───────────────────────────────────────────────

export async function extractIncident(
  env: ExtractEnv,
  text: string,
  contextHint?: string,
  jurisdictionHint?: string
): Promise<{ ok: true; incident: ExtractedIncident } | { ok: false; error: string }> {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY secret is not configured on this worker." };
  }

  const userMessage = [
    contextHint ? `[Source type: ${contextHint}]` : "",
    jurisdictionHint ? `[Jurisdiction hint: ${jurisdictionHint}]` : "",
    "",
    text,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: userMessage,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        ok: false,
        error: `Anthropic API error (${response.status}): ${errText.slice(0, 200)}`,
      };
    }

    const result = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const textBlock = result.content.find((b) => b.type === "text");
    if (!textBlock?.text) {
      return { ok: false, error: "Anthropic returned no text content." };
    }

    // Parse the JSON response
    let extracted: ExtractedIncident;
    try {
      // Strip any markdown fences if Claude adds them despite instructions
      let jsonStr = textBlock.text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      extracted = JSON.parse(jsonStr);
    } catch (parseErr) {
      return {
        ok: false,
        error: `Failed to parse Claude's response as JSON: ${String(parseErr)}. Raw: ${textBlock.text.slice(0, 300)}`,
      };
    }

    // Validate minimum requirements
    if (!extracted.title || extracted.title.length < 3) {
      return { ok: false, error: "Extraction produced an invalid title (too short or missing)." };
    }
    if (!Array.isArray(extracted.agents) || extracted.agents.length === 0) {
      return { ok: false, error: "Extraction produced no agents (at least 1 required)." };
    }
    if (!Array.isArray(extracted.events) || extracted.events.length === 0) {
      return { ok: false, error: "Extraction produced no events (at least 1 required)." };
    }

    // Ensure deterministic_only is always true
    extracted.deterministic_only = true;

    return { ok: true, incident: extracted };
  } catch (err) {
    return {
      ok: false,
      error: `Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── REST endpoint handler (POST /v1/extract) ───────────────────────────────

export async function handleExtract(
  request: Request,
  env: ExtractEnv
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed", hint: "Use POST" }),
      { status: 405, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
    );
  }

  let body: { text?: string; context_hint?: string; jurisdiction_hint?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid_json", hint: "Request body must be valid JSON with a 'text' field." }),
      { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
    );
  }

  if (!body.text || body.text.length < 20) {
    return new Response(
      JSON.stringify({ error: "text_too_short", hint: "Provide at least 20 characters of text to extract from." }),
      { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
    );
  }

  if (body.text.length > 50000) {
    return new Response(
      JSON.stringify({ error: "text_too_long", hint: "Input text must be under 50,000 characters." }),
      { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
    );
  }

  const result = await extractIncident(env, body.text, body.context_hint, body.jurisdiction_hint);

  if (!result.ok) {
    return new Response(
      JSON.stringify({ error: "extraction_failed", detail: result.error }),
      { status: 422, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      incident: result.incident,
      _meta: {
        model: "claude-sonnet-4-20250514",
        note: "This is a pre-processing extraction. The incident has NOT been scored yet. " +
              "Pass the 'incident' object to submit_incident to run the deterministic engine.",
      },
    }),
    { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
  );
}
