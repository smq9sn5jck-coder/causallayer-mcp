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

## Verify From CLI (no install, no network)

A standalone Node CLI that runs the **same** deterministic scoring engine
shipped to the browser at <https://faultkey.com/try>:

```bash
git clone https://github.com/smq9sn5jck-coder/causallayer-mcp
cd causallayer-mcp
node demo/score.js --scenario loan
node demo/score.js --scenario medical
node demo/score.js --scenario content
node demo/score.js --scenario hiring
node demo/score.js --scenario av
node demo/score.js --input ./my-incident.json
```

The CLI prints an `input_hash` and an `output_hash` for the chosen scenario.
**These must equal the hashes shown in the DETERMINISTIC PROOF panel on
/try for the same scenario.** Reproducibility contract (any drift = a bug):

| Scenario  | input_hash         | output_hash         |
|-----------|--------------------|---------------------|
| `loan`    | `0a0dc64e-2b5f875f` | `f41224822abf9a6d` |
| `medical` | `fb8ffbc22522452d` | `746987f1-553bc6e2` |
| `content` | `446cc4bc-653e85ad` | `5db3fd1c-7ce1bc0d` |
| `hiring`  | `b0a5781e6e08c6f1` | `fd91331f233c8df0` |
| `av`      | `bc58c49862f57a77` | `1d4a50d0-3c1811c1` |

(These are 16-hex-character FNV-1a derived digests, kept byte-identical to
the browser engine. Production CausalCertificateV1 issuance uses SHA-256 with
canonical JSON; the public demo uses a smaller hash so values fit on one line
in the certificate UI. Hyphens that occasionally appear are an artefact of
the shared `padStart` implementation and are part of the byte-identical
contract — fixing them would break reproducibility against /try until both
are updated in lockstep.)

No external dependencies. Node ≥ 18.
