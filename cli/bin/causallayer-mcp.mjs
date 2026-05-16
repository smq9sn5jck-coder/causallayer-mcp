#!/usr/bin/env node
/**
 * causallayer-mcp — one-line MCP client.
 *
 * Spawns mcp-remote (the canonical 2026 stdio↔Streamable-HTTP shim) pointed
 * at the CausalLayer MCP server. Defaults to the public demo so a brand-new
 * user can run:
 *
 *     npx causallayer-mcp
 *
 * and get a working stdio MCP server for Claude Desktop / Cursor / Cline /
 * Continue / VS Code without any setup.
 *
 * Flags:
 *   --url <url>         Override server URL (default: live demo Worker on Cloudflare)
 *   --api-key <key>     Use Bearer auth for a paid tenant (clk_…)
 *   --env <name>        Shorthand for known envs: demo | sandbox | production
 *   --help              Print this message
 *
 * All other arguments are passed through to mcp-remote untouched, so you can
 * use any flag mcp-remote supports (e.g. --header, --transport).
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

function take(flag) {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function takeBool(flag) {
  const i = args.indexOf(flag);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

if (takeBool("--help") || takeBool("-h")) {
  console.log(
    `causallayer-mcp <flags>\n\n` +
      `  --url <url>         Override server URL\n` +
      `  --api-key <clk_…>   Bearer token for a paid tenant\n` +
      `  --env demo|sandbox|production  Shortcut for known envs (default: demo)\n` +
      `  --help              Print this message\n\n` +
      `Examples:\n` +
      `  npx causallayer-mcp\n` +
      `  npx causallayer-mcp --env production --api-key clk_xxx\n` +
      `  npx causallayer-mcp --url http://localhost:8787/mcp\n`
  );
  process.exit(0);
}

const env = take("--env") || process.env.CAUSALLAYER_ENV;
let url = take("--url") || process.env.CAUSALLAYER_URL;
const apiKey = take("--api-key") || process.env.CAUSALLAYER_API_KEY;

if (!url) {
  switch ((env ?? "demo").toLowerCase()) {
    case "production":
    case "prod":
      url = "https://mcp.faultkey.com/mcp";
      break;
    case "sandbox":
      url = "https://causallayer-mcp-sandbox.workers.dev/mcp";
      break;
    case "demo":
    default:
      url = "https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp";
      break;
  }
}

const passthrough = [...args];
if (apiKey) {
  passthrough.push("--header", `Authorization: Bearer ${apiKey}`);
}

// Prefer the locally installed mcp-remote binary (works fully offline in
// containerised launchers like Glama / Smithery). Fall back to `npx -y` for
// `npx causallayer-mcp` users who haven't installed anything.
const localBin = resolve(__dirname, "..", "node_modules", ".bin", "mcp-remote");
const hasLocal = existsSync(localBin);

const cmd = hasLocal ? localBin : "npx";
const cmdArgs = hasLocal
  ? [url, ...passthrough]
  : ["-y", "mcp-remote", url, ...passthrough];

const child = spawn(cmd, cmdArgs, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("[causallayer-mcp] failed to spawn mcp-remote:", err.message);
  process.exit(1);
});
