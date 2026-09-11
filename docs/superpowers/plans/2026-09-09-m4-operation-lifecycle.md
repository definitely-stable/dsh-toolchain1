# M4.4 Verification Operation Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, transport-neutral async start/get/cancel lifecycle around the existing `plugin.verify` use case while preserving the current synchronous verification contract.

**Architecture:** Keep `verifyPlugin` and `verifyPluginResponse` as the sole verification semantics. Add one application-owned in-memory `VerificationOperationManager` above that mapper, one opaque id/controller per active operation, bounded terminal retention, and thin DSH/MCP projections. Standalone CLI remains synchronous because it has no persistent host lifetime.

**Tech Stack:** TypeScript 6, Node.js 22.19+/24+/26, Vitest, JSON Schema 2020-12/Ajv, Cordis DSH Service/Tools, MCP Server, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-09-m4-operation-lifecycle-design.md`

## Global Constraints

- Base is `main@673c536f238a8b17d9c304ff0d1dd3635f19cae9` plus the approved design commits on `feature/m4-operation-lifecycle-207`.
- Preserve existing synchronous `plugin.verify` request/response and CLI exit semantics.
- Reuse one `verifyPluginResponse(kernel, request, requestId, signal?)` mapper; no async-only verification reducer.
- Operation ids are opaque, non-semantic strings, length `1..128`; production uses `randomUUID`, tests inject deterministic ids.
- Maximum active operations defaults to `4`; maximum retained terminal operations defaults to `32`; no queued backlog.
- No fabricated percentage progress. `progress` stays absent in M4.4.
- Queued cancellation prevents kernel invocation. Running cancellation is cooperative and does not claim terminal cancellation before the canonical verification response proves it.
- Unexpected rejection remains operation `failed` with `OPERATION_EXECUTION_FAILED` even if cancellation was requested.
- `failed|partial|stale` verification reports are successful operation execution and therefore operation `succeeded`; a canonical cancelled report maps to operation `cancelled`.
- No Client/page visibility, behavior assertions, MCP Tasks, Web UI, persistent queue/database, retry/replay, new execution policy, or fingerprint namespace changes.

---

### Task 1: Freeze the Protocol operation contract as RED

**Files:**
- Modify: `tests/protocol/protocol.spec.ts`
- Create: `tests/protocol/operation-request-validation.spec.ts`
- Modify later: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify later: `src/protocol/request-validation.ts`
- Regenerate later: `src/protocol/generated.ts`
- Create later: `spec/examples/v1/plugin-verify-operation-running.json`
- Create later: `spec/examples/v1/plugin-verify-operation-succeeded.json`

**Interfaces:**
- Consumes: existing `PluginVerifyRequest`, `PluginVerifyResponse`, `Diagnostic`.
- Produces: `Operation`, `OperationRequest`, `PluginVerifyStartResponse`, `OperationGetResponse`, `OperationCancelResponse`; parsers `parseOperationRequest()` and existing `parsePluginVerifyRequest()` reused by start.

- [ ] **Step 1: Write schema/type RED assertions**

Pin these exact invariants before production edits:

```ts
expect(schema.$defs.operation).toMatchObject({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'state', 'cancellationRequested', 'diagnostics'],
})
expect(generated).toContain('export type PluginVerifyStartResponse =')
expect(generated).toContain('export type OperationGetResponse =')
expect(generated).toContain('export type OperationCancelResponse =')
```

Validate a running snapshot without `result`, a succeeded snapshot containing canonical `PluginVerifySuccessResponse`, and rejection of ids longer than 128 characters / whitespace-only / undeclared fields.

- [ ] **Step 2: Write parser RED tests**

```ts
expect(parseOperationRequest({ id: 'op-1' })).toEqual({ id: 'op-1' })
expect(() => parseOperationRequest({ id: '   ' })).toThrow(TypeError)
expect(() => parseOperationRequest({ id: 'x'.repeat(129) })).toThrow(TypeError)
expect(() => parseOperationRequest({ id: 'op-1', extra: true })).toThrow(TypeError)
```

- [ ] **Step 3: Commit test-only RED**

Commit only the tests and open a draft PR. Run CI and record the exact failing HEAD/run. Expected failures are missing operation response definitions/parser, not unrelated lint/build errors.

---

### Task 2: Implement the Protocol contract atomically

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify: `src/protocol/request-validation.ts`
- Regenerate: `src/protocol/generated.ts`
- Create: `spec/examples/v1/plugin-verify-operation-running.json`
- Create: `spec/examples/v1/plugin-verify-operation-succeeded.json`
- Test: `tests/protocol/protocol.spec.ts`
- Test: `tests/protocol/operation-request-validation.spec.ts`

**Interfaces:**
- Produces:

```ts
type OperationRequest = { readonly id: string }
type Operation = {
  readonly id: string
  readonly kind: 'plugin.verify'
  readonly state: 'queued' | 'running' | 'input-required' | 'succeeded' | 'failed' | 'cancelled'
  readonly cancellationRequested: boolean
  readonly progress?: number
  readonly message?: string
  readonly result?: PluginVerifyResponse
  readonly diagnostics: readonly Diagnostic[]
}
```

Concrete success/failure response families use `data.operation`; lifecycle calls themselves do not carry `snapshotFingerprint`.

- [ ] **Step 1: Extend the canonical JSON Schema**

Replace the speculative `operation` shape and add `operationRequest`, `pluginVerifyStartSuccessResponse|FailureResponse|Response`, `operationGetSuccessResponse|FailureResponse|Response`, and `operationCancelSuccessResponse|FailureResponse|Response`.

- [ ] **Step 2: Add the closed operation id parser**

```ts
export function parseOperationRequest(value: unknown): OperationRequest {
  const message = 'Invalid operation arguments'
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'id')) invalid(message)
  if (typeof value.id !== 'string' || value.id.trim().length === 0 || value.id.length > 128) invalid(message)
  return { id: value.id }
}
```

- [ ] **Step 3: Regenerate types**

Run `pnpm generate`; never hand-edit `src/protocol/generated.ts`.

- [ ] **Step 4: Add canonical examples and focused GREEN**

Run `pnpm vitest run tests/protocol/protocol.spec.ts tests/protocol/operation-request-validation.spec.ts` and `pnpm check:generated`.

- [ ] **Step 5: Commit Protocol GREEN**

Commit schema, generated types, parser, examples, tests atomically.

---

### Task 3: Add the application-owned operation manager

**Files:**
- Create: `src/kernel/operation.ts`
- Modify: `src/kernel/index.ts`
- Create: `tests/kernel/operation.spec.ts`
- Modify: `tests/kernel/plugin-verify-response.spec.ts`

**Interfaces:**
- Consumes:

```ts
verifyPluginResponse(
  kernel: VerificationApplicationKernel,
  request: PluginVerifyRequest,
  requestId: string,
  signal?: AbortSignal,
): Promise<PluginVerifyResponse>
```

- Produces:

```ts
interface VerificationOperationManager {
  start(request: PluginVerifyRequest, requestId: string): Operation
  get(id: string): Operation
  cancel(id: string): Operation
}

interface VerificationOperationManagerOptions {
  readonly operationId: () => string
  readonly maxActive?: number // default 4
  readonly maxRetainedCompleted?: number // default 32
}
```

Use typed lifecycle errors `OPERATION_NOT_FOUND`, `OPERATION_CAPACITY_EXCEEDED`, and internal `OPERATION_EXECUTION_FAILED` diagnostics.

- [ ] **Step 1: Write manager RED tests**

Pin queued snapshot, running/terminal observation, direct/async canonical response equivalence, status mapping, queued/running/late cancellation races, signal identity, unexpected reject fail-closed behavior, concurrency, id collision, capacity, completion-order eviction, poll-independent retention, and immutable snapshots.

- [ ] **Step 2: Extend the canonical response mapper with signal**

Change only:

```ts
export async function verifyPluginResponse(kernel, request, requestId, signal?: AbortSignal) {
  const outcome = await kernel.verifyPlugin(request, signal)
  // existing mapping unchanged
}
```

Existing direct callers omit the signal.

- [ ] **Step 3: Implement manager state privately**

Registry entries own controller, request, requestId and lifecycle state. `start()` inserts queued state, captures/returns its immutable snapshot, and schedules execution on `queueMicrotask`/`Promise.resolve().then(...)` so queued cancellation can win before invocation.

- [ ] **Step 4: Implement terminal mapping and bounded retention**

Canonical success + non-cancelled report -> `succeeded`; canonical cancelled report -> `cancelled`; canonical failed envelope -> `failed`; unexpected reject -> `failed` with bounded `OPERATION_EXECUTION_FAILED`. Prune only terminal entries by completion sequence.

- [ ] **Step 5: Run focused GREEN and commit**

Run `pnpm vitest run tests/kernel/operation.spec.ts tests/kernel/plugin-verify-response.spec.ts tests/kernel/plugin-verify.spec.ts` plus `pnpm typecheck`.

---

### Task 4: Project lifecycle through the persistent DSH Host

**Files:**
- Create: `src/integrations/dsh/operation-tool.ts`
- Modify: `src/integrations/dsh/index.ts`
- Create: `tests/dsh/operation-tool.spec.ts`
- Modify: `tests/dsh/service.spec.ts`
- Modify: `tests/dsh/smoke-policy.spec.ts`
- Modify: `scripts/smoke-dsh-package.mjs`

**Interfaces:**
- Service methods:

```ts
startPluginVerification(request: PluginVerifyRequest, requestId?: string): Promise<PluginVerifyStartResponse>
getOperation(request: OperationRequest, requestId?: string): Promise<OperationGetResponse>
cancelOperation(request: OperationRequest, requestId?: string): Promise<OperationCancelResponse>
```

- Native tools:
  - `toolchain_plugin_verify_start`
  - `toolchain_operation_get`
  - `toolchain_operation_cancel`

- [ ] **Step 1: Write DSH RED tests**

Require one Service-owned manager shared by all three methods/tools; native tools must call canonical parsers and return Protocol responses without inspecting manager internals.

- [ ] **Step 2: Instantiate one manager for `ToolchainService` lifetime**

Production id source is `randomUUID`. Existing synchronous `verifyPlugin` continues to call the direct mapper.

- [ ] **Step 3: Add thin native definitions**

Start uses the same request parameter schema as `toolchain_plugin_verify`; get/cancel expose only bounded `id`.

- [ ] **Step 4: Extend the real DSH boot probe**

Within one real Host lifetime, start a known valid verification, call get using the returned id, poll boundedly until terminal, and require `state='succeeded'` plus nested canonical `verified` report. Preserve active profile and exact receipt bindings.

- [ ] **Step 5: Focused GREEN and commit**

Run DSH unit tests and smoke-policy tests before full CI.

---

### Task 5: Project lifecycle through persistent MCP without MCP Tasks

**Files:**
- Modify: `src/frontends/mcp/index.ts`
- Create: `tests/mcp/operation.spec.ts`
- Modify: `tests/mcp/server.spec.ts`
- Modify: `tests/mcp/plugin-verify.spec.ts`

**Interfaces:**
- MCP tools:
  - `plugin.verify.start` — executing/non-idempotent
  - `operation.get` — read-only/idempotent
  - `operation.cancel` — executing/non-idempotent

One manager is constructed per `buildMcpServer()` and shared across the three tools. Existing `plugin.verify` remains synchronous.

- [ ] **Step 1: Write MCP RED tests**

Require canonical input/output schema refs, annotations, same returned id across calls, nested response preservation, parser rejection, and no CLI changes.

- [ ] **Step 2: Add one manager to MCP server composition**

For injected test kernels, construct the manager only when verification capability exists; lifecycle tools fail configuration clearly if verification is unavailable.

- [ ] **Step 3: Register the trio and keep direct verify unchanged**

Do not use MCP Tasks or frontend-owned polling/state reduction.

- [ ] **Step 4: Focused GREEN and commit**

Run `pnpm vitest run tests/mcp/operation.spec.ts tests/mcp/plugin-verify.spec.ts tests/mcp/server.spec.ts`.

---

### Task 6: Normative docs, full verification, and merge discipline

**Files:**
- Modify: `spec/protocol.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`
- Modify: Issue #207 / PR description only after evidence exists.

**Interfaces:**
- Documents exact persistent-host lifetime, CLI synchronous exception, bounds, state/report distinction, cancellation races, and non-goals.

- [ ] **Step 1: Update normative docs only after implementation semantics are GREEN**

Mark Operation lifecycle complete in M4 but do not claim full M4 completion; Client visibility/behavior remain deferred.

- [ ] **Step 2: Run aggregate verification**

Require `pnpm check`, build/pack checks, and PR CI with Node 22.19/24.19/26, Windows 2025/macOS 15, exact packed Toolchain, isolated worker, synchronous positive/negative public verify, real DSH lifecycle smoke, compose, and target-train resolution.

- [ ] **Step 3: Self-review final diff**

Confirm no async CLI commands, no Web UI/MCP Tasks, no second verifier/reducer, no fake progress, no unbounded registry, no semantic-core runtime coupling, no fingerprint changes.

- [ ] **Step 4: Freeze exact-head evidence and merge**

Record test-only RED SHA/run and final GREEN SHA/run, mark PR ready only after terminal GREEN, squash merge with `expected_head_sha`, verify Issue #207 closes, and require post-merge push CI GREEN on the exact `main` merge SHA.
