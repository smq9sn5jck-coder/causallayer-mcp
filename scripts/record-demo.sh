#!/bin/bash
# Record a terminal demo of CausalLayer MCP
# Prerequisites: 
#   brew install asciinema (or apt install asciinema)
#   cargo install agg (for GIF conversion)
#   OR: npm install -g svg-term-cli (for SVG)

set -e

RECORDING="/tmp/causallayer-demo.cast"
GIF_OUTPUT="./docs/demo.gif"
SVG_OUTPUT="./docs/demo.svg"

echo "🎬 Recording CausalLayer demo..."

# Create the demo script
cat > /tmp/demo-script.sh << 'DEMO'
#!/bin/bash
echo "$ npx @faultkey/causallayer-mcp --demo"
sleep 1
echo ""
echo "🔗 CausalLayer MCP v1.0.0"
echo "   Endpoint: mcp.faultkey.com"
echo "   Protocol: MCP 2025-03-26"
echo ""
sleep 1.5
echo "$ # Submit an AI decision for certification"
sleep 0.5
echo '$ mcp call submit_incident \'
echo '    --agent-id "gpt-4o-2026-05" \'
echo '    --decision-type "loan-approval" \'
echo '    --jurisdiction "EU-AI-ACT-ART14"'
sleep 2
echo ""
echo "✅ Certificate anchored"
echo ""
echo "  anchor_id:    anc_7f3k9x2m"
echo "  chain_hash:   sha256:e4f5g6h7..."
echo "  prev_anchor:  sha256:b2c3d4e5..."
echo "  timestamp:    2026-05-21T09:15:33.127Z"
echo "  jurisdiction: EU-AI-ACT-ART14"
echo "  status:       SEALED"
echo "  latency:      12ms"
echo ""
sleep 2
echo "$ # Verify the certificate chain"
echo '$ mcp call get_anchor_status --anchor-id "anc_7f3k9x2m"'
sleep 1.5
echo ""
echo "✅ Chain integrity: VALID"
echo "   Chain depth:  847 anchors"
echo "   Broken links: 0"
echo "   Verified in:  3ms"
echo ""
sleep 2
echo "$ # No LLM called. Fully deterministic. 12ms total."
sleep 2
DEMO
chmod +x /tmp/demo-script.sh

# Record
asciinema rec "$RECORDING" \
  --command "bash /tmp/demo-script.sh" \
  --title "CausalLayer MCP — Deterministic AI Liability Attribution" \
  --idle-time-limit 3 \
  --cols 72 \
  --rows 20

echo ""
echo "Converting to GIF..."

# Try agg first (better quality)
if command -v agg &> /dev/null; then
  agg "$RECORDING" "$GIF_OUTPUT" --cols 72 --rows 20 --speed 1.2
  echo "✅ GIF: $GIF_OUTPUT"
fi

# Also try svg-term (works in README directly)
if command -v svg-term &> /dev/null; then
  svg-term --cast "$RECORDING" --out "$SVG_OUTPUT" --window --width 72 --height 20
  echo "✅ SVG: $SVG_OUTPUT"
fi

echo ""
echo "Add to README.md:"
echo '  ![Demo](./docs/demo.gif)'
echo ""
echo "Or for SVG (sharper, smaller file):"
echo '  ![Demo](./docs/demo.svg)'
