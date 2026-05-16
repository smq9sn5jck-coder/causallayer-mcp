# MCP Marketplace Submission Packets

Use these exact snippets to submit the CausalLayer MCP server to the major directories. This is how you get free distribution to agent builders.

## 1. awesome-mcp-servers (GitHub PR)

**Target:** https://github.com/punkpeye/awesome-mcp-servers
**Action:** Fork, edit `README.md`, submit PR.

**Snippet to insert under "Security & Governance" or "Tools":**

```markdown
- [causallayer-mcp](https://github.com/causallayer/causallayer-mcp) - Deterministic AI-liability attribution engine. Submits incident logs and returns cryptographically signed, Bitcoin-anchored certificates proving *who pays* when an AI fails. Includes edge PII-scanning guardrails.
```

## 2. Smithery (smithery.yaml)

**Target:** https://smithery.ai
**Action:** The file is already in the repo. Just log in to Smithery and point it at your GitHub repo.

**File (`smithery.yaml`):**
```yaml
startCommand:
  type: stdio
  command: npx
  args:
    - -y
    - causallayer-mcp
```

## 3. LobeHub (lobe-chat-plugins)

**Target:** https://github.com/lobehub/lobe-chat-plugins
**Action:** Submit a PR adding this JSON to their registry.

**Snippet:**
```json
{
  "identifier": "causallayer",
  "author": "CausalLayer",
  "createdAt": "2026-05-16",
  "meta": {
    "title": "CausalLayer AI Liability",
    "description": "Deterministic AI-liability attribution. Submit incident logs to get cryptographically signed certificates proving fault.",
    "tags": ["governance", "security", "liability", "compliance", "mcp"]
  },
  "homepage": "https://causallayer.io",
  "manifest": "https://raw.githubusercontent.com/causallayer/causallayer-mcp/main/docs/lobehub-manifest.json"
}
```

## 4. mcp.so / mcpservers.org / PulseMCP

**Target:** Web submission forms on each site.
**Action:** Copy-paste these fields.

- **Name:** CausalLayer MCP
- **Tagline:** Deterministic AI-liability attribution and signed certificates.
- **Description:** Connects your agent to the CausalLayer engine. Submits AI incident logs and returns a cryptographically signed, Bitcoin-anchored `CausalCertificateV1` proving *who pays* when an AI fails. Enforces strict NO-PII and deterministic-only guardrails at the edge. Includes a free public demo mode.
- **GitHub URL:** https://github.com/causallayer/causallayer-mcp
- **Install Command:** `npx -y causallayer-mcp`
- **Tags:** Security, Governance, Compliance, Legal, Enterprise

## 5. VS Code / Cursor / Cline Extension Lists

**Target:** When posting on Reddit (r/Cursor, r/LocalLLaMA) or Discord.
**Action:** Use this copy-paste config block.

**Snippet:**
```json
"mcpServers": {
  "causallayer": {
    "command": "npx",
    "args": ["-y", "causallayer-mcp"]
  }
}
```
