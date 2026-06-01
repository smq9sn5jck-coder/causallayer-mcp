#!/bin/bash
set -e
cd /home/ubuntu/causallayer-mcp
esbuild src/standalone.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=dist/standalone.js \
  '--banner:js=#!/usr/bin/env node' \
  --external:@modelcontextprotocol/sdk
echo "Build complete: dist/standalone.js"
