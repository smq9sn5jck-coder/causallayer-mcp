/**
 * Constant-time string comparison for short shared secrets (admin/leads tokens).
 *
 * Plain `a === b` / `a !== b` short-circuits on the first differing byte, which
 * is theoretically timing-observable. This compares over the full length and
 * folds any length difference into the result so it doesn't early-return.
 * (Mirrors the constant-time HMAC compare already used in billing.ts.)
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    // charCodeAt past the end returns NaN; `|| 0` normalizes it to 0. A real
    // length mismatch is already captured by the initial `a.length ^ b.length`.
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
