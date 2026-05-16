# FaultKey · Zero-cost launch track (no credit card)

> Resumed track after billing concern — every step below uses free tiers only and the existing Cloudflare auth.

## Phase 1 — Free hosting for the landing page (Cloudflare Pages, no card)
- [ ] Build production bundle of `/home/ubuntu/faultkey-landing`
- [ ] Deploy via `wrangler pages deploy` using the existing token
- [ ] Confirm `*.pages.dev` URL returns HTTP 200 with the Forensic-Document hero

## Phase 2 — GitHub Pages fallback (also free)
- [ ] Push static bundle to a `gh-pages` branch on causallayer-mcp
- [ ] Enable Pages from that branch
- [ ] Confirm fallback URL returns HTTP 200

## Phase 3 — Domain binding (one tap from your phone)
- [ ] Generate the exact Cloudflare DNS record(s) for `faultkey.com` apex → Pages

## Phase 4 — Launch posts (exact copy, ready to fire from phone)
- [ ] HN Show — Tue/Wed 8 am US ET
- [ ] r/mcp + r/LocalLLaMA + r/ClaudeAI
- [ ] X/Twitter long-form thread with the hero image
- [ ] LinkedIn AI-governance angle
- [ ] Mastodon (fosstodon.org)
- [ ] dev.to / hashnode technical post

## Phase 5 — Outreach scripts (cold but personalised)
- [ ] AI insurer / underwriter
- [ ] APRA / RegTech Australia
- [ ] Brisbane / QUT / UQ AI-safety angle

## Phase 6 — Bundle + deliver
- [ ] Update LAUNCH.md v2 in the public repo
- [ ] Phone-friendly checklist with one-tap links
- [ ] Final report

---

## Phase 7 — Crawl/visibility audit + remaining-angle hunt (post-launch)
- [ ] Pull Cloudflare Worker analytics (req count, bot vs human, by country)
- [ ] Pull Cloudflare Pages analytics for faultkey.pages.dev
- [ ] Pull GitHub repo traffic API (views, clones, referrers, popular paths)
- [ ] Verify MCP Registry listing is queryable + Smithery/Glama/PulseMCP crawl
- [ ] Check sitemap fetch evidence (bingbot, applebot, ddg, claudebot)
- [ ] Run IndexNow ping (stage key if needed)
- [ ] Hit every remaining free findability surface (Stack Overflow tag watch, OpenSSF, libraries.io, sourcegraph, Codeberg mirror, Software Heritage, alternativeto.net, AlternativeMCP, lobste.rs, Tildes, federated wikis, ProductHunt-style alts)
- [ ] Stage one-tap URLs for anything that requires user auth

---

## Carried over (already DONE in earlier phases)
- [x] Worker deployed live with CORS at `causallayer-mcp-demo.zykm9qkk7j.workers.dev`
- [x] Public GitHub repo with topics, badges, SECURITY.md, FUNDING.yml, CITATION.cff, OpenAPI, .well-known/mcp.json
- [x] v0.2.0 GitHub Release tagged + Atom feed live
- [x] Published to official MCP Registry (`io.github.smq9sn5jck-cloud/causallayer-mcp`)
- [x] LAUNCH.md v1 with 30 prefilled submission URLs
- [x] smithery.yaml in repo root
- [x] llms.txt + ai.txt + robots.txt in landing page public dir


## Phase 8 — Next steps queue (post mcp.faultkey.com bind, ranked by ROI)
- [ ] User: 4× workflow file paste (CI, CodeQL, Scorecard, dependabot.yml) — ~90s
- [ ] User: Apex DNS bind (faultkey.com → faultkey-pages) in Cloudflare dash — ~30s
- [ ] User: 3× awesome-list PR taps (punkpeye/wong2/appcypher) — ~60s
- [ ] User: Glama submission tap — unblocks punkpeye PR review — ~120s
- [ ] User: Cline marketplace issue submit — exposes to ~5M Cline users — ~60s
- [ ] User: 5 cold-outreach emails (APRA/insurer/regtech leads) — highest revenue ROI — ~30 min
- [ ] User: Show HN fire at peak window (Wed 8am US ET = Thu 1am Brisbane) — ~5 min
- [ ] User: Reddit + X + LinkedIn + dev.to staggered cascade — ~20 min
- [ ] Auto: npm publish CLI — needs npm 2FA token from user
- [ ] Auto: After Glama listing live, push badge update to PR


## Phase 9 — C5 build + visibility audit + Cloudflare maximisation
- [ ] Build interactive /try page on faultkey.pages.dev
- [ ] Form submits to https://mcp.faultkey.com/mcp via JSON-RPC
- [ ] Display the returned signed certificate inline (verifiable)
- [ ] Add /verify page that lets visitors paste a cert and re-verify it
- [ ] Build "embed widget" snippet visitors can drop into their own pages
- [ ] Audit visibility: list every surface NOT yet hit
- [ ] Cloudflare: enable Web Analytics on Pages
- [ ] Cloudflare: enable Email Routing (hello@faultkey.com → real inbox)
- [ ] Cloudflare: enable Turnstile to protect /try form
- [ ] Cloudflare: add Snippet for security headers (CSP, HSTS, X-Frame, etc.)
- [ ] Cloudflare: add Cache Rules for static assets
- [ ] Cloudflare: add Rate Limiting Rule on /mcp (free tier)
- [ ] Cloudflare: add R2 public bucket for whitepaper PDF
- [ ] Cloudflare: add Workers AI to summarise incidents in /try
- [ ] Cloudflare: add Browser Rendering for share-image generation
- [ ] Cloudflare: add Logpush to local R2 for audit trail
- [ ] Cloudflare: enable Bot Fight Mode (free)
