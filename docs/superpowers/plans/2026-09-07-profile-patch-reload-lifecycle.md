# Profile Patch Reload Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model DSH `dsh.profile.patchReload` without changing `dsh-target-v2`, and bind strong runtime verification/live-host evidence to a separately content-addressed lifecycle identity on DSH trains that support the lifecycle contract.

**Architecture:** `dsh-target-v2` remains the immutable startup-composition identity defined by ADR-0007. DSH 0.1.2+ target acquisition resolves the effective reload policy (`live | startup`) and derives `dsh-profile-lifecycle-v1:<sha256>` from that policy; older trains omit lifecycle metadata so frozen rc.2 target snapshots and evidence remain valid. Runtime verification and Host enrichment compare both identities whenever lifecycle metadata is present, while Contract Index identity remains target/evidence-bound and does not include reload policy.

**Tech Stack:** TypeScript 6, Node.js 22/24/26, Vitest 4, JSON Schema Draft 2020-12, pnpm 11, real `@deepseek-ai/dsh@0.1.2-rc.1` CI smoke.

**Spec:** `docs/decisions/ADR-0010-profile-patch-reload-lifecycle-v1.md`

## Global Constraints

- Do not mutate the `dsh-target-v2` canonical projection or fingerprint namespace.
- Do not rewrite frozen rc.2 H1/R1/R2/Contract Index identities or receipts.
- DSH versions before the 0.1.2 lifecycle contract omit `profileLifecycle` from Protocol snapshots/reports.
- DSH 0.1.2+ treats omitted `dsh.profile.patchReload` as upstream historical default `live`; explicit values are only `live | startup`.
- Lifecycle drift may invalidate runtime/live claims, but MUST NOT invalidate static Contract Index identity by itself.
- All acquisition remains read-only; no candidate code executes during `target.resolve` or `plugin.check`.
- Required CI remains deterministic except existing registry-backed smoke lanes.

---

### Task 1: Freeze identity semantics with RED model tests

**Files:**
- Modify: `tests/model/target.spec.ts`
- Modify: `src/model/target.ts`

**Interfaces:**
- Produces: `ProfilePatchReload`, `ProfileLifecycleSemanticProjectionV1`, `createProfileLifecycleSemanticProjectionV1(patchReload)`, `fingerprintProfileLifecycle(projection, digest)`.
- Preserves: `createTargetSemanticProjectionV2()` and `fingerprintTarget()` byte-for-byte semantics.

- [ ] Add a test proving identical `AcquiredTargetFacts` except `patchReload=live/startup` produce the same `dsh-target-v2` fingerprint but different `dsh-profile-lifecycle-v1` fingerprints.
- [ ] Run the target model test and observe RED because lifecycle functions/types do not exist.
- [ ] Implement the minimal pure lifecycle projection and fingerprint in `src/model/target.ts`.
- [ ] Re-run the target model test and preserve the existing canonical v2 JSON assertion exactly.

### Task 2: Resolve effective lifecycle policy at the filesystem boundary

**Files:**
- Modify: `src/acquisition/dsh-filesystem.ts`
- Modify: `tests/acquisition/dsh-filesystem.spec.ts`

**Interfaces:**
- `AcquiredTargetFacts.profile.patchReload?: 'live' | 'startup'` is present only when the installed DSH train supports the lifecycle contract.
- DSH core versions >= `0.1.2` support the contract; prerelease suffix does not change the core-version comparison.

- [ ] Add RED fixtures/tests for explicit `live`, explicit `startup`, omitted value on DSH 0.1.2+ => `live`, invalid supported-train value => `TARGET_MANIFEST_INVALID`, and unchanged omission on rc.2.
- [ ] Implement a small numeric core-version feature gate and supported-train manifest validation.
- [ ] Add authoritative manifest-backed lifecycle evidence without changing `dsh-target-v2` projection inputs.
- [ ] Re-run acquisition/model tests.

### Task 3: Project lifecycle metadata through Protocol and the kernel

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Regenerate: `src/protocol/generated.ts`
- Modify: `src/kernel/index.ts`
- Modify: target/protocol/kernel tests as required.

**Interfaces:**
- Optional `TargetSnapshot.profileLifecycle`: `{ patchReload, fingerprint }`.
- Optional `VerificationReport.lifecycleFingerprint` mirrors the lifecycle identity claimed by runtime verification.

- [ ] Add RED schema/kernel assertions for 0.1.2+ lifecycle metadata and rc.2 omission.
- [ ] Add schema definitions/pattern `^dsh-profile-lifecycle-v1:[0-9a-f]{64}$` and regenerate generated types.
- [ ] Make `resolveTarget()` derive lifecycle identity from acquired facts and expose it without changing `snapshot.fingerprint`.
- [ ] Confirm Protocol conformance and generated-file checks.

### Task 4: Bind `plugin.verify` and worker evidence to lifecycle identity

**Files:**
- Modify: `src/model/plugin-verify.ts`
- Modify: `src/verification/packed-worker.ts`
- Modify: `src/verification/execution-port.ts`
- Modify: `src/kernel/index.ts`
- Modify: verification/model/kernel tests.

**Interfaces:**
- Worker observations optionally echo `lifecycleFingerprint` from the exact input snapshot.
- Reducer receives initial/final lifecycle fingerprints and fails closed on worker binding mismatch.
- Initial/final lifecycle drift returns `status='stale'` with `VERIFY_LIFECYCLE_STALE` while target-v2 may remain unchanged.

- [ ] Add RED reducer tests for same target-v2 + changed lifecycle => stale and worker lifecycle mismatch => failed.
- [ ] Echo lifecycle identity through packed worker/execution port.
- [ ] Compare initial/final lifecycle in kernel reduction and emit the optional report binding.
- [ ] Preserve old-train behavior when both lifecycle identities are absent.

### Task 5: Bind live Host enrichment to startup lifecycle

**Files:**
- Modify: `src/integrations/dsh/runtime-target-binding.ts`
- Modify: `src/integrations/dsh/index.ts`
- Modify: `tests/dsh/runtime-target-binding.spec.ts` and related DSH integration tests.

**Interfaces:**
- Startup binding captures `{ targetFingerprint, lifecycleFingerprint? }` once when Toolchain mounts.
- `matches(snapshot)` requires lifecycle equality whenever either side has lifecycle metadata; a missing/mismatched lifecycle fails closed.

- [ ] Add RED same-target/different-lifecycle runtime binding test.
- [ ] Capture startup lifecycle alongside target-v2 identity.
- [ ] Require exact lifecycle match for live Inspect evidence on supported trains.
- [ ] Preserve existing path/runtime/overlay fail-closed rules.

### Task 6: Activate registry-backed DSH 0.1.2 compatibility evidence

**Files:**
- Modify: `scripts/smoke-target-resolve.mjs`
- Modify: `scripts/smoke-plugin-verify.mjs` or add an equivalently bounded compatibility smoke.
- Modify: `docs/evaluation/m2/upstream-drift.md`, `docs/architecture.md`, issue #33 status after evidence.

**Interfaces:**
- Target smoke includes `0.1.2-rc.1` and asserts `headless => startup` plus a valid lifecycle fingerprint.
- Existing rc.2/rc.8 target smoke continues to assert exact `dsh-target-v2` behavior without requiring lifecycle metadata.
- Runtime verification on 0.1.2-rc.1 must emit a lifecycle-bound verified receipt.

- [ ] Add the published 0.1.2-rc.1 target smoke and lifecycle assertions.
- [ ] Exercise public packed `plugin.verify` against 0.1.2-rc.1.
- [ ] Run full CI on the PR and inspect every job result before merge.
- [ ] Update #33 with exact CI/run evidence; close only if all acceptance criteria hold.
