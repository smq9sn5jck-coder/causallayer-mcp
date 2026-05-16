# Contributing to CausalLayer MCP

Thank you for your interest in contributing! This repository contains the open-source MCP server (Cloudflare Worker) and the `npx causallayer-mcp` CLI wrapper.

**Note:** The core CausalLayer engine (the deterministic liability math) is closed-source and runs upstream. This repository is strictly the MCP transport, billing, and edge-guardrail layer.

## Development Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/causallayer/causallayer-mcp.git
   cd causallayer-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run type-checks and tests:
   ```bash
   npx tsc --noEmit
   npx vitest run
   ```

4. Run locally (free mode):
   ```bash
   npx wrangler dev
   ```

## Pull Requests

- **Guardrails:** If you are adding a new guardrail (e.g., a new PII pattern), please add a test case in `test/demo.test.ts` or a new test file.
- **Billing:** Changes to the Stripe ledger or x402 paths must pass the `test/billing.test.ts` suite.
- **Formatting:** We use Prettier. Please format your code before submitting.

## Security

If you find a security vulnerability in the MCP server (e.g., a bypass of the PII scanner or a flaw in the credit ledger), please do NOT open a public issue. Email `security@causallayer.io` directly.
