# Plugin Verification Operation Lifecycle

Status: **Normative Protocol v1 extension (pre-public)**

This specification owns the concrete M4.4 `Operation` lifecycle for long-running `plugin.verify` work. It is normative together with `spec/protocol.md` and `spec/verification.md`. Where the older generic `## Operations` baseline in `spec/protocol.md` leaves the payload unspecified, this document supplies the concrete Protocol v1 semantics.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when capitalized, as defined by RFC 2119 and RFC 8174.

## Scope

M4.4 adds a transport-neutral asynchronous lifecycle without replacing the existing synchronous `plugin.verify` operation.

The supported operation family is:

```text
same PluginVerifyRequest
        ↓
plugin.verify.start
        ↓
Operation
        ↓
operation.get / operation.cancel
        ↓
terminal Operation
        ↓
same canonical PluginVerifyResponse when one was produced
```

The lifecycle MUST reuse the same verification kernel, reducer, artifact identity, target/lifecycle freshness rules, cleanup semantics, and `PluginVerifyResponse` mapping as synchronous `plugin.verify`.

M4.4 does not define Client/page visibility, behavior assertions, MCP Tasks semantics, a persistent queue, retries/replay, cross-process resume, durable history, or a standalone async CLI mode.

## Operation identity

An operation id is an opaque, ephemeral identifier scoped to the lifetime of the persistent Toolchain application host that created it.

An operation id MUST:

- be non-empty and no longer than 128 UTF-16 code units;
- be independent from Protocol `requestId`;
- not encode or reuse target, lifecycle, Contract Index, plugin-subject, or artifact fingerprints;
- not encode profile names or filesystem paths;
- be unique among all operations retained by that host.

An id collision MUST fail closed rather than overwrite an existing operation. Unknown and already-evicted ids are intentionally indistinguishable and use `OPERATION_NOT_FOUND`.

## Operation model

Protocol v1 uses the closed state vocabulary:

- `queued`;
- `running`;
- `input-required`;
- `succeeded`;
- `failed`;
- `cancelled`.

`plugin.verify` does not enter `input-required` in M4.4; the value remains reserved for Protocol continuity.

The public `Operation` object contains:

```ts
type Operation = {
  readonly id: string
  readonly kind: 'plugin.verify'
  readonly state:
    | 'queued'
    | 'running'
    | 'input-required'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
  readonly cancellationRequested: boolean
  readonly progress?: number
  readonly message?: string
  readonly result?: PluginVerifyResponse
  readonly diagnostics: readonly Diagnostic[]
}
```

M4.4 MUST NOT emit fabricated percentage progress. `progress` remains absent until a separately specified kernel/worker progress contract can prove its meaning. `message`, when emitted, is bounded human status text and is never machine authority.

Every returned operation value MUST be an immutable snapshot. Reading or polling an operation MUST NOT mutate lifecycle state, retention order, or semantic result data.

## `plugin.verify.start`

`plugin.verify.start` accepts the exact existing closed `PluginVerifyRequest`. It MUST validate that request with the shared Protocol parser before allocating an operation.

A successful start:

- registers the operation before background execution begins;
- returns a real `queued` snapshot;
- preserves the start call's Protocol `requestId` as the request id used by the eventual canonical `PluginVerifyResponse`;
- does not resolve the target synchronously merely to populate the start response;
- therefore does not carry a target `snapshotFingerprint` in the start envelope.

When active capacity is exhausted, start MUST fail before allocating an operation with `OPERATION_CAPACITY_EXCEEDED`.

## `operation.get`

Request:

```json
{ "id": "<operation-id>" }
```

`operation.get` is read-only and returns the latest immutable operation snapshot.

Unknown or already-evicted ids fail with `OPERATION_NOT_FOUND`. The implementation MUST NOT expose tombstones or disclose whether an id never existed versus having been evicted.

Polling MUST NOT extend completed-operation retention.

## `operation.cancel`

Request:

```json
{ "id": "<operation-id>" }
```

Cancellation is idempotent.

For `queued` work, cancellation MUST:

1. set `cancellationRequested = true`;
2. abort the operation's owned cancellation controller;
3. commit terminal `cancelled` immediately;
4. ensure the scheduled runner cannot subsequently invoke verification.

For `running` work, cancellation MUST:

1. set `cancellationRequested = true`;
2. abort the operation's owned cancellation controller exactly once;
3. keep the operation non-terminal until the underlying verification path actually completes.

A running operation MUST NOT be labelled `cancelled` merely because cancellation was requested. Cooperative completion decides the terminal outcome.

For an already terminal operation, cancel is a no-op and returns the unchanged terminal snapshot. A late cancel MUST NOT rewrite or invalidate an already produced verification receipt.

Unknown/evicted ids use `OPERATION_NOT_FOUND`.

## State transitions

The only M4.4 transitions for `plugin.verify` are:

```text
queued -> running
queued -> cancelled
running -> succeeded
running -> failed
running -> cancelled
```

No transition may leave a terminal state.

Terminal finalization is single-assignment. Competing completion/cancellation paths MUST NOT overwrite a terminal snapshot.

## Operation state versus verification status

Operation execution status and `VerificationReport.status` are deliberately different axes.

### `succeeded`

`state = "succeeded"` means asynchronous application execution produced a canonical `PluginVerifySuccessResponse` whose verification report is not `cancelled`.

Therefore these semantic verification results all map to operation `succeeded`:

- `verified`;
- `failed`;
- `partial`;
- `stale`.

A verifier proving that a candidate fails is successful execution of the verification use case; it is not operation-infrastructure failure.

### `cancelled`

`state = "cancelled"` is used only when:

- queued work was cancelled before verification started; or
- the shared verification path produced a canonical successful `PluginVerifyResponse` whose `VerificationReport.status` is `cancelled`.

When a canonical cancelled response exists, it MUST remain available in `result`. A pre-run cancellation may legitimately have no `result`.

If completion wins a race after cancellation was requested and produces a non-cancelled response, that response wins: the operation may finish `succeeded` with `cancellationRequested = true`.

### `failed`

`state = "failed"` means asynchronous application execution did not produce a successful semantic response.

A mapped canonical `PluginVerifyFailureResponse` is retained in `result` and yields `failed`.

An unexpected background rejection that prevents any canonical response MUST yield `failed` without fabricating a verification report. The operation instead contains `OPERATION_EXECUTION_FAILED` in lifecycle diagnostics.

An unexpected exception MUST NOT be reclassified as cancellation solely because cancellation had already been requested. Only the canonical verification response may establish semantic cancellation.

## Direct/async equivalence

For the same validated `PluginVerifyRequest`, evidence epoch, ports, and Protocol request id:

- synchronous `plugin.verify` and asynchronous execution MUST call the same verification kernel and response mapper;
- when an asynchronous operation carries `result`, that `PluginVerifyResponse` MUST be canonically equivalent to the direct response for the same outcome;
- the lifecycle wrapper MUST NOT alter verification check ordering, diagnostics, artifact binding, target/lifecycle freshness, cleanup, or report status.

No frontend may own a second verification reducer.

## Cancellation ownership

Every active operation owns exactly one `AbortController` or equivalent single cancellation source. Its signal is passed through the shared `verifyPluginResponse(..., signal?)` path into the existing verification worker boundary.

M4.4 MUST NOT introduce a second cancellation channel.

Race rules:

1. queued cancellation commits before kernel invocation and prevents invocation;
2. running cancellation never writes a terminal state directly;
3. the canonical verification response decides running completion;
4. cancellation after terminal commit is ignored;
5. a cancellation request remains observable as `cancellationRequested = true` even if non-cancelled completion wins;
6. unexpected rejection remains `failed` unless canonical verification output itself proves `cancelled`.

## Capacity and retention

M4.4 is not a queueing or scheduling subsystem. It has no priorities, retries, delayed work, or persistent backlog.

The initial application defaults are:

- maximum active `plugin.verify` operations: **4**;
- maximum retained completed operations: **32**.

`active` means `queued` plus `running`.

When the active bound is reached, `plugin.verify.start` fails with `OPERATION_CAPACITY_EXCEEDED`; it MUST NOT create an unbounded queued backlog.

Active operations MUST NOT be evicted.

Completed entries are evicted by terminal completion order when the retained-completed bound is exceeded. Polling/access order MUST NOT affect eviction. Eviction removes only the host registry entry; a `PluginVerifyResponse` already returned to a caller remains self-contained and unchanged.

## Host lifetime and shutdown

Operation ids are valid only while their persistent Toolchain application host remains alive.

On host shutdown/unload:

- the manager stops accepting new operations;
- every non-terminal operation records `cancellationRequested = true` and receives the same owned abort signal used by explicit cancellation;
- queued operations become terminal `cancelled` without starting verification;
- running operations are awaited to quiescence before application-host cleanup is considered complete.

The lifecycle manager MUST be owned by the same DSH/Cordis or MCP host lifetime that exposes its operation ids. Shutdown must not leave detached verification processes or promises intentionally running after their registry owner disappears.

## Frontend projections

### DSH Host/native tools

The persistent Toolchain Service owns the operation registry. Native DSH tools project:

- `toolchain_plugin_verify_start`;
- `toolchain_operation_get`;
- `toolchain_operation_cancel`.

They MUST delegate to the same application manager and shared Protocol request parsers. Native tools MUST NOT implement lifecycle state or verification reduction locally.

### MCP

A persistent MCP server process may expose the same start/get/cancel semantics and host-scoped ids. MCP-specific Tasks mapping remains a later transport concern and MUST NOT change this application contract.

### CLI

The standalone CLI remains synchronous for M4.4. A one-shot process cannot safely return an in-memory operation id whose owning registry immediately disappears. No standalone async CLI command is defined by this milestone.

### DSH Web

Future Web UI consumes Host-owned operation snapshots. It MUST NOT manufacture percentage progress or frontend-owned terminal semantics.

## Diagnostics

M4.4 introduces the application lifecycle diagnostic family:

- `OPERATION_NOT_FOUND` — id unknown or no longer retained;
- `OPERATION_CAPACITY_EXCEEDED` — active capacity is exhausted before allocation;
- `OPERATION_EXECUTION_FAILED` — operation allocation/host lifecycle/background execution failed before a canonical successful semantic response could be produced.

Human summaries may evolve while diagnostic codes retain their semantic meaning within Protocol v1.

## Security and isolation

The operation lifecycle adds no new execution-policy claim. Candidate execution remains governed by `spec/verification.md` and `docs/security.md`.

In particular:

- asynchronous execution MUST use the same `safe` disposable verification boundary as direct `plugin.verify`;
- cancellation and host shutdown MUST preserve cleanup/process-tree termination semantics;
- an operation registry is not a security sandbox;
- operation ids MUST NOT embed secrets or host-specific sensitive coordinates.
