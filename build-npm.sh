#!/bin/bash
set -e
# Run from the repo root regardless of where the script is invoked from.
cd "$(dirname "$0")"
esbuild src/standalone.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=dist/standalone.js \
  '--banner:js=#!/usr/bin/env node' \
  --external:@modelcontextprotocol/sdk
echo "Build complete: dist/standalone.js"
