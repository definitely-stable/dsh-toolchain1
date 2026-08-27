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

M1 establishes exact target identity. M1.1 projects the same target-resolution capability through the installed DSH Plugin and MCP. M2.1 adds an offline, target-bound Contract Index so agents can search and inspect installed package/declaration evidence without loading the complete DSH catalog or guessing from model memory.

## Installation model

DSH plugin management is profile-scoped. Once the public package is released, the canonical installation shape is:

```bash
dsh plugin --profile <profile> add dsh-toolchain
```

For the canonical Web profile:

```bash
dsh plugin --profile web add dsh-toolchain
```

The private incubator package is not published to npm. CI packs the exact `.tgz`, installs it into disposable DSH profiles, verifies minimal and Web composition, and boots a real DSH host with an external probe. The live probe resolves the same target through `ctx.toolchain.resolveTarget()` and the host-owned native ToolRuntime, then executes native contract search→inspect against the same target/index identity before launcher-owned shutdown.

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

When the running Host provides `ctx.tools`, Toolchain registers the native model-facing target tool:

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

## Contract Intelligence — M2.1 offline index

M2.1 binds contract facts to the exact M1 target and to the evidence bytes that produced them. It intentionally does **not** claim live runtime availability: installed package manifests and public declaration files prove declared capability, so their baseline availability is `unknown` until M2.2 can enrich the same model from official live DSH Inspect evidence.

### CLI

Search progressively instead of loading every contract definition:

```bash
dsh-toolchain contract search \
  --profile web \
  --query ToolDefinition \
  --kind package \
  --limit 5
```

Inspect one selected contract against the exact returned Contract Index identity:

```bash
dsh-toolchain contract inspect \
  --profile web \
  --contract-index dsh-contract-index-v1:<sha256> \
  --contract-id package:@deepseek-ai/dsh-tools
```

`contract.inspect` rebuilds the current target-bound index. If the caller's index fingerprint is no longer current, Toolchain returns `status: "stale"` / `CONTRACT_INDEX_STALE` instead of silently inspecting different evidence.

### Installed DSH Plugin

The Service exposes the same shared application semantics:

```ts
const search = await ctx.toolchain.searchContracts({
  target: { profile: 'web' },
  query: 'ToolDefinition',
})

const inspect = await ctx.toolchain.inspectContract({
  target: { profile: 'web' },
  contractIndexFingerprint: search.data.contractIndexFingerprint,
  contractId: 'package:@deepseek-ai/dsh-tools',
})
```

The host-owned ToolRuntime exposes:

```text
toolchain_contract_search
toolchain_contract_inspect
```

These tools use strict raw-argument validation, delegate to `ctx.toolchain`, and share lifecycle ownership with `ctx.tools`. The exact packed-artifact CI boot executes the real ToolRuntime search→inspect path and proves target fingerprint equality plus Contract Index continuity.

### MCP

MCP exposes:

```text
contract.search
contract.inspect
```

Both use Protocol-owned input/output schemas, `structuredContent` plus equivalent text JSON, and read-only/idempotent annotations. CLI, native DSH, and MCP parity tests prove the same search and stale-inspect semantics apart from transport-owned request IDs.

### Evidence and Contract Index identity

M2.1 reads only target-captured installed package manifests and public TypeScript declaration entrypoints/relative declaration references. It does not execute package JavaScript and does not use private generated DSH source paths. Captured manifest hashes are rechecked before use; same-version declaration drift changes contract evidence/index identity rather than pretending the M1 target identity changed.

One installed package may appear through more than one DSH composition coordinate, for example as both a bundle and a profile dependency. Toolchain emits one package Contract for one exact canonical package root while preserving every captured manifest evidence alias as provenance; conflicting roots or versions fail loudly rather than being silently collapsed.

`dsh-contract-index-v1:<sha256>` is distinct from `dsh-target-v2`. Its canonical projection includes the exact target fingerprint, consumed evidence identity/content hashes, and normalized contract semantics. Machine paths, timestamps, traversal order, request IDs, and frontend metadata are excluded. Therefore equal targets may legitimately have different Contract Index fingerprints when same-version declaration evidence differs.

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

Current target semantics are defined by [`ADR-0007`](docs/decisions/ADR-0007-complete-target-composition-fingerprint-v2.md). Contract Index identity is defined by [`ADR-0008`](docs/decisions/ADR-0008-contract-index-fingerprint-v1.md). M1.1 frontend parity is tracked by [Issue #25](https://github.com/definitely-stable/dsh-toolchain1/issues/25); M2.1 offline Contract Index implementation is tracked by [Issue #29](https://github.com/definitely-stable/dsh-toolchain1/issues/29) and its [implementation plan](docs/plans/2026-08-27-m2-1-contract-index.md).

Development policy lives in [`docs/development.md`](docs/development.md). All contributors—human or automated—follow [`CONTRIBUTING.md`](CONTRIBUTING.md); coding agents also follow [`AGENTS.md`](AGENTS.md).

## Repository status

This private repository is the development incubator. The future public project is a new clean `definitely-stable/dsh-toolchain` repository created from curated approved source states; the incubator history is not intended to become public history.

M0 Foundation, M1 Target Intelligence, and M1.1 Target Frontend Parity are merged. M2.1 Offline Contract Index is implemented and verified in source/CI under Issue #29: target-bound manifest/declaration acquisition, `dsh-contract-index-v1`, deterministic `contract.search` / stale-safe `contract.inspect`, CLI/DSH/MCP parity, and exact packed-artifact real DSH ToolRuntime search→inspect proof are present. GitHub tracks the review/merge state rather than encoding a transient PR state here.

The package root still exposes only stable public product/protocol identities. `createApplicationKernel()` remains an internal composition primitive; CLI, DSH Host, and MCP construct or receive the required runtime adapters internally.

The remaining M2 work is **M2.2 live Contract Intelligence enrichment/evaluation**: consume official `ctx.cordisInspect` evidence where a real Agent scope exists and evaluate exact-target retrieval against frozen DSH development tasks. Source/artifact plugin validation, isolated verification, and DSH Web remain later milestones.

## License

Apache-2.0.
