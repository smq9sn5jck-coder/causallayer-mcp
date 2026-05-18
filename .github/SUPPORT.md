# Getting support

Thanks for using **CausalLayer MCP**. Here is the right channel for each kind of question.

## Where to ask

| Question type | Channel |
| --- | --- |
| **Bug report** (something is broken or returns the wrong receipt) | [Open a bug-report issue](https://github.com/smq9sn5jck-coder/causallayer-mcp/issues/new?template=bug-report.yml) |
| **Integration help** (Claude Desktop, Cursor, Cline, Continue, Windsurf) | [Open an integration-request issue](https://github.com/smq9sn5jck-coder/causallayer-mcp/issues/new?template=integration-request.yml) |
| **General question** (concept, compliance mapping, scoring math) | [GitHub Discussions](https://github.com/smq9sn5jck-coder/causallayer-mcp/discussions) |
| **Security report** (signature bypass, anchor forging, tenant isolation) | See [SECURITY.md](../SECURITY.md). Email `security@faultkey.com`. **Do not** open a public issue. |
| **Commercial inquiries** (managed deployment, hosted certificate issuance, SLAs) | Email `hello@faultkey.com`. |

## Response expectations

- Bug reports: triaged within 48 hours.
- Integration requests: a maintainer responds within 72 hours.
- Security reports: acknowledged within 48 hours; high-severity patched within 7 days.

## Before opening an issue

1. Confirm the issue reproduces against the latest tagged release.
2. Confirm the live demo at <https://mcp.faultkey.com/healthz> is healthy when reproducing locally.
3. Search existing issues — many integration questions are already answered.
4. Read [`README.md`](../README.md) and [`docs/`](../docs/) if you have not already.

## Self-service diagnostic endpoints

| Endpoint | Use |
| --- | --- |
| `https://mcp.faultkey.com/healthz` | Is the demo Worker reachable? |
| `https://mcp.faultkey.com/stats` | Aggregated demand telemetry, no PII. |
| `https://faultkey.com/transparency` | Daily Merkle roots and Bitcoin anchor block heights. |
| `https://faultkey.com/verify` | Drag-and-drop receipt verifier. |

## Commercial support

We offer paid integrations for regulated entities (APRA-regulated, EU AI-Act high-risk providers, NIST AI RMF / ISO/IEC 42001 implementers). Email `hello@faultkey.com` with the integration scope and the standard you are aligning to.
