# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of CausalLayer MCP seriously. If you believe you have found a security vulnerability, please report it responsibly.

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of these channels:

1. **Email:** security@faultkey.com
2. **GitHub Security Advisories:** [Report a vulnerability](https://github.com/smq9sn5jck-coder/causallayer-mcp/security/advisories/new)

### What to include

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 5 business days
- **Resolution target:** Within 30 days for critical issues

### Disclosure Policy

- We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
- We will credit reporters in our security advisories (unless anonymity is requested)
- We ask that you give us reasonable time to address the issue before public disclosure

## Security Measures

This project implements:

- **Cryptographic certificate signing** (HMAC-SHA256) for all CausalCertificates
- **Input validation** on all MCP tool parameters
- **No persistent storage** of incident data (stateless Worker architecture)
- **Rate limiting** via Cloudflare
- **Content Security Policy** headers on all responses
- **OpenSSF Scorecard** continuous monitoring
- **CodeQL** static analysis on every push
- **Dependabot** automated dependency updates

## Scope

The following are in scope for security reports:

- The CausalLayer MCP Worker (`src/`)
- Certificate generation and verification logic
- The MCP protocol implementation
- Authentication and authorization mechanisms

The following are **out of scope**:

- The landing page (faultkey.com) — report via email
- Third-party dependencies (report to the upstream project)
- Social engineering attacks
