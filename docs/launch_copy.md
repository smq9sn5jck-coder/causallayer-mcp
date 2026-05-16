# CausalLayer Launch Copy

Use these exact drafts to execute the 12-surface launch strategy.

---

## 1. The AFR / iTnews / InnovationAus Pitch (Email)

**Subject:** Brisbane fintech ships world-first "AI Liability Engine" as Microsoft commoditizes basic AI receipts
**To:** [Journalist Name]

Hi [Name],

While Microsoft is now teaching developers how to build basic "AI receipts" for free in their latest curriculum, a Brisbane-based fintech has just shipped the missing piece that APRA-regulated entities actually need: **deterministic liability attribution**.

CausalLayer has launched an engine that doesn't just log what an AI did—it uses counterfactual math to prove *who pays* when the AI fails. Today, they released a free public integration (via the Model Context Protocol) that allows any AI agent to submit an incident log and receive a cryptographically signed, Bitcoin-anchored certificate proving fault.

**Why this matters now:**
- With the EU AI Act in force and APRA CPS 230 looming, Australian insurers and banks are paralyzed by "model risk."
- Current "AI Governance" platforms rely on LLMs to grade LLMs (which insurers won't underwrite).
- CausalLayer is the first to enforce strict deterministic math at the edge, rejecting PII and probabilistic guesses before they even hit the engine.

I'm the founder. I'd love to give you a 5-minute demo of the engine proving fault in a multi-agent supply chain failure. Are you covering AI risk or regtech this week?

Best,
[Your Name]
Founder, CausalLayer

---

## 2. LinkedIn Announcement (The Buyer Pitch)

**Audience:** Risk Officers, APRA-regulated execs, AI Governance leads.

Microsoft just made "AI receipts" free in their developer curriculum. But receipts don't prove fault. They don't prove policy compliance. And they certainly don't tell an insurer *who pays* when a multi-agent supply chain fails.

Today, we're launching the public demo of the **CausalLayer MCP Server**.

It connects any AI agent directly to our deterministic liability engine. When an incident occurs, the agent submits the log. The engine uses counterfactual do-calculus (not LLMs) to calculate fault, and returns a cryptographically signed, Bitcoin-anchored `CausalCertificateV1`.

We built this for APRA-regulated entities who need insurance-grade evidence, not probabilistic guesses.

To prove it, we've opened a free public demo. If you use Claude Desktop or Cursor, you can test the engine right now with one line of code:
`npx causallayer-mcp`

No API key required. Strict NO-PII guardrails enforced at the edge.

Read the docs and see the live demand telemetry here: [Link to GitHub/Website]

#AIGovernance #ModelRisk #CPS230 #Insurtech #Brisbane

---

## 3. Show HN (Hacker News)

**Title:** Show HN: CausalLayer MCP – Deterministic AI liability attribution (Cloudflare Worker)

**Body:**
Hey HN,

We built a deterministic engine that calculates *who pays* when an AI agent fails. Today we're open-sourcing the MCP server (Cloudflare Worker) that connects agents to it.

Most "AI governance" tools use LLMs to grade LLMs. We think that's a dead end for actual liability and insurance. Instead, our upstream engine uses counterfactual do-calculus to attribute fault across multi-agent supply chains.

The MCP server we're releasing today acts as the edge proxy. It enforces strict guardrails (regex-based PII blocking, deterministic-only flags) before any data hits the engine. It returns a cryptographically signed, Bitcoin-anchored (OpenTimestamps) certificate.

You can try the public demo right now in Claude Desktop or Cursor without an API key:
`npx -y causallayer-mcp`

The worker code is open-source (Apache 2.0) and includes a neat pattern for Stripe prepaid-credit billing and x402 stablecoin micro-payments over MCP.

Repo: https://github.com/causallayer/causallayer-mcp
Live telemetry: https://demo.causallayer.io/stats

Would love feedback on the edge-guardrail approach or the MCP billing pattern.

---

## 4. Product Hunt Draft

**Name:** CausalLayer MCP
**Tagline:** Deterministic AI liability attribution for your agents
**Description:**
When your AI agent fails, who pays? CausalLayer is a deterministic engine that calculates fault and issues cryptographically signed, Bitcoin-anchored liability certificates. Connect your agents instantly via our free MCP server. No PII stored.
**First Comment:**
Hey Product Hunt! 👋

As agents get more autonomous, the liability question gets harder. If a multi-agent supply chain hallucinates and causes financial damage, you need mathematical proof of fault, not just a log file.

We built CausalLayer to solve this using deterministic math. Today, we're launching our MCP server so any agent (Claude, Cursor, custom frameworks) can submit incident logs and get a signed liability certificate.

Try it free: `npx causallayer-mcp`

Let us know what you think!

---

## 5. RegTech Association / AI Australia Demo Pitch

**Event:** Next available showcase or roundtable.
**Pitch:**
"CausalLayer: Solving the CPS 230 AI Liability Gap."
As APRA enforces CPS 230, financial institutions are struggling to quantify the operational risk of autonomous AI. We will demonstrate a live, multi-agent failure scenario where CausalLayer's deterministic engine instantly calculates fault and issues an insurance-grade, cryptographically anchored liability certificate. We will also show how our open-source MCP edge-proxy strips PII before data ever leaves the bank's environment.

---

## 6. Cloudflare Blog Guest Pitch

**To:** Cloudflare Developer Relations
**Subject:** Guest post: Building a paid, edge-guarded MCP server with Workers and Stripe

Hi team,

We recently built the official MCP server for CausalLayer (an AI liability engine) entirely on Cloudflare Workers.

We used the `McpAgent` pattern, but we had to solve two hard problems that I think the Cloudflare community would love to read about:
1. **Edge Guardrails:** Running regex PII-scanners in the Worker to block sensitive data *before* it hits the upstream API.
2. **Hybrid Billing:** Implementing a Stripe prepaid-credit ledger (via KV) for enterprise tenants, running side-by-side with the `x402` stablecoin protocol for indie developers.

I've written up the architecture and open-sourced the repo. Would you be interested in a guest post or case study on the Cloudflare Developer blog showing how to monetize MCP servers at the edge?

Best,
[Your Name]
