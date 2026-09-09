# Packed archive inspection hardening implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove divergent TAR/PAX semantics between packed acquisition and verification, make PAX parsing byte-correct for UTF-8 values, and ensure internal verification-inspector faults fail closed instead of being silently downgraded to `not-checkable`.

**Architecture:** Introduce one bounded archive-index implementation in the closed internal `runtime` utility layer and reuse it from both packed acquisition and verification. Acquisition remains authoritative for static subject validity; verification consumes the exact already-fingerprinted bytes only to add package-integrity evidence. Unsupported Node resolution semantics continue to return `not-checkable`; malformed archive/manifest inspection returns an explicit failure result that the worker maps to a package-stage failure. No kernel or Protocol transport dependency is introduced.

**Tech Stack:** TypeScript, Node Buffer/zlib, Vitest, GitHub Actions.

**Owner:** Issue #204. Base: `main@1dac0e817b0924d34ef1e7f7c4a686ebf718600b`.

## Global constraints

- Preserve `dsh-plugin-artifact-v1`, `dsh-target-v2`, `dsh-profile-lifecycle-v1`, Agent Tool semantics, H1/H2 and retrieval.
- Do not implement a full Node package/module resolver or conditional exports evaluator.
- Keep plain `main` and simple root `exports` present/missing semantics from #200/#205.
- Artifact identity must be established before semantic package failure.
- Archive parsing remains bounded and non-extracting.
- TDD is mandatory: correctness regressions are committed RED before production changes.

---

### Task 1: Lock byte-correct PAX and inspection-fault semantics as RED

**Files:**
- Modify: `tests/verification/packed-artifact-inspection.spec.ts`
- Modify: `tests/acquisition/plugin-packed.spec.ts`
- Modify: `tests/verification/packed-worker-package-integrity.spec.ts`

- [ ] Add a real gzip/tar fixture containing an extended PAX `path=` record whose value contains multi-byte UTF-8 and whose declared record length is the correct byte length.
- [ ] Require verification to resolve the PAX-mapped runtime entry and return `present`.
- [ ] Require acquisition to accept a PAX-mapped UTF-8 bundle-patch/member path rather than returning `PLUGIN_PACKED_INVALID`.
- [ ] Require malformed bounded archive bytes passed to the verifier inspector to produce explicit `failed`, not `not-checkable`.
- [ ] Require the worker to stop before subprocesses, preserve artifact/target/lifecycle fingerprints, fail `package`, and emit `VERIFY_PACKAGE_INSPECTION_FAILED` when inspection fails.
- [ ] Run CI on the test-only HEAD and record the exact RED evidence.

---

### Task 2: Establish one bounded archive index

**Files:**
- Add: `src/runtime/packed-archive.ts`
- Add: `tests/runtime/packed-archive.spec.ts`
- Modify: `src/acquisition/plugin-packed.ts`
- Modify: `src/verification/packed-artifact-inspection.ts`
- Modify: `scripts/check-architecture.mjs`
- Add: `tests/policy/runtime-layer.spec.ts`

- [ ] Move TAR header parsing, checksum validation, canonical-path validation, PAX handling, GNU long-name handling, duplicate detection and bounded archive indexing into one exported runtime-IO module.
- [ ] Parse PAX records against `Buffer` byte offsets. Record length is a byte count; decode key/value only after record boundaries are validated.
- [ ] Stop applying `trimEnd()` to path/name data. NUL termination remains structural, but trailing spaces in names are preserved.
- [ ] Preserve canonical path safety and reject duplicate canonical member names.
- [ ] Keep gzip decompression bounded at existing limits in both consumers.
- [ ] Make acquisition consume the shared index without changing public acquisition results.
- [ ] Make verification consume the same shared index and remove its handwritten TAR/PAX parser.
- [ ] Keep the `runtime` layer closed to semantic code; only explicit runtime-boundary consumers may depend on it.

---

### Task 3: Split unsupported from inspection failure and fail closed

**Files:**
- Modify: `src/verification/packed-artifact-inspection.ts`
- Modify: `src/verification/packed-worker.ts`
- Test: `tests/verification/packed-artifact-inspection.spec.ts`
- Test: `tests/verification/packed-worker-package-integrity.spec.ts`

- [ ] Extend the internal inspector result to `present | missing | not-checkable | failed`.
- [ ] Reserve `not-checkable` for intentional deferral only: non-gzip/non-applicable inputs, conditional exports, URL/query/fragment/percent targets, directory/extension inference, and non-regular runtime entry targets.
- [ ] Map archive corruption, malformed PAX/TAR, malformed package JSON and equivalent inspector faults to `failed`.
- [ ] Map `failed` in the worker to `VERIFY_PACKAGE_INSPECTION_FAILED`, package-stage failure, and skipped downstream install/compose/boot/visibility.
- [ ] Preserve exact artifact fingerprint in the failed execution receipt.

---

### Task 4: Bound diagnostic display payloads

**Files:**
- Modify: `src/verification/packed-worker.ts`
- Test: `tests/verification/packed-worker-package-integrity.spec.ts`

- [ ] Bound the user-controlled entrypoint display text used by `VERIFY_PACKAGE_ENTRYPOINT_MISSING` to a small deterministic maximum while keeping the exact artifact fingerprint as durable evidence identity.
- [ ] Do not mutate the entrypoint used for archive membership lookup; bound only diagnostic presentation.
- [ ] Add a regression proving the diagnostic stays bounded for a long declared entrypoint.

---

### Task 5: Final verification and merge discipline

- [ ] Run focused tests and repository-wide CI on the final exact HEAD.
- [ ] Require Node 22/24/26, Windows/macOS, pack/manifest, real DSH, isolated worker, public positive/negative verify, compose and target-train gates GREEN.
- [ ] Self-review for parser duplication, generated drift, scope creep and accidental kernel/Protocol coupling.
- [ ] Update PR #/Issue #204 with immutable RED/GREEN SHA and workflow evidence.
- [ ] Mark ready only after exact-head GREEN; squash merge with expected-head guard.
- [ ] Verify `main` points to the merge SHA and require post-merge push CI GREEN before closing the work.
