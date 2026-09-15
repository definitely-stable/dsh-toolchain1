# Plugin Verify Contract Index Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every public `plugin.verify` receipt to the exact Contract Index used by its static compatibility result and make same-target Contract Index drift reduce to `stale`.

**Architecture:** Keep Protocol v1. Extend `VerificationReport` with the initial `contractIndexFingerprint`, make kernel verification rebuild the canonical target-bound Contract Index after runtime execution, and let the shared reducer compare initial/final Contract Index identities alongside target/lifecycle freshness. No frontend owns freshness logic.

**Tech Stack:** TypeScript 6, Vitest, JSON Schema Draft 2020-12, generated Protocol v1 TypeScript, existing Application Kernel and M4 verification reducer.

**Spec:** `docs/superpowers/specs/2026-09-15-plugin-verify-contract-index-freshness-design.md`

## Global Constraints

- Protocol version remains exactly `1`.
- `dsh-target-v2` semantics do not change.
- ADR-0008 independent Target/Contract Index identity axes remain authoritative.
- `VerificationReport.contractIndexFingerprint` is required and records the initial index used for static verification.
- Same target/lifecycle plus changed final Contract Index yields `status: 'stale'` with `VERIFY_CONTRACT_INDEX_STALE`.
- Cancellation retains precedence over freshness drift.
- No frontend-owned freshness comparison.
- No persistent Contract Index cache, M5/Web work, assertion-vocabulary expansion, sandbox changes, dependency changes, or broad kernel refactor.

---

### Task 1: Add reducer-level Contract Index freshness semantics

**Files:**
- Modify: `src/model/plugin-verify.ts`
- Test: existing verification reducer spec under `tests/` that exercises `reducePluginVerification`

**Interfaces:**
- Consumes: existing `PluginVerificationReductionInput`, `VerificationReport`, target/lifecycle/artifact reducer semantics.
- Produces: `initialContractIndexFingerprint: string`, `finalContractIndexFingerprint: string` reducer inputs and canonical `contractIndexFingerprint` receipt field.

- [ ] **Step 1: Write the failing reducer tests**

Add focused cases proving:

```ts
expect(report.contractIndexFingerprint).toBe(initialContractIndexFingerprint)
```

for the normal path, and:

```ts
expect(report.status).toBe('stale')
expect(report.diagnostics).toContainEqual(expect.objectContaining({
  code: 'VERIFY_CONTRACT_INDEX_STALE',
  severity: 'error',
  domain: 'verification',
}))
```

when only the final Contract Index fingerprint differs.

Add one case where execution is cancelled and the Contract Index differs; expect `cancelled`, proving cancellation precedence.

- [ ] **Step 2: Run the focused reducer tests and verify RED**

Run the repository's existing focused Vitest invocation for the reducer spec. Expected failure: missing reduction input fields and/or missing `contractIndexFingerprint`/stale diagnostic behavior. The failure must be caused by the absent feature, not fixture/schema breakage.

- [ ] **Step 3: Implement minimal reducer behavior**

In `src/model/plugin-verify.ts`:

```ts
export interface PluginVerificationReductionInput {
  readonly artifactFingerprint: string
  readonly initialTargetFingerprint: string
  readonly finalTargetFingerprint: string
  readonly initialContractIndexFingerprint: string
  readonly finalContractIndexFingerprint: string
  // existing lifecycle/static/execution fields unchanged
}
```

Compute:

```ts
const contractIndexStale =
  input.finalContractIndexFingerprint !== input.initialContractIndexFingerprint
```

When true, append:

```ts
diagnostic(
  'VERIFY_CONTRACT_INDEX_STALE',
  'error',
  'The target-bound Contract Index changed after verification execution and the result cannot be claimed for the current contract-evidence epoch.',
)
```

Extend stale reduction to:

```ts
: targetStale || lifecycleStale || contractIndexStale
  ? 'stale'
```

Return:

```ts
contractIndexFingerprint: input.initialContractIndexFingerprint,
```

without changing the existing ordering after the freshness branch.

- [ ] **Step 4: Run focused reducer tests and verify GREEN**

Expected: new tests pass and prior target/lifecycle/artifact reducer cases remain green.

- [ ] **Step 5: Commit**

```bash
git add src/model/plugin-verify.ts tests
git commit -m "fix(verify): bind receipts to contract index freshness"
```

---

### Task 2: Make kernel verification re-acquire the final Contract Index

**Files:**
- Modify: `src/kernel/index.ts`
- Test: existing kernel verification spec under `tests/` that exercises `createApplicationKernel().verifyPlugin()`

**Interfaces:**
- Consumes: Task 1 reducer fields; existing private `buildContractIndex(request.target)` path.
- Produces: one initial `(snapshot,index)` epoch and one final `(snapshot,index)` epoch around runtime execution.

- [ ] **Step 1: Write the failing kernel orchestration test**

Build a deterministic acquisition fixture whose target facts stay identical while Contract Acquisition returns evidence/contracts that produce index `X` for the initial build and index `Y` for the post-runtime build.

The test must assert:

```ts
expect(outcome.data.status).toBe('stale')
expect(outcome.data.targetFingerprint).toBe(initialTargetFingerprint)
expect(outcome.data.contractIndexFingerprint).toBe(initialContractIndexFingerprint)
expect(outcome.data.diagnostics).toContainEqual(expect.objectContaining({
  code: 'VERIFY_CONTRACT_INDEX_STALE',
}))
```

and prove target acquisition still describes the same target epoch.

- [ ] **Step 2: Run the focused kernel verification test and verify RED**

Expected current behavior before implementation: target re-resolution succeeds with the same target fingerprint and the verification result does not become stale because no final Contract Index is rebuilt.

- [ ] **Step 3: Implement minimal kernel orchestration change**

Replace the final plain target re-resolution in `verifyPlugin()`:

```ts
const { snapshot: finalSnapshot } = await resolveTarget(request.target)
```

with:

```ts
const { snapshot: finalSnapshot, index: finalIndex } = await buildContractIndex(request.target)
```

Pass to the reducer:

```ts
initialContractIndexFingerprint: index.fingerprint,
finalContractIndexFingerprint: finalIndex.fingerprint,
```

Keep `staticOutcome` bound to the original `index` and keep worker execution bound to the original `snapshot`.

- [ ] **Step 4: Run focused kernel tests and verify GREEN**

Expected: same-target Contract Index drift test becomes `stale`; existing unchanged-index verification tests preserve prior statuses.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/index.ts tests
git commit -m "fix(kernel): revalidate contract index after verification"
```

---

### Task 3: Strengthen the Protocol v1 receipt schema

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Regenerate: `src/protocol/generated.ts`
- Test: existing protocol/schema/generated conformance tests under `tests/`

**Interfaces:**
- Consumes: existing `dsh-contract-index-v1:[0-9a-f]{64}` schema convention.
- Produces: required `VerificationReport.contractIndexFingerprint: string` in canonical schema and generated TypeScript.

- [ ] **Step 1: Write/update the failing Protocol conformance test**

Add a success-response fixture containing:

```json
"contractIndexFingerprint": "dsh-contract-index-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
```

and a negative fixture omitting the field. The canonical success fixture should be required to validate; the omission should fail schema validation.

- [ ] **Step 2: Run focused protocol tests and verify RED**

Expected: generated/runtime report typing or schema acceptance does not yet enforce the new required field.

- [ ] **Step 3: Update canonical JSON Schema**

In `$defs.verificationReport.required`, add `contractIndexFingerprint`.

In `$defs.verificationReport.properties`, add:

```json
"contractIndexFingerprint": {
  "type": "string",
  "pattern": "^dsh-contract-index-v1:[0-9a-f]{64}$"
}
```

- [ ] **Step 4: Regenerate Protocol types**

Run:

```bash
pnpm generate
pnpm check:generated
pnpm check:protocol
```

Expected: `src/protocol/generated.ts` contains required `contractIndexFingerprint` on `VerificationReport` and generated artifacts are synchronized.

- [ ] **Step 5: Run focused protocol tests and verify GREEN**

Expected: receipt with field validates; omission fails; generated parity is green.

- [ ] **Step 6: Commit**

```bash
git add spec/schemas/v1/toolchain-protocol.schema.json src/protocol/generated.ts tests
git commit -m "feat(protocol): expose verification contract index identity"
```

---

### Task 4: Repair all verification fixtures and transport projections

**Files:**
- Modify: verification/kernel/frontend test fixtures that construct `VerificationReport` or `PluginVerificationReductionInput`
- Verify only unless compilation proves otherwise: `src/frontends/cli/**`, `src/frontends/mcp/**`, `src/integrations/dsh/**`

**Interfaces:**
- Consumes: required `VerificationReport.contractIndexFingerprint` from Task 3.
- Produces: repository-wide type/test parity with no frontend-owned freshness logic.

- [ ] **Step 1: Run typecheck/tests to expose all incomplete fixtures**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected before fixture repair: failures only where tests/helpers manually construct verification reports/reducer inputs without the new required fingerprint.

- [ ] **Step 2: Update fixtures with deterministic Contract Index fingerprints**

Use valid `dsh-contract-index-v1:<64 lowercase hex>` constants. For unchanged-index cases, initial and final values must be identical. For stale-specific cases, use two explicit distinct values.

Do not add comparison logic to CLI/MCP/DSH projections.

- [ ] **Step 3: Run typecheck/tests and verify GREEN**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: all tests and typechecks pass.

- [ ] **Step 4: Commit**

```bash
git add tests src/frontends src/integrations
git commit -m "test(verify): propagate contract index receipt identity"
```

Only stage production frontend files if the compiler proves a generated/type projection update is genuinely necessary.

---

### Task 5: Verify repository-wide invariants and exact package path

**Files:**
- Modify only if a real regression is found: focused tests or docs directly affected by Issue #227.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: exact-head evidence that the stronger freshness contract does not regress architecture, package, runtime, or frontend parity.

- [ ] **Step 1: Run aggregate repository gate**

```bash
pnpm check
```

Expected: generated/protocol/architecture/package/CI-storage/lint/typecheck/scripts/tests all green.

- [ ] **Step 2: Build and pack exact artifact**

```bash
pnpm build
mkdir -p .artifacts
pnpm pack --out .artifacts/dsh-toolchain.tgz
node scripts/check-pack.mjs .artifacts/dsh-toolchain.tgz
```

Expected: exact distribution artifact passes package inspection.

- [ ] **Step 3: Run affected public verification smokes**

```bash
node scripts/smoke-plugin-verify.mjs .artifacts/dsh-toolchain.tgz
node scripts/smoke-plugin-verify-negative.mjs .artifacts/dsh-toolchain.tgz
node scripts/smoke-operation-lifecycle.mjs .artifacts/dsh-toolchain.tgz
```

Expected: normal public verification and existing negative/lifecycle behavior remain green with the new receipt field.

- [ ] **Step 4: Run full CI-equivalent evidence through the draft PR**

Require exact-head success for CI, Performance Validation, and Real Plugin Corpus before merge. Do not infer success from an older head.

- [ ] **Step 5: Commit any directly required test/doc correction**

If no correction is required, do not create a decorative commit. Otherwise use a focused message such as:

```bash
git commit -m "test(verify): cover contract index freshness receipt"
```

---

### Task 6: Final review and issue closure evidence

**Files:**
- Update if repository convention requires: Issue #227 / PR description only.

**Interfaces:**
- Consumes: exact-head test/CI evidence.
- Produces: auditable acceptance record for Issue #227.

- [ ] **Step 1: Review the final diff against the design spec**

Confirm there is no target-fingerprint expansion, no cache, no frontend-owned freshness logic, no M5/assertion/sandbox scope creep, and no unrelated refactor.

- [ ] **Step 2: Verify exact-head checks**

Record the exact PR head SHA and exact workflow runs. Required result: all repository-required checks green on that SHA.

- [ ] **Step 3: Update PR acceptance evidence**

State explicitly that the regression proves:

```text
same target fingerprint + changed Contract Index fingerprint => stale
```

and that the receipt exposes the initial Contract Index identity used for static compatibility.

- [ ] **Step 4: Merge only after exact-head green evidence**

Issue #227 should close through the merge PR (`Closes #227`) once exact-head acceptance is green.
