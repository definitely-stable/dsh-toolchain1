# DSH Toolchain

DSH Toolchain is a plugin-first development toolchain for DeepSeek Harness.

Its canonical distribution is a single installable DSH bundle that gives DSH users and agents the same development intelligence through native DSH services, DSH tools, CLI, and MCP. Internally, the semantic/application kernel remains independent from DSH runtime APIs so the same target semantics can later be reused by DSH Web, Codex, Claude Code, OpenCode, CI, and other clients.

## Product promise

**Do not guess the installed Harness API. Inspect the exact target. Do not guess whether a plugin works. Verify it against a real DSH composition.**

The product axis is exact-target development and compatibility intelligence:

```text
exact DSH target + evidence + plugin source/artifact
        ↓
normalized machine model
        ↓
contract intelligence / diagnostics / verification receipts / compatibility diff
```

M1 establishes exact target identity. M1.1 projects the same target-resolution capability through the installed DSH Plugin and MCP so later contract intelligence and plugin checking can build on one target model instead of frontend-specific implementations.

## Installation model

DSH plugin management is profile-scoped. Once the public package is released, the canonical installation shape is:

```bash
dsh plugin --profile <profile> add dsh-toolchain
```

For the canonical Web profile:

```bash
dsh plugin --profile web add dsh-toolchain
```

The private incubator package is not published to npm. CI packs the exact `.tgz`, installs it into disposable DSH profiles, verifies minimal and Web composition, and boots a real DSH host with an external probe. The live probe resolves the same target through `ctx.toolchain.resolveTarget()` and the host-owned native ToolRuntime, requiring both paths to return the same `dsh-target-v2` fingerprint before launcher-owned shutdown.

## Exact target resolution

The same Protocol v1 target semantics are available through three user/agent-facing projections.

### CLI

```bash
dsh-toolchain target resolve --profile <name>
```

Optional acquisition hints are available when the caller needs to inspect a specific home or DSH installation, or describe the same invocation-level patch overlays that DSH will apply:

```bash
dsh-toolchain target resolve \
  --profile web \
  --dsh-home /path/to/.dsh \
  --dsh-package-root /path/to/node_modules/@deepseek-ai/dsh \
  --patch /path/to/first.patch.yml \
  --patch /path/to/second.patch.yml
```

`--patch` is repeatable and order-sensitive. Patch paths are acquisition evidence; their ordered content hashes enter target identity.

### Installed DSH Plugin

The canonical DSH Service exposes:

```ts
await ctx.toolchain.resolveTarget({ profile: 'web' })
```

When the running Host provides `ctx.tools`, Toolchain also registers one native model-facing tool:

```text
toolchain_target_resolve
```

The tool is lifecycle-owned by the Host `tools` capability, validates raw arguments before Service invocation, and returns the canonical Protocol `TargetResolveResponse`. Toolchain deliberately does not bundle a second runtime copy of `@deepseek-ai/dsh-tools`; the running DSH Host owns that identity-sensitive runtime.

Current upstream DSH does not expose the selected profile name as a supported Cordis capability, so `profile` remains explicit. Toolchain does not infer it from argv, PATH, process state, or undocumented launcher internals.

### MCP

The MCP frontend exposes:

```text
target.resolve
```

Its input and output validators are projected from the normative Protocol JSON Schema through MCP v2 `fromJsonSchema`. Successful target resolution and expected `TARGET_*` failures therefore use the same Protocol DTOs and diagnostics as CLI and DSH; MCP owns only transport framing/rendering.

## Target identity

When `dshPackageRoot` is omitted, the Node acquisition adapter uses deterministic package-resolution anchors from the installed Toolchain/profile graph. CI proves the no-hint path with the exact packed Toolchain and DSH co-installed in one disposable package graph. Detached layouts can always provide the explicit root rather than relying on PATH or subprocess guessing.

A successful response contains an immutable `TargetSnapshot` with:

- exact `@deepseek-ai/dsh` version;
- resolution/compatibility Node version, platform, and architecture;
- profile name;
- ordered exact bundle identities including each bundle patch content hash;
- exact installed top-level profile dependency identities;
- profile patch content hash;
- DSH-home patch content hash;
- ordered invocation-overlay content hashes;
- content-hashed evidence and provenance;
- a deterministic `dsh-target-v2:<sha256>` semantic fingerprint.

The v2 fingerprint deliberately excludes absolute paths, timestamps, evidence locations, and Toolchain's own observer version/content. Bundle order, bundle patch bytes, profile/home patch bytes, overlay order/content, exact target package versions, and runtime coordinates remain semantic.

`dsh-target-v2` supersedes the private pre-public v1 identity after corrective review found that v1 omitted some effective DSH composition layers. This correction is made before public release rather than preserving a known false-sameness case for compatibility.

Target resolution is read-only: Toolchain does not initialize a missing profile, install packages, create fallback links, or rewrite profile state to make the operation succeed. CI verifies this against real `headless` profiles on DSH `0.1.1-rc.2` and `0.1.0-rc.8`, including equivalent profiles copied to another `DSH_HOME` and no-hint versus explicit-root DSH discovery.

Expected acquisition failures are returned as stable Protocol diagnostics. CLI syntax errors remain CLI errors; raw DSH transport-invalid arguments are rejected at the tool boundary; unexpected infrastructure failures are not disguised as target diagnostics.

## Architecture baseline

Read in this order:

1. [`docs/architecture.md`](docs/architecture.md)
2. [`spec/protocol.md`](spec/protocol.md)
3. [`spec/verification.md`](spec/verification.md)
4. [`docs/security.md`](docs/security.md)
5. [`docs/roadmap.md`](docs/roadmap.md)
6. relevant ADRs under [`docs/decisions/`](docs/decisions/)

Current target semantics are defined by [`ADR-0007`](docs/decisions/ADR-0007-complete-target-composition-fingerprint-v2.md) and the approved [M1 design](docs/plans/2026-08-26-m1-target-intelligence-design.md). [`ADR-0006`](docs/decisions/ADR-0006-target-semantic-fingerprint-v1.md) is retained as the superseded pre-public v1 decision. M1.1 frontend-parity implementation is tracked by [Issue #25](https://github.com/definitely-stable/dsh-toolchain1/issues/25) and its [implementation plan](docs/plans/2026-08-27-m1-1-target-frontend-parity.md).

Development policy lives in [`docs/development.md`](docs/development.md). All contributors—human or automated—follow [`CONTRIBUTING.md`](CONTRIBUTING.md); coding agents also follow [`AGENTS.md`](AGENTS.md).

## Repository status

This private repository is the development incubator. The future public project is a new clean `definitely-stable/dsh-toolchain` repository created from curated approved source states; the incubator history is not intended to become public history.

M0 Foundation and M1 Target Intelligence are merged. M1.1 Target Frontend Parity is implemented in PR #24 and is in final verification: shared response execution, `ctx.toolchain.resolveTarget()`, lifecycle-owned native `toolchain_target_resolve`, MCP `target.resolve`, raw native-tool validation, cross-frontend semantic parity tests, and exact-package live DSH Service/ToolRuntime parity are present on the branch.

The package root still exposes only stable public product/protocol identities. `createApplicationKernel()` remains an internal composition primitive; CLI, DSH Host, and MCP construct or receive the required runtime adapters internally.

The next capability milestone after M1.1 is **M2 Contract Intelligence**: evidence-backed `contract.search` / `contract.inspect` and target-bound contract evidence/index identity. Source/artifact plugin validation, isolated verification, and DSH Web remain later milestones.

## License

Apache-2.0.
