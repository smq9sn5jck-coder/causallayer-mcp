# FaultKey · CausalLayer — Launch Posts (copy-paste ready)

> Brisbane, UTC+10. Pages live at https://faultkey.pages.dev. Worker live at https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp. Repo at https://github.com/smq9sn5jck-coder/causallayer-mcp. Registry ID `io.github.smq9sn5jck-cloud/causallayer-mcp`.

**Fire order (Tuesday or Wednesday, US morning ≈ Brisbane Wed/Thu 10pm–midnight):**
1. Show HN at 8:00am US ET (Wed ~10pm Brisbane)
2. r/mcp + r/LocalLLaMA + r/ClaudeAI within 30 min of HN going up
3. X thread within 60 min of HN going up
4. LinkedIn 2 hours later (different audience, different time)
5. Mastodon (fosstodon.org) and dev.to next morning
6. Outreach DMs/emails the same day, before 5pm AEST

Don't post all at once everywhere — spread across ~24h so each can breathe.

---

## 1. Show HN (Hacker News)

**Title (exactly 80 chars or less; HN strips emoji):**
```
Show HN: FaultKey – deterministic AI-liability attribution (signed, no LLMs)
```

**URL field:**
```
https://faultkey.pages.dev
```

**First comment (paste immediately after submitting — HN expects the author to comment with context):**

```
Author here. Quick context.

Every AI incident gets one signed receipt – a CausalCertificateV1 – with a
deterministic vendor/deployer/user fault split. The scoring path has no LLMs
in it; it's closed-form (Ed25519 over a Merkle root, anchored to Bitcoin
via OpenTimestamps). Same input → byte-identical output, forever.

The point isn't another LLM eval framework. The point is that when an AI
system causes harm, an insurer or a regulator needs to know who pays, and
they need to know it from a number that doesn't change next week because
someone re-trained a judge model.

Live MCP server (no install, public demo):
  https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp

Try the handshake:
  curl -sS https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz

Tools:
  submit_incident      → returns the signed certificate + fault split
  verify_certificate   → verifies signature + Merkle path + OTS anchor
  get_anchor_status    → latest Bitcoin batch status
  query_issuer_registry → public Ed25519 issuer key lookup

Source (Apache-2.0, the MCP wrapper):
  https://github.com/smq9sn5jck-coder/causallayer-mcp

Already in the official MCP Registry as
io.github.smq9sn5jck-cloud/causallayer-mcp.

Targeted at AI-insurance underwriters, APRA CPS 230, EU AI Act Article 12,
ISO/IEC 42001, NIST AI RMF. Built in Brisbane.

Open to brutal feedback, especially from anyone who has actually had to
argue causal attribution in front of a regulator or an underwriter.
```

**Submit URL:** https://news.ycombinator.com/submit (paste the title and URL above).

---

## 2. Reddit – r/mcp

**Title:**
```
FaultKey · CausalLayer — deterministic AI-liability MCP server (signed, Bitcoin-anchored receipts; live demo)
```

**Body:**

```
Live demo, no install: https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp

I built a deterministic AI-liability MCP server. Every incident → a signed,
Bitcoin-anchored CausalCertificateV1 receipt with a vendor/deployer/user
fault split. Closed-form scoring (Ed25519 + Merkle + OpenTimestamps),
byte-identical reproducibility, no LLMs in the scoring path.

Tools:
- `submit_incident` — submit an AI incident, returns signed certificate + fault split (50 credits)
- `verify_certificate` — verify signature + Merkle path + OTS anchor (1 credit)
- `get_anchor_status` — latest Bitcoin anchor batch status (free)
- `query_issuer_registry` — public Ed25519 issuer key lookup (free)

Source (Apache-2.0): https://github.com/smq9sn5jck-coder/causallayer-mcp
Homepage: https://faultkey.pages.dev
Official MCP Registry: `io.github.smq9sn5jck-cloud/causallayer-mcp`

Built on Cloudflare Workers, Streamable HTTP transport, free demo. Try the
handshake yourself:

    curl -sS https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz

Looking for feedback from anyone working on AI insurance, APRA CPS 230,
EU AI Act, ISO/IEC 42001, or NIST AI RMF.
```

---

## 3. Reddit – r/LocalLLaMA

**Title:**
```
A non-LLM MCP server for AI liability — deterministic vendor/deployer/user fault split, signed and Bitcoin-anchored
```

**Body:**

```
Most AI-eval and AI-judge tooling I see in this sub uses an LLM somewhere
in the scoring path. That's fine for benchmarks. It's useless if your
scoring output ever has to survive a court, an APRA review, or an
insurance claim.

So I built the opposite: a deterministic, no-LLM, no-ML scoring layer
exposed as an MCP server. Closed-form math (Ed25519 over a Merkle root,
anchored to the Bitcoin chain via OpenTimestamps). Same input → same
output, byte for byte, forever. The certificate is signed by an issuer
key that's published on a public registry.

Live demo (no install): https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp
Source (Apache-2.0): https://github.com/smq9sn5jck-coder/causallayer-mcp
Homepage: https://faultkey.pages.dev
MCP Registry: `io.github.smq9sn5jck-cloud/causallayer-mcp`

Tools:
- `submit_incident`     → CausalCertificateV1 with fault split
- `verify_certificate`  → signature + Merkle + OTS verification
- `get_anchor_status`   → Bitcoin batch status
- `query_issuer_registry` → Ed25519 key lookup

Why post here: I'd genuinely like adversarial review from people who
actually run local models and have an opinion on what "deterministic"
should and shouldn't mean. Tear it apart.

    curl -sS https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz
```

---

## 4. Reddit – r/ClaudeAI

**Title:**
```
New MCP server for Claude: deterministic AI-liability receipts (works in Claude Desktop today)
```

**Body:**

```
Just published an MCP server that gives Claude (or any MCP client) the
ability to issue and verify deterministic AI-liability certificates.

If your Claude session causes harm — bad advice, hallucinated diagnosis,
faulty code that ships — the server returns a signed CausalCertificateV1
with a vendor/deployer/user fault split. Bitcoin-anchored via
OpenTimestamps so the receipt can't be silently rewritten.

Add to Claude Desktop in 30 seconds (no install — remote MCP):

In `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows),
add the server under `mcpServers`. Then ask Claude to call
`submit_incident`, `verify_certificate`, `get_anchor_status`, or
`query_issuer_registry`.

Live endpoint: https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp
Source (Apache-2.0): https://github.com/smq9sn5jck-coder/causallayer-mcp
Homepage: https://faultkey.pages.dev
Registry: `io.github.smq9sn5jck-cloud/causallayer-mcp`

Free demo tier (50/1/0/0 credits per tool). Looking for early users in
AI insurance, regtech, and anyone running Claude in a regulated
environment.
```

---

## 5. X / Twitter — long-form thread (10 tweets)

**Attach the hero image (`/home/ubuntu/webdev-static-assets/faultkey-hero-certificate.png`) to tweet 1.**

```
[1/10]
Shipping FaultKey today.

When an AI causes harm, who pays?

Right now: lawyers, six months, $250k of expert testimony, and the answer
still depends on which expert you hired.

We replaced that with one signed number.

https://faultkey.pages.dev
```

```
[2/10]
Every AI incident → one CausalCertificateV1.

It contains:
• vendor fault %
• deployer fault %
• user fault %
• an Ed25519 signature
• a Merkle root
• a Bitcoin block height (via OpenTimestamps)

Same input → same output, byte for byte. Forever.
```

```
[3/10]
No LLMs in the scoring path.

Every "AI judge" tool I tested put a model somewhere in the loop. That's
fine for benchmarks. It collapses the moment a regulator asks
"why did this number change between Tuesday and Friday".

Closed-form math doesn't drift. That's the whole pitch.
```

```
[4/10]
Built as an MCP server so any Claude/Cursor/Copilot agent can call it
mid-conversation:

submit_incident  → signed receipt
verify_certificate → cryptographic verify
get_anchor_status  → Bitcoin batch status
query_issuer_registry → public key lookup

Already in the official MCP Registry.
```

```
[5/10]
Live demo, no install:

curl -sS https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz

Or add it to Claude Desktop in 30 seconds via the config file.

Free demo tier. No card. Worker-hosted on Cloudflare's edge so latency
is low everywhere.
```

```
[6/10]
Why now?

EU AI Act Article 12 (logging), ISO/IEC 42001 (AI MS), APRA CPS 230
(operational resilience for Australian banks/insurers), and the NIST AI
RMF all require a defensible, reproducible audit trail.

None of them tell you HOW to produce one. FaultKey does.
```

```
[7/10]
Insurers care because the cert collapses 80% of the discovery cost in an
AI claim. Regulators care because the math is the same on every desk.
Deployers care because they can finally prove "we did our part".

The certificate is the artefact everyone agrees is true.
```

```
[8/10]
What's open: the MCP wrapper (Apache-2.0).
What's not: the engine math.

That's deliberate. The wrapper is the on-ramp. The engine is the moat.

https://github.com/smq9sn5jck-coder/causallayer-mcp
```

```
[9/10]
Built solo, in Brisbane, against a stack of insurance and AI-governance
papers. Targeting Lloyd's syndicates, Munich Re's AI desk, APRA-regulated
firms, and anyone underwriting AI risk in 2026.

If that's you — DMs are open.
```

```
[10/10]
The full landing, the live demo, the GitHub, the registry listing:

https://faultkey.pages.dev

If you've ever had to argue causal attribution in front of a regulator,
I want to hear how badly I got it wrong.

🔁 if useful — it helps the right people find this.
```

---

## 6. LinkedIn (long-form post — APRA / regulator / insurer audience)

**Title (post headline):**
```
We just made AI liability cryptographically provable. Here's why APRA-regulated firms should care.
```

**Body:**

```
Today I'm releasing FaultKey — the first deterministic AI-liability
attribution server.

Every AI incident now produces a single artefact: a signed,
Bitcoin-anchored CausalCertificateV1 with a vendor / deployer / user
fault split. The scoring path is closed-form mathematics: Ed25519
signature over a Merkle root, time-locked to a Bitcoin block via
OpenTimestamps. There is no language model in the scoring path. Same
input produces byte-identical output, forever.

Why this matters for APRA-regulated firms.

CPS 230 (Operational Risk Management) takes effect in July 2026 and
requires a defensible audit trail for every material operational
incident, including AI-driven ones. The standard tells you the bar.
It does not tell you how to produce evidence that survives a regulator's
review three years later.

Today the standard play is:
- a vendor incident report (one perspective)
- a deployer incident report (another perspective)
- a forensics consultancy ($150–500k) to reconcile them
- months of legal back-and-forth
- an answer that is still effectively "whichever expert was louder"

FaultKey replaces that with one number, generated in seconds, that
every desk in the chain can independently verify with a single CLI call.

The same artefact maps cleanly to:
- EU AI Act Article 12 (logging requirements)
- ISO/IEC 42001 (AI management systems)
- NIST AI RMF Govern + Manage functions
- Lloyd's of London emerging AI-liability wordings

Live demo (no install, free tier):
https://faultkey.pages.dev

Source (Apache-2.0):
https://github.com/smq9sn5jck-coder/causallayer-mcp

If you sit on an operational risk, AI governance, or claims team at a
bank, insurer, or super fund — particularly in Australia — I'd be glad
to walk you through it. DMs open. Brisbane-based.

#APRA #CPS230 #AIGovernance #EUAIAct #ISO42001 #InsurTech #RegTech
#OperationalRisk #AIInsurance #Cryptography
```

---

## 7. Mastodon (fosstodon.org — developer / FOSS audience)

**Single toot, ≤ 500 chars:**

```
Just shipped FaultKey: a deterministic AI-liability MCP server.

Every AI incident → one signed, Bitcoin-anchored CausalCertificateV1 with
a vendor/deployer/user fault split. Closed-form math, no LLMs in the
scoring path, byte-identical reproducibility.

Live demo (no install): https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp
Apache-2.0: https://github.com/smq9sn5jck-coder/causallayer-mcp

#MCP #AISafety #FOSS #Cryptography
```

**Optional follow-up toot:**

```
Why deterministic? Because the moment you put an LLM in the scoring path
you've recreated the problem you were trying to solve: a number that
drifts every retraining cycle.

Closed-form Ed25519 + Merkle + OpenTimestamps. Same input → same output,
byte for byte, forever.

https://faultkey.pages.dev
```

---

## 8. dev.to / Hashnode — technical deep-dive post

**Title:**
```
Building a deterministic AI-liability MCP server on Cloudflare Workers
```

**Tags:** `mcp`, `ai`, `cryptography`, `cloudflare`, `typescript`

**Body:** *(markdown)*

````markdown
> TL;DR: I built FaultKey, a Model Context Protocol (MCP) server that
> produces signed, Bitcoin-anchored AI-liability certificates with a
> deterministic vendor/deployer/user fault split. No LLMs in the scoring
> path. Live, free, Apache-2.0 MCP wrapper. Try the curl below.

```bash
curl -sS https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz
```

## The problem

Every AI-evaluation framework I looked at had an LLM somewhere in the
scoring path. That is acceptable for benchmarks. It is unacceptable for
anything that has to survive an APRA, MAS, FCA, or EU AI Act review three
years from now, because the output drifts on every retrain.

I wanted a number that:

1. **Doesn't drift.** Same input → byte-identical output, forever.
2. **Doesn't trust me.** A third party can verify it cryptographically.
3. **Doesn't need a vendor.** The math is closed-form and inspectable.
4. **Plugs into agents.** Any MCP-aware client (Claude, Cursor, Copilot,
   custom agents) can call it.

## The architecture

- **Edge runtime:** Cloudflare Workers (TypeScript). Single-region cold
  starts under 5 ms; the JSON-RPC MCP handshake fits comfortably under
  the 50 ms CPU limit.
- **State:** KV for issuer keys + idempotency, Durable Object for batch
  anchor scheduling.
- **Crypto:** Ed25519 signature over a SHA-256 Merkle root of the
  incident payload. The Merkle root is then submitted to OpenTimestamps,
  which time-locks it into the Bitcoin chain (typically within ~1 hour).
- **Transport:** Streamable HTTP (the new MCP transport) — works in
  Claude Desktop, Cursor, the Anthropic SDK, and the Python MCP SDK with
  zero install.

## The four tools

| Tool | Purpose | Cost |
|---|---|---|
| `submit_incident` | Generate signed CausalCertificateV1 with fault split | 50 |
| `verify_certificate` | Verify signature + Merkle path + OTS anchor | 1 |
| `get_anchor_status` | Inspect latest Bitcoin batch | 0 |
| `query_issuer_registry` | Resolve issuer Ed25519 public keys | 0 |

## Why MCP, why not REST

MCP is the only agent-native protocol with momentum right now. By
shipping as an MCP server first, every Claude Desktop user, every Cursor
user, every custom agent built on the Python SDK can call FaultKey
mid-conversation. That's a much higher-value distribution surface than
"yet another REST API behind a SaaS dashboard".

The MCP wrapper is open-source under Apache-2.0:

```
https://github.com/smq9sn5jck-coder/causallayer-mcp
```

The engine math is not. That is deliberate — the wrapper is the on-ramp,
the engine is the differentiator.

## What I learned

- **Deterministic is harder than it sounds.** Anywhere you have a JSON
  serializer, a floating-point operation, or a map/dict iteration order,
  determinism leaks. The whole scoring path is integer math over a
  canonical CBOR encoding.
- **OpenTimestamps is criminally underused.** It is a free, public,
  Bitcoin-anchored timestamping service that nobody outside the OTS
  community talks about. It is exactly the right primitive for
  regulator-grade evidence.
- **The MCP Registry works.** I published `io.github.smq9sn5jck-cloud/
  causallayer-mcp` and Smithery / PulseMCP / Glama auto-pulled the
  metadata within 24 hours.

## Try it

```bash
# Health
curl -sS https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz

# Add to Claude Desktop config:
# ~/Library/Application Support/Claude/claude_desktop_config.json
```

Source: <https://github.com/smq9sn5jck-coder/causallayer-mcp>
Homepage: <https://faultkey.pages.dev>
Registry: `io.github.smq9sn5jck-cloud/causallayer-mcp`

If you work in AI governance, regtech, or AI insurance — particularly
under APRA CPS 230, EU AI Act, ISO/IEC 42001, or NIST AI RMF — I'd love
adversarial review.
````

---

## 9. Bluesky / Threads (single-skeet adaptations)

**Bluesky (300 char limit):**
```
Shipped FaultKey: a deterministic AI-liability MCP server.

Every AI incident → one signed, Bitcoin-anchored receipt with a vendor/
deployer/user fault split. No LLMs in the scoring path.

Live, free, Apache-2.0:
https://faultkey.pages.dev
```

**Threads:**
```
Made AI liability cryptographically provable.

Every AI incident now → one signed, deterministic receipt. Vendor /
deployer / user fault split. No LLMs in the scoring path. Bitcoin-
anchored.

Live demo, free tier, no install:
https://faultkey.pages.dev

Built solo in Brisbane.
```

---

## 10. Cloudflare Community / Discord post

**Title:**
```
Show & Tell: FaultKey — a deterministic AI-liability MCP server on Cloudflare Workers
```

**Body:**
```
G'day from Brisbane.

Just shipped what I think is the first deterministic AI-liability MCP
server, fully hosted on Cloudflare Workers + KV + Durable Objects. No
external compute, no model in the scoring path, ~5 ms cold start at the
edge.

Live demo (free tier):
  https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp

Source (Apache-2.0):
  https://github.com/smq9sn5jck-coder/causallayer-mcp

Homepage (also on Cloudflare Pages free tier):
  https://faultkey.pages.dev

The whole thing is a working demo of how far Workers + KV + DO will get
you for an AI-governance product. JSON-RPC handshake fits under the
50 ms CPU limit, Streamable HTTP transport works out of the box, and
the OpenTimestamps batching is handled in a Durable Object alarm.

Happy to answer any questions about the architecture or the wrangler
config.
```

---

## 11. Outreach scripts (cold but personalised)

### 11A. AI insurer / underwriter (Lloyd's, Munich Re, Swiss Re AI desks)

**Subject:**
```
A signed, deterministic fault split for AI claims
```

**Body:**
```
Hi {{First name}},

Saw your work on {{specific syndicate / paper / panel — fill in}}.
Wanted to send this directly because it sits squarely in the
attribution problem you've been describing.

I shipped FaultKey today. Every AI incident → a single signed
CausalCertificateV1 with a vendor / deployer / user fault split.
Closed-form math, Ed25519 over a Merkle root, anchored to Bitcoin via
OpenTimestamps. Byte-identical reproducibility, forever. No LLMs in
the scoring path.

The point is the artefact: when a claim hits your desk, instead of
{{vendor report + deployer report + 6 months of expert reconciliation}},
you get one number that any forensic reviewer can independently verify
with one CLI call.

Demo (no install, free):
  https://faultkey.pages.dev

If you've got 15 minutes next week, I'd like to show you the
underwriting workflow. I'm in Brisbane (UTC+10), happy to do
{{their timezone}} early or late.

Best,
{{Your name}}
```

### 11B. APRA-regulated firm — operational risk / AI governance lead

**Subject:**
```
CPS 230 AI-incident evidence — one signed receipt
```

**Body:**
```
Hi {{First name}},

CPS 230 lands July 2026. The standard requires a defensible audit trail
for every material AI-driven operational incident, but doesn't specify
the evidence format. Right now the default play is two incident reports
plus a forensics retainer.

I built FaultKey to replace that with one signed, deterministic
artefact. CausalCertificateV1: vendor/deployer/user fault split,
Ed25519 + Merkle root + Bitcoin anchor. Same input → byte-identical
output. Maps cleanly to CPS 230, EU AI Act Article 12, ISO/IEC 42001,
NIST AI RMF.

Live demo, free tier:
  https://faultkey.pages.dev

Apache-2.0 MCP wrapper if your team wants to inspect it:
  https://github.com/smq9sn5jck-coder/causallayer-mcp

Brisbane-based. Happy to do a 20-minute walkthrough with your op-risk
or model-risk team. No deck, just the live system.

Cheers,
{{Your name}}
```

### 11C. RegTech Association Australia member

**Subject:**
```
Open-source AI-liability primitive for the regtech stack
```

**Body:**
```
Hi {{First name}},

Wanted to flag this in case it's useful for your members:

FaultKey ships an open MCP server that produces deterministic,
cryptographically-signed AI-liability certificates. Every incident →
one CausalCertificateV1 with a vendor/deployer/user fault split,
anchored to Bitcoin via OpenTimestamps. Apache-2.0.

It's targeted at the gap CPS 230 + EU AI Act + ISO/IEC 42001 leave
open: how do you produce evidence that survives multi-year regulator
review? Closed-form math, no LLM drift, third-party verifiable.

Live, free demo:
  https://faultkey.pages.dev

I'm Brisbane-based and happy to present at the next member meet-up if
there's interest. Even a 5-minute lightning slot.

Best,
{{Your name}}
```

### 11D. QUT / UQ / Brisbane AI-safety researcher

**Subject:**
```
A deterministic alternative to LLM-as-judge — interested in adversarial review
```

**Body:**
```
Hi {{First name}},

Read your paper on {{specific paper / talk / preprint}}. Thought you
might be interested in tearing apart this:

FaultKey is a deterministic, no-LLM scoring layer for AI-liability
attribution. The scoring path is closed-form (Ed25519 over a Merkle
root, OpenTimestamps anchor). Same input → byte-identical output.

I'd genuinely like adversarial review from someone who works on AI
safety formally. The MCP wrapper is Apache-2.0 and the math is
documented in the repo:
  https://github.com/smq9sn5jck-coder/causallayer-mcp

Live demo:
  https://faultkey.pages.dev

I'm in Brisbane. Coffee on me if you've got 30 minutes.

Cheers,
{{Your name}}
```

### 11E. Generic VC / angel (defensive, only if asked)

**Subject:**
```
FaultKey — deterministic AI-liability primitive (live, OSS wrapper)
```

**Body:**
```
Hi {{First name}},

Quick note. I shipped FaultKey today: deterministic AI-liability
attribution as an MCP server. Every AI incident → one signed,
Bitcoin-anchored receipt with vendor/deployer/user fault split.
Closed-form math, no LLMs in the scoring path.

Wrapper is Apache-2.0. Engine math is closed (deliberate moat).
Already in the official MCP Registry. Hosted on Cloudflare Workers
free tier — unit economics are unusually good.

Live: https://faultkey.pages.dev
Repo: https://github.com/smq9sn5jck-coder/causallayer-mcp

Not raising right now. Sending in case the category is interesting —
APRA CPS 230, EU AI Act, AI-insurance underwriting. Brisbane-based.

{{Your name}}
```

---

## 12. Fire-order checklist (phone-friendly)

- [ ] **T+0:** Submit Show HN (title + URL above), paste the comment immediately.
- [ ] **T+5min:** Post in r/mcp.
- [ ] **T+15min:** Post in r/LocalLLaMA.
- [ ] **T+25min:** Post in r/ClaudeAI.
- [ ] **T+45min:** Fire X thread (10 tweets, hero image on tweet 1).
- [ ] **T+60min:** Toot on Mastodon (fosstodon.org).
- [ ] **T+90min:** Bluesky + Threads single-skeet.
- [ ] **T+2h:** Publish dev.to deep-dive.
- [ ] **T+3h:** LinkedIn long-form post (different audience, different time).
- [ ] **T+4h:** Cloudflare Community + Discord show & tell.
- [ ] **T+24h:** Send 5–10 outreach emails (templates above) to specifically-named insurer/APRA/regtech leads.
- [ ] **Day 2 morning AEST:** Awesome-list PRs (4 prefilled URLs in LAUNCH.md tier 3) + mcp.so / Glama / MCP Hunt submissions (LAUNCH.md tier 2).
- [ ] **Day 2 afternoon AEST:** Bing Webmaster + Yandex Webmaster + IndexNow ping.

End of file.
