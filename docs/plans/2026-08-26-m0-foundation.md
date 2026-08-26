# M0 Foundation Implementation Plan

> **For agentic workers:** implement task-by-task with red/green/refactor discipline. Production behavior is not added before its failing test exists. Configuration-only files are exempt from red-first, but every configuration contract must have an executable verification gate in this milestone.

**Goal:** Build the smallest installable DSH Toolchain bundle that proves the architecture baseline is executable: one DSH-independent kernel, one protocol source, native DSH service, CLI/MCP faces, package artifact smoke, and CI-enforced dependency/contracts policy.

**Architecture:** The root npm package is the future `dsh-toolchain` distribution. `src/kernel`, `src/model`, `src/product.ts`, and `src/protocol` are runtime-neutral semantic layers; adapters and execution boundaries depend inward. The complete `src/` tree is closed-world: every production source file belongs to a declared layer and every relative source edge is checked against an explicit layer matrix. The DSH bundle contributes one Host plugin through `cordis.patch.yml`. M0 exposes no fake target/contract/verification capability and does not publish the application-kernel factory as an npm root contract; those shapes arrive only with real M1+ use cases. M0 deliberately uses plain TypeScript/NodeNext emission rather than a bundler: this preserves host peer identity, keeps package entry points transparent, and avoids build complexity that has no current requirement.

**Tech Stack:** Node `^22.19.0 || >=24`, pnpm `11.7.0`, TypeScript `6.0.3`, Vitest `4.1.8`, oxlint `1.76.0`, AJV 2020-12, `@deepseek-ai/cordis` `^4.0.1`, MCP TypeScript SDK v2 (`@modelcontextprotocol/server` `2.0.0`).

**Specs:** `docs/architecture.md`, `spec/protocol.md`, `spec/verification.md`, `docs/development.md`, ADR-0001..0005.

## Global constraints

- Current private package version is `0.0.0`; package is `private: true` so the incubator cannot publish accidentally.
- Package identity is already `dsh-toolchain`; the public repository later removes only incubator-specific publication guards, not product naming.
- DSH/Cordis host runtime APIs are peer + dev dependencies, never nested runtime copies; the tested dev version MUST satisfy the advertised peer range.
- Every production file under `src/` MUST belong to a declared architecture layer. Unknown `shared`, `util`, or similar source zones fail until explicitly designed.
- Product source under `src/` is TypeScript-family only. JavaScript-family shims under `src/` fail architecture policy even though repository-only `.mjs` scripts remain valid outside the product boundary.
- `src/kernel/**`, `src/model/**`, `src/product.ts` and `src/protocol/**` may not import Node built-ins, `@deepseek-ai/*` runtime packages, package self-references, runtime-capable layers, or directly use `process`, `require()`, or non-literal dynamic `import()`.
- CLI, MCP and DSH Host construct/use the same internal application kernel. The npm package root exposes only stable product/protocol identities in M0.
- M0 does not implement `target.resolve`, `contract.search`, `plugin.validate`, or `plugin.verify`; no placeholder operation may pretend otherwise.
- MCP uses v2 and `serveStdio`, which negotiates the 2026-07-28 protocol revision rather than the legacy direct `StdioServerTransport` bootstrap.
- Bundle shape follows current DSH: `package.json#dsh.bundle.patch` -> `cordis.patch.yml` -> package export `dsh-toolchain/dsh`; the Loader row id is namespaced as `dsh-toolchain`, while the Cordis capability remains `ctx.toolchain`.
- CI release/package smoke inspects the exact `pnpm pack` tarball, installs it as a normal package consumer would, then composes it in both a minimal DSH profile and the shipped `web` profile.
- Repository policy scripts are linted and statically checked with a dedicated JavaScript `checkJs` program.
- Add a bundler later only if a measured/publication requirement cannot be satisfied by transparent NodeNext ESM output.

---

## Task 1 — Root package and compiler/test faces

**Files:** create `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.test.json`, `vitest.config.ts`, `.oxlintrc.json`.

**Produces:** reproducible package metadata, strict TypeScript build, one-package release surface, initial scripts.

Acceptance:
- exact Node/pnpm baseline is encoded;
- package is ESM and private in incubator;
- exports reserve `.`, `./dsh`, `./protocol`;
- root runtime exports only stable M0 product/protocol identities; application kernel remains an internal package boundary;
- bins reserve `dsh-toolchain` and `dsh-toolchain-mcp`;
- `dsh.bundle.patch` points to `./cordis.patch.yml`;
- DSH/Cordis is peer + dev;
- MCP server is a Toolchain-owned runtime dependency;
- production TypeScript program does not admit JavaScript product source; test and repository-script programs have explicit separate policies;
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
- both canonical examples validate against Protocol v1 schemas;
- operation-specific `data` examples additionally validate against their referenced report definitions;
- Protocol version constant is derived from schema, not copied independently.

## Task 3 — Shared internal application kernel descriptor

**Files:** create `src/kernel/index.ts`, `src/product.ts`, `tests/kernel/kernel.spec.ts`, root public-surface tests.

**Produces:** internal `createApplicationKernel()` and immutable `KernelDescriptor` used by every M0 frontend, without prematurely committing that factory as an npm root API.

TDD sequence:
1. RED: descriptor test imports missing kernel.
2. GREEN: minimal immutable descriptor (`product`, `version`, `protocolVersion`).
3. RED: public-surface test proves the root does not expose the kernel factory before its M1 dependency shape exists.
4. GREEN/refactor: keep all IO outside kernel and export only stable root identities.

Acceptance:
- kernel has no Node/DSH/MCP imports or Node global/process escape hatches;
- descriptor protocol version comes from protocol module;
- product version matches package version through an executable consistency test;
- DSH/CLI/MCP use the internal kernel, but external package consumers are not promised its temporary M0 factory shape.

## Task 4 — Native DSH bundle and ToolchainService

**Files:** create `cordis.patch.yml`, `src/integrations/dsh/index.ts`, `tests/dsh/service.spec.ts`, `tests/package/bundle-manifest.spec.ts`.

**Produces:** installable bundle row and `ctx.toolchain` Cordis service.

TDD sequence:
1. RED: manifest/patch test fails before patch/export/provider exist.
2. GREEN: package manifest + patch refer to `dsh-toolchain/dsh` and Loader row `dsh-toolchain`.
3. RED: real Cordis context cannot resolve `ctx.toolchain` before provider.
4. GREEN: default service class extends `Service`, mounts name `toolchain`, declaration-merges `Context`, and exposes `describe()` backed by the shared kernel.

Acceptance:
- no daemon/IPC for native use;
- DSH provider imports kernel inward only;
- Loader row is namespaced `dsh-toolchain`; Cordis semantic capability remains `toolchain` / `ctx.toolchain`;
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
- version comes from shared internal kernel descriptor;
- bin wrapper contains no business logic.

## Task 6 — MCP v2 stdio face

**Files:** create `src/frontends/mcp/index.ts`, `src/frontends/mcp/bin.ts`, `tests/mcp/server.spec.ts`.

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

## Task 7 — Executable closed-world architecture/dependency policy

**Files:** create `scripts/check-architecture.mjs`, `scripts/check-package-policy.mjs`, `tsconfig.scripts.json`, tests under `tests/policy/`.

**Produces:** CI-failing architecture fitness gates.

TDD sequence:
1. RED with direct forbidden imports and runtime globals.
2. RED with `kernel -> unclassified shared -> node:fs` and JS shim bypass fixtures.
3. GREEN classifier requires every production source file to belong to a declared layer and checks resolved relative edges against the layer matrix.
4. RED with host peer/dev drift.
5. GREEN package policy validates explicit host-identity registry placement/version consistency.

Acceptance:
- every architecture source under `src/` is classified; unknown production directories fail;
- JavaScript-family production source under `src/` fails; TS/TSX/MTS/CTS are scanned;
- semantic core cannot import Node built-ins (bare or `node:`), `@deepseek-ai/*`, package self-references, or runtime-capable layers;
- semantic core rejects direct `process`, `require()`, and non-literal `import()` escape hatches;
- relative internal imports are resolved to actual source targets and checked by source-layer → target-layer matrix, closing transitive `shared` bridges;
- browser/client face cannot import Node built-ins or concrete DSH Host implementation;
- DSH/MCP/CLI may depend inward on kernel; reverse direction fails;
- identity-sensitive host dependencies are listed explicitly, required as peer + dev, forbidden as nested runtime copies, and tested dev versions satisfy advertised peer ranges;
- policy scripts themselves are included in oxlint and a dedicated `checkJs` static-check gate;
- negative tests demonstrate each bypass fails for the intended reason.

## Task 8 — CI, dependency automation, and exact-artifact smoke

**Files:** create `.github/workflows/ci.yml`, `.github/dependabot.yml`, `scripts/check-pack.mjs`, `scripts/smoke-installed-package.mjs`, tests for pack-file policy.

**Produces:** least-privilege CI and future dependency automation attached to real manifests/workflows.

Acceptance:
- workflow permissions default to `contents: read`;
- third-party actions are pinned to reviewed full SHAs;
- CI runs on pull requests, pushes to `main`, and manual dispatch;
- primary lane: Ubuntu + Node 24.19;
- Node compatibility lane: 22.19 + 24.19 + current Node 26 major;
- Windows/macOS run only boundary-sensitive smoke, not duplicate all pure tests;
- `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, `pnpm pack` run before composition smoke;
- pack checker reads the `package.json` inside the actual tarball and proves concrete `main`, `types`, recursive `exports`, `bin`, and DSH patch targets exist while source/private plans are absent;
- throwaway consumer installs the exact `.tgz`, resolves public root/protocol/DSH exports, proves the internal kernel factory is absent from root, and runs the installed CLI;
- Dependabot groups npm and Actions updates weekly with conservative PR limits.

## Task 9 — Real DSH composition smoke

**Files:** create `scripts/smoke-dsh-package.mjs`, `tests/dsh/smoke-policy.spec.ts`, wire into CI.

**Produces:** proof that the packed artifact is recognized as a current DSH bundle and composes both on the minimal base and the canonical shipped Web profile.

Acceptance:
- CI uses current pinned/tested `@deepseek-ai/dsh` train (`0.1.1-rc.2` at plan creation) rather than an unbounded `latest` during a required run;
- create temporary `DSH_HOME`;
- install exact generated tarball via profile-scoped `dsh plugin --profile <profile> add <tarball>`;
- minimal `toolchain-smoke` profile retains `@deepseek-ai/dsh-base` and registers `dsh-toolchain`;
- shipped `web` profile retains both `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` and registers `dsh-toolchain`;
- each profile manifest lists `dsh-toolchain` as a bundle/dependency;
- `dsh --profile <profile> --dump-config` contains Loader row `dsh-toolchain` mounting `dsh-toolchain/dsh`;
- focused real-Cordis lifecycle test covers service mount/dispose without inventing provider credentials;
- cleanup temp home regardless of result.

## M0 completion review

Before claiming M0 complete:
- run the aggregate protocol/architecture/package/lint/source-test-script typecheck/unit gates across supported Node lanes;
- build, pack, validate the packed manifest and install the exact artifact as an independent package consumer;
- compose the exact tarball in both minimal and shipped Web DSH profiles;
- require GitHub CI green on the final PR head;
- inspect the PR diff for architecture direction, generated ownership, package contents and accidental scope creep;
- confirm no M1+ capability or premature public kernel factory is advertised;
- record current upstream DSH/MCP versions used by the smoke in the PR evidence.
