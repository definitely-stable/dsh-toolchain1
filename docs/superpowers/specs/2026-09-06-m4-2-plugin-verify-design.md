# M4.2 Public Plugin Verification Design

Status: proposed implementation contract for issue #190.

## Goal

Expose `plugin.verify` as one transport-neutral application use case owned by the shared kernel. M4.2 does not create a second runtime verifier; it composes existing static `plugin.check` semantics with the merged M4.1 packed-artifact worker, then revalidates target freshness and reduces all evidence into Protocol v1 `VerificationReport`.

## Boundary

```text
TargetResolveRequest + packed subject + safe policy
        ↓
initial target.resolve
        ↓
static plugin.check against that exact target epoch
        ↓
authoritative packed artifact contentHash
        ↓
M4.1 isolated worker with initial TargetSnapshot
        ↓
final target.resolve
        ↓
kernel-owned deterministic reducer
        ↓
VerificationReport
```

The kernel owns status semantics. Frontends only validate/serialize/transport requests and responses.

## Identity

Static identity and runtime artifact identity remain separate:

- `dsh-plugin-subject-v1:<sha256>`: normalized static subject identity;
- `dsh-plugin-artifact-v1:<sha256>`: exact packed `.tgz` bytes executed by verification;
- `dsh-target-v2:<sha256>`: exact target identity;
- `dsh-contract-index-v1:<sha256>`: exact static contract evidence identity.

`VerificationReport.artifactFingerprint` is mandatory even when execution fails before the worker can expose its optional `artifactFingerprint`. Therefore M4.2 derives the expected runtime identity from the authoritative packed acquisition `contentHash` before launching the worker:

`dsh-plugin-artifact-v1:${contentHash}`.

The worker must receive the same `contentHash` as `expectedContentHash`; any worker-returned artifact fingerprint, when present, must equal the pre-bound value or the operation fails closed.

## Request

Protocol v1 gains a closed `PluginVerifyRequest`:

```ts
type PluginVerifyRequest = {
  readonly target: TargetResolveRequest
  readonly subject: {
    readonly kind: 'packed'
    readonly path: string
  }
  readonly executionPolicy: 'safe'
}
```

M4.2 intentionally supports packed artifacts only. Directory verification would require a separate authoritative pack step and byte-identity contract and is not implied by `plugin.check` directory support.

## Reducer input

The pure reducer consumes only runtime-neutral values:

```ts
interface PluginVerificationReductionInput {
  readonly artifactFingerprint: string
  readonly initialTargetFingerprint: string
  readonly finalTargetFingerprint: string
  readonly staticResult: PluginCheckResult
  readonly staticDiagnostics: readonly Diagnostic[]
  readonly execution: PackedPluginVerificationExecutionLike
}
```

The kernel must not import Node filesystem/process concepts. A verification execution port supplies the M4.1 execution observation.

## Static-stage mapping

M4.1 currently marks `structure`, `manifest`, `dependency`, and `contract` as skipped with `handled-by-static-check`. M4.2 replaces those placeholders deterministically:

- `structure`: passed only when `subjectCompleteness === 'complete'`; otherwise failed for `invalid`, skipped for `partial`.
- `manifest`: passed when the acquired subject is complete and static analysis produced no manifest-domain error; failed when diagnostics prove a manifest defect; otherwise skipped when incomplete evidence prevents proof.
- `dependency`: failed when any requirement is `missing`; passed when every material host relationship is proven satisfied/not-required; skipped when any material relation is `unproven`.
- `contract`: failed when static verdict is `incompatible`; passed only for `compatible-in-scope`; skipped for `unproven` because static alpha remains scope-incomplete.

The exact mapping is intentionally conservative. `scopeComplete:false` prevents static coverage from being described as exhaustive, but it does not by itself block runtime verification of the checks M4.2 actually executes. What blocks `verified` is an unresolved material static requirement or a required runtime check that remains skipped.

## Required runtime checks

For M4.2 alpha, these runtime checks are required for `verified`:

- `package`
- `install`
- `compose`
- `boot`

`visibility` is required only when visibility assertions are part of the request. M4.2 does not yet expose such assertions, so the M4.1 `visibility` placeholder remains skipped and is not a blocker for the baseline verified claim. `build` and `behavior` are explicitly outside the M4.2 alpha claim and remain skipped.

The report must preserve all 11 canonical Protocol v1 checks in canonical order.

## Status precedence

Status reduction is deterministic and fail closed:

1. `cancelled` when worker terminal is cancelled.
2. `stale` when final target fingerprint differs from the initial target fingerprint.
3. `failed` when static analysis proves incompatibility, a required static stage failed, a required runtime stage failed, worker terminal is failed, or worker artifact identity conflicts with the pre-bound artifact fingerprint.
4. `partial` when cleanup failed, a material static requirement remains unproven, a required covered check is skipped, or independently useful evidence exists but the verified claim is incomplete.
5. `verified` only when all required static/runtime checks pass, worker terminal is completed, cleanup succeeded, artifact identity matches, and target freshness is unchanged.

Cancellation outranks freshness because the operation did not complete the requested verification. Staleness outranks ordinary semantic success/failure only after a completed/non-cancelled execution because the report's target-specific claim can no longer be attached to the requested current target epoch.

A previously proven static incompatibility remains `failed` even if runtime stages happen to pass.

## Diagnostics

Static diagnostics and worker diagnostics are preserved. M4.2 may append reducer-owned diagnostics with stable codes for cross-layer invariants:

- `VERIFY_TARGET_STALE`
- `VERIFY_ARTIFACT_IDENTITY_MISMATCH`
- `VERIFY_STATIC_UNPROVEN`
- `VERIFY_CLEANUP_FAILED` (worker already owns this code; reducer must not duplicate it when present)

Expected candidate defects remain semantic report data. Unexpected infrastructure exceptions may prevent a semantic report and are handled by the operation response layer rather than invented as candidate failures.

## Freshness

The application use case resolves the target twice. The worker is bound to the immutable first snapshot. After execution, the kernel resolves the same `TargetResolveRequest` again. Fingerprint mismatch yields `VerificationReport.status = 'stale'` and the report retains the initial `targetFingerprint`, because that is the target actually supplied to the worker.

Transport envelope `status` remains `ok` when a semantic `VerificationReport` was successfully produced, including reports whose own status is `failed`, `partial`, `stale`, or `cancelled`. `PluginVerifyFailureResponse` is reserved for application/infrastructure conditions that prevent producing the defined report. This matches `plugin.check`, where candidate incompatibility is report data rather than transport failure.

## Kernel port

M4.2 introduces a runtime-neutral port owned by the kernel boundary:

```ts
interface PluginVerificationExecutionPort {
  verify(input: {
    readonly artifactPath: string
    readonly expectedContentHash: string
    readonly target: TargetSnapshot
    readonly executionPolicy: 'safe'
  }, signal?: AbortSignal): Promise<PackedPluginVerificationExecutionLike>
}
```

The concrete Node adapter delegates to `runPackedPluginVerification`. Kernel tests inject deterministic fakes and never spawn processes.

## Protocol and frontend sequence

This slice is implemented in reviewable order:

1. pure reducer + RED/GREEN tests;
2. kernel orchestration port/use case + freshness tests;
3. Protocol v1 request/response schema/types/conformance;
4. Node adapter binding M4.1 worker;
5. CLI/native DSH/MCP parity projection;
6. exact-head full CI and real DSH smoke.

No frontend may compute report status locally.

## Non-goals

- trusted execution;
- malicious-code sandboxing;
- behavior assertions;
- visibility assertion vocabulary;
- DSH Web UI;
- Search/ranker changes;
- H1/H2 or provider/model evaluation;
- target/index/artifact fingerprint namespace changes.
