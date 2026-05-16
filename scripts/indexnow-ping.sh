#!/usr/bin/env bash
# IndexNow instant-indexing protocol — pushes URL changes to Bing, Yandex, Seznam,
# Naver, and (eventually) every IndexNow participant in one POST.
# Docs: https://www.indexnow.org/documentation
#
# Setup (one-time, after faultkey.com is published):
#   1. Generate a key: openssl rand -hex 32
#   2. Save the key as <KEY>.txt at the root of faultkey.com (e.g., https://faultkey.com/abc123.txt
#      whose content is "abc123" — a self-verification file).
#   3. Export INDEXNOW_KEY=<that key> in your shell.
#   4. Run this script after every content update.

set -euo pipefail

KEY="${INDEXNOW_KEY:-}"
HOST="faultkey.com"

if [[ -z "$KEY" ]]; then
  echo "ERROR: INDEXNOW_KEY env var is not set." >&2
  exit 1
fi

URLS_JSON=$(cat <<EOF
{
  "host": "$HOST",
  "key": "$KEY",
  "keyLocation": "https://$HOST/$KEY.txt",
  "urlList": [
    "https://$HOST/",
    "https://$HOST/sitemap.xml",
    "https://$HOST/openapi.yaml",
    "https://$HOST/.well-known/mcp.json"
  ]
}
EOF
)

# IndexNow accepts a single POST that gets fanned out to all participating engines.
# Bing endpoint also forwards to all IndexNow members.
echo "Pinging IndexNow (Bing/Yandex/Seznam/Naver fan-out)…"
curl -sS -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json" \
  -d "$URLS_JSON"
echo
echo "Done. Bing typically reflects new pages within 5–30 minutes; Yandex within 1–6 hours."
