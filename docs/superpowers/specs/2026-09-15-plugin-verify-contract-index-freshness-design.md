# Plugin Verify Contract Index Freshness Design

Status: proposed for Issue #227
Date: 2026-09-15

## Context

`plugin.verify` currently combines a static `plugin.check` result with runtime verification and performs a final target re-resolution before a public `verified` result is allowed. The existing reducer binds the receipt to the exact packed artifact, initial `dsh-target-v2` fingerprint, and optional profile lifecycle fingerprint.

ADR-0008 deliberately defines `dsh-target-v2` and `dsh-contract-index-v1` as independent identity axes. Same-version declaration/catalog/source/runtime evidence can change the Contract Index without changing the target fingerprint. Consequently, final target/lifecycle freshness alone is insufficient to prove that the static compatibility evidence folded into a verification receipt is still current.

## Decision

Keep Toolchain Protocol at version `1` and strengthen the existing `plugin.verify` contract rather than introducing a new protocol generation.

`VerificationReport` gains a required `contractIndexFingerprint` field. It is the exact fingerprint of the initial Contract Index used to produce the static `PluginCheckResult` folded into the receipt.

`plugin.verify` reuses the existing canonical `buildContractIndex(request.target)` path after runtime execution. The final Contract Index fingerprint is compared with the initial fingerprint in addition to target and lifecycle freshness.

When target and lifecycle remain unchanged but the Contract Index fingerprints differ, reduction emits `VERIFY_CONTRACT_INDEX_STALE` and the public verification status is `stale`. The receipt continues to carry the initial Contract Index identity because that is the evidence epoch against which static compatibility was actually evaluated.

## Status precedence

Cancellation retains highest precedence.

Freshness drift is evaluated next. Any target drift, profile lifecycle drift, or independently attributable Contract Index drift makes the receipt `stale` unless execution was cancelled. Diagnostic attribution is hierarchical: target drift is reported as `VERIFY_TARGET_STALE`; when target remains equal but lifecycle drifts, `VERIFY_LIFECYCLE_STALE` is authoritative; `VERIFY_CONTRACT_INDEX_STALE` is reserved for Contract Index drift while both target and lifecycle remain equal. This avoids relabelling the Contract Index change implied by a changed target fingerprint as a second independent cause.

Existing artifact identity mismatch, worker target/lifecycle binding mismatch, runtime/static failures, visibility/behavior failures, incomplete required checks, and cleanup/static-unproven handling otherwise keep their current ordering.

## Data flow

1. Resolve the initial target and build the initial Contract Index.
2. Acquire the plugin subject and produce the static `PluginCheckResult` from that exact index.
3. Bind the exact packed artifact and execute runtime verification against the initial target snapshot.
4. Rebuild the current target-bound Contract Index using the same canonical acquisition path.
5. Compare final target, lifecycle, and Contract Index identities against the initial epoch with target/lifecycle freshness owning diagnostic precedence.
6. Reduce one canonical `VerificationReport` containing the initial artifact, target, lifecycle, and Contract Index identities.

The final index contents are not exposed in the receipt and no new cache is introduced.

## Protocol contract

`verificationReport` adds required:

```json
{
  "contractIndexFingerprint": "dsh-contract-index-v1:<sha256>"
}
```

The field uses the existing Contract Index fingerprint pattern. Generated TypeScript types and protocol conformance fixtures remain generated from the canonical schema.

A new stable diagnostic is introduced:

```text
VERIFY_CONTRACT_INDEX_STALE
```

with domain `verification`, severity `error`, and wording that the target-bound Contract Index changed after verification execution so the result cannot be claimed for the current contract-evidence epoch.

## Kernel and reducer changes

`PluginVerificationReductionInput` gains:

- `initialContractIndexFingerprint: string`
- `finalContractIndexFingerprint: string`

`reducePluginVerification()`:

- computes target and lifecycle freshness first;
- computes `contractIndexStale` only when target and lifecycle remain fresh and the Contract Index fingerprints differ;
- emits `VERIFY_CONTRACT_INDEX_STALE` for that independently attributable Contract Index drift;
- treats target, lifecycle, and Contract Index freshness as `status: 'stale'` conditions after cancellation precedence;
- returns `contractIndexFingerprint: initialContractIndexFingerprint` in the report.

`createApplicationKernel().verifyPlugin()` must not call plain `resolveTarget()` for final freshness. It calls `buildContractIndex(request.target)` so final target and Contract Index are acquired as one canonical current evidence epoch, then passes both final identities to the reducer.

## Failure behavior

If final Contract Index acquisition itself fails, existing acquisition error semantics remain authoritative. Toolchain must not manufacture a stale comparison from an index that could not be built.

No frontend performs freshness comparison. CLI, native DSH, and MCP continue to project the shared kernel response.

## Compatibility

This changes the shape of successful Protocol v1 verification responses by adding one required receipt field. The repository is still `0.0.0`/incubator and the change corrects an incomplete correctness guarantee of the existing alpha contract. No protocol-version bump is introduced.

Existing callers that validate responses against the canonical schema receive the stronger field automatically after updating the package. No request shape changes.

## Tests

Tests must prove at minimum:

1. reducer receipts always carry the initial Contract Index fingerprint;
2. equal initial/final Contract Index identities preserve existing status semantics;
3. same target + same lifecycle + changed Contract Index reduces to `stale` and emits `VERIFY_CONTRACT_INDEX_STALE`;
4. cancellation still wins over Contract Index drift;
5. target/lifecycle stale behavior remains unchanged and does not gain a redundant Contract Index stale diagnostic;
6. kernel orchestration performs a second Contract Index acquisition after runtime verification and detects same-target evidence drift;
7. protocol schema/generated types/conformance require the new field;
8. public CLI/native/MCP projection tests remain transport-neutral and no frontend-owned comparison is added.

## Non-goals

- no change to `dsh-target-v2` semantics;
- no persistent Contract Index cache;
- no M5/Web work;
- no behavior/visibility vocabulary changes;
- no new runtime isolation or sandbox claims;
- no broad kernel refactor.
