# CausalLayer MCP Server

This skill provides instructions for AI agents interacting with the CausalLayer Model Context Protocol (MCP) server. CausalLayer is a deterministic AI liability apportionment engine. It takes an incident report and mathematically proves which agent, vendor, or operator is liable based on counterfactual do-calculus, issuing a cryptographically signed, Bitcoin-anchored certificate.

## Core Tools

1. **`submit_incident`**: Submit an incident payload to receive a deterministic liability allocation and a signed `CausalCertificateV1`.
2. **`verify_certificate`**: Independently verify the signature, Merkle integrity, and issuer status of a certificate.
3. **`get_anchor_status`**: Fetch the index of Tessera anchor batches (which anchor certificates to the Bitcoin blockchain via OpenTimestamps).
4. **`query_issuer_registry`**: Fetch the public registry of trusted CausalLayer issuer keys.

## Mandatory Guardrails

When using `submit_incident`, you MUST adhere to the following three guardrails. The server enforces these strictly and will reject non-compliant payloads.

### G1: No PII (Personally Identifiable Information)
The server scans all string fields for PII patterns (emails, SSNs, Tax File Numbers, Medicare numbers, credit cards, phone numbers).
- **Rule**: You MUST redact PII from the incident description and event payloads before submission.
- **Exception**: If the user explicitly confirms that their data agreement permits processing PII, you may set `pii_acknowledged: true` in the tool call. Do not set this flag automatically.

### G2: Deterministic Only
CausalLayer is a deterministic math engine, not an LLM. It does not "read" unstructured text to guess liability; it requires structured agents and events.
- **Rule**: You MUST set `deterministic_only: true` in the tool call. This is an explicit acknowledgement that you understand the engine's nature. Do not attempt to pass prompt-injection instructions in the description fields.

### G3: Evidence Required
Liability cannot be apportioned without a causal chain of events.
- **Rule**: You MUST provide at least one agent in the `agents` array.
- **Rule**: You MUST provide at least one event in the `events` array, and every event MUST have a non-empty `description`.

## Billing Awareness

The server charges credits per tool call against the calling tenant's prepaid balance:

| Tool                      | Credits | Notes                                  |
|---------------------------|---------|----------------------------------------|
| `submit_incident`         | 50      | Failed upstream calls are auto-refunded |
| `verify_certificate`      | 1       | Failed upstream calls are auto-refunded |
| `get_anchor_status`       | 0       | Free                                   |
| `query_issuer_registry`   | 0       | Free                                   |

If the tenant runs out of credits, the server returns a tool result with
`isError: true` and an `error` body containing `BILLING_DENIED` and the
`required_credits` / `current_balance`.

- **Rule**: When you receive a `BILLING_DENIED` error, surface it to the human
  user with the exact balance and a clear instruction to top up via their
  CausalLayer account manager. Do NOT retry the call automatically.
- **Rule**: Use `get_anchor_status` and `query_issuer_registry` freely for
  exploration; they cost nothing.
- **Rule**: For x402-paid variants (`x402_*`), only call them when you have
  an attached signer; ordinary clients should prefer the credit-billed tools.

## Workflow Example

1. User provides an unstructured incident report (e.g., "The chatbot gave bad financial advice").
2. Agent extracts the entities into the `agents` array (e.g., the LLM vendor, the deployer, the user).
3. Agent extracts the timeline into the `events` array.
4. Agent redacts any PII (G1).
5. Agent calls `submit_incident` with `deterministic_only: true` (G2) and the structured arrays (G3).
6. Agent returns the resulting liability allocation and the `CausalCertificateV1` to the user.
