/**
 * standalone-mcp-stdio.ts — real stdio MCP server entry point for the
 * @faultkey/causallayer-mcp scoped npm package.
 *
 * Why this exists
 * ───────────────
 * The Cloudflare Worker (src/index.ts) is the public, network-mounted MCP
 * surface. The bundled CLI thin shim (cli/) speaks to that Worker over
 * Streamable HTTP.
 *
 * Some users — air-gapped reviewers, regulators, corporate VDIs that can't
 * egress to mcp.faultkey.com, anyone who wants to verify the engine
 * offline — need a pure-Node version that boots `npx -y` and serves the
 * same four MCP tools over stdio without ever opening a network socket.
 *
 * That's this file. It wires `@modelcontextprotocol/sdk`'s
 * StdioServerTransport to the existing deterministic `standaloneResponse()`
 * engine in standalone.ts. The engine itself is byte-identical to the
 * Worker's `STANDALONE_DEMO=true` path, so verdicts produced offline are
 * reproducible by anyone with this package.
 *
 * The four MCP tools mirror the Worker exactly:
 *   - submit_incident          → POST /api/v1/incidents/analyze
 *   - verify_certificate       → POST /api/v2/verify/certificate
 *   - get_anchor_status        → GET  /api/v2/anchor/status
 *   - query_issuer_registry    → GET  /api/v2/issuers
 *
 * Bitcoin anchoring and the trusted issuer registry obviously cannot run
 * offline; the engine returns demo_ephemeral anchors and a clearly-marked
 * demo issuer. Offline-produced certificates can be re-anchored later via
 * `causallayer-verifier --reanchor` against the public anchor log.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { standaloneResponse } from "./standalone.js";

const SERVER_NAME = "@faultkey/causallayer-mcp";
const SERVER_VERSION = "0.5.0";

const TOOLS: Tool[] = [
  {
    name: "submit_incident",
    description:
      "Submit an AI incident for deterministic multi-party liability attribution. " +
      "Returns a CausalCertificateV1 with primary/secondary share allocation, " +
      "causal graph, four-factor scoring, EU rule overlay (when jurisdiction + " +
      "trigger gates engage), counterfactual perturbations, blast radius, and a " +
      "demo_ephemeral anchor. Identical math to the public Worker; offline mode " +
      "skips Bitcoin anchoring (re-anchorable later).",
    inputSchema: {
      type: "object",
      required: ["title", "agents", "events", "deterministic_only"],
      properties: {
        title: { type: "string", description: "Short incident title" },
        category: {
          type: "string",
          description:
            "Free-form category, e.g. 'autonomous_vehicle', 'medical_diagnosis', 'financial_advice'",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Incident severity tier",
        },
        jurisdiction: {
          type: "string",
          description:
            "ISO 3166-1 alpha-2 (e.g. AU, US) or supranational (EU). Triggers EU rule overlay when 'EU' + eu_flags engage.",
        },
        financial_impact_cents: {
          type: ["number", "null"],
          description: "Direct financial impact in cents of the named currency",
        },
        currency: { type: "string", description: "ISO 4217 currency, default AUD" },
        deterministic_only: {
          type: "boolean",
          description:
            "REQUIRED. Caller's binding acknowledgement that FaultKey output is closed-form, not probabilistic.",
        },
        pii_acknowledged: {
          type: "boolean",
          description:
            "Set true if your payload may contain PII; this is logged in the certificate as a compliance acknowledgement.",
        },
        agents: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "ai_system",
                  "vendor",
                  "deployer",
                  "human_operator",
                  "user",
                  "third_party",
                ],
              },
              eu_resident: { type: "boolean" },
            },
          },
        },
        events: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["timestamp", "description"],
            properties: {
              timestamp: { type: "string", format: "date-time" },
              description: { type: "string" },
              agent_id: { type: "string" },
            },
          },
        },
        eu_flags: {
          type: "object",
          description:
            "Optional EU-rule trigger flags; consult docs/eu-rules.md for the full list.",
          additionalProperties: true,
        },
      },
    },
  },
  {
    name: "verify_certificate",
    description:
      "Verify a CausalCertificateV1 against the (offline) trusted-issuer registry. " +
      "In offline mode this checks the demo Ed25519 signature pattern and chain " +
      "integrity; for full Bitcoin-anchor proof, re-run against the public Worker.",
    inputSchema: {
      type: "object",
      required: ["certificate"],
      properties: {
        certificate: {
          type: "object",
          description: "A CausalCertificateV1 object as returned by submit_incident",
          additionalProperties: true,
        },
      },
    },
  },
  {
    name: "get_anchor_status",
    description:
      "Read the Bitcoin-anchored OpenTimestamps proof index for the public " +
      "FaultKey anchor log. In offline mode returns the schema and the last " +
      "embedded snapshot baked into this build.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "query_issuer_registry",
    description:
      "List trusted CausalLayer issuer public keys. In offline mode returns " +
      "the embedded demo issuer plus the production issuer's metadata (the " +
      "production public key itself is HSM-backed and never bundled).",
    inputSchema: { type: "object", properties: {} },
  },
];

const TOOL_TO_PATH: Record<string, { method: "GET" | "POST"; path: string }> = {
  submit_incident: { method: "POST", path: "/api/v1/incidents/analyze" },
  verify_certificate: { method: "POST", path: "/api/v2/verify/certificate" },
  get_anchor_status: { method: "GET", path: "/api/v2/anchor/status" },
  query_issuer_registry: { method: "GET", path: "/api/v2/issuers" },
};

async function main(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const route = TOOL_TO_PATH[toolName];
    if (!route) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Unknown tool: ${toolName}. Available: ${Object.keys(TOOL_TO_PATH).join(", ")}` },
        ],
      };
    }

    // Engine guardrails — match the Worker's behaviour exactly.
    if (route.method === "POST" && toolName === "submit_incident") {
      if (!args.deterministic_only) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "DETERMINISTIC-ONLY guardrail rejected request: caller must set " +
                "`deterministic_only: true` to acknowledge that FaultKey output " +
                "is closed-form, not probabilistic.",
            },
          ],
        };
      }
      if (
        !Array.isArray(args.agents) ||
        (args.agents as unknown[]).length === 0 ||
        !Array.isArray(args.events) ||
        (args.events as unknown[]).length === 0
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "EVIDENCE-REQ guardrail rejected request: at least one agent and " +
                "one timestamped event are required.",
            },
          ],
        };
      }
    }

    try {
      const result = await standaloneResponse({
        method: route.method,
        path: route.path,
        body: route.method === "POST" ? args : undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          { type: "text", text: `Engine error: ${message}` },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stay alive: stdio transport keeps the process up via the open streams.
}

main().catch((err) => {
  // Print to stderr — stdout is reserved for the JSON-RPC stream.
  process.stderr.write(
    `[@faultkey/causallayer-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
  );
  process.exit(1);
});
