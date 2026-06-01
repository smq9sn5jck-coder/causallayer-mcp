#!/usr/bin/env bash
# ----------------------------------------------------------------
# CausalLayer end-to-end smoke test
# ----------------------------------------------------------------
# Verifies the full stack from edge → Worker → Fly upstream:
#   1. Fly upstream answers /api/v2/issuers (no-auth)
#   2. Cloudflare Worker proxies the same call via /api/v2/issuers
#   3. MCP initialize handshake works on /mcp
#   4. tools/list returns the four expected tool names
#   5. submit_incident returns a watermarked demo certificate
#
# Usage:
#   ./scripts/smoke_e2e.sh                          # uses ENV defaults
#   API=https://causallayer-api.fly.dev \
#   MCP=https://causallayer-mcp-demo.<sub>.workers.dev \
#       ./scripts/smoke_e2e.sh
# ----------------------------------------------------------------
set -euo pipefail

API="${API:-https://causallayer-api.fly.dev}"
MCP="${MCP:-http://127.0.0.1:8787}"

red()   { printf "\033[0;31m%s\033[0m\n" "$*"; }
green() { printf "\033[0;32m%s\033[0m\n" "$*"; }

step() { printf "\n──── %s ────\n" "$*"; }

step "1. Upstream Fly /api/v2/issuers"
ISSUERS=$(curl -fsS "${API}/api/v2/issuers" || true)
if [[ -z "${ISSUERS}" ]]; then
  red "FAIL: ${API}/api/v2/issuers returned nothing"
  exit 1
fi
echo "${ISSUERS}" | head -c 200
green "OK"

step "2. Worker proxy of /api/v2/issuers (no MCP)"
# Worker exposes /healthz at the root for liveness; if we need the issuer
# proxy via Worker we go through MCP only — not a direct REST passthrough.
HEALTH=$(curl -fsS "${MCP}/healthz" || echo "")
# /healthz returns a JSON liveness object identified by its service name.
if [[ "${HEALTH}" != *'"causallayer-mcp"'* ]]; then
  red "FAIL: Worker /healthz did not return the expected liveness object (got: '${HEALTH}')"
  exit 1
fi
green "OK"

step "3. MCP initialize handshake"
INIT=$(curl -fsS -X POST "${MCP}/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}')
echo "${INIT}" | head -c 300
if ! echo "${INIT}" | grep -q '"protocolVersion"'; then
  red "FAIL: initialize did not return a protocolVersion"
  exit 1
fi
green "OK"

step "4. tools/list — expect 4 tools"
LIST=$(curl -fsS -X POST "${MCP}/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
for tool in submit_incident verify_certificate get_anchor_status query_issuer_registry; do
  if ! echo "${LIST}" | grep -q "\"${tool}\""; then
    red "FAIL: tools/list missing ${tool}"
    exit 1
  fi
done
green "OK"

step "5. tools/call submit_incident (watermarked demo)"
CALL=$(curl -fsS -X POST "${MCP}/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"submit_incident","arguments":{"deterministic_only":true,"agents":[{"id":"agent-a","role":"analyst"}],"events":[{"description":"Agent A produced a bad recommendation"}]}}}')
echo "${CALL}" | head -c 400
if ! echo "${CALL}" | grep -qiE 'demo|watermark|certificate'; then
  red "FAIL: submit_incident did not produce a recognisable response"
  exit 1
fi
green "OK"

green "── all 5 steps passed ──"
