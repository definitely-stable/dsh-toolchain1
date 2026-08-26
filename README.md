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
- one application kernel shared by DSH, DSH Web, CLI, and MCP.

Plugin generation, migration, compatibility CI, and integration compilation are deliberately downstream of reliable inspection and verification.

## Architecture baseline

Read in this order:

1. [`docs/architecture.md`](docs/architecture.md)
2. [`spec/protocol.md`](spec/protocol.md)
3. [`spec/verification.md`](spec/verification.md)
4. [`docs/security.md`](docs/security.md)
5. [`docs/roadmap.md`](docs/roadmap.md)
6. relevant ADRs under [`docs/decisions/`](docs/decisions/)

For coding agents, [`AGENTS.md`](AGENTS.md) defines repository working rules.

## Status

Architecture baseline. No production implementation is committed yet.

## License

Apache-2.0.
