# FaultKey Interactive Demo Worker

This is the standalone Cloudflare Worker that serves the interactive demo at `faultkey-try-demo.zykm9qkk7j.workers.dev/try`.

## Features

- **Deterministic Scoring Engine v1** — real liability computation (simplified public version)
- **PDF Certificate Generation** — downloadable formatted certificate
- **5 Pre-built Scenarios** — Loan Denial, Medical Triage, Content Mod, Hiring AI, Autonomous Vehicle
- **Zero external dependencies** — runs entirely on Cloudflare Workers

## Scoring Algorithm

The public demo uses a simplified but real deterministic scoring engine:

1. **Position Weight** — later events in the causal chain get higher weight (last-clear-chance doctrine)
2. **Event Type Severity** — inference failures weight more than data inputs
3. **Operator Role Duty** — AI providers have highest duty of care (2.5x), deployers (1.8x), vendors (2.0x)
4. **But-For Test** — actors with no events get zero liability
5. **Normalization** — weights converted to percentage shares

**Key property:** Running identical inputs ALWAYS produces identical liability scores. This is the core differentiator — no LLM, no randomness, no temperature.

## Deploy

### Option 1: Cloudflare Dashboard
1. Go to Workers & Pages → `faultkey-try-demo` → Quick Edit
2. Paste contents of `try-worker.js`
3. Click Deploy

### Option 2: Wrangler CLI
```bash
cd demo/
wrangler deploy try-worker.js --name faultkey-try-demo --compatibility-date 2024-01-01
```

### Option 3: GitHub Actions (after adding secrets)
Push to main with changes in `demo/` directory triggers auto-deploy.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/try` | GET | Interactive demo page |
| `/api/run` | POST | Run deterministic scoring engine |
| `/api/pdf` | POST | Generate certificate HTML (print to PDF) |

## Example API Call

```bash
curl -X POST https://faultkey-try-demo.zykm9qkk7j.workers.dev/api/run \
  -H "Content-Type: application/json" \
  -d '{"arguments": {"title": "Test", "agents": [...], "events": [...]}}'
```
