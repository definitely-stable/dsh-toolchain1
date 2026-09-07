# ADR-0010: Profile patch-reload lifecycle identity v1

- Status: Proposed
- Date: 2026-09-07
- Related: ADR-0007, ADR-0008, ADR-0009, Issue #33

## Context

ADR-0007 intentionally defines `dsh-target-v2` as the identity of the startup composition inputs Toolchain can resolve read-only: DSH/runtime identity, profile name, ordered bundle identities and patch hashes, profile dependencies, profile/home patch hashes, and ordered invocation overlays. Launcher-synthesized/runtime state is explicitly outside that projection.

Published DSH `0.1.2-rc.1` adds `dsh.profile.patchReload: live | startup`. The policy does not change the startup patch bytes. It changes what happens after boot:

- `live` watches the profile and home user patch files and recomposes the running tree when they change;
- `startup` applies the user layers once and installs no patch watchers.

Therefore two installations can have identical `dsh-target-v2` fingerprints while differing in a lifecycle property that changes the validity window of runtime observations and verification receipts. Adding `patchReload` silently to `dsh-target-v2` would change an existing content-addressed namespace and invalidate frozen rc.2 evidence without a version transition.

## Decision

Keep `dsh-target-v2` unchanged.

For installed DSH trains whose launcher contract supports `dsh.profile.patchReload` (DSH core version `>= 0.1.2`), target acquisition additionally resolves an effective profile lifecycle policy:

```text
live | startup
```

If the supported-train profile manifest omits the field, Toolchain uses the upstream compatibility default `live`. Any other present value is an invalid supported-train profile manifest and fails target acquisition.

Older DSH trains do not expose lifecycle metadata. Toolchain must not reinterpret their frozen target snapshots by backfilling this newer contract.

### Lifecycle projection

The semantic projection is:

```json
{
  "schema": "dsh-profile-lifecycle-v1",
  "patchReload": "live"
}
```

or the corresponding `startup` value. Canonical JSON uses the same recursively code-point-sorted-key convention as other Toolchain content-addressed identities.

The fingerprint is:

```text
dsh-profile-lifecycle-v1:<lowercase sha256 hex(canonicalProjectionJson)>
```

Profile name and DSH version are intentionally not duplicated into this fingerprint. They are already bound by the accompanying `dsh-target-v2` identity. The lifecycle fingerprint identifies the policy dimension itself and is only interpreted together with the target snapshot that carries it.

### Protocol representation

On supporting trains, `TargetSnapshot` carries optional top-level metadata:

```text
profileLifecycle:
  patchReload: live | startup
  fingerprint: dsh-profile-lifecycle-v1:<sha256>
```

The field is optional specifically to preserve old-train/frozen receipt semantics. It is not optional for acquisition of a supporting train: if the train supports the contract and the effective policy cannot be proven, target resolution fails closed.

`VerificationReport` optionally carries `lifecycleFingerprint` when verification was executed against a lifecycle-aware target.

### Static vs runtime identity

Contract acquisition, Contract Index identity, static `plugin.check`, and retrieval evaluation remain keyed to `dsh-target-v2` plus the evidence they actually consume. A lifecycle-only change does not change startup declarations or composed bytes and therefore must not fabricate a new Contract Index identity by itself.

Strong runtime claims use both identities when available:

```text
(targetFingerprint, lifecycleFingerprint?)
```

A lifecycle-aware verification worker must echo the lifecycle identity it was given. The application reducer fails closed if the worker binding differs from the initial snapshot. If final target re-resolution returns the same `dsh-target-v2` but a different lifecycle fingerprint, the verification result is `stale` rather than `verified`.

Likewise, live DSH Host enrichment may join a resolved snapshot only when the immutable startup binding matches both the target fingerprint and lifecycle fingerprint on lifecycle-aware trains. Missing or mismatched lifecycle metadata fails closed rather than weakening the binding to paths or target-v2 alone.

## Compatibility and migration

- Frozen `@deepseek-ai/dsh@0.1.1-rc.2` H1/R1/R2/Contract Index identities and `dsh-target-v2` receipts remain unchanged.
- Existing v2 consumers continue to use `snapshot.fingerprint` exactly as before.
- Consumers that make runtime/freshness claims should additionally bind `profileLifecycle.fingerprint` whenever present.
- Old-train snapshots legitimately omit lifecycle metadata; absence there is not interpreted as either `live` or `startup`.
- New supporting trains must not silently omit lifecycle metadata.
- No `dsh-target-v3` is introduced by this change. A future target namespace revision remains available if startup-composition semantics themselves change.

## Support policy

Registry support for DSH 0.1.2 is widened only after real `@deepseek-ai/dsh@0.1.2-rc.1` target-resolution and isolated public `plugin.verify` smokes pass with lifecycle assertions. Source-only/master evidence is not sufficient for the support claim.

## Consequences

- Target identity retains the precise static meaning established by ADR-0007.
- Runtime receipts can distinguish identical startup bytes with different post-boot reload behavior.
- Frozen rc.2 evidence does not need migration or relabeling.
- Protocol v1 gains additive optional lifecycle metadata rather than a target namespace reset.
- Verification/runtime binding becomes stricter on lifecycle-aware DSH trains while remaining backward-compatible for older supported trains.
