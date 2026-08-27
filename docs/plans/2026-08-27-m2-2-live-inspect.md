# M2.2 Agent-scoped Live Inspect — Implementation Plan

> **Execution rule:** use TDD. Every behavioral change must have an observed RED before the minimal GREEN. Do not add a dummy Agent, global/current-Agent state, an Agent-keyed cache, or a parallel live Contract Index.

**Issue:** #31  
**Parent:** #28  
**Base:** M2.1 squash merge `0c647dceb0af00b36ca28a91cb520bd697a33efb`  
**Upstream DSH baseline:** `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `dsh@0.1.1-rc.2`.

## Goal

Enrich the existing target-bound Contract Index with authoritative live DSH Cordis Inspect evidence only when native DSH Contract Intelligence is executing for a real Agent. CLI, MCP and ordinary `ctx.toolchain` Service calls remain valid offline paths. DSH `Agent`, Cordis `Context`, ToolExecution and provider DTO types stop at the DSH integration boundary.

M2.2 is not M2 completion. M2.3 remains a separate frozen retrieval evaluation before parent #28 can close.

## Verified upstream seam

The official `CordisInspectRegistryService` exposes:

```ts
list(): CordisInspectProviderView[]
query(platform, providerId, methodName, input, agent, signal): Promise<JsonValue>
```

`query(...)` requires the requesting real `Agent` and the tool-call `AbortSignal`, validates provider input/output, and forwards cancellation. At the pinned upstream baseline first-party Host providers are:

- `host/Service/listService` — compact Service + method-signature directory, or one exact Service coding contract;
- `host/Event/listEvents` — compact Event + signature directory, or one exact Event coding contract;
- `host/Tool/listTools` — every Tool schema currently callable by the requesting Agent;
- `host/Builtin/listBuiltins` — dynamic Host builtins.

Client providers include `client/Slots/listSubTree`, but Client work follows the proven Host path.

## Corrected design decisions

### 1. Narrow capability projection is a hard boundary

Native `ToolExecution` is never passed downstream by type assertion. `contract-tool.ts` constructs a new immutable `{ agent, signal }` object and drops every other execution capability before invoking a resolver. An extra field on the Host execution object must be unobservable downstream.

### 2. Offline acquisition and live enrichment are distinct internal ports

M2.1 `ContractAcquisitionPort.acquire(snapshot)` remains the read-only static acquisition seam. M2.2 adds a Toolchain-owned, runtime-neutral request-aware enrichment seam. Kernel owns merge, canonicalization and `dsh-contract-index-v1`; the DSH integration adapter only converts official Inspect JSON into Toolchain-owned `Evidence` / `ContractDefinition` values.

CLI/MCP/ordinary Service calls omit the enrichment seam and retain exact M2.1 behavior.

### 3. Search/inspect identity continuity beats hidden richness

A stateless `contract.inspect` must be able to rebuild the same index fingerprint returned by `contract.search`. Therefore M2.2 indexes only the stable compact live surface that can be reacquired identically for both operations: Host Service/Event directories and Agent-scoped Tool schemas.

An exact `Service.listService({service})`, `Event.listEvents({event})`, or Client Slot query must **not** silently add new indexed facts after search, because that would change the content-addressed Contract Index and make a valid search fingerprint stale by construction. Exact provider detail is postponed unless it can be represented without changing indexed semantics, or a later explicit protocol/identity decision introduces a separate detail identity.

### 4. Availability semantics are positive-proof only in M2.2

- a live directory/tool row proves that normalized contract `available` in the observed Agent scope;
- missing Inspect capability/provider/client page is `no live evidence`, not `unavailable`;
- absence from a provider result is not normalized to `unavailable` unless the provider contract is explicitly exhaustive for the exact queried scope and a test proves that interpretation;
- offline declarations remain `unknown` when live evidence says nothing about them.

This slice therefore primarily upgrades `unknown -> available`; it does not manufacture negative runtime claims.

### 5. Agent/session identity is not semantic fingerprint input

Agent object identity, Agent id/session id, request id, AbortSignal identity and timestamps never enter `dsh-contract-index-v1`. Different Agents produce different fingerprints only when the normalized contract/evidence semantics visible to them differ.

### 6. Live observations are invocation-scoped, not an atomic runtime snapshot claim

The upstream registry exposes no global epoch/version marker covering multiple provider queries. M2.2 therefore defines one enrichment as an **ordered observational sample within one tool invocation**, not a claim that all providers were read atomically. Deterministic query order and normalized results define the sample; no wall-clock metadata enters semantic identity.

A later upstream epoch seam may strengthen freshness without changing the rule that mixed evidence is never presented as an atomic snapshot unless such a seam exists.

### 7. Live acquisition is bounded before materialization where possible

Defaults are internal safety policy, not Protocol fields. The implementation must bound at least:

- provider directory entries consumed;
- normalized live contracts;
- live facts per contract and total facts;
- serialized provider result bytes;
- Tool schema serialized bytes per tool and total;
- recursively inspected JSON depth/node count where provider values are normalized.

Exceeding a live safety bound fails the native operation explicitly; it must not truncate silently into a false complete contract set.

### 8. Provider text is untrusted contract data

Descriptions/schema text returned by installed plugins are preserved only as bounded data/facts. They are never interpreted as Toolchain instructions, system prompts, or executable code.

## Data flow

```text
real DSH ToolExecution
        │
        ├─ project new { agent, signal } only
        ▼
DSH live Inspect adapter
        │  list official provider directory
        │  query supported provider methods in deterministic order
        ▼
Toolchain-owned live Evidence + ContractDefinition[]
        │
        ▼
Kernel merge with M2.1 AcquiredContractFacts
        │
        ▼
createContractIndex(...)
        │
        ├─ contract.search
        └─ contract.inspect
```

## Task 1 — Close the native execution boundary

**Files**
- Test: `tests/dsh/contract-tool.spec.ts`
- Modify: `src/integrations/dsh/contract-tool.ts`

- [ ] RED: pass an execution object containing `agent`, `signal`, and an unrelated capability; prove the resolver currently receives the unrelated capability.
- [ ] GREEN: construct and freeze a new narrow execution object containing only captured `agent` and valid `AbortSignal`.
- [ ] Preserve object identity of the actual `agent` and `signal`; do not clone or replace them.
- [ ] Non-object execution remains absent context.

## Task 2 — Add the structural Inspect adapter and safety budget

**Files**
- Create: `src/integrations/dsh/live-inspect.ts`
- Test: `tests/dsh/live-inspect.spec.ts`
- Modify: `src/integrations/dsh/index.ts`

- [ ] RED: structural registry `list/query` receives the exact projected Agent and AbortSignal.
- [ ] GREEN: adapt `ctx.cordisInspect` structurally; never import/bundle DSH Agent or cordis-host-runner runtime identity.
- [ ] Select supported provider/method pairs only from `list()`; provider absence yields no enrichment.
- [ ] Query in deterministic order independent of registry insertion order.
- [ ] Forward the same signal to every query; an abort/rejection is awaited and never detached.
- [ ] Enforce explicit live result/contract/fact/schema budgets with deterministic failures.

## Task 3 — Normalize Host Service/Event/Tool compact evidence

**Files**
- Create: `src/integrations/dsh/live-contract-normalizer.ts`
- Test: `tests/dsh/live-contract-normalizer.spec.ts`

- [ ] `Service.listService({})`: normalize compact rows to `service` contracts with stable ids, summary and method-signature facts.
- [ ] `Event.listEvents({})`: normalize compact rows to `event` contracts with stable ids, summary/mode/signature facts.
- [ ] `Tool.listTools({})`: normalize Agent-scoped tool schemas to `tool` contracts using bounded canonical JSON facts.
- [ ] Mark only positively observed rows `available`.
- [ ] Every live contract/fact references authoritative or observed live evidence whose `source` canonically names `platform/provider/method` and whose `contentHash` binds the exact normalized provider JSON consumed.
- [ ] Provider array/object order differences that are semantically irrelevant normalize deterministically; meaningful schema/contract changes alter evidence/index identity.
- [ ] Ignore `Builtin` until a concrete baseline `ContractKind`/use case requires it.

## Task 4 — Add runtime-neutral enrichment/merge semantics to model/kernel

**Files**
- Modify: `src/model/contract.ts`
- Modify: `src/kernel/index.ts`
- Test: `tests/model/contract.spec.ts`
- Test: `tests/kernel/contract-intelligence.spec.ts`

- [ ] RED: same offline target plus changed normalized live evidence changes `dsh-contract-index-v1` while `dsh-target-v2` stays stable.
- [ ] RED: equal live semantics acquired in different order produce the same index.
- [ ] GREEN: add a Toolchain-owned optional enrichment seam and deterministic merge; no DSH types in model/kernel.
- [ ] Merge contracts by stable id. Live facts add evidence-backed semantics; an observed matching contract may upgrade `unknown -> available` but never deletes offline facts.
- [ ] Conflicting incompatible live/offline identity/kind/name values fail loud instead of silently selecting a winner.
- [ ] Search still returns minimal evidence witnesses; inspect returns the evidence referenced by the selected merged contract.

## Task 5 — Per-call native DSH orchestration

**Files**
- Modify: `src/integrations/dsh/index.ts`
- Modify: `src/integrations/dsh/contract-tool.ts`
- Test: `tests/dsh/service.spec.ts`
- Test: `tests/dsh/contract-tool.spec.ts`

- [ ] Native `toolchain_contract_search` and `toolchain_contract_inspect` supply live enrichment only when the current execution has a real Agent, a real AbortSignal, and `ctx.cordisInspect` is present.
- [ ] Ordinary `ctx.toolchain.searchContracts/inspectContract`, CLI and MCP remain M2.1 offline semantics.
- [ ] Two overlapping native calls with different Agent objects cannot cross-contaminate queries/results.
- [ ] Agent ids themselves do not affect the fingerprint when returned live semantics are equal.
- [ ] Aborted calls forward one signal through all provider work and settle only after the awaited provider query settles.

## Task 6 — Client Slots after Host semantics are stable

**Files**
- Extend `live-inspect.ts` / normalizer tests only after Tasks 1–5 are GREEN.

- [ ] Discover `client/Slots/listSubTree` only from the official registry directory.
- [ ] Normalize compact trees to stable `client-slot` contracts without assuming a responding Client exists.
- [ ] Provider/page absence or cancellation does not manufacture `unavailable` slots.
- [ ] Keep the same live budgets and observational-sample semantics.
- [ ] Do not index exact selected Slot details unless identity continuity is explicitly solved.

## Task 7 — Exact packed-artifact verification

**Files**
- Modify: `scripts/smoke-dsh-package.mjs`
- Modify policy regression only if the smoke contract requires it.

- [ ] Pack the exact branch artifact and compose it into real DSH `0.1.1-rc.2` minimal/Web profiles.
- [ ] Real host-owned ToolRuntime executes native Contract Intelligence with an actual Agent-scoped ToolExecution.
- [ ] Prove at least one Host live contract/evidence row and that the live Contract Index differs from the offline-only index when live semantics add capability facts.
- [ ] Prove repeated search/inspect in equivalent Agent live state retains index continuity.
- [ ] Negative packed smoke: missing optional Inspect capability/provider preserves the valid offline path.
- [ ] Existing shipped-Web `ToolDefinition -> package:@deepseek-ai/dsh-tools -> inspect` proof stays green.
- [ ] Multi-train target-only smoke remains unchanged; live proof is pinned only to DSH trains exposing the verified Inspect contract.

## Task 8 — Governance/doc reconciliation and M2.3 handoff

**Files**
- Modify: `README.md`
- Modify: `docs/roadmap.md`
- Update Issue #31 / PR #32 chronology.

- [ ] README/roadmap explicitly separate M2.2 implementation from M2.3 frozen retrieval evaluation.
- [ ] Record every accepted RED and corresponding GREEN by exact commit/run id.
- [ ] Do not mark parent M2 complete after #31; create/confirm the M2.3 implementation issue first.

## Final merge gate

- [ ] Protocol/generated checks unchanged unless an explicit higher-level contract decision requires a schema change.
- [ ] Architecture/package/CI-storage gates GREEN.
- [ ] Full tests/lint/typechecks GREEN on Node 22.19/24.19/26.
- [ ] Windows 2025/macOS 15 boundary smoke GREEN.
- [ ] Exact packed-artifact real DSH live smoke GREEN on the exact final HEAD.
- [ ] PR comments/reviews/threads reconciled on exact final HEAD.
- [ ] Issue #31 contains RED→GREEN chronology and final CI evidence before merge.
- [ ] Parent #28 remains open for M2.3.
