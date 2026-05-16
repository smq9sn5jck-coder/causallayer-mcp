# causallayer-mcp · FaultKey one-liner

One-line MCP client for **FaultKey · CausalLayer** — the deterministic AI-liability attribution engine. Connects any MCP-aware tool (Claude Desktop, Cursor, Cline, Continue, Windsurf, VS Code) to the public demo or your paid tenant in a single command.

## Try it (free public demo)

```bash
npx causallayer-mcp
```

That's it. The CLI auto-installs `mcp-remote` and connects you to the live FaultKey Worker on Cloudflare. Four tools are available:

| Tool | What it does | Demo limit |
|---|---|---|
| `submit_incident` | Deterministic multi-party liability attribution. Returns a signed `CausalCertificateV1`. | 5 / IP / day |
| `verify_certificate` | Verify a CausalCertificate signature against the issuer registry. | 50 / IP / day |
| `get_anchor_status` | Read the Bitcoin-anchored OpenTimestamps proof index. | unlimited |
| `query_issuer_registry` | List trusted CausalLayer issuer public keys. | unlimited |

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "faultkey": {
      "command": "npx",
      "args": ["-y", "causallayer-mcp"]
    }
  }
}
```

Restart Claude. Type *"List the FaultKey tools."*

## Cursor / Cline / Continue / Windsurf / VS Code

Same idea — set `command: npx` and `args: ["-y", "causallayer-mcp"]` in your MCP servers config.

## Use a paid tenant

```bash
npx causallayer-mcp --env production --api-key clk_your_key_here
```

Or set it once via env var:

```bash
export CAUSALLAYER_API_KEY=clk_your_key_here
npx causallayer-mcp --env production
```

## What is FaultKey?

FaultKey is the brand that ships **CausalLayer** — a deterministic engine that takes an AI incident and proves *who pays* using counterfactual do-calculus, not LLMs. Every output is a signed `CausalCertificateV1` Bitcoin-anchored via OpenTimestamps, suitable for insurer claim handling, regulator submissions, and APRA CPS 230 / EU AI Act / ISO 42001 evidence chains.

The engine is closed-source. This MCP client is open-source under Apache-2.0.

## Links

- Repo: https://github.com/smq9sn5jck-coder/causallayer-mcp
- Live demo Worker: https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz
- Demand-signal stats (anonymous): https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/stats
- Issues: https://github.com/smq9sn5jck-coder/causallayer-mcp/issues
