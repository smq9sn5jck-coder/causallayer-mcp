/**
 * /.well-known/* directory for MCP registry auto-discovery.
 *
 * Many MCP registries crawl public servers via documented `.well-known` paths
 * to populate their listings. We expose three:
 *
 *   - /.well-known/mcp.json
 *       The canonical Model Context Protocol service descriptor
 *       (https://modelcontextprotocol.io/schemas/well-known/v1.json).
 *       Used by registries that follow the upstream MCP spec.
 *
 *   - /.well-known/glama.json
 *       glama.ai's MCP registry crawler reads this file to auto-list servers
 *       on https://glama.ai/mcp/servers without requiring a manual submission.
 *       (Observed in production: a glama.ai crawler hit this path on
 *        2026-05-22 and 404'd; this restores the auto-listing path.)
 *
 *   - /.well-known/mcp/server-card.json
 *       Smithery / generic MCP registry card. Already served by the main
 *       router in src/index.ts; re-exported here for completeness so all
 *       three live in one place going forward.
 *
 * Bundling: these payloads are inlined into the Worker source rather than
 * read from disk at request time. The repo's `public/.well-known/mcp.json`
 * file is the source of truth for the human-readable copy; this module
 * mirrors it. **If you change one, change both** — the test in
 * `test/well-known.test.ts` enforces parity.
 */
export const WELL_KNOWN_MCP = {
  $schema: "https://modelcontextprotocol.io/schemas/well-known/v1.json",
  name: "io.faultkey/causallayer-mcp",
  title: "FaultKey · CausalLayer",
  description:
    "Deterministic AI-liability attribution. Issues signed, Bitcoin-anchored CausalCertificateV1 receipts that compute vendor/deployer/user liability splits for AI incidents. Closed-form math, byte-identical reproducible, no LLMs in the scoring path.",
  version: "0.2.0",
  vendor: "FaultKey Protocol",
  license: "Apache-2.0",
  repository: "https://github.com/smq9sn5jck-coder/causallayer-mcp",
  homepage: "https://faultkey.com",
  endpoints: {
    production: "https://mcp.faultkey.com/mcp",
    demo: "https://mcp.faultkey.com/mcp",
  },
  transport: ["http", "sse"],
  auth: {
    type: "bearer",
    demo_mode: "anonymous",
  },
  capabilities: ["tools"],
  tools: [
    {
      name: "submit_incident",
      description:
        "Issue a CausalCertificateV1 attributing fault between vendor / deployer / user.",
      credits: 50,
    },
    {
      name: "verify_certificate",
      description:
        "Verify the signature and Bitcoin anchor of a CausalCertificateV1.",
      credits: 1,
    },
    {
      name: "get_anchor_status",
      description: "Look up the OpenTimestamps anchor status for a certificate.",
      credits: 0,
    },
    {
      name: "query_issuer_registry",
      description: "List trusted FaultKey issuer keys.",
      credits: 0,
    },
  ],
  tags: [
    "ai-governance",
    "ai-liability",
    "regtech",
    "compliance",
    "audit",
    "regulated",
    "remote",
    "free-tier",
  ],
  regulated_use_cases: [
    "APRA CPS 230",
    "EU AI Act Article 12",
    "ISO/IEC 42001",
    "NIST AI RMF",
  ],
} as const;

/**
 * glama.ai MCP registry descriptor.
 *
 * Schema reference: https://glama.ai/mcp/servers (the registry crawls this
 * path and uses the fields below to populate the listing). Fields not
 * understood by glama are ignored, so we err toward providing extra metadata.
 *
 * Important: this does NOT replace a manual submission to glama.ai — it just
 * means that once a server is listed, the listing stays current automatically.
 */
export const WELL_KNOWN_GLAMA = {
  schemaVersion: 1,
  name: "causallayer-mcp",
  displayName: "FaultKey · CausalLayer",
  description:
    "Deterministic AI-liability attribution MCP server. Issues signed, Bitcoin-anchored CausalCertificateV1 receipts that compute vendor/deployer/user liability splits for AI incidents. Closed-form math, byte-identical reproducible, no LLMs in the scoring path.",
  vendor: "FaultKey Protocol",
  license: "Apache-2.0",
  homepage: "https://faultkey.com",
  repository: "https://github.com/smq9sn5jck-coder/causallayer-mcp",
  documentation: "https://faultkey.com/anchor-log",
  endpoints: {
    mcp: "https://mcp.faultkey.com/mcp",
    sse: "https://mcp.faultkey.com/mcp",
  },
  transport: ["http", "sse"],
  authentication: {
    type: "none-for-demo",
    notes:
      "Demo tier is anonymous with per-IP rate limits. Stripe billing is supported when BILLING_MODE=stripe and a clk_… bearer token is provided.",
  },
  pricing: {
    tier: "free-tier",
    rateLimits: {
      submit_incident_per_ip_per_day: 50,
      verify_certificate_per_ip_per_day: 200,
      submit_incident_global_per_day: 5000,
    },
  },
  tools: [
    {
      name: "submit_incident",
      description:
        "Issue a CausalCertificateV1 attributing fault between vendor / deployer / user.",
    },
    {
      name: "verify_certificate",
      description:
        "Verify the signature and Bitcoin anchor of a CausalCertificateV1.",
    },
    {
      name: "get_anchor_status",
      description: "Look up the OpenTimestamps anchor status for a certificate.",
    },
    {
      name: "query_issuer_registry",
      description: "List trusted FaultKey issuer keys.",
    },
  ],
  tags: [
    "ai-governance",
    "ai-liability",
    "regtech",
    "compliance",
    "audit",
    "regulated",
    "remote",
    "free-tier",
    "deterministic",
    "bitcoin-anchor",
    "ed25519",
    "merkle-tree",
  ],
  // Tag the registered MCP card path so glama can cross-reference.
  links: {
    serverCard: "https://mcp.faultkey.com/.well-known/mcp/server-card.json",
    mcpDescriptor: "https://mcp.faultkey.com/.well-known/mcp.json",
    githubReadme:
      "https://raw.githubusercontent.com/smq9sn5jck-coder/causallayer-mcp/main/README.md",
  },
} as const;

/**
 * Build a JSON Response with caching headers tuned for static descriptors.
 *
 * Cache: 1h on browsers, 1h at the edge. Registries re-crawl infrequently,
 * and these payloads change roughly only at version bumps, so a 1h TTL is
 * generous; we re-deploy more often than that anyway.
 */
function staticJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Route handler: returns a Response if `pathname` is one of the known
 * descriptor paths; otherwise returns null and lets the main router proceed.
 *
 * Pure / deterministic / no env access — easy to unit-test.
 */
export function handleWellKnown(pathname: string): Response | null {
  switch (pathname) {
    case "/.well-known/mcp.json":
      return staticJson(WELL_KNOWN_MCP);
    case "/.well-known/glama.json":
      return staticJson(WELL_KNOWN_GLAMA);
    default:
      return null;
  }
}
