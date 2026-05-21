# Contributing to CausalLayer MCP

Thank you for your interest in contributing to CausalLayer! This document provides guidelines and information for contributors.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/smq9sn5jck-coder/causallayer-mcp.git
cd causallayer-mcp

# Install dependencies
npm install

# Run tests
npm test

# Start local development
npx wrangler dev
```

## How to Contribute

### Reporting Bugs

- Use [GitHub Issues](https://github.com/smq9sn5jck-coder/causallayer-mcp/issues/new?template=bug_report.md)
- Include steps to reproduce, expected vs actual behavior
- Include your environment (OS, Node.js version, Wrangler version)

### Suggesting Features

- Check [existing issues](https://github.com/smq9sn5jck-coder/causallayer-mcp/issues) first
- Use the [feature request template](https://github.com/smq9sn5jck-coder/causallayer-mcp/issues/new?template=feature_request.md)
- Describe the use case and expected behavior

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc.)
6. Push to your fork and open a PR

### Areas We Need Help

Check our [roadmap issues](https://github.com/smq9sn5jck-coder/causallayer-mcp/issues?q=is%3Aissue+is%3Aopen+label%3Aroadmap) for areas where contributions are especially welcome:

- 🌏 **Jurisdiction modules** — Add regulatory mappings for new countries/regions
- 🧪 **Test scenarios** — Industry-specific incident templates
- 📖 **Documentation** — Tutorials, integration guides, translations
- 🔌 **Client integrations** — Claude Desktop, Cursor, VS Code configurations
- 📊 **Scoring models** — New attribution algorithms and weighting schemes

## Code Style

- TypeScript strict mode
- ESLint + Prettier (run `npm run lint`)
- Meaningful variable names over comments
- Each MCP tool should be self-contained in its own module

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Japanese jurisdiction module
fix: correct liability split rounding error
docs: add Claude Desktop integration guide
test: add edge case for multi-party incidents
chore: update wrangler to v4
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

- Open a [Discussion](https://github.com/smq9sn5jck-coder/causallayer-mcp/discussions)
- Email: contributors@faultkey.com
