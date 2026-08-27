# M2.2 Agent-scoped Live Inspect — Implementation Plan

> **Execution rule:** use TDD. Every behavioral change must have an observed RED before the minimal GREEN. Do not add dummy Agent/global current-Agent state.

**Issue:** #31  
**Base:** M2.1 squash merge `0c647dceb0af00b36ca28a91cb520bd697a33efb`  
**Upstream DSH baseline:** `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `dsh@0.1.1-rc.2`.

## Goal

Enrich the existing target-bound Contract Index with authoritative live DSH Cordis Inspect evidence only when a native DSH tool is executing for a real Agent. CLI and MCP remain valid offline paths. The M2.1 kernel/model must stay free of DSH `Agent`, Cordis `Context`, ToolExecution and provider DTO types.

## Verified upstream seam

The official Host `CordisInspectRegistryService.query(platform, providerId, methodName, input, agent, signal)` requires the requesting `Agent` and the tool-call `AbortSignal`. First-party Host providers currently expose `Service.listService`, `Event.listEvents`, `Builtin.listBuiltins`, and Agent-scoped `Tool.listTools`; the Client directory may expose `Slots.listSubTree`.

Therefore M2.2 adapts live Inspect **per tool invocation** from the native DSH `ToolRunContext`. It must never invent an Agent for CLI/MCP or retain Agent state between calls.

## Architectural boundary

```text
real DSH ToolExecution / ToolRunContext
        │  agent + signal
        ▼
DSH integration adapter
        │  calls ctx.cordisInspect.list/query
        ▼
Toolchain-owned LiveContractEvidence
        │  JSON-only normalized facts/provenance
        ▼
existing Contract acquisition/index semantics
        ▼
contract.search / contract.inspect
```

DSH runtime types stop at the integration adapter. Kernel and model see only Toolchain-owned immutable data.

## Task 1 — Prove the current native boundary drops ToolExecution

**Files**
- Test: `tests/dsh/contract-tool.spec.ts`
- Modify later: `src/integrations/dsh/contract-tool.ts`

- [ ] RED: execute native search/inspect definitions with a structural execution object containing `agent` and `signal` and prove the resolver does not receive it today.
- [ ] GREEN: introduce a narrow integration-owned execution-context shape and forward it to native search/inspect resolver callbacks.
- [ ] Missing/invalid Agent must not cause CLI/MCP changes; only the DSH live-enrichment adapter decides whether live Inspect is available.

## Task 2 — Add a narrow Cordis Inspect port at the DSH integration boundary

**Files**
- Create: `src/integrations/dsh/live-inspect.ts`
- Modify: `src/integrations/dsh/index.ts`
- Test: `tests/dsh/live-inspect.spec.ts`

- [ ] RED: with a real-shaped execution context and inspect registry, list supported first-party providers and query one Host provider using the exact same `agent` object and `signal` object.
- [ ] GREEN: structural port over `ctx.cordisInspect.list/query`; do not import/bundle DSH Agent or cordis-host-runner runtime identities.
- [ ] Missing registry/provider is an offline/no-live-evidence condition, not an invented negative capability.
- [ ] Forward cancellation exactly; do not replace signals and do not abandon provider promises.

## Task 3 — Normalize Host Service/Event/Tool evidence

**Files**
- Create/modify integration live-inspect normalizer files under `src/integrations/dsh/`
- Add focused tests under `tests/dsh/`

- [ ] `Service.listService`: compact directory first, exact service second when selected.
- [ ] `Event.listEvents`: compact directory first, exact event second when selected.
- [ ] `Tool.listTools`: Agent-scoped live tool schemas; provenance identifies `host/Tool/listTools`.
- [ ] `Builtin.listBuiltins`: include only if it materially contributes contract facts.
- [ ] Normalize provider output into Toolchain-owned immutable JSON/facts/evidence; never expose raw provider DTOs to kernel/model.
- [ ] Deterministic ordering and canonical provenance independent of object insertion order.

## Task 4 — Merge live evidence with M2.1 acquisition without parallel identity

**Files**
- Modify model/acquisition/kernel only through Toolchain-owned ports/types.
- Tests: model/kernel fingerprint and freshness tests.

- [ ] RED: same offline target/evidence + changed normalized live evidence changes `dsh-contract-index-v1` while `dsh-target-v2` stays stable.
- [ ] GREEN: deterministic overlay/merge on existing contracts/evidence; no second live index namespace.
- [ ] Offline facts remain; live facts enrich rather than wholesale replace them.
- [ ] `availability` moves from `unknown` only when authoritative live evidence proves presence.
- [ ] Every live fact references evidence with provider/platform/method provenance.
- [ ] Search keeps minimal witnesses; inspect returns exact supporting live/offline evidence.

## Task 5 — Per-call DSH orchestration

**Files**
- Modify: `src/integrations/dsh/index.ts`, `contract-tool.ts`
- Tests: `tests/dsh/contract-tool.spec.ts`, `tests/dsh/service.spec.ts`

- [ ] Native DSH `contract.search`/`contract.inspect` use live evidence only when current execution carries an Agent and the Inspect capability exists.
- [ ] No global/current Agent singleton, cache keyed by Agent object, or service-level retained execution state.
- [ ] Two concurrent calls with different Agents cannot cross-contaminate evidence.
- [ ] Aborted call forwards the same signal through every Inspect query and settles after provider work reaches quiescence.
- [ ] CLI/MCP output remains the M2.1 offline path when no DSH execution context exists.

## Task 6 — Client Slots after Host path is stable

- [ ] Discover Client `Slots.listSubTree` only from the official registry directory.
- [ ] Query it with the same Agent/signal through registry routing.
- [ ] Client provider absence/timeout does not manufacture `unavailable` contracts.
- [ ] Normalize only stable, useful slot evidence; preserve bounded progressive retrieval.

## Task 7 — Exact packed-artifact verification

**Files**
- Modify: `scripts/smoke-dsh-package.mjs`
- Policy regression as needed.

- [ ] Exact `pnpm pack` tarball composed into real DSH `0.1.1-rc.2` minimal/Web profiles.
- [ ] Real host-owned ToolRuntime executes native Contract Intelligence with an actual Agent-scoped ToolExecution.
- [ ] Smoke proves at least one live Host fact/evidence item and deterministic search/inspect continuity.
- [ ] Optional Inspect provider absence preserves offline behavior.
- [ ] Existing shipped-Web `ToolDefinition -> @deepseek-ai/dsh-tools -> inspect` proof remains green.
- [ ] Multi-train target-only smoke remains green; M2.2 live proof is pinned only to trains that expose the official Inspect contract.

## Final merge gate

- [ ] Protocol/generated checks unchanged unless a public schema change is explicitly justified.
- [ ] Architecture/package/CI-storage checks green.
- [ ] Full tests/lint/typechecks green on Node 22.19/24.19/26.
- [ ] Windows 2025/macOS 15 boundary smoke green.
- [ ] Exact packed-artifact real DSH live smoke green.
- [ ] PR comments/reviews/threads reconciled on exact final HEAD.
- [ ] Issue #31 updated with RED→GREEN chronology and exact final CI evidence before merge.
