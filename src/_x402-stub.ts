/**
 * Stub for @x402/* modules.
 *
 * The `agents/x402` helper imports four `@x402/*` packages eagerly. These are
 * only needed at runtime when BILLING_MODE === "x402". For the demo
 * deployment (BILLING_MODE=demo) and free/Stripe deployments we never enter
 * the x402 code path, so we alias the missing packages to this stub via
 * wrangler.jsonc `alias` to keep the bundler happy.
 *
 * If x402 is later actually wired up, replace these aliases with the real
 * packages: `pnpm add @x402/core @x402/evm` and remove the `alias` entries.
 */
export const HTTPFacilitatorClient: unknown = class {};
export const x402ResourceServer: unknown = (() => {
  throw new Error(
    "x402 not bundled in this build — set BILLING_MODE != 'x402' or install @x402/* packages"
  );
}) as unknown;
export const x402Client: unknown = (() => {
  throw new Error(
    "x402 not bundled in this build — set BILLING_MODE != 'x402' or install @x402/* packages"
  );
}) as unknown;
export const registerExactEvmScheme: unknown = (() => {
  // no-op stub
}) as unknown;
export default {};
