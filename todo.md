# FaultKey · Non-webpage distribution todo

## Phase 1 — GitHub repo SEO + discoverability
- [ ] Add SECURITY.md, FUNDING.yml, CITATION.cff
- [ ] Add README badges (license, MCP-compatible, Cloudflare, version)
- [ ] Add a social-preview image (the hero certificate)
- [ ] Create v0.2.0 GitHub Release with release notes
- [ ] Publish OPENAPI.yaml (so AI/MCP crawlers can ingest it)
- [ ] Add .well-known/mcp.json pointer (so any MCP-aware crawler discovers us)

## Phase 2 — Official MCP Registry (registry.modelcontextprotocol.io)
- [ ] Validate server.json against schema
- [ ] Run `mcp-publisher publish` and verify listing

## Phase 3 — Marketplaces
- [ ] Smithery — submit via smithery CLI / GitHub-issue
- [ ] Glama — confirm auto-crawl picked us up
- [ ] mcp.so — open the GitHub-issue submission template
- [ ] PulseMCP — submit via their suggest-server form
- [ ] MCP Hunt — schedule for launch day
- [ ] mcpserverfinder.com — submit listing

## Phase 4 — Awesome list PRs (one-tap URLs already prepared)
- [ ] punkpeye/awesome-mcp-servers
- [ ] wong2/awesome-mcp-servers
- [ ] appcypher/awesome-mcp-servers
- [ ] JAW9C/awesome-remote-mcp-servers

## Phase 5 — Cloudflare ecosystem
- [ ] Cloudflare Workers Showcase / built-with directory
- [ ] Cloudflare Discord #showcase post
- [ ] Cloudflare Community forum thread (gets Google + indexed by Cloudflare's own search)

## Phase 6 — Package registries
- [ ] npm: prep tarball for offline publish (user runs `npm publish` from a laptop)
- [ ] JSR / Deno: optional alt registry

## Phase 7 — Syndication / search-engine signaling
- [ ] IndexNow ping for landing-page URL (Bing/Yandex/Seznam)
- [ ] GitHub Releases RSS feed (auto-emits via /releases.atom)
- [ ] Add structured-data hints to README
- [ ] Pingomatic/Pubsubhubbub for blog syndication (if blog exists)

## Phase 8 — Repo-as-playbook
- [ ] LAUNCH.md with all submission URLs + copy
- [ ] /docs/PRESS.md with one-line, one-paragraph, one-page descriptions
