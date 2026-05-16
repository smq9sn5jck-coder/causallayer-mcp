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

## Carried over (already DONE in earlier phases)
- [x] Worker deployed live with CORS at `causallayer-mcp-demo.zykm9qkk7j.workers.dev`
- [x] Public GitHub repo with topics, badges, SECURITY.md, FUNDING.yml, CITATION.cff, OpenAPI, .well-known/mcp.json
- [x] v0.2.0 GitHub Release tagged + Atom feed live
- [x] Published to official MCP Registry (`io.github.smq9sn5jck-cloud/causallayer-mcp`)
- [x] LAUNCH.md v1 with 30 prefilled submission URLs
- [x] smithery.yaml in repo root
- [x] llms.txt + ai.txt + robots.txt in landing page public dir
