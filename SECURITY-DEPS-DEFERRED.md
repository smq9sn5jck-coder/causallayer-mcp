# Deferred Dependency Advisories

_Last reviewed: 2026-05-22._

This file documents Dependabot / `pnpm audit` advisories that have been
**triaged and accepted as deferred** rather than silently ignored. The goal is
that any third-party reviewer can see exactly which alerts are open, why we
have not patched them, and what the upgrade trigger is.

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| High     | 0 | All previously-high advisories patched 2026-05-22 (commits below). |
| Moderate | 3 | Dev-only, deferred. See table below. |
| Low      | 0 | — |

Net change from the 2026-05-20 baseline of **5 alerts (2 high / 3 moderate)**:
high advisories are now fully resolved; three transitive dev-only moderates
remain. None reach the production Cloudflare Worker runtime.

## Patched 2026-05-22

| Advisory | Package | Action | Commit |
|----------|---------|--------|--------|
| GHSA-c4hr-29qr-h73h | `undici` (HTTP request smuggling, smuggled responses) | Bumped via `wrangler 3 → 4` in `demo/package.json` | _this commit_ |
| GHSA-rrhc-453j-q967 | `undici` (memory exhaustion via Content-Encoding) | Same chain bump | _this commit_ |
| GHSA-cxrh-j4jr-qwg3 | `undici` (Unbounded WebSocket permessage-deflate) | Same chain bump | _this commit_ |
| GHSA-3p23-vc8h-w9pp | `undici` (Unhandled WS server_max_window_bits exception) | Same chain bump | _this commit_ |
| GHSA-32h6-7q7h-rj86 | `undici` (CRLF injection via upgrade option) | Same chain bump | _this commit_ |

## Deferred

| Advisory | Package | Severity | Reason | Re-evaluation trigger |
|----------|---------|----------|--------|-----------------------|
| GHSA-67mh-4wv8-2f99 | `esbuild ≤ 0.24.2` | moderate | Reaches us only via `agents → @rolldown/plugin-babel → vite@5 → esbuild@0.21.5` and `vitest → @vitest/mocker → vite@5 → esbuild@0.21.5`. Both are **dev-time tooling never shipped to the Worker runtime**. The advisory describes a same-origin attack against the local dev server; threat model is a developer machine, not production. Forcing `>=0.24.3` via pnpm overrides causes `agents@0.12.4` to break its internal Vite plugin contract. | When `agents` ships a release with `vite@^6.4.2`, or `vitest` ships v5 that drops Vite 5 — bump and re-audit. |
| GHSA-4w7w-66w2-5vf9 | `vite ≤ 6.4.1` | moderate | Same `agents → vite@5.4.x` chain. Dev-only path-traversal in `.map` handling; never executed by the deployed Worker. Override to `>=6.4.2` breaks the `agents` peer-dep pin. | Track upstream `agents` releases. |
| GHSA-58qx-3vcg-4xpx | `ws ≥ 8.0.0 < 8.20.1` | moderate | Reaches us only via `wrangler → miniflare → ws@8.18.0`. `miniflare` is the local Workers emulator — it does not run in production. Override to `>=8.20.1` is silently ignored by pnpm because `miniflare` declares an exact dep on `ws@8.18.0`. | Track `wrangler 4.x → 4.94+` (expected to bump `miniflare`, which will pull a patched `ws`). |

## Production runtime exposure

The Cloudflare Worker bundle that runs at `mcp.faultkey.com` and
`faultkey-try-demo.zykm9qkk7j.workers.dev` is built from `src/` with
`esbuild@0.25.12` (root devDependency) and contains **none** of the packages
listed above as runtime dependencies. Runtime deps are limited to:

- `@modelcontextprotocol/sdk` ^1.29.0
- `agents` ^0.12.4 (Workers runtime entry, not its dev-time esbuild)
- `zod` ^3.23.8

A reviewer can confirm this by inspecting `dist/standalone.js` after
`pnpm build:npm` — the three deferred packages do not appear.

## Automation

`pnpm audit --prod` currently surfaces the `esbuild` and `vite` advisories
even with the `--prod` flag, because pnpm resolves `agents`' transitive
dev-time Vite 5 in the production graph. **This is a pnpm resolution
artefact, not a runtime exposure** — the deployed `dist/standalone.js`
bundle (which is what actually runs on Cloudflare Workers) does not contain
either package. To verify:

```bash
pnpm run build:npm
grep -l -E "esbuild|vite" dist/*.js   # expect no output
```

The CI gate is therefore: any **new** advisory not on this deferred list
should block the build. The three entries above are explicit allow-listed
until their re-evaluation triggers fire.

---

_To dispute an entry here, open an issue at
<https://github.com/smq9sn5jck-coder/causallayer-mcp/issues> with the
GHSA ID — we will re-triage._
