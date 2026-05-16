# Launch playbook — CausalLayer MCP / FaultKey

This file is intentionally public. It is the canonical record of how this server was launched and where it has been listed. Crawlers and humans reading the repo can use it as a directory of every distribution surface.

## Live infrastructure

| Surface | URL | Status |
| --- | --- | --- |
| Public demo Worker | <https://causallayer-mcp-demo.zykm9qkk7j.workers.dev> | Live · CORS-enabled · global edge (Cloudflare) |
| Healthcheck + manifest | <https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/healthz> | Returns 200 with the tool manifest |
| Public stats | <https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/stats> | Anonymized demand-signal counters |
| MCP endpoint | <https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp> | Streamable-HTTP transport |
| Source code | <https://github.com/smq9sn5jck-coder/causallayer-mcp> | Public · Apache 2.0 |
| OpenAPI spec | [`openapi.yaml`](./openapi.yaml) | Indexed by AI/MCP crawlers |
| MCP discovery | [`public/.well-known/mcp.json`](./public/.well-known/mcp.json) | Auto-discovery for MCP-aware tools |
| Marketing site | <https://faultkey.com> | Forensic-document-style landing page |

## Distribution surfaces (non-app)

The intent of this playbook is to enumerate **every non-webpage, non-app surface** through which the server is discoverable. Each entry should retain a status (`pending`, `submitted`, `live`) and an ISO date for the last attempted action.

### Official MCP registries

| Registry | Mechanism | Status |
| --- | --- | --- |
| registry.modelcontextprotocol.io | `mcp-publisher publish` (uses `server.json`) | Pending |
| Smithery (`smithery.ai`) | `smithery cli submit` or GitHub-issue template | Pending |
| Glama (`glama.ai/mcp`) | Auto-crawls public GitHub repos | Pending — auto-indexing |
| mcp.so | GitHub-issue submission | Pending |
| PulseMCP (`pulsemcp.com`) | Suggest-server form | Pending |
| MCP Hunt | Time for launch day | Scheduled |
| MCP Server Finder | Direct submission | Pending |
| AIBase MCP Directory | Direct submission | Pending |
| mcp.ing | Search-driven; needs no submission | Indexed-on-crawl |

### GitHub awesome-list pull requests

| List | Owner | PR-ready URL |
| --- | --- | --- |
| awesome-mcp-servers | `punkpeye` | <https://github.com/smq9sn5jck-coder/awesome-mcp-servers/pull/new/add-causallayer-faultkey> |
| awesome-mcp-servers | `wong2` | <https://github.com/smq9sn5jck-coder/awesome-mcp-servers-1/pull/new/add-causallayer-faultkey> |
| awesome-mcp-servers | `appcypher` | <https://github.com/smq9sn5jck-coder/awesome-mcp-servers-2/pull/new/add-causallayer-faultkey> |
| awesome-remote-mcp-servers | `JAW9C` | <https://github.com/smq9sn5jck-coder/awesome-remote-mcp-servers/pull/new/add-causallayer-faultkey> |

### Cloudflare ecosystem

| Surface | Mechanism |
| --- | --- |
| Cloudflare Workers Showcase | Submit form on cloudflare.com/case-studies |
| `built-with-cloudflare` directory | Forum / community thread |
| Cloudflare Discord (`#showcase`) | Direct post |
| Cloudflare Community forum | `community.cloudflare.com` thread (also indexed by Cloudflare's own search) |

### Package and code-search registries

| Registry | Status |
| --- | --- |
| npm (`causallayer-mcp` CLI) | Tarball ready; awaits `npm publish` |
| JSR | Optional |
| sourcegraph.com / `code.search` | Auto-indexes public GitHub |
| greppy / GitHub code search | Auto-indexes public GitHub |

### Search-engine signaling

| Surface | Mechanism |
| --- | --- |
| Bing IndexNow | `POST` to `https://api.indexnow.org/IndexNow` for `faultkey.com` URLs |
| Yandex IndexNow | Same protocol, same ping |
| Seznam (Czech) | Same protocol |
| Sitemap (`/sitemap.xml`) | Pinged on every release |
| GitHub Releases Atom feed | <https://github.com/smq9sn5jck-coder/causallayer-mcp/releases.atom> — automatically syndicates to RSS readers and AI crawlers |

### Developer-feed surfaces

| Surface | Mechanism |
| --- | --- |
| GitHub Trending (`mcp` topic) | Earned through stars/forks |
| Hacker News (Show HN) | One-off, launch-day |
| `r/LocalLLaMA`, `r/ClaudeAI`, `r/mcp` | One-off, launch-day |
| Lobsters | Invite-only |
| Indie Hackers | Account-required |
| Dev.to / Hashnode / Medium | Cross-post technical write-up |
| Substack: `Bens Bites`, `The Rundown AI`, `TLDR` | Direct outreach |

## Launch checklist (live)

The execution status is tracked alongside `todo.md` in this repo and updated as items move from `pending` to `submitted` to `live`.
