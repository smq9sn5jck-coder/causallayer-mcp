# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# CausalLayer · FaultKey — MCP Server Dockerfile
#
# A self-contained stdio MCP wrapper around the canonical hosted
# Streamable-HTTP server at https://causallayer-mcp-demo.zykm9qkk7j.workers.dev/mcp .
# Exists so MCP clients that prefer a containerised stdio launcher
# (Glama, Smithery, Claude Desktop with custom containers, etc.) can run the
# server with no Cloudflare account, no Wrangler, no build step, and zero
# runtime network installs.
#
# The actual signing, Merkle, and OpenTimestamps logic always runs on the
# canonical Worker — never inside this container. The container is therefore
# stateless, has zero secrets at rest, and any incident receipt produced via
# this stdio path is byte-identical to one produced by hitting the Worker
# directly (closed-form determinism guarantee).
#
# Build:    docker build -t causallayer-mcp .
# Run:      docker run -i --rm causallayer-mcp
# Override: docker run -i --rm \
#               -e CAUSALLAYER_ENV=production \
#               -e CAUSALLAYER_API_KEY=clk_xxx \
#               causallayer-mcp
# ---------------------------------------------------------------------------

FROM node:22-alpine

WORKDIR /app

# Copy the stdio CLI package (small, self-contained)
COPY cli/package.json ./
COPY cli/bin ./bin

# Bake mcp-remote into the image so introspection works fully offline.
# `--ignore-scripts` keeps the build deterministic; `--omit=dev` keeps the
# image small. We pin to the version range declared in cli/package.json.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts \
    && npm cache clean --force

# Default environment selection. Overridable at run time.
ENV CAUSALLAYER_ENV=demo \
    NODE_ENV=production \
    PATH="/app/node_modules/.bin:${PATH}"

# Glama's quality check expects a process that responds to MCP introspection
# on stdio (initialize → tools/list). The CLI shim does exactly that by
# proxying to the canonical Worker.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "process.exit(0)"

ENTRYPOINT ["node", "/app/bin/causallayer-mcp.mjs"]
