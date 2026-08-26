# M1.1 Target Frontend Parity — Implementation Plan

**Goal:** project the existing M1 `target.resolve` semantics through DSH Service, one native DSH tool, and MCP without duplicating target logic.

**Sources:** `spec/protocol.md`, `docs/architecture.md`, `docs/roadmap.md` M1.1, current upstream DSH tool authoring contract, MCP TypeScript SDK v2.

## Constraints

- Protocol v1 owns request/result/response DTOs, diagnostics and `dsh-target-v2` semantics.
- CLI, DSH and MCP must share one expected-error → Protocol-response path.
- Semantic core stays free of Node/DSH runtime APIs.
- DSH native tool is conditional on mounted `ctx.tools`; minimal profiles must still boot Toolchain Service.
- `profile` stays explicit: current DSH does not expose selected profile as a supported Cordis capability. No argv/PATH guessing.
- DSH acquisition stays read-only.
- MCP uses v2 `registerTool`; structured output is Protocol v1, not an MCP-owned DTO.
- Exact packed-artifact smoke is authoritative for DSH Host/tool visibility.

## Task 1 — shared Protocol response execution

**Files:** `src/kernel/index.ts`, `src/frontends/cli/index.ts`, kernel/CLI target tests.

- [ ] RED: success + acquisition-failure tests for `resolveTargetResponse(kernel, request, requestId)`.
- [ ] GREEN: implement one runtime-neutral mapping from `TargetAcquisitionError` to Protocol `TARGET_*` diagnostic.
- [ ] Refactor CLI to use it; unexpected infrastructure errors still propagate.
- [ ] Verify focused kernel/CLI tests.

## Task 2 — DSH Service parity

**Files:** `src/integrations/dsh/index.ts`, `tests/dsh/service.spec.ts`, acquisition files only if needed.

- [ ] RED: `ctx.toolchain.resolveTarget()` returns Protocol success/failure responses with the shared diagnostic identity.
- [ ] GREEN: service delegates to existing kernel + shared response helper.
- [ ] Use stable Host launch-time acquisition context only where upstream exposes it; do not invent active-profile inference.
- [ ] Verify DSH/acquisition tests.

## Task 3 — native DSH tool

**Files:** focused DSH integration/tool module, DSH tests, package metadata only if compile-time upstream types are needed.

- [ ] RED: tool registers when `tools` appears, is absent without it, follows lifecycle, and delegates to `ctx.toolchain.resolveTarget`.
- [ ] Tool name: `toolchain_target_resolve`.
- [ ] Parameters mirror Protocol request: required `profile`; optional `dshHome`, `dshPackageRoot`, ordered `patches`.
- [ ] Canonical output is `TargetResolveResponse`, not prose.
- [ ] GREEN using current upstream Cordis `ctx.inject()` / DSH tool registry semantics.

## Task 4 — MCP target.resolve

**Files:** `src/frontends/mcp/index.ts`, `tests/mcp/server.spec.ts`.

- [ ] RED: registration + success/failure structured response tests.
- [ ] GREEN: register `target.resolve` via MCP v2 `registerTool`.
- [ ] Derive validation from Protocol JSON Schema through MCP `fromJsonSchema` where practical; no transport-owned target DTO.
- [ ] Mark read-only/idempotent metadata.

## Task 5 — parity, exact-package smoke, docs

**Files:** frontend parity tests, `scripts/smoke-dsh-package.mjs`, smoke-policy tests, README/roadmap/development docs as affected.

- [ ] RED: cross-frontend semantic parity and real DSH native-tool visibility expectations.
- [ ] GREEN: exact `.tgz` boot proves `ctx.toolchain`, `ctx.toolchain.resolveTarget`, and native tool visibility through a real suitable DSH profile; minimal composition remains valid.
- [ ] Run Protocol/generated/architecture/package/lint/type/tests/build/pack/consumer/DSH gates.
- [ ] Final diff review; PR evidence must name the final head and actual CI run.
- [ ] Squash merge only after all required lanes are green.

## Non-goals

No M2 contract search/index, M3 validation, M4 verification worker, Web UI, generic frontend framework, or new active-profile abstraction.
