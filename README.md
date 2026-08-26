# DSH Toolchain

DSH Toolchain is a plugin-first development toolchain for DeepSeek Harness.

Its canonical distribution is a single installable DSH bundle that gives DSH users and agents the same development intelligence through native DSH services, DSH Web, CLI, and MCP. Internally, the semantic/application kernel remains independent from DSH runtime APIs so the same target semantics can be reused by Codex, Claude Code, OpenCode, CI, and other clients.

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

M1 establishes the target half of that pipeline. Contract intelligence, plugin checking, and isolated verification build on the same target identity in later milestones rather than inventing parallel target models.

## Installation model

DSH plugin management is profile-scoped. Once the public package is released, the canonical installation shape is:

```bash
dsh plugin --profile <profile> add dsh-toolchain
```

For the canonical Web profile:

```bash
dsh plugin --profile web add dsh-toolchain
```

The private incubator package is not published to npm. CI packs the exact `.tgz`, installs it into disposable DSH profiles, verifies minimal and Web composition, then boots a real DSH host with an external probe that observes `ctx.toolchain` and calls `ctx.toolchain.describe()` before requesting a clean launcher-owned shutdown.

## Exact target resolution

M1 exposes the first useful machine-facing operation through the CLI:

```bash
dsh-toolchain target resolve --profile <name>
```

Optional acquisition hints are available when the caller needs to inspect a specific home or DSH installation:

```bash
dsh-toolchain target resolve \
  --profile web \
  --dsh-home /path/to/.dsh \
  --dsh-package-root /path/to/node_modules/@deepseek-ai/dsh
```

The command writes one Toolchain Protocol v1 JSON response. A successful result contains an immutable `TargetSnapshot` with:

- exact `@deepseek-ai/dsh` version;
- Node version, platform, and architecture;
- profile name;
- ordered exact bundle identities;
- exact installed top-level profile dependency identities;
- profile patch content hash;
- content-hashed evidence and provenance;
- a deterministic `dsh-target-v1:<sha256>` semantic fingerprint.

The fingerprint deliberately excludes absolute paths, timestamps, evidence locations, and Toolchain's own observer version. Bundle order, profile patch bytes, exact target package versions, and runtime coordinates remain semantic.

Target resolution is read-only: Toolchain does not initialize a missing profile, install packages, or rewrite profile state to make the operation succeed. CI verifies this against real `headless` profiles on DSH `0.1.1-rc.2` and `0.1.0-rc.8`, including the same semantic profile copied to a different `DSH_HOME`.

Expected target acquisition failures are returned as stable Protocol diagnostics. CLI syntax errors remain CLI errors; unexpected infrastructure failures are not disguised as target diagnostics.

## Architecture baseline

Read in this order:

1. [`docs/architecture.md`](docs/architecture.md)
2. [`spec/protocol.md`](spec/protocol.md)
3. [`spec/verification.md`](spec/verification.md)
4. [`docs/security.md`](docs/security.md)
5. [`docs/roadmap.md`](docs/roadmap.md)
6. relevant ADRs under [`docs/decisions/`](docs/decisions/)

M1 target semantics are defined by [`ADR-0006`](docs/decisions/ADR-0006-target-semantic-fingerprint-v1.md) and the approved [M1 design](docs/plans/2026-08-26-m1-target-intelligence-design.md).

Development policy lives in [`docs/development.md`](docs/development.md). All contributors—human or automated—follow [`CONTRIBUTING.md`](CONTRIBUTING.md); coding agents also follow [`AGENTS.md`](AGENTS.md).

## Repository status

This private repository is the development incubator. The future public project is a new clean `definitely-stable/dsh-toolchain` repository created from curated approved source states; the incubator history is not intended to become public history.

M0 Foundation and the M1 Target Intelligence vertical slice are implemented in the current development branch. M1 includes the closed `target.resolve` Protocol contract, explicit target semantic projection/fingerprint, read-only Node acquisition, the first real application-kernel use case, CLI projection, real multi-train target smoke, and exact-package live DSH service visibility smoke.

The package root still exposes only stable public product/protocol identities. `createApplicationKernel()` remains an internal composition primitive; CLI, DSH Host, and MCP construct the required runtime adapters internally.

Not yet implemented as public Toolchain capabilities:

- M2 `contract.search` / `contract.inspect`;
- source/artifact plugin analysis and validation;
- isolated plugin verification and verification receipts;
- DSH Web UI;
- native DSH/MCP projection of `target.resolve` beyond their shared internal kernel wiring.

The CLI does not advertise those future operations as if they already existed.

## License

Apache-2.0.
