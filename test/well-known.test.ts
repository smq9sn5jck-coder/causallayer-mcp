/**
 * Unit tests for src/well-known.ts.
 *
 * These verify the descriptor payloads and the path-matching router.
 * They do NOT spin up a Worker; they call the pure handler directly.
 */
import { describe, it, expect } from "vitest";
import {
  WELL_KNOWN_MCP,
  WELL_KNOWN_GLAMA,
  handleWellKnown,
} from "../src/well-known.js";

describe("WELL_KNOWN_MCP descriptor", () => {
  it("declares the canonical MCP $schema", () => {
    expect(WELL_KNOWN_MCP.$schema).toBe(
      "https://modelcontextprotocol.io/schemas/well-known/v1.json"
    );
  });

  it("uses an io.faultkey/* identifier (matches the public/.well-known/mcp.json file)", () => {
    expect(WELL_KNOWN_MCP.name).toBe("io.faultkey/causallayer-mcp");
  });

  it("lists all four production tools with credit prices", () => {
    const names = WELL_KNOWN_MCP.tools.map((t) => t.name);
    expect(names).toEqual([
      "submit_incident",
      "verify_certificate",
      "get_anchor_status",
      "query_issuer_registry",
    ]);
    // submit_incident is the only priced tool that costs > 1 credit
    const submit = WELL_KNOWN_MCP.tools.find((t) => t.name === "submit_incident");
    expect(submit?.credits).toBe(50);
  });

  it("points the production endpoint at mcp.faultkey.com", () => {
    expect(WELL_KNOWN_MCP.endpoints.production).toBe(
      "https://mcp.faultkey.com/mcp"
    );
  });
});

describe("WELL_KNOWN_GLAMA descriptor", () => {
  it("declares schemaVersion 1", () => {
    expect(WELL_KNOWN_GLAMA.schemaVersion).toBe(1);
  });

  it("uses canonical name 'causallayer-mcp'", () => {
    expect(WELL_KNOWN_GLAMA.name).toBe("causallayer-mcp");
  });

  it("links to the MCP server-card and mcp.json so registries can cross-reference", () => {
    expect(WELL_KNOWN_GLAMA.links.serverCard).toBe(
      "https://mcp.faultkey.com/.well-known/mcp/server-card.json"
    );
    expect(WELL_KNOWN_GLAMA.links.mcpDescriptor).toBe(
      "https://mcp.faultkey.com/.well-known/mcp.json"
    );
  });

  it("documents the public demo rate limits (matches wrangler.jsonc)", () => {
    expect(WELL_KNOWN_GLAMA.pricing.rateLimits).toEqual({
      submit_incident_per_ip_per_day: 50,
      verify_certificate_per_ip_per_day: 200,
      submit_incident_global_per_day: 5000,
    });
  });
});

describe("handleWellKnown(pathname)", () => {
  it("returns the MCP descriptor as application/json with cache headers", async () => {
    const res = handleWellKnown("/.well-known/mcp.json");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toMatch(/application\/json/);
    expect(res!.headers.get("cache-control")).toContain("max-age=3600");
    const body = await res!.json();
    expect(body).toEqual(WELL_KNOWN_MCP);
  });

  it("returns the glama descriptor as application/json", async () => {
    const res = handleWellKnown("/.well-known/glama.json");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res!.json();
    expect(body).toEqual(WELL_KNOWN_GLAMA);
  });

  it("returns null for unknown well-known paths so the main router can 404 them", () => {
    expect(handleWellKnown("/.well-known/foo")).toBeNull();
    expect(handleWellKnown("/.well-known/openid-configuration")).toBeNull();
    expect(handleWellKnown("/.well-known/mcp.JSON")).toBeNull(); // case-sensitive on purpose
    expect(handleWellKnown("/")).toBeNull();
    expect(handleWellKnown("/mcp")).toBeNull();
  });

  it("does not match the existing /.well-known/mcp/server-card.json (still served by main router)", () => {
    // Important: the existing server-card.json route remains owned by the
    // main router so that registry-specific behaviours can be added there
    // without coupling this module.
    expect(handleWellKnown("/.well-known/mcp/server-card.json")).toBeNull();
  });
});

describe("byte-stable JSON serialization", () => {
  it("descriptor JSON is stable across calls (no Date.now() / Math.random())", async () => {
    const a = await handleWellKnown("/.well-known/mcp.json")!.text();
    const b = await handleWellKnown("/.well-known/mcp.json")!.text();
    expect(a).toBe(b);
  });
});
