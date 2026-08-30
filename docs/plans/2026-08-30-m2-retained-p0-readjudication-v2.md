# M2.3 Retained P0 Re-adjudication v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-adjudicate immutable retained P0 run `33264398212` offline with independent API Truth v2 and corrected adjudication v2, producing a small content-addressed derived analysis without mutating historical evidence or executing a provider.

**Architecture:** `result.json` remains immutable observation data. The evaluation-only re-adjudicator receives an explicit source identity plus the parsed retained result and a prebuilt `ApiTruthUniverseV2`. It replays only terminal `model-outcome` `rawAnswer.inline` values through `adjudicateP0ModelOutcomeV2`, including legitimate empty model answers, and emits compact per-run verdicts plus arm aggregates. A committed summary records only identities, aggregates, fingerprints and limitations; it does not replace the historical P0 result.

**Tech Stack:** TypeScript 6, Node.js `^22.19.0 || >=24`, Vitest 4, retained P0 fixtures, `m2-api-truth-v2`, `m2-agent-p0-adjudication-v2`, canonical evaluation JSON and SHA-256 ports.

**Spec:** GitHub Issue #64; retained fixture `tests/evaluation/fixtures/m2/p0-live-33264398212/`; `docs/evaluation/m2/agent-comparison.md`; `AGENTS.md`; `CONTRIBUTING.md`.

## Global Constraints

- Evaluation-only. Do not modify `src/**`, Protocol, production Contract Index/ranking, provider adapters, dependencies, lockfile, or required CI workflow.
- Do not edit Oracle v1, the historical P0 definition, retained `probe.json`, retained `result.json`, or retained `manifest.json`.
- Historical status remains `INCONCLUSIVE`; v2 output is derived analysis and MUST NOT replace/rewrite it.
- No network, provider, subprocess, retry synthesis, or live P0 execution.
- Re-adjudication consumes only retained model raw answers and independent Truth v2 derived from the frozen rc.2 ordinary workspace.
- Missing model outcomes stay missing. Empty terminal model answers remain real model outcomes and adjudicate normally to zero claims / `UNKNOWN` unless evidence says otherwise.
- `UNKNOWN` remains `UNKNOWN`; do not coerce uncertainty to manufacture calibration.
- Never duplicate the multi-megabyte retained result in a derived artifact.

---

### Task 1: Pure retained-run re-adjudicator

**Files:**
- `tests/evaluation/m2-retained-p0-readjudication-v2.ts`
- `tests/evaluation/m2-retained-p0-readjudication-v2.spec.ts`

**Actual interface:**

```ts
export interface RetainedP0ReAdjudicationV2Input {
  readonly source: {
    readonly runId: number
    readonly headSha: string
    readonly definitionSha256: string
    readonly resultSha256: string
    readonly historicalStatus: string
    readonly scheduledRuns: number
    readonly modelOutcomes: number
  }
  readonly retainedResult: unknown
}

export async function readjudicateRetainedP0V2(
  input: RetainedP0ReAdjudicationV2Input,
  truth: ApiTruthUniverseV2,
  sha256: Sha256Port,
): Promise<RetainedP0ReAdjudicationV2Report>
```

The report contains `schema`, `derived`, explicit source identity, adjudicator id, Truth fingerprint, 69 compact model-outcome verdicts, arm aggregates and a SHA-256 fingerprint over the canonical report projection.

- [x] **RED:** exact-head CI #699 failed because the module did not exist.
- [x] Validate source/result definition identity, historical status and scheduled-run count.
- [x] Locate exactly one terminal `model-outcome` when present; preserve the three historical missing model outcomes.
- [x] Preserve valid empty `rawAnswer.inline` strings instead of rejecting or dropping those observations.
- [x] Replay each retained answer only through `adjudicateP0ModelOutcomeV2` and independent Truth v2.
- [x] Emit compact claim identity/classification/resolution only; omit raw answer/provider/execution/environment data.
- [x] Canonicalize and hash the derived report through the injected SHA-256 port.

---

### Task 2: Regression invariants over actual retained evidence

- [x] Preserve dotted `profile.patchReload` claims instead of silently dropping them.
- [x] Ensure approval public member claims are not falsely `INVALID` because v1 only modeled package exports.
- [x] Recognize retained `resolveChildDepth` as `VALID` for p0-05.
- [x] Preserve target-wide p0-07 uncertainty while the frozen target declaration closure is incomplete.
- [x] Allow p0-08 task `SUCCESS` from the complete `@deepseek-ai/dsh-tools` task scope while the literal target-wide ToolAutopilot claim remains `UNKNOWN/incomplete-universe`.
- [x] Preserve all 69 model outcomes, including empty final answers; no retries or synthetic observations are added.

---

### Task 3: Freeze compact derived evidence

**Derived summary:** `docs/evaluation/m2/p0-readjudication-v2.json`

Exact values were emitted by deterministic CI #703 before being frozen into assertions:

```text
A: 21 outcomes — 0 SUCCESS / 0 FAILURE / 21 UNKNOWN
B: 24 outcomes — 15 SUCCESS / 0 FAILURE / 9 UNKNOWN
C: 24 outcomes — 22 SUCCESS / 0 FAILURE / 2 UNKNOWN
```

API-claim aggregates under v2:

```text
A: 0 VALID / 2 INVALID / 11 UNKNOWN
B: 23 VALID / 0 INVALID / 6 UNKNOWN
C: 57 VALID / 0 INVALID / 7 UNKNOWN
```

Identities:

```text
Truth:  dsh-api-truth-v2:14ab2c32fa1307de300d09715b30a147a9ffe7884335ee0f19ebc5cb018871bb
Report: aaba6e82c2506d0af0b440cb0bf34c1ebf68efc9293f32ca8eeeadeb294bdd69
```

- [x] Obtain exact aggregates/fingerprints from CI rather than hand-calculating them.
- [x] Commit only a compact summary; no raw answers, provider payloads, tool traces, environment or duplicated retained bytes.
- [x] Freeze exact summary values as executable test invariants against the immutable retained evidence.
- [ ] Run final exact-head repository CI after the summary/plan cleanup.
- [ ] Review the final diff and confirm historical fixtures and live workflows are untouched.
- [ ] Merge only the exact head that passes required CI and verify post-merge `main` CI.
- [ ] Update Issue #64 with the derived result and remaining gate status.

## Interpretation

The corrected offline analysis changes the observable P0 comparison materially: B is `15/24 SUCCESS`, C is `22/24 SUCCESS`, and neither B nor C has an `INVALID` API claim under v2. This is evidence that Contract Intelligence remains promising, but it is still **P0 calibration evidence**, not an H1 result. Historical P0 status remains `INCONCLUSIVE`; p0-07 still exposes legitimate target-wide uncertainty; and H1 remains blocked by its separate preregistered gates.
