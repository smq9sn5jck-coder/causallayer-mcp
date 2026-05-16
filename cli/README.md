# causallayer-mcp

One-line MCP client for the **CausalLayer** deterministic AI-liability
attribution engine. Connects any MCP-aware tool (Claude Desktop, Cursor,
Cline, Continue, VS Code MCP) to the public demo or your paid tenant.

## Try it (demo)

```bash
npx causallayer-mcp
```

That's it. You're now talking to `https://demo.causallayer.io/mcp` with
4 tools available:

| Tool                   | What it does                              | Demo limit         |
|------------------------|-------------------------------------------|--------------------|
| `submit_incident`      | Deterministic liability attribution        | 5 / IP / day       |
| `verify_certificate`   | Verify a CausalCertificate signature      | 50 / IP / day      |
| `get_anchor_status`    | Read Bitcoin-anchored proof index         | unlimited          |
| `query_issuer_registry`| List trusted CausalLayer issuer keys      | unlimited          |

## Use a paid tenant

```bash
npx causallayer-mcp --env production --api-key clk_your_key_here
```

Or set it once via env var:

```bash
export CAUSALLAYER_API_KEY=clk_your_key_here
npx causallayer-mcp --env production
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "causallayer": {
      "command": "npx",
      "args": ["-y", "causallayer-mcp"]
    }
  }
}
```

For your paid tenant:

```json
{
  "mcpServers": {
    "causallayer": {
      "command": "npx",
      "args": [
        "-y", "causallayer-mcp",
        "--env", "production",
        "--api-key", "clk_your_key_here"
      ]
    }
  }
}
```

## Cursor / Cline / Continue / VS Code

Same idea — set `command: npx` and `args: ["-y", "causallayer-mcp"]` in your
MCP servers config.

## What is CausalLayer?

CausalLayer is a deterministic engine that takes an AI incident and proves
*who pays* — using counterfactual do-calculus, not LLMs. Every output is a
signed `CausalCertificateV1` Bitcoin-anchored via OpenTimestamps, suitable
for insurer claim handling, regulator submissions, and APRA CPS 230 evidence
chains.

The engine is closed-source. This MCP client is open-source under
Apache-2.0.

## Links

- Homepage: https://causallayer.io
- Engine docs: https://docs.causallayer.io
- MCP server source (Cloudflare Worker): https://github.com/causallayer/causallayer-mcp
- Demand-signal stats (anonymous): https://demo.causallayer.io/stats
