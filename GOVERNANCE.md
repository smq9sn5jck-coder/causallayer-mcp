# Project governance

## What this document is

A short description of how decisions get made in the **CausalLayer MCP** repository. The repository contains the open-source MCP transport, the CLI wrapper, and the CausalCertificateV1 receipt format specification. The closed-form scoring engine lives upstream and is not governed by this document.

## Maintainers

The repository is maintained by **FaultKey Protocol** (Brisbane, Queensland, Australia). The current maintainer set is the GitHub organisation `@smq9sn5jck-coder` and `@smq9sn5jck-cloud`. Maintainers have commit and merge rights, are responsible for triaging issues, and review external contributions.

## Decision making

Decisions in this repository follow a *rough consensus* model:

1. Open an issue describing the proposed change.
2. Maintainers and other interested parties discuss in the issue thread.
3. If no maintainer objects within 7 calendar days, the change is approved.
4. If a maintainer objects, the discussion continues until either the objection is resolved or the proposal is withdrawn.

For changes to the **CausalCertificateV1 record format**, the bar is higher: any change must be backwards-compatible at the JSON-Schema level, and the change must ship with explicit test vectors demonstrating that previously-issued receipts still verify. Format-breaking changes require a major version bump and a 90-day notice period.

For changes to the **scoring function ID**, the bar is highest: scoring-function changes are explicit, never silent, and always result in a new ID. The current ID is `causallayer-v0.2.0`. A change to the function logic produces ID `causallayer-v0.2.1`, `v0.3.0`, etc.

## Release cadence

We tag a release whenever a backwards-compatible feature lands and the test suite is green. We do not maintain long-lived release branches; security fixes are issued as patch versions on top of the latest tag.

## Code of Conduct

All participation is subject to [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Enforcement is the responsibility of the maintainers.

## Trademarks

"FaultKey", "CausalLayer", and "CausalCertificateV1" are trademarks of FaultKey Protocol. The Apache 2.0 licence on the source code does not grant trademark rights. Forks and derivative works should rename to avoid confusion with the upstream project.

## Funding

The project's funding posture is documented in [`.github/FUNDING.yml`](./.github/FUNDING.yml).
