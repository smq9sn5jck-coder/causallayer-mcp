/**
 * standalone.ts — Hard-coded watermarked demo responses for the public
 * mcp.faultkey.com launch.
 *
 * Activated when env.STANDALONE_DEMO === "true". Bypasses the upstream API
 * entirely and returns deterministic, clearly-marked example output based on
 * the requested path. Used to ship the Worker before the real Fly upstream
 * is live, and to stay online if the upstream goes down.
 *
 * Every response carries:
 *   - "_demo_mode": true
 *   - "_demo_disclaimer" naming the limitation
 *   - "_demo_request_hash" derived from the input so callers see their own
 *     payload reflected back (proves the call was actually processed by us
 *     and not a static cached page)
 */
export interface StandaloneInput {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

const DISCLAIMER =
  "DEMO RESULT — illustrative only. The deterministic liability scoring engine, " +
  "the trusted issuer registry, and the Sigstore-anchored ledger are not invoked " +
  "in this demo. Contact hello@faultkey.com for a paid tenant with the full engine.";

async function hashHex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pickFromHash(hash: string, options: string[]): string {
  const n = parseInt(hash.slice(0, 8), 16);
  return options[n % options.length] ?? options[0];
}

function deterministicScore(hash: string, min = 0.55, max = 0.94): number {
  const n = parseInt(hash.slice(8, 16), 16) / 0xffffffff;
  return +(min + n * (max - min)).toFixed(3);
}

export async function standaloneResponse(input: StandaloneInput): Promise<unknown> {
  const requestSerialized = JSON.stringify({
    method: input.method,
    path: input.path,
    body: input.body ?? null,
  });
  const hash = await hashHex(requestSerialized);
  const shortHash = hash.slice(0, 16);

  const base = {
    _demo_mode: true,
    _demo_disclaimer: DISCLAIMER,
    _demo_request_hash: shortHash,
    _demo_generated_at: new Date().toISOString(),
  };

  // ── /api/v1/incidents/analyze ────────────────────────────────────────────
  if (input.method === "POST" && input.path === "/api/v1/incidents/analyze") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const agents = (body.agents as Array<{ id: string; name?: string }> | undefined) ?? [];
    const events = (body.events as Array<{ id: string }> | undefined) ?? [];
    const liablePartyId = agents[0]?.id ?? "agent_unknown";
    const liablePartyName = agents[0]?.name ?? "Primary AI System";
    const score = deterministicScore(hash, 0.55, 0.94);
    const verdict = pickFromHash(hash, [
      "primary_agent_at_fault",
      "shared_liability_two_party",
      "third_party_data_provider_at_fault",
      "human_in_the_loop_failure",
    ]);
    const incidentId = `inc_demo_${shortHash}`;
    return {
      ...base,
      incident_id: incidentId,
      verdict,
      liability: {
        primary_party: { id: liablePartyId, name: liablePartyName, share: score },
        secondary_parties: agents.slice(1).map((a, i) => ({
          id: a.id,
          name: a.name ?? `Agent ${i + 2}`,
          share: +((1 - score) / Math.max(1, agents.length - 1)).toFixed(3),
        })),
      },
      causal_chain: events.map((e, i) => ({
        step: i + 1,
        event_id: e.id,
        contribution: +((1 - i * 0.1) * 0.5).toFixed(3),
      })),
      damages_estimate_cents: parseInt(hash.slice(16, 24), 16) % 5_000_000,
      currency: (body.currency as string) ?? "AUD",
      certificate: {
        version: "0.1.0",
        issuer: "did:web:faultkey.com#demo-issuer",
        signature_alg: "ed25519",
        signature: `demo_sig_${shortHash}`,
        anchor: {
          merkle_root: `0xdemo${shortHash.slice(0, 60).padEnd(60, "0")}`,
          opentimestamps: "demo-ots-not-yet-anchored",
          status: "demo_ephemeral",
        },
      },
      regulator_relevant: {
        eu_ai_act_article_26: true,
        apra_cps_230: true,
        nsw_ai_assessment_framework_v3: true,
      },
    };
  }

  // ── /api/v2/verify/certificate ───────────────────────────────────────────
  if (input.method === "POST" && input.path === "/api/v2/verify/certificate") {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const cert = body.certificate as Record<string, unknown> | undefined;
    const sig = (cert?.signature as string | undefined) ?? "";
    const isDemoCert = sig.startsWith("demo_sig_");
    return {
      ...base,
      verified: isDemoCert,
      reason: isDemoCert
        ? "Demo certificate signature pattern recognised. In production this would " +
          "verify the ed25519 signature against the issuer registry and check the " +
          "Sigstore anchor proof inclusion."
        : "Unknown signature format. Demo mode only recognises certificates issued " +
          "by this same demo Worker. Contact hello@faultkey.com for full verification.",
      issuer_known: isDemoCert,
      anchor_proof_valid: isDemoCert,
      not_revoked: isDemoCert,
    };
  }

  // ── /api/v2/anchor/status ────────────────────────────────────────────────
  if (input.method === "GET" && input.path === "/api/v2/anchor/status") {
    return {
      ...base,
      anchor_log: {
        repo: "https://github.com/causallayer/causallayer-anchor-log",
        latest_version: "v0.0.42-demo",
        latest_root: `0xdemo${"a".repeat(60)}`,
        anchor_count: 42,
        last_updated: new Date().toISOString(),
        opentimestamps_status: "pending_first_real_anchor",
      },
    };
  }

  // ── /api/v2/issuers ──────────────────────────────────────────────────────
  if (input.method === "GET" && input.path === "/api/v2/issuers") {
    return {
      ...base,
      issuers: [
        {
          key_id: "did:web:faultkey.com#demo-issuer",
          status: "demo",
          algorithm: "ed25519",
          public_key_pem: "-----BEGIN PUBLIC KEY-----DEMO KEY-----END PUBLIC KEY-----",
          attestation: "Demo issuer. Not part of the trusted production registry.",
          issued_at: "2026-05-16T00:00:00Z",
          expires_at: "2026-08-16T00:00:00Z",
        },
      ],
      registry_root: `0xdemo${"b".repeat(60)}`,
    };
  }

  // ── /api/v2/anchor/<version> ─────────────────────────────────────────────
  if (input.method === "GET" && input.path.startsWith("/api/v2/anchor/")) {
    const version = input.path.split("/").pop() ?? "unknown";
    return {
      ...base,
      version,
      root: `0xdemo${shortHash.padEnd(60, "0").slice(0, 60)}`,
      anchor_status: "demo_ephemeral",
    };
  }

  // ── /api/v1/regulatory-lookup ────────────────────────────────────────────
  if (input.method === "GET" && input.path.startsWith("/api/v1/regulatory-lookup")) {
    return {
      ...base,
      jurisdictions: [
        { id: "AU-APRA-CPS-230", name: "APRA CPS 230 (operational risk)", in_force: true },
        { id: "AU-NSW-AIAF-v3", name: "NSW AI Assessment Framework v3", in_force: true },
        { id: "EU-AI-ACT-ART-26", name: "EU AI Act Article 26 (deployer obligations)", in_force: true },
      ],
    };
  }

  // ── default ──────────────────────────────────────────────────────────────
  return {
    ...base,
    error: "unknown_demo_path",
    requested: { method: input.method, path: input.path },
  };
}
