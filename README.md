# DSH Toolchain

DSH Toolchain is a plugin-first development toolchain for DeepSeek Harness.

Its canonical distribution is a single installable DSH bundle that gives DSH users and agents the same development intelligence through native DSH tools and services, DSH Web, CLI, and MCP. Internally, the analysis kernel remains independent from DSH runtime APIs so the same semantics can be reused by Codex, Claude Code, OpenCode, CI, and other clients.

## Product promise

**Do not guess the installed Harness API. Inspect the exact target. Do not guess whether a plugin works. Verify it against a real DSH composition.**

The first releases focus on:

- exact target discovery and immutable target snapshots;
- progressive search and inspection of DSH contracts;
- source-backed plugin analysis and stable diagnostics;
- isolated package/composition/runtime verification;
- one application kernel shared internally by DSH, DSH Web, CLI, and MCP.

Plugin generation, migration, compatibility CI, and integration compilation are deliberately downstream of reliable inspection and verification.

## Installation model

DSH plugin management is profile-scoped. Once the public package is released, the canonical installation shape is:

```bash
dsh plugin --profile <profile> add dsh-toolchain
```

For the canonical Web profile:

```bash
dsh plugin --profile web add dsh-toolchain
```

The private incubator package is not published to npm. CI verifies the exact packed `.tgz` twice: first in an isolated minimal profile based on `@deepseek-ai/dsh-base`, then in the shipped `web` profile (`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`).

## Architecture baseline

Read in this order:

1. [`docs/architecture.md`](docs/architecture.md)
2. [`spec/protocol.md`](spec/protocol.md)
3. [`spec/verification.md`](spec/verification.md)
4. [`docs/security.md`](docs/security.md)
5. [`docs/roadmap.md`](docs/roadmap.md)
6. relevant ADRs under [`docs/decisions/`](docs/decisions/)

Development policy lives in [`docs/development.md`](docs/development.md). All contributors—human or automated—follow [`CONTRIBUTING.md`](CONTRIBUTING.md); coding agents also follow [`AGENTS.md`](AGENTS.md).

## Repository status

This private repository is the development incubator. The future public project is a new clean `definitely-stable/dsh-toolchain` repository created from curated approved source states; the incubator history is not intended to become public history.

M0 Foundation is implemented: reproducible package/build faces, Protocol v1 generation and conformance, an internal runtime-neutral application-kernel descriptor, native `ToolchainService`, CLI/MCP shells, closed-world architecture/package fitness gates, and exact-artifact DSH composition smoke.

The package root intentionally exposes only stable M0 product/protocol identities. The application-kernel factory remains internal until M1 defines its real acquisition ports and first useful programmatic use case.

Target intelligence, contract intelligence, plugin analysis, validation, verification operations, and DSH Web UI are later milestones. They are not currently exposed as Toolchain capabilities.

## License

Apache-2.0.
