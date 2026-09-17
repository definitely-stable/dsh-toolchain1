# Packed exports URL suffix hardening implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the bounded packed-artifact entrypoint inspector from producing false `VERIFY_PACKAGE_ENTRYPOINT_MISSING` failures for Node-valid simple root `exports` targets that include URL query or fragment suffixes.

**Architecture:** Keep the #200 verification boundary and diagnostic semantics intact. The inspector should only claim exact archive membership for literal unambiguous file targets; URL-suffixed `exports` are outside that bounded proof and must return `not-checkable`, leaving real runtime stages authoritative. No Protocol, schema, target identity, lifecycle identity, or Agent Tool changes are required.

**Tech Stack:** TypeScript, Vitest, Node package/ESM resolution semantics, GitHub Actions.

**Spec:** `spec/verification.md`; implementation owner: Issue #203.

## Global Constraints

- Base exactly on `main@b517c353ae3ee8997c22655dd3953255909db381` or a descendant that contains no competing edits to the inspector.
- Preserve `dsh-plugin-artifact-v1`, `dsh-target-v2`, and `dsh-profile-lifecycle-v1` semantics.
- Preserve `VERIFY_PACKAGE_ENTRYPOINT_MISSING` for plain statically provable file targets.
- Do not implement a full Node package/module resolver.
- Do not change conditional exports, extension/directory inference, transitive resolution, Agent Tool visibility, H1/H2, or retrieval.
- TDD is mandatory: the regression test must fail before production code changes.

---

### Task 1: Lock the URL-suffix regression as RED

**Files:**
- Modify: `tests/verification/packed-artifact-inspection.spec.ts`

**Interfaces:**
- Consumes: `inspectPackedArtifactRuntimeEntrypoint(packedBytes)`.
- Produces: regression contract that URL query/fragment targets are `not-checkable` whether the base file exists or not.

- [ ] **Step 1: Add the failing regression test**

Add one parameterized test covering `./plugin.mjs?mode=dsh` and `./plugin.mjs#runtime`; for each target, test both `['plugin.mjs']` and `[]` runtime-file sets and require `{ status: 'not-checkable' }`.

```ts
it('does not reinterpret URL-suffixed exports targets as literal archive member paths', () => {
  for (const exportsValue of ['./plugin.mjs?mode=dsh', './plugin.mjs#runtime']) {
    for (const runtimeFiles of [['plugin.mjs'], []] as const) {
      const bytes = artifact({
        name: 'candidate',
        version: '1.0.0',
        type: 'module',
        exports: exportsValue,
      }, runtimeFiles)

      expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({ status: 'not-checkable' })
    }
  }
})
```

- [ ] **Step 2: Verify RED**

Run the repository CI on the test-only branch/PR. Expected failure: the query/fragment case is classified as `missing` because the inspector searches for the literal suffixed tar path.

- [ ] **Step 3: Record immutable RED evidence**

Keep the exact branch HEAD and failing workflow run in the PR description before production code is changed.

---

### Task 2: Implement the minimal conservative eligibility guard

**Files:**
- Modify: `src/verification/packed-artifact-inspection.ts`
- Test: `tests/verification/packed-artifact-inspection.spec.ts`

**Interfaces:**
- Consumes: simple root `exports` string.
- Produces: `entrypointArchivePath()` returns `undefined` for targets containing `?` or `#`, which maps to inspector `not-checkable`.

- [ ] **Step 1: Add the smallest production guard**

In `hasInvalidExportsSegment(value)`, reject URL query and fragment suffixes before archive-path normalization:

```ts
if (!value.startsWith('./')) return true
const relative = value.slice(2)
if (relative.length === 0 || relative.includes('%') || relative.includes('?') || relative.includes('#')) return true
```

Do not parse/strip the suffix and do not broaden static proof semantics.

- [ ] **Step 2: Verify focused GREEN**

Run the focused packed-artifact inspector test. The new regression must pass and existing plain `main` / `exports` present/missing tests must remain green.

- [ ] **Step 3: Run repository-wide verification**

Require the normal CI matrix and primary real-DSH verification lane to be green on the final exact HEAD. No new registry-backed scenario is required because this change narrows static inspection and does not add a new runtime claim.

---

### Task 3: Final review and handoff

**Files:**
- Review only: final PR diff, Issue #203, `spec/verification.md`.

**Interfaces:**
- Produces: focused, reviewable fix with no public contract drift.

- [ ] **Step 1: Self-review the final diff**

Confirm only the plan, regression test, and minimal inspector guard changed; no generated files, schema, Protocol, Agent Tool, H1/H2, or unrelated formatting edits.

- [ ] **Step 2: Confirm documentation impact**

No normative wording change is required if the implementation still matches the existing statement that only unambiguous simple root file targets are statically checked and ambiguous/runtime-resolved cases are deferred.

- [ ] **Step 3: Update PR/Issue evidence**

Record exact RED and final GREEN workflow run IDs/SHA. Close Issue #203 only after the final exact-head CI is green and the PR is merged.

- [ ] **Step 4: Keep broader hardening separate**

Issue #204 owns TAR/PAX consolidation, explicit inspection-failure semantics, Unicode PAX byte accounting, and bounded diagnostic display. Do not pull those changes into this PR.
