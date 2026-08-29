# M2.3 Retained P0 Re-adjudication v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-adjudicate the immutable retained P0 run `33264398212` offline with independent API Truth v2 and corrected adjudication v2, producing a small content-addressed derived report without mutating historical evidence or executing a provider.

**Architecture:** Treat the retained `result.json` as immutable observations only. A pure evaluation-only re-adjudicator receives the already-parsed retained result plus an `ApiTruthUniverseV2`, replays only model-outcome `rawAnswer.inline` through `adjudicateP0ModelOutcomeV2`, and emits a compact derived report with source identities, per-run v2 verdicts, and arm aggregates. The report is analysis over historical bytes, never a replacement P0 result.

**Tech Stack:** TypeScript 6, Node.js `^22.19.0 || >=24`, Vitest 4, existing retained P0 fixtures, `m2-api-truth-v2`, `m2-agent-p0-adjudication-v2`, canonical evaluation JSON and SHA-256 ports.

**Spec:** GitHub Issue #64; retained fixture `tests/evaluation/fixtures/m2/p0-live-33264398212/`; `docs/evaluation/m2/agent-comparison.md`; `AGENTS.md`; `CONTRIBUTING.md`.

## Global Constraints

- Evaluation-only. Do not modify `src/**`, Protocol, production Contract Index/ranking, provider adapters, dependencies, lockfile, or required CI workflow.
- Do not edit `api-oracle-v1.json`, the historical P0 definition, retained `probe.json`, retained `result.json`, or retained `manifest.json`.
- Historical status remains `INCONCLUSIVE`; a derived v2 report MUST NOT claim to replace or rewrite it.
- No network, provider, subprocess, or live P0 execution is permitted.
- Re-adjudication consumes only retained model raw answers and independent Truth v2 derived from the frozen rc.2 ordinary workspace.
- Missing model outcomes stay missing; no synthetic answer or retry may be created.
- API/task `UNKNOWN` remains `UNKNOWN`; the report may summarize uncertainty but MUST NOT coerce it to a success/failure to manufacture calibration.
- Commit only a compact derived report if needed; never duplicate the multi-megabyte retained result fixture.

---

### Task 1: Pure retained-run re-adjudicator

**Files:**
- Create: `tests/evaluation/m2-retained-p0-readjudication-v2.ts`
- Create: `tests/evaluation/m2-retained-p0-readjudication-v2.spec.ts`
- Reuse: `tests/evaluation/m2-api-truth-v2.ts`
- Reuse: `tests/evaluation/m2-agent-p0-adjudication-v2.ts`

**Interfaces:**

```ts
export interface RetainedP0ReAdjudicationV2Run {
  readonly taskId: string
  readonly arm: 'A' | 'B' | 'C'
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly taskSuccess: 'SUCCESS' | 'FAILURE' | 'UNKNOWN'
  readonly apiClaims: readonly {
    readonly package: string | '*'
    readonly symbol: string
    readonly assertion: 'exists' | 'absent'
    readonly classification: 'VALID' | 'INVALID' | 'UNKNOWN'
    readonly resolution: string
  }[]
}

export interface RetainedP0ReAdjudicationV2Report {
  readonly schema: 'dsh-toolchain-m2-p0-readjudication-v2'
  readonly source: {
    readonly runId: 33264398212
    readonly definitionSha256: string
    readonly historicalStatus: 'INCONCLUSIVE'
    readonly scheduledRuns: 72
    readonly modelOutcomes: 69
  }
  readonly truthFingerprint: string
  readonly runs: readonly RetainedP0ReAdjudicationV2Run[]
  readonly byArm: Readonly<Record<'A' | 'B' | 'C', {
    readonly modelOutcomes: number
    readonly success: number
    readonly failure: number
    readonly unknown: number
    readonly validClaims: number
    readonly invalidClaims: number
    readonly unknownClaims: number
  }>>
  readonly reportSha256: string
}

export async function readjudicateRetainedP0V2(
  retainedResult: unknown,
  truth: ApiTruthUniverseV2,
  sha256: Sha256Port,
): Promise<RetainedP0ReAdjudicationV2Report>
```

- [ ] **Step 1: Write RED tests**

Read the immutable retained `result.json`, build Truth v2 from `rc2-web-v1/ordinary-workspace.json`, call the new function and assert:

```ts
expect(report.source).toMatchObject({
  runId: 33264398212,
  definitionSha256: '240d1e9ff32c976a55c6a312e16f2046833047c512d33f711bb0eef60c8be2c6',
  historicalStatus: 'INCONCLUSIVE',
  scheduledRuns: 72,
  modelOutcomes: 69,
})
expect(report.runs).toHaveLength(69)
expect(report.runs.filter(run => run.arm === 'B' || run.arm === 'C')).toHaveLength(48)
expect(report.reportSha256).toMatch(/^[0-9a-f]{64}$/u)
```

Also assert the report contains no retained raw answer body and no provider credential/environment field.

- [ ] **Step 2: Run focused RED**

Run:

```text
pnpm vitest run tests/evaluation/m2-retained-p0-readjudication-v2.spec.ts
```

Expected: FAIL because `m2-retained-p0-readjudication-v2.ts` does not exist.

- [ ] **Step 3: Implement minimal parser/replay**

Implementation must validate the retained result shape, locate exactly one terminal model-outcome attempt for each model outcome, require `rawAnswer.inline`, call `adjudicateP0ModelOutcomeV2(taskId, rawAnswer.inline, truth)`, retain only compact claim identities/classifications/resolutions, aggregate counts by arm, canonicalize the report projection without `reportSha256`, and hash it using the injected `Sha256Port`.

- [ ] **Step 4: Run focused GREEN and typecheck**

```text
pnpm vitest run tests/evaluation/m2-retained-p0-readjudication-v2.spec.ts
pnpm run typecheck
```

Expected: PASS.

---

### Task 2: Regression invariants over the actual retained 72-run evidence

**Files:**
- Modify: `tests/evaluation/m2-retained-p0-readjudication-v2.spec.ts`

- [ ] **Step 1: Add RED assertions for observed evaluator defects**

The real retained evidence must prove:

```ts
// dotted p0-07 claims are retained rather than silently dropped
expect(report.runs.some(run => run.taskId === 'p0-07'
  && run.apiClaims.some(claim => claim.symbol === 'profile.patchReload'))).toBe(true)

// exact public class methods are never INVALID merely because v1 saw exports only
expect(report.runs
  .flatMap(run => run.apiClaims)
  .filter(claim => claim.symbol === 'ApprovalService.setPolicy'
    || claim.symbol === 'ApprovalService.overrideOf')
  .every(claim => claim.classification !== 'INVALID')).toBe(true)

// p0-05 accepts the real enforcement API
expect(report.runs.some(run => run.taskId === 'p0-05'
  && run.apiClaims.some(claim => claim.symbol === 'resolveChildDepth'
    && claim.classification === 'VALID'))).toBe(true)
```

For p0-08, assert a retained target-wide ToolAutopilot absence can produce task `SUCCESS` while the literal claim remains `UNKNOWN` when the task is proven by the complete `dsh-tools` package scope. For p0-07, assert target-scoped absence may remain `UNKNOWN` while the frozen target declaration closure is incomplete.

- [ ] **Step 2: Run the focused test**

Expected: PASS if Task 1 replays the actual retained bytes correctly; any failure is evidence to investigate, not a reason to whitelist a trial.

---

### Task 3: Freeze only compact derived evidence and document interpretation

**Files:**
- Create only if useful: `docs/evaluation/m2/p0-readjudication-v2.json`
- Modify: GitHub Issue #64 with the observed compact summary after CI verifies it.

- [ ] **Step 1: Obtain exact deterministic aggregates from the focused test/CI**

Record `byArm`, report fingerprint, Truth v2 fingerprint, source run and definition hash. Do not infer counts manually.

- [ ] **Step 2: If a committed derived artifact is justified, write only the compact report**

The artifact must omit raw answers, tool traces, provider payloads and duplicated historical bytes. It must explicitly label itself `derived`, retain historical status `INCONCLUSIVE`, and state that it does not replace the historical P0 result.

- [ ] **Step 3: Run repository verification**

```text
pnpm check
```

Required CI must remain provider-free. Full platform/package/DSH composition verification is the ordinary repository CI matrix.

- [ ] **Step 4: Review final diff and merge only exact-head green CI**

Confirm no historical fixture was modified and no live workflow/provider invocation was added.
