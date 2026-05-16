# Distribution Gaps — surfaces not covered in v1

This file is the supplement to `LAUNCH.md`. It covers every additional free findability surface we hadn't yet hit. Most are one-tap from a phone; a few have already been fired automatically (marked **DONE-AUTO**).

---

## Already fired (autonomous, no action needed)

| Surface | Status | Detail |
|---|---|---|
| **Software Heritage** archive | **DONE-AUTO** (request id 2333003) | Permanent archival of the GitHub repo on the public scientific software ledger; gives a citable SWHID. Live page once the crawler runs: `https://archive.softwareheritage.org/browse/origin/?origin_url=https://github.com/smq9sn5jck-coder/causallayer-mcp` |
| **IndexNow fan-out** (Bing/Yandex/Seznam/Naver) | **DONE-AUTO** (HTTP 202) | Six core URLs pushed: `/`, `/sitemap.xml`, `/llms.txt`, `/ai.txt`, `/.well-known/mcp.json`, `/robots.txt`. Key file deployed at `https://faultkey.pages.dev/<KEY>.txt` |
| **Internet Archive Wayback** snapshot of landing page | **DONE-AUTO** | https://web.archive.org/web/20260516162928/https://faultkey.pages.dev/ |
| **Internet Archive Wayback** of GitHub repo | **DONE-AUTO** (302 → archived) | https://web.archive.org/web/2*/https://github.com/smq9sn5jck-coder/causallayer-mcp |
| **MCP Registry** | DONE prior session | `io.github.smq9sn5jck-cloud/causallayer-mcp` v0.2.0. *Note: `websiteUrl` field in registry still shows old `faultkey.com`. Re-publish requires the original publishing GitHub account (`smq9sn5jck-cloud`); the soft fix is a one-line CNAME in Cloudflare DNS to redirect `faultkey.com → faultkey.pages.dev`.* |

---

## High-ROI gaps remaining (one-tap from phone)

### Tier A — MCP-ecosystem aggregators we missed

| Surface | What it gets you | Open |
|---|---|---|
| **Cline MCP Marketplace** (one-click install for ~5M Cline users) | Highest single-channel install volume in the MCP ecosystem | [New issue](https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml&title=Add%20FaultKey%20%C2%B7%20CausalLayer%20%E2%80%94%20deterministic%20AI-liability%20MCP%20%28signed%2C%20Bitcoin-anchored%20fault%20split%29) |
| **mcp.run** registry (Dylibso) | Cross-language MCP runtime; their registry surfaces remote MCPs to Cursor + others | [Submit form](https://www.mcp.run/registry) — paste GitHub URL + workers.dev MCP endpoint |
| **Smithery.ai re-trigger** | Auto-pulls from official registry; if not listed in 48h, manual nudge | [Search query](https://smithery.ai/search?q=causallayer) — if 0 results, [open an issue](https://github.com/smithery-ai/smithery/issues/new) referencing registry ID `io.github.smq9sn5jck-cloud/causallayer-mcp` |
| **Continue.dev MCP catalog** | Continue is a major VS Code/JetBrains AI plugin with MCP support | [Open PR](https://github.com/continuedev/continue/pulls) → add to `extensions/mcp-servers.md` |
| **Block (Goose) MCP support** | Goose is Block's open-source AI agent; remote MCPs are first-class | [Open issue](https://github.com/block/goose/issues/new) — add to extensions list |

### Tier B — General AI-tool aggregators

| Surface | What it gets you | Open |
|---|---|---|
| **AlternativeTo.net** (AI Tools category) | Search-friendly + crowd-sourced; high domain authority | [Submit](https://alternativeto.net/software/new-application/) |
| **There's An AI For That** (theresanaiforthat.com) | Highest-traffic AI-tool directory | [Submit](https://theresanaiforthat.com/submit/) |
| **AItoolnet** | Free AI directory; auto-syndicates to dozens of mirrors | [Submit](https://www.aitoolnet.com/submit/) |
| **AllThingsAI** | Curated AI-tool directory | [Submit](https://allthingsai.com/submit) |
| **Toolify.ai** | Major AI directory | [Submit](https://www.toolify.ai/submit-tool) |
| **FutureTools.io** | Matt Wolfe's directory | [Submit](https://www.futuretools.io/submit-a-tool) |
| **AI Tools Journal** | Newsletter + site; reaches AI-curious audiences | [Submit](https://aitoolsjournal.com/submit-tool) |
| **Toolfolio** | Niche AI directory | [Submit](https://toolfolio.com/submit) |

### Tier C — Developer/technical aggregators we missed

| Surface | What it gets you | Open |
|---|---|---|
| **Lobste.rs** | High-signal HN alternative; needs invite to post | Find an inviter, then [submit](https://lobste.rs/stories/new) with tag `ai`/`crypto` |
| **Tildes.net** | Reddit alternative, civil/technical | [Submit](https://tildes.net/~comp.new) |
| **dev.to** | Already in LAUNCH_POSTS.md §8 | (dev.to deep-dive copy ready) |
| **Hashnode** | Mirror of dev.to post | [Write](https://hashnode.com/write) — paste the dev.to body |
| **Indie Hackers** | Founder/builder community; "Ship It" forum | [Post](https://www.indiehackers.com/post/new) → "Show IH" tag |
| **HackerNoon** | Submit a column; SEO-strong | [Submit](https://hackernoon.com/submit) |
| **Substack — "Build in Public"** | Newsletter pool | [Cross-post](https://substack.com/) |
| **Awesome Selfhosted / Awesome AI Safety** lists | Same playbook as MCP awesome lists | [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) (already opened in LAUNCH.md tier 3) — also try [openai/awesome-prompts](https://github.com/openai/awesome-prompts) |

### Tier D — AI-search citation surfaces (the real long-tail)

LLMs (ChatGPT, Perplexity, Claude search, Phind) cite from a small pool of crawl sources. We already have `llms.txt` + `ai.txt` + structured data; the remaining moves:

| Surface | What it gets you | Open |
|---|---|---|
| **Perplexity Pages** | Author a Perplexity Page on "Deterministic AI liability" → cited inline by Perplexity for related queries | [Create](https://www.perplexity.ai/pages) |
| **Wikipedia draft page** | "Deterministic AI liability attribution" — even a stub gets indexed by ChatGPT/Claude | [Create draft](https://en.wikipedia.org/wiki/Wikipedia:Articles_for_creation) — needs an autoconfirmed account |
| **Wikidata entity** | Add FaultKey as a Wikidata Q-item; LLMs heavily prefer Wikidata for entity grounding | [Create item](https://www.wikidata.org/wiki/Special:NewItem) |
| **Crunchbase company page** | Cited by Perplexity + ChatGPT for company-info queries | [Create](https://www.crunchbase.com/) |
| **G2 listing** | Software-review site; cited heavily by LLMs in evaluation queries | [List on G2](https://sell.g2.com/) |
| **Trustpilot business page** | Trust signal + crawled by LLMs | [Claim](https://www.trustpilot.com/business/onboarding) |
| **OpenSSF Scorecard badge** | Adds a security-posture signal that LLM coding agents weight heavily | [Add Action](https://github.com/ossf/scorecard-action) — push to repo |
| **OpenAPI on Swagger Hub** | Swagger Hub's OpenAPI registry is crawled by GPT-Builder + Claude tools | Upload [`openapi.yaml`](./openapi.yaml) at https://app.swaggerhub.com/ |

### Tier E — RSS / Atom / federated discovery

| Surface | What it gets you | Open |
|---|---|---|
| **Atom feed** at `https://github.com/smq9sn5jck-coder/causallayer-mcp/releases.atom` | Already live; submit to RSS aggregators below |
| **Feedly** | Submit feed | [Add to Feedly](https://feedly.com/i/discover) — paste the releases.atom URL |
| **Inoreader** | Same | [Add](https://www.inoreader.com/?add_feed=https://github.com/smq9sn5jck-coder/causallayer-mcp/releases.atom) |
| **NewsBlur** | Same | [Add](https://www.newsblur.com/?url=https://github.com/smq9sn5jck-coder/causallayer-mcp/releases.atom) |
| **GitHub Sponsors profile** | Adds a discovery surface even if no sponsorship is sought | [Set up](https://github.com/sponsors) |

### Tier F — Regulatory / compliance / academic surfaces (highest signal-to-noise for our buyer pool)

| Surface | What it gets you | Open |
|---|---|---|
| **NIST AI RMF use-case repository** | Cited by every AI-governance team | [Submit](https://airc.nist.gov/AI_RMF_Knowledge_Base/Use_Cases) |
| **OECD AI Policy Observatory tools registry** | Cited by gov + regulators | [Submit](https://oecd.ai/en/wonk/national-policies-2) |
| **CSIRO N4 / CSIRO AI ethics use-case database (AU)** | Australia's top science agency catalogues AI tools | [Submit](https://www.csiro.au/en/research/technology-space/ai/Ethics-of-AI) |
| **Tech Council Australia** | AU industry body; member showcase | [Apply](https://techcouncil.com.au/membership/) |
| **APRA Public Consultations** — submit a written response when CPS 230 has open comments | Direct visibility to APRA staff | [APRA consultations](https://www.apra.gov.au/news-and-publications/consultations) |
| **Lloyd's of London Lab** | Innovation accelerator; AI-liability is on their 2026 roadmap | [Apply](https://www.lloyds.com/about-lloyds/innovation/lloyds-lab) |
| **FCA Innovation Hub (UK)** | UK regulator innovation pipeline — even an enquiry email creates a paper trail | [Contact](https://www.fca.org.uk/firms/innovation) |
| **arXiv** | Drop a 2-page whitepaper on the closed-form scoring math (no LLM in scoring); arXiv is the #1 LLM citation source | [Submit](https://arxiv.org/submit) — needs an endorsement (academic email or a friendly endorser) |
| **Zenodo (CERN)** | Mint a DOI for the OSS wrapper; gives a citable artefact that arXiv/papers reference | [Upload](https://zenodo.org/uploads/new) |

### Tier G — Newsletter / podcast outreach (high-leverage for the AI-governance buyer)

| Outlet | Audience | Pitch URL |
|---|---|---|
| **Last Week in AI (Skynet Today)** | AI-policy + technical | [Tip line](https://lastweekinai.com/contact/) |
| **The Algorithm (MIT Tech Review)** | AI-policy mainstream | [Tip](mailto:tips@technologyreview.com) |
| **Import AI (Jack Clark)** | AI-governance/safety; ex-OpenAI | [Tip](mailto:jack@jack-clark.net) |
| **Stratechery / Sharp Tech** | AI-strategy | [Tip](mailto:tips@stratechery.com) |
| **Latent Space (swyx)** | Most influential AI-engineering podcast/newsletter | [Tip](mailto:swyx@latent.space) |
| **AI Snake Oil (Princeton)** | Critical AI-policy academic | [Contact](https://www.aisnakeoil.com/about) |
| **Unsupervised Learning (Daniel Miessler)** | AI + security crossover (your exact buyer) | [Contact](https://danielmiessler.com/about) |

---

## Quick math on what each gap is worth

The honest priority stack, ranked by expected installs/leads per hour-of-tap:

1. **Cline marketplace** — 5M user base, one-click install. Tap value: very high.
2. **Perplexity Pages + Wikidata** — these are how LLMs find out you exist. Tap value: high (LLM citation moat).
3. **Awesome-list PRs** (already prefilled in LAUNCH.md tier 3, still pending tap) — one-time, permanent SEO + dev mind-share.
4. **arXiv whitepaper** — only one in the entire stack that gives academic credibility. Worth writing a 2-page note. Needs an endorser.
5. **NIST AI RMF + APRA + Lloyd's Lab** — only one or two replies needed; they're the actual buyers.
6. Everything else is incremental.

---

## Brutal honest read on the crawl-state-zero finding

GitHub repo: 0 views, 0 stars, 0 referrers in 14 days. **This is normal and expected.** Repos do not pull traffic spontaneously — they pull traffic from the launch posts that haven't yet been fired. The only thing that drives the first-100-stars is the HN/Reddit/X day. Until those go, the metrics will read zero.

The MCP Registry entry is live and queryable; Smithery's auto-crawl hasn't surfaced us yet (404 on direct lookup), but their search endpoint shows partial matches. Re-checking 48h after launch is the right move.

---

## Recommended action stack right now (Brisbane evening)

If you have 10 minutes total:

1. Tap **Cline marketplace** issue (link above) — fills itself in from the template.
2. Tap **mcp.run** registry submit — paste GitHub URL.
3. Tap the four **awesome-list PRs** in `LAUNCH.md` Tier 3.

If you have 30 minutes:

4. Above + tap the four MCP-marketplace submissions in `LAUNCH.md` Tier 2 (mcp.so, Glama, MCP Hunt, PulseMCP).
5. Tap **Wikidata** to register `FaultKey` and `CausalLayer` as Q-items (Wikidata is the LLM citation moat).

If you have 2 hours:

6. Above + write a 2-page arXiv-style whitepaper on the closed-form scoring math; upload to **Zenodo** to mint a DOI; queue **arXiv** for endorsement.
7. Above + ship the **Perplexity Page** + **Crunchbase** + **G2** listings.

Tomorrow morning Brisbane time: fire the launch posts in `LAUNCH_POSTS.md` against US-morning audiences (8am US ET ≈ 10pm Wed Brisbane).
