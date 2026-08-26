# M0 Foundation Implementation Plan

> **For agentic workers:** implement task-by-task with red/green/refactor discipline. Production behavior is not added before its failing test exists. Configuration-only files are exempt from red-first, but every configuration contract must have an executable verification gate in this milestone.

**Goal:** Build the smallest installable DSH Toolchain bundle that proves the architecture baseline is executable: one DSH-independent kernel, one protocol source, native DSH service, CLI/MCP faces, package artifact smoke, and CI-enforced dependency/contracts policy.

**Architecture:** The root npm package is the future `dsh-toolchain` distribution. `src/kernel` and `src/protocol` are DSH-independent; adapters under `src/integrations` and `src/frontends` depend inward. The DSH bundle contributes one Host plugin through `cordis.patch.yml`. M0 exposes no fake target/contract/verification capability: those arrive in M1+. M0 deliberately uses plain TypeScript/NodeNext emission rather than a bundler: this preserves host peer identity, keeps package entry points transparent, and avoids build complexity that has no current requirement.

**Tech Stack:** Node `^22.19.0 || >=24`, pnpm `11.7.0`, TypeScript `6.0.3`, Vitest `4.1.8`, oxlint `1.76.0`, AJV 2020-12, `@deepseek-ai/cordis` `^4.0.1`, MCP TypeScript SDK v2 (`@modelcontextprotocol/server` `^2.0.0`).

**Specs:** `docs/architecture.md`, `spec/protocol.md`, `spec/verification.md`, `docs/development.md`, ADR-0001..0005.

## Global constraints

- Current private package version is `0.0.0`; package is `private: true` so the incubator cannot publish accidentally.
- Package identity is already `dsh-toolchain`; the public repository later removes only incubator-specific publication guards, not product naming.
- DSH/Cordis host runtime APIs are peer + dev dependencies, never nested runtime copies.
- `src/kernel/**`, `src/model/**` and `src/protocol/**` may not import `@deepseek-ai/*`, Node filesystem/process/network modules, CLI/MCP/Web adapters, or verification execution code.
- CLI, MCP and DSH Host construct/use the same application kernel.
- M0 does not implement `target.resolve`, `contract.search`, `plugin.validate`, or `plugin.verify`; no placeholder operation may pretend otherwise.
- MCP uses v2 and `serveStdio`, which negotiates the 2026-07-28 protocol revision rather than the legacy direct `StdioServerTransport` bootstrap.
- Bundle shape follows current DSH: `package.json#dsh.bundle.patch` -> `cordis.patch.yml` -> package export `dsh-toolchain/dsh`.
- CI release/package smoke inspects the exact `pnpm pack` tarball before installing it into a clean temporary DSH profile.
- Add a bundler later only if a measured/publication requirement cannot be satisfied by transparent NodeNext ESM output.

---

## Task 1 — Root package and compiler/test faces

**Files:** create `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.oxlintrc.json`.

**Produces:** reproducible package metadata, strict TypeScript build, one-package release surface, initial scripts.

Acceptance:
- exact Node/pnpm baseline is encoded;
- package is ESM and private in incubator;
- exports reserve `.`, `./dsh`, `./protocol`;
- bins reserve `dsh-toolchain` and `dsh-toolchain-mcp`;
- `dsh.bundle.patch` points to `./cordis.patch.yml`;
- DSH/Cordis is peer + dev;
- MCP server is a Toolchain-owned runtime dependency;
- TypeScript build emits NodeNext ESM + declarations without bundling host/runtime dependencies;
- `pnpm check` is the single local/CI aggregate gate.

## Task 2 — Protocol code generation and conformance

**Files:** create `scripts/generate-protocol.mjs`, `scripts/check-protocol.mjs`, `src/protocol/index.ts`, generated `src/protocol/generated.ts`, tests under `tests/protocol/`.

**Produces:** Protocol v1 constants/types derived from `spec/schemas/v1/toolchain-protocol.schema.json` and executable schema/example validation.

TDD sequence:
1. RED: generator/conformance tests fail because generated output/checker do not exist.
2. GREEN: deterministic generation and AJV 2020-12 validation.
3. REFACTOR: keep generator ownership explicit; generated file contains a do-not-edit header.

Acceptance:
- `pnpm generate` is deterministic;
- `pnpm check:generated` compares expected generated output without silently mutating tracked files;
- both canonical examples validate against the response schema;
- operation-specific `data` examples additionally validate against their referenced report definitions;
- Protocol version constant is derived from schema, not copied independently.

## Task 3 — Shared application kernel descriptor

**Files:** create `src/kernel/index.ts`, `src/product.ts`, `tests/kernel/kernel.spec.ts`.

**Produces:** `createApplicationKernel()` and immutable `KernelDescriptor` used by every M0 frontend.

TDD sequence:
1. RED: descriptor test imports missing kernel.
2. GREEN: minimal immutable descriptor (`product`, `version`, `protocolVersion`).
3. RED: mutation/fresh-instance tests prove descriptor cannot be mutated/shared accidentally.
4. GREEN/refactor: freeze descriptor and keep all IO outside kernel.

Acceptance:
- kernel has no Node/DSH/MCP imports;
- descriptor protocol version comes from protocol module;
- product version matches package version through an executable consistency test.

## Task 4 — Native DSH bundle and ToolchainService

**Files:** create `cordis.patch.yml`, `src/integrations/dsh/index.ts`, `tests/dsh/service.spec.ts`, `tests/package/bundle-manifest.spec.ts`.

**Produces:** installable bundle row and `ctx.toolchain` Cordis service.

TDD sequence:
1. RED: manifest/patch test fails before patch/export/provider exist.
2. GREEN: package manifest + patch refer to `dsh-toolchain/dsh`.
3. RED: real Cordis context cannot resolve `ctx.toolchain` before provider.
4. GREEN: default service class extends `Service`, mounts name `toolchain`, declaration-merges `Context`, and exposes `describe()` backed by the shared kernel.

Acceptance:
- no daemon/IPC for native use;
- DSH provider imports kernel inward only;
- service description equals direct kernel descriptor;
- unloading provider removes the service through normal Cordis lifecycle.

## Task 5 — CLI face

**Files:** create `src/frontends/cli/index.ts`, `src/frontends/cli/bin.ts`, `tests/cli/cli.spec.ts`.

**Produces:** dependency-light CLI shell with `--help`, `--version`, and `mcp` handoff only.

TDD sequence:
1. RED: help/version behavior missing.
2. GREEN: injectable IO runner prints deterministic help/version to stdout and errors to stderr.
3. RED: unknown command returns non-zero without contaminating machine/protocol stdout.
4. GREEN: explicit exit-code contract.

Acceptance:
- no target/validation commands until their milestones;
- version comes from shared kernel descriptor;
- bin wrapper contains no business logic.

## Task 6 — MCP v2 stdio face

**Files:** create `src/frontends/mcp/server.ts`, `src/frontends/mcp/bin.ts`, `tests/mcp/server.spec.ts`.

**Produces:** MCP v2 server factory and stdio launcher with no fake Toolchain tools yet.

TDD sequence:
1. RED: server factory missing.
2. GREEN: server identity comes from shared kernel descriptor.
3. RED: adapter construction test proves one kernel factory path is used.
4. GREEN: `serveStdio(() => buildMcpServer())` launcher; stdout remains protocol-only.

Acceptance:
- uses `@modelcontextprotocol/server` v2, not deprecated v1 monolith;
- stdio path uses `serveStdio` to support the 2026-07-28 revision;
- no HTTP transport in M0;
- no advertised Toolchain operations not implemented by kernel.

## Task 7 — Executable architecture/dependency policy

**Files:** create `scripts/check-architecture.mjs`, `scripts/check-package-policy.mjs`, tests under `tests/policy/`.

**Produces:** CI-failing architecture fitness gates.

TDD sequence:
1. RED with fixture containing forbidden import.
2. GREEN scanner reports exact file/import/rule.
3. RED with package fixture nesting `@deepseek-ai/cordis` in dependencies.
4. GREEN package policy rejects identity-sensitive host packages outside peer+dev.

Acceptance:
- pure kernel/protocol cannot import Node IO/process/network or `@deepseek-ai/*`;
- browser/client face cannot import Node-only modules or Host implementation (rule reserved even before Web exists);
- DSH/MCP/CLI may import kernel; reverse direction fails;
- framework dependency rule fails loud with actionable diagnostics.

## Task 8 — CI, dependency automation, and exact-artifact smoke

**Files:** create `.github/workflows/ci.yml`, `.github/dependabot.yml`, `scripts/check-pack.mjs`, tests for pack-file policy.

**Produces:** least-privilege CI and future dependency automation attached to real manifests/workflows.

Acceptance:
- workflow permissions default to `contents: read`;
- third-party actions are pinned to reviewed full SHAs;
- primary lane: Ubuntu + Node 24;
- Node compatibility lane: 22.19 + 24;
- Windows/macOS run only boundary-sensitive smoke, not duplicate all pure tests;
- `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, `pnpm pack` run before composition smoke;
- pack checker proves required exports/bin/patch/lib files are inside tarball and source/private plans are not accidentally shipped;
- Dependabot groups npm and Actions updates weekly with conservative PR limits.

## Task 9 — Real DSH composition smoke

**Files:** create `scripts/smoke-dsh-package.mjs`, wire into CI.

**Produces:** proof that the packed artifact is recognized as a current DSH bundle and can compose in a clean profile.

Acceptance:
- CI uses current pinned/tested `@deepseek-ai/dsh` train (`0.1.1-rc.2` at plan creation) rather than an unbounded `latest` during a run;
- create temporary `DSH_HOME`;
- install exact generated tarball via `dsh plugin --profile toolchain-smoke add <tarball>`;
- assert profile manifest lists `dsh-toolchain` as a bundle;
- run `dsh --profile toolchain-smoke --dump-config` and assert Toolchain row is present;
- boot/load service through a keyless composition path where possible; if the current DSH CLI surface requires application rows to stay alive, use a focused Cordis service integration test rather than inventing credentials;
- cleanup temp home regardless of result.

## M0 completion review

Before claiming M0 complete:
- run `pnpm check`, build, pack, and package inspection on supported local/CI Node;
- require GitHub CI green on the PR head;
- inspect the PR diff for architecture direction, generated ownership, package contents and accidental scope creep;
- confirm no M1+ capability is advertised without implementation;
- record current upstream DSH/MCP versions used by the smoke in the PR evidence.
