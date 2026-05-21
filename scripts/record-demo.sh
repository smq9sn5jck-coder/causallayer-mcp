#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# record-demo.sh — Record a terminal demo of CausalLayer MCP in action
#
# Prerequisites:
#   brew install asciinema    (or apt install asciinema)
#   cargo install agg         (or npm install -g svg-term-cli for SVG)
#
# Usage:
#   ./scripts/record-demo.sh           # Records + converts to GIF
#   ./scripts/record-demo.sh --svg     # Records + converts to SVG (for README)
#
# Output:
#   docs/demo.gif  or  docs/demo.svg
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/docs"
CAST_FILE="$OUTPUT_DIR/demo.cast"
FORMAT="${1:-gif}"

mkdir -p "$OUTPUT_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  CausalLayer MCP Demo Recorder                              ║"
echo "║  This will record a scripted terminal session.              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Create the demo script that simulates a real interaction
cat > "$OUTPUT_DIR/.demo-script.sh" << 'DEMO'
#!/usr/bin/env bash
type_slow() {
  local text="$1"
  for (( i=0; i<${#text}; i++ )); do
    printf '%s' "${text:$i:1}"
    sleep 0.04
  done
  echo ""
}

clear
echo ""
printf '\033[1;37m'
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║  CausalLayer MCP — Deterministic AI Liability Attribution ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
printf '\033[0m'
echo ""
sleep 1

printf '\033[0;90m# Step 1: Initialize MCP session with mcp.faultkey.com\033[0m\n'
sleep 0.5
type_slow '$ curl -s -X POST https://mcp.faultkey.com/mcp \'
type_slow '    -H "Content-Type: application/json" \'
type_slow '    -d {"jsonrpc":"2.0","method":"initialize",...}'
sleep 0.8
printf '\033[0;32m✓ Session established: 4980470cc7bf...\033[0m\n'
echo ""
sleep 1

printf '\033[0;90m# Step 2: Submit AI incident for deterministic liability scoring\033[0m\n'
sleep 0.5
type_slow '$ curl -s -X POST https://mcp.faultkey.com/mcp \'
type_slow '    -H "Mcp-Session-Id: 4980470cc7bf..." \'
type_slow '    -d {"method":"tools/call","params":{"name":"submit_incident",...}}'
sleep 2
echo ""
printf '\033[1;37m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n'
printf '\033[1;37m  CAUSAL CERTIFICATE V1\033[0m\n'
printf '\033[1;37m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n'
echo ""
printf '  \033[1;31mVERDICT:\033[0m  THIRD_PARTY_DATA_PROVIDER_AT_FAULT\n'
echo ""
printf '  \033[1;37mLIABILITY:\033[0m\n'
printf '  \033[31m████████████████████████████████████████████\033[0m 88%% Anthropic Claude 3.5\n'
printf '  \033[37m███\033[0m 6%% National Credit Corp\n'
printf '  \033[34m███\033[0m 6%% Loan Officer\n'
echo ""
printf '  \033[1;37mDAMAGES:\033[0m  $41,303.90 AUD\n'
echo ""
printf '  \033[1;37mREGULATORY:\033[0m  EU AI Act Art.26 · APRA CPS 230 · NSW AI Framework\n'
echo ""
printf '  \033[1;37mCRYPTO:\033[0m  ed25519 | did:web:faultkey.com#demo-issuer\n'
printf '\033[1;37m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n'
echo ""
sleep 2

printf '\033[0;32m✓ Generated in 2.4s — deterministic, no LLM in scoring path\033[0m\n'
printf '\033[0;90m  Same input → same output. Every time. Verifiable in 30 lines of Node.js.\033[0m\n'
echo ""
sleep 2
DEMO

chmod +x "$OUTPUT_DIR/.demo-script.sh"

# Record with asciinema
echo "Recording demo..."
asciinema rec "$CAST_FILE" \
  --command "$OUTPUT_DIR/.demo-script.sh" \
  --title "CausalLayer MCP — AI Liability Attribution" \
  --cols 80 \
  --rows 28 \
  --overwrite \
  --idle-time-limit 3

echo ""
echo "Recording complete: $CAST_FILE"

# Convert based on format
if [[ "$FORMAT" == "--svg" || "$FORMAT" == "svg" ]]; then
  echo "Converting to SVG..."
  if command -v svg-term &> /dev/null; then
    svg-term --in "$CAST_FILE" --out "$OUTPUT_DIR/demo.svg" --window --width 80 --height 28
    echo "✓ Output: $OUTPUT_DIR/demo.svg"
  else
    echo "⚠ svg-term-cli not found. Install: npm install -g svg-term-cli"
    echo "  Then: svg-term --in $CAST_FILE --out $OUTPUT_DIR/demo.svg --window"
  fi
else
  echo "Converting to GIF..."
  if command -v agg &> /dev/null; then
    agg "$CAST_FILE" "$OUTPUT_DIR/demo.gif" --font-size 14 --theme monokai --speed 1.5
    echo "✓ Output: $OUTPUT_DIR/demo.gif"
  else
    echo "⚠ agg not found. Install: cargo install agg"
    echo "  Then: agg $CAST_FILE $OUTPUT_DIR/demo.gif --font-size 14 --theme monokai"
    echo ""
    echo "Alt: Upload $CAST_FILE to https://asciinema.org for web embed"
  fi
fi

rm -f "$OUTPUT_DIR/.demo-script.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Add to README.md:"
echo '  ![Demo](docs/demo.gif)'
echo "Or embed asciinema:"
echo '  [![asciicast](https://asciinema.org/a/XXXXX.svg)](https://asciinema.org/a/XXXXX)'
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
