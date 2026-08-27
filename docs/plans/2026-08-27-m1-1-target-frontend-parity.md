# M1.1 Target Frontend Parity — Implementation Plan

**Goal:** project the existing M1 `target.resolve` semantics through DSH Service, one native DSH tool, and MCP without duplicating target logic.

**Tracking:** Issue #25, PR #24.

**Sources:** `spec/protocol.md`, `docs/architecture.md`, `docs/roadmap.md` M1.1, current upstream DSH tool authoring contract, MCP TypeScript SDK v2.

## Constraints

- Protocol v1 owns request/result/response DTOs, diagnostics and `dsh-target-v2` semantics.
- CLI, DSH and MCP share one expected-error → Protocol-response path.
- Semantic core stays free of Node/DSH runtime APIs.
- DSH native tool is conditional on mounted `ctx.tools`; minimal profiles still boot Toolchain Service.
- `profile` stays explicit: current DSH does not expose selected profile as a supported Cordis capability. No argv/PATH guessing.
- DSH acquisition stays read-only.
- MCP uses v2 `registerTool`; structured output is Protocol v1, not an MCP-owned DTO.
- Exact packed-artifact smoke is authoritative for DSH Host/tool visibility.
- Because Toolchain registers a raw host-owned ToolDefinition without bundling `@deepseek-ai/dsh-tools`, the DSH adapter validates raw `unknown` arguments before delegating to Service.

## Task 1 — shared Protocol response execution — complete

**Files:** `src/kernel/index.ts`, `src/frontends/cli/index.ts`, kernel/CLI target tests.

- [x] RED: success + acquisition-failure tests for `resolveTargetResponse(kernel, request, requestId)` — CI #207.
- [x] GREEN: one runtime-neutral mapping from `TargetAcquisitionError` to Protocol `TARGET_*` diagnostic.
- [x] CLI uses the same helper; unexpected infrastructure errors still propagate.
- [x] Focused and aggregate kernel/CLI tests pass.

## Task 2 — DSH Service parity — complete

**Files:** `src/integrations/dsh/index.ts`, `tests/dsh/service.spec.ts`.

- [x] RED: `ctx.toolchain.resolveTarget()` required to return Protocol success/failure responses — CI #210.
- [x] GREEN: Service delegates to the existing kernel + shared response helper.
- [x] No active-profile inference was introduced; `profile` remains explicit.
- [x] Full six-lane CI #212 passed after the Service implementation.

## Task 3 — native DSH tool — complete

**Files:** `src/integrations/dsh/target-tool.ts`, `src/integrations/dsh/index.ts`, DSH tests.

- [x] RED: tool registration/lifecycle/delegation expectations — CI #213.
- [x] Tool name is `toolchain_target_resolve`.
- [x] Parameters mirror the Protocol request: required `profile`; optional `dshHome`, `dshPackageRoot`, ordered `patches`.
- [x] Canonical output is `TargetResolveResponse`, not a frontend-owned DTO.
- [x] Registration is conditional/lifecycle-owned through Cordis `ctx.inject(['tools'], ...)`.
- [x] Toolchain does not import or bundle `@deepseek-ai/dsh-tools`; the running Host owns that identity-sensitive runtime.
- [x] Raw-tool runtime validation rejects malformed/extra input before Service invocation. RED: CI #219; GREEN aggregate: CI #221.

## Task 4 — MCP target.resolve — complete

**Files:** `src/frontends/mcp/index.ts`, `tests/mcp/server.spec.ts`.

- [x] RED: registration + success/failure structured response tests — CI #217.
- [x] `target.resolve` is registered via MCP v2 `registerTool`.
- [x] Input/output validators project Protocol JSON Schema `$defs` through MCP `fromJsonSchema`; there is no MCP-owned target DTO.
- [x] Tool is marked read-only/idempotent.
- [x] CI #218 passed all six lanes, including exact pack/composition and multi-train target smoke.

## Task 5 — parity, exact-package smoke, docs — in final verification

**Files:** frontend parity tests, `scripts/smoke-dsh-package.mjs`, smoke-policy tests, README/roadmap/development docs.

- [x] RED: real DSH native-tool visibility/execution receipt required — CI #222 (103 pass / 2 intentional failures).
- [x] GREEN: CI #223 exact `.tgz` boot proved `ctx.toolchain.resolveTarget()`, real host-owned `ctx.tools.schemas()`, `ctx.tools.execute()` of `toolchain_target_resolve`, JSON rendering, and identical `dsh-target-v2` fingerprints from Service and native tool; minimal/Web composition and the multi-train target smoke also passed.
- [x] Cross-frontend parity tests were added for CLI / native DSH tool / MCP success and expected target failure; transport request IDs are the only normalized difference.
- [ ] Record final parity/docs head green across Protocol/generated/architecture/package/lint/type/tests/build/pack/consumer/DSH gates.
- [ ] Final diff/review check; PR evidence must name final head and actual CI run.
- [ ] Squash merge only after all final-head required lanes are green.

## Non-goals

No M2 contract search/index, M3 validation, M4 verification worker, Web UI, generic frontend framework, or new active-profile abstraction.
