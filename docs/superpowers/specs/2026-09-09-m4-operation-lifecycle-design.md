# M4.4 Plugin Verify Operation Lifecycle Design

Status: proposed implementation contract for issue #207.

## Goal

Evolve the existing pre-public Protocol `Operation` placeholder into the smallest transport-neutral lifecycle justified by the already long-running `plugin.verify` path.

M4.4 adds asynchronous start/status/cancel semantics without replacing the existing synchronous `plugin.verify` operation, without creating a second verification reducer, and without inventing stage percentages that the current kernel/worker cannot prove.

The product contract is:

```text
same PluginVerifyRequest
        ↓
shared verification kernel
        ↓
current synchronous plugin.verify
        OR
persistent-host operation lifecycle
        ↓
start -> get -> cancel/get -> terminal
        ↓
same canonical PluginVerifyResponse
```

The asynchronous path exists because real verification performs target acquisition, static checking, exact artifact binding, package/install/compose/boot/visibility work, final target/lifecycle freshness, and cleanup. The current worker already accepts `AbortSignal`; M4.4 makes that cancellation seam reachable through a stable application lifecycle.

## Why this is the next M4 slice

M4.3.2 completed Agent-scoped Tool visibility. The remaining roadmap items are Client visibility, behavior contracts, and an Operation lifecycle.

Client/page visibility is still blocked on a deterministic page identity/lifetime contract. Adding it now would require guessing what constitutes one stable observed Client epoch.

Generic behavior assertions are also premature because there is no frozen deterministic fixture vocabulary for arguments, side effects, approvals, results, or replay safety.

Operation lifecycle has a concrete requirement today: `plugin.verify` is already long-running, cancellation is already propagated to the isolated worker, and M5 Web explicitly requires progress/status/cancel. Protocol v1 has reserved `Operation`, `operation.get`, and `operation.cancel` since M1, with the explicit instruction that their detailed payload be evolved from real M4 worker needs.

## Existing authority and invariants

M4.4 does not alter the M4.2 verification semantics.

The existing kernel remains authoritative for:

```text
initial target.resolve
  -> target-bound Contract Index
  -> packed plugin.check
  -> exact artifact binding
  -> isolated verification execution
  -> final target.resolve
  -> deterministic VerificationReport reduction
```

`verifyPlugin(request, signal?)` already forwards the optional signal only to the runtime execution port. The same verifier/reducer therefore remains the only authority for `verified | failed | partial | stale | cancelled` report status.

The existing direct `plugin.verify` response contract also remains authoritative:

- producing a semantic `VerificationReport` yields a successful Protocol response envelope even when the report itself is `failed`, `partial`, `stale`, or `cancelled`;
- a `PluginVerifyFailureResponse` is reserved for a mapped application/acquisition/infrastructure condition that prevents the semantic report;
- unexpected exceptions may still prevent a direct response and remain transport/infrastructure failures.

M4.4 must preserve those distinctions rather than reinterpret report status as generic operation failure.

## Chosen architecture

### Recommended approach: one persistent-host operation manager above the existing verification use case

Introduce one application-owned operation manager/registry that invokes the existing verification kernel and canonical response mapping. It owns only lifecycle state, operation identity, cancellation controllers, bounded retention, and terminal response storage.

It does **not** own target resolution, verification stages, report reduction, candidate execution, or frontend-specific transport semantics.

Conceptually:

```text
Protocol request parser
        ↓
VerificationOperationManager
        ├─ registry: operation id -> lifecycle entry
        ├─ AbortController per active operation
        └─ invokes existing verifyPluginResponse/kernel semantics
                         ↓
              existing verification kernel
                         ↓
                 existing worker port
```

This is preferable to embedding operation state in each frontend because frontend-owned managers would drift on cancellation and terminal-state mapping. It is also preferable to replacing direct `plugin.verify` with async-only semantics because the CLI/CI path is already useful and stable.

### Rejected: async-only `plugin.verify`

Rejected because it would unnecessarily break the current CLI/CI/public API contract and force every caller to implement polling even when its transport can safely wait synchronously.

### Rejected: lifecycle in CLI/DSH/MCP adapters independently

Rejected because operation identity, cancellation races, retention, and report-vs-operation status are semantic behavior. They must not be recomputed by transports.

## Operation scope and lifetime

An operation id is valid only inside the lifetime of the persistent Toolchain application host that created it.

M4.4 explicitly does **not** provide:

- persistence across process restart;
- cross-process lookup;
- distributed operation ownership;
- daemon discovery for standalone CLI invocations;
- durable historical operation storage.

This is sufficient for:

- a running DSH Host/Toolchain Service;
- native DSH Agent tools hosted by that same process;
- a persistent MCP server process;
- future DSH Web calls through the running Host service.

A standalone CLI invocation is different: after `plugin verify start` returned, its process would exit and destroy the in-memory registry. Therefore M4.4 **must not** expose a misleading standalone CLI async command. The current CLI keeps synchronous `plugin verify`; this is explicitly allowed by Protocol's rule that an adapter may execute synchronously when semantic results are equivalent.

A future persistent Toolchain daemon/remote endpoint could make operation commands useful to CLI, but that is outside this slice.

## Operation identity

Operation ids are ephemeral, opaque, non-semantic identifiers.

They must not reuse or encode:

- Protocol `requestId`;
- target fingerprint;
- lifecycle fingerprint;
- Contract Index fingerprint;
- artifact fingerprint;
- plugin subject fingerprint;
- profile name or filesystem path.

The application receives an `OperationIdPort` / injected id source. The Node composition uses `crypto.randomUUID()` or an equivalently strong opaque source; kernel/application tests use a deterministic source.

The public schema bounds ids to a non-empty maximum of 128 characters. No public UUID syntax is promised.

The registry must reject an id collision rather than overwrite an existing operation. Production random ids make collision practically negligible; deterministic tests must prove collision cannot replace another operation's controller/result.

## Protocol operation model

The speculative baseline `Operation` becomes a closed M4-owned object for currently supported long work.

Minimum shape:

```ts
type OperationState =
  | 'queued'
  | 'running'
  | 'input-required'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

type Operation = {
  readonly id: string
  readonly kind: 'plugin.verify'
  readonly state: OperationState
  readonly cancellationRequested: boolean
  readonly progress?: number
  readonly message?: string
  readonly result?: PluginVerifyResponse
  readonly diagnostics: readonly Diagnostic[]
}
```

`input-required` stays in the baseline vocabulary for Protocol continuity but `plugin.verify` never enters it in M4.4.

`progress` remains optional in Protocol but M4.4 does not emit it. No `0.25`/`0.5`/stage-count estimate may be manufactured from elapsed stages. A later worker/kernel progress contract can begin emitting it only after its semantics are designed and tested.

`message` is optional human status text and is not machine authority. If emitted, it is bounded to 512 characters. Machine behavior uses `state`, `cancellationRequested`, `result`, and diagnostics.

`diagnostics` is required and bounded by the same safe diagnostic conventions as other Toolchain responses. It is empty for normal queued/running/succeeded operation lifecycle. It exists because a background operation can encounter an unexpected infrastructure exception after the start transport call has already returned; a later `operation.get` must be able to explain that failure without pretending it was a plugin verification report.

## Operation-specific requests

### `plugin.verify.start`

The request payload is exactly the existing canonical `PluginVerifyRequest`; no second verification DTO is introduced.

The application parser validates it before allocating an operation.

A successful start returns an `Operation` snapshot. The first returned snapshot is `queued`, even though execution may advance to `running` immediately after acceptance.

Start does not resolve the target synchronously merely to populate a snapshot fingerprint. Target acquisition is part of the operation. Therefore the start response is not itself target-bound and does not carry a `snapshotFingerprint`.

The operation stores the start call's Protocol `requestId` as the request id of the eventual canonical `PluginVerifyResponse`. The operation id remains separate.

### `operation.get`

Request:

```ts
{ readonly id: string }
```

It returns an immutable copy/snapshot of the latest operation state. It does not mutate access order or extend retention merely because a client polls.

Unknown or already-evicted ids fail with stable diagnostic `OPERATION_NOT_FOUND`. M4.4 deliberately does not retain tombstones, so the diagnostic does not claim whether an id was never valid or was evicted.

### `operation.cancel`

Request:

```ts
{ readonly id: string }
```

Cancellation is idempotent.

For `queued` or `running` operations it sets `cancellationRequested = true` and aborts that operation's controller exactly once. It does **not** immediately claim terminal `cancelled` for a running verification. The state remains non-terminal until the underlying use case reaches a terminal outcome.

For an already terminal `succeeded | failed | cancelled` operation, cancel is a no-op and returns the unchanged terminal snapshot. A late cancel must never rewrite an already produced verification receipt.

Unknown/evicted ids use `OPERATION_NOT_FOUND`.

## State transitions

Allowed M4.4 transitions for plugin verification are:

```text
queued -> running
queued -> cancelled          (cancelled before execution starts)
running -> succeeded
running -> failed
running -> cancelled
```

No transition leaves a terminal state.

The manager inserts the queued entry before execution is launched. The queued snapshot returned by `start` is therefore real state, not a fabricated progress event.

Before changing queued -> running, the runner checks the operation controller. If the operation was cancelled while still queued, it becomes `cancelled` without starting verification.

## Terminal state mapping

Operation state is intentionally distinct from `VerificationReport.status`.

### `succeeded`

`state = 'succeeded'` means the asynchronous application call successfully produced a canonical `PluginVerifySuccessResponse` and the contained verification report is not `cancelled`.

Therefore all of these report outcomes still map to operation `succeeded`:

- `verified`;
- `failed`;
- `partial`;
- `stale`.

This preserves the existing M4.2 distinction between "verification ran and proved a candidate failure" and "the operation infrastructure failed".

### `cancelled`

`state = 'cancelled'` is used when:

1. the operation is cancelled before verification begins; or
2. the canonical success response contains `VerificationReport.status = 'cancelled'`; or
3. execution terminates without a semantic response because the operation's own AbortSignal was already aborted and the thrown condition is attributable to that cancellation boundary.

When a canonical cancelled `PluginVerifySuccessResponse` exists, it is retained in `result`.

A mere `cancellationRequested = true` does not force this terminal state. If the underlying verification has already won the race and produces a non-cancelled result, that result wins and the operation may finish `succeeded` with `cancellationRequested = true`. This accurately represents cooperative cancellation.

### `failed`

`state = 'failed'` means the asynchronous application execution did not produce a successful semantic response.

A mapped canonical `PluginVerifyFailureResponse` is retained as `result` and yields `failed`.

An unexpected background exception that would have been a transport/infrastructure failure in direct mode yields `failed` with no fabricated `PluginVerifyResponse`; the Operation carries stable lifecycle diagnostic `OPERATION_EXECUTION_FAILED` with bounded non-sensitive summary.

M4.4 must not convert such an exception into `VerificationReport.status = 'failed'`, because that would falsely blame the candidate/runtime semantics.

## Direct/async equivalence

For the same validated `PluginVerifyRequest`, exact evidence epoch, verification ports, and Protocol request id:

- direct `plugin.verify` and async `plugin.verify.start` must call the same verification kernel;
- when async produces a `result`, that `PluginVerifyResponse` must be byte/structure-equivalent to the response the direct response mapper would produce for the same outcome;
- no async-only reducer may alter report check order, diagnostics, artifact binding, target/lifecycle freshness, cleanup, or status.

The operation wrapper adds lifecycle metadata only.

## Cancellation ownership and race rules

Each active operation owns exactly one `AbortController`.

The signal is passed into the existing `verifyPlugin(request, signal)` call and therefore reaches the existing `PluginVerificationExecutionPort.verify(..., signal)` / worker boundary. M4.4 must not add a second cancellation channel.

Race discipline:

1. `operation.cancel` never writes a terminal state for a running operation.
2. The verification promise's actual terminal response decides whether the final state is succeeded/failed/cancelled.
3. An abort request received after a terminal entry is committed is ignored.
4. An abort requested while the promise is running remains visible as `cancellationRequested = true` even if completion wins.
5. Finalization is single-assignment; one background completion path cannot overwrite another terminal snapshot.

These rules prevent "cancel after success" from rewriting durable evidence and prevent UI optimism from claiming cancellation before the worker has quiesced.

## Concurrency and resource bounds

M4.4 is not a scheduler. It does not add priorities, retries, delayed jobs, or distributed queues.

However async start creates a new resource-amplification surface, so both active and completed entries must be bounded.

Production defaults:

- maximum active plugin verification operations: **4**;
- maximum retained completed operations: **32**.

The limits are explicit application options/test seams so policy can be revised later without changing Protocol.

When the active limit is reached, `plugin.verify.start` fails before allocating an operation with `OPERATION_CAPACITY_EXCEEDED`. It does not create a permanently queued backlog.

Active operations are never evicted.

When a new terminal entry causes retained completed operations to exceed the completed bound, evict the oldest terminal operation by **terminal completion order**, not by last access. Polling therefore cannot keep an old operation alive or nondeterministically evict a newer receipt.

Eviction removes only the registry entry. Any `PluginVerifyResponse` already returned to a caller remains self-contained and unchanged.

The registry must also enforce the completed bound when operations finish concurrently; pruning happens synchronously with terminal commit.

## Immutability

Every public operation snapshot is a deep-enough immutable copy of the manager's current state:

- callers cannot mutate registry state through returned arrays/objects;
- `result` response data/diagnostics are frozen/copied consistently with existing Protocol response handling;
- `operation.get` never returns an internal mutable entry/controller/promise.

Controllers, promises, sequence counters, and retention bookkeeping are private runtime state and never enter Protocol.

## Frontend projection

### DSH Toolchain Service — required

The running DSH Host is the primary persistent lifecycle owner needed by future M5 Web.

Add service methods that project the shared lifecycle application semantics:

- verification start;
- operation get;
- operation cancel.

The service must not own a second registry. Its lifetime-scoped operation manager is the same one used by any native Tool projection in that Toolchain instance.

### Native DSH Agent tools — required

Expose a small explicit asynchronous trio for agent workflows where synchronous verification may exceed one Tool call's practical latency:

- `toolchain_plugin_verify_start`;
- `toolchain_operation_get`;
- `toolchain_operation_cancel`.

They call the same Toolchain Service/application operation manager. They do not inspect controllers or map terminal states locally.

The existing `toolchain_plugin_verify` remains available as the synchronous convenience path.

### MCP — required, without MCP Tasks coupling

Expose the same three logical operations through MCP using canonical Protocol schemas and the shared lifecycle manager owned by the persistent MCP server process.

M4.4 does not map them onto MCP Tasks. Protocol already permits a future Tasks adapter, but coupling kernel semantics to a transport extension is explicitly deferred.

### CLI — synchronous only in M4.4

Do not add standalone `plugin verify start`, `operation get`, or `operation cancel` commands while CLI owns no persistent service process.

The current CLI `plugin verify` remains synchronous and continues to emit the canonical `PluginVerifyResponse` and existing exit-code semantics.

This is intentional frontend policy, not missing semantic parity: Protocol permits synchronous execution, and a one-shot process cannot honestly promise later retrieval from an in-memory registry.

## Application/API ownership

The operation manager belongs to the application/kernel boundary, not `src/model` verification semantics and not `src/verification` process code.

A practical shape is a focused module such as:

```text
src/kernel/operation.ts
```

or an equivalently narrow application-owned module imported by `src/kernel/index.ts`.

It may depend on Protocol DTOs and `VerificationApplicationKernel`, but pure verification model code must not depend on operation lifecycle state.

The existing architecture fitness rules must continue to reject semantic-core -> runtime/frontend coupling.

The operation id source is a narrow injected port; the Node `randomUUID` implementation belongs outside semantic model code.

## Protocol response families

M4.4 adds closed response contracts rather than using unconstrained generic `data`:

```text
PluginVerifyStartResponse
OperationGetResponse
OperationCancelResponse
```

Each success response contains `data.operation`.

These lifecycle calls are not themselves target-bound and therefore do not add envelope `snapshotFingerprint` merely because their eventual verification result may contain one.

Each get/cancel request has its own Protocol `requestId`. If an operation has terminal `result`, the nested `PluginVerifyResponse.requestId` remains the original `plugin.verify.start` request id. Polling request ids never rewrite the stored result.

Expected get/cancel/start lifecycle failures use ordinary Protocol failure envelopes and stable diagnostics:

- `OPERATION_NOT_FOUND`;
- `OPERATION_CAPACITY_EXCEEDED`.

Unexpected background failure after successful start is represented inside the terminal Operation through `OPERATION_EXECUTION_FAILED`, because there is no longer an open start transport request on which to surface the exception.

## Validation rules

Protocol request parsing must remain closed and transport-neutral:

- operation id: string, `1..128`, contains at least one non-whitespace character;
- no undeclared fields;
- `plugin.verify.start` reuses the canonical `PluginVerifyRequest` parser rather than copying visibility/subject/policy validation;
- start/get/cancel response schemas, generated types, examples, parser tests, and normative spec are updated atomically.

The existing generic baseline response envelope is not used as a shortcut once these concrete operations exist.

## Real-DSH acceptance

M4.4 needs one exact installed public-path proof in a **persistent** real DSH runtime, because the central claim is lifecycle continuity across multiple calls.

Primary CI should use current published acceptance train `@deepseek-ai/dsh@0.1.2-rc.1` and an agent-capable profile when native Tool invocation is used.

The acceptance must prove, within one disposable DSH Host lifetime:

1. pack/install the exact Toolchain artifact under test;
2. use the real Toolchain Service or native DSH Tool surface to start verification of a known boot/visibility-valid packed candidate;
3. receive a bounded opaque operation id;
4. observe the same operation through at least one subsequent get call in the same host;
5. reach terminal `succeeded` with a canonical `PluginVerifySuccessResponse` whose report is `verified`;
6. preserve exact artifact/target/lifecycle binding and cleanup success in that nested result;
7. preserve the active user profile unchanged.

Cancellation behavior is covered deterministically below the registry/worker boundary rather than relying on a timing-sensitive registry network/package-manager race in the real-DSH smoke.

## TDD strategy

Implementation starts with contracts that are impossible under current production code.

### Protocol RED

Pin before production changes:

- closed operation object contains `kind`, `cancellationRequested`, diagnostics, and optional canonical verification result;
- start/get/cancel request/response schemas;
- operation id bounds;
- malformed additional fields rejected;
- nested terminal result remains a canonical `PluginVerifyResponse`.

### Operation manager RED

Pin:

- start returns immutable queued snapshot and later get observes running/terminal;
- direct/async canonical response equivalence;
- semantic verification `failed|partial|stale` -> operation `succeeded`;
- semantic cancelled report -> operation `cancelled` with result retained;
- mapped `PluginVerifyFailureResponse` -> operation `failed`;
- unexpected exception -> operation `failed` + `OPERATION_EXECUTION_FAILED`, not fabricated verification report;
- queued cancellation prevents kernel invocation;
- running cancellation forwards exactly the owned signal and does not claim terminal cancellation early;
- late cancellation does not rewrite terminal result;
- cancellation request may lose to completed non-cancelled result while remaining observable;
- concurrent operations use distinct ids/controllers/results;
- id collision cannot overwrite an existing operation;
- active capacity fails before allocation;
- completed retention evicts by completion order and polling does not change eviction order;
- returned snapshots cannot mutate registry state.

### Frontend RED

Pin:

- DSH Service/native tools and MCP delegate to shared lifecycle operations;
- no frontend-owned state mapping;
- existing synchronous CLI output/exit behavior is unchanged;
- CLI does not advertise unusable one-shot async operation commands.

### Acceptance GREEN

Only after focused correctness is GREEN:

- exact packed artifact inspection;
- Node 22.19 / 24.19 / 26 aggregate quality gates;
- Windows 2025 and macOS 15 boundary smoke;
- real DSH persistent-host operation acceptance;
- existing positive and negative synchronous public verification smokes;
- exact-head final self-review and post-merge `main` CI.

## Failure semantics and diagnostics

Operation lifecycle diagnostics use domain `operation`.

Stable new codes:

- `OPERATION_NOT_FOUND` — id is unavailable in this host registry;
- `OPERATION_CAPACITY_EXCEEDED` — active verification capacity rejected a start before allocation;
- `OPERATION_EXECUTION_FAILED` — an unexpected background infrastructure exception prevented a canonical verification response.

No new `VERIFY_*` diagnostic is introduced merely for lifecycle state.

Candidate/runtime defects continue to use existing verification diagnostics and report semantics.

Diagnostic summaries must be bounded and must not copy arbitrary stdout/stderr, environment, credentials, full package-manager logs, or unbounded thrown objects.

## Security and isolation

M4.4 does not strengthen `safe` into a malicious-code sandbox claim.

The existing disposable DSH home, allowlisted child environment, lifecycle-script policy, timeout/process-tree termination, bounded output, exact artifact identity, and cleanup semantics remain unchanged.

Operation ids are routing handles, not authorization secrets. Existing transport/process access control remains responsible for who may call get/cancel. The design must not imply that knowledge of an opaque id is an authorization boundary.

Async lifecycle must not broaden environment inheritance or retain worker filesystem state after terminal cleanup.

## Documentation/roadmap updates

On implementation merge:

- Protocol normative Operations section becomes concrete for `plugin.verify`;
- architecture documents identify the application-owned ephemeral operation manager and persistent-host lifetime;
- roadmap marks M4 Operation lifecycle complete but keeps the full M4 milestone open until Client visibility and deterministic behavior-contract decisions are resolved;
- docs explicitly state standalone CLI remains synchronous until a persistent host/daemon exists.

## Non-goals

- Client/page visibility;
- behavior assertion vocabulary;
- Tool execution;
- persistent operation database;
- operation recovery after host restart;
- distributed queue/scheduler;
- retries/replay of verification;
- new target/artifact/lifecycle/Contract Index fingerprint namespaces;
- trusted execution or malicious-code sandboxing;
- MCP Tasks integration;
- DSH Web UI implementation;
- CLI daemon or background process;
- H1/H2/Search work.

## Exit rule

M4.4 is complete only when the same verification use case is proven in both modes:

1. existing synchronous `plugin.verify` remains unchanged and GREEN;
2. persistent-host async start/get/cancel produces the same canonical terminal response, obeys cooperative cancellation/race rules, and is bounded/fail-closed.

The slice must not claim full M4 completion. Client visibility and deterministic behavior contracts remain separately gated by evidence.