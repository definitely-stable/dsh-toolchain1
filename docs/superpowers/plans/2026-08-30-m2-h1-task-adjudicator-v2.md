# M2.3 H1 Declarative Task Adjudicator v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. TDD is mandatory.

**Goal:** Freeze a task-neutral declarative H1 task-success adjudicator that consumes evaluator-only rules, generic classified API claims and independent Truth v2 without embedding hidden task ids/prompts or creating a second API oracle.

**Architecture:** Hidden H1 tasks carry a small closed `successRule` vocabulary that never enters model-visible `{id,prompt}` projection. `m2-h1-task-adjudication-v2.ts` validates rules fail-closed, filters only task-relevant API claims, and returns `SUCCESS | FAILURE | UNKNOWN`. API existence validity remains owned by `m2-api-claims-v2`; the task adjudicator only interprets already-classified claims in the context of a rule.

**Tech Stack:** TypeScript 6, Vitest 4, `m2-api-claims-v2`, `m2-api-truth-v2`.

**Spec:** Issue #82; parent #34/#28; H1 readiness v2 from PR #81; M2.3 amendment.

## Global constraints

- Evaluation-only; no production `src/**`, Protocol, retrieval/ranking, provider calls or H1 outcomes.
- No real H1 task ids/prompts/rules are committed in this slice; tests use synthetic rules only.
- No arbitrary expression language, callbacks, eval, functions or executable dataset metadata.
- Rule vocabulary is closed and versioned; unknown keys/kinds fail before model execution.
- API classification stays in `m2-api-claims-v2`; no duplicate truth/scorer.
- Task success is independent from global invalid-API rate: irrelevant invalid claims do not fail a task.
- Task-relevant conflicting claims fail closed to `UNKNOWN` rather than cherry-picking a favorable claim.
- Absence requires explicit proof scope and independent authoritative completeness.

---

### Task 1: RED contract

**Files:**
- Create: `tests/evaluation/m2-h1-task-adjudication-v2.spec.ts`
- Create later: `tests/evaluation/m2-h1-task-adjudication-v2.ts`

- [ ] Define the expected closed rule types through tests.
- [ ] Test strict validation: unknown kind/key, empty/duplicate symbols, malformed package/symbol and bad proof scope are rejected.
- [ ] Test positive SUCCESS/FAILURE/UNKNOWN including wrong-package and task-relevant conflict behavior.
- [ ] Test irrelevant INVALID claims do not alter success.
- [ ] Test package/target negative proof scopes, complete/incomplete truth and target-wide-vs-package-scoped evidence.
- [ ] Run exact CI and confirm clean RED only because the module does not exist.

### Task 2: Rule model and validator

**Produces:**

```ts
export const H1_TASK_ADJUDICATOR_ID = 'dsh-toolchain-m2-h1-task-adjudicator-v2'

export type H1TaskSuccessRuleV2 =
  | {
      readonly kind: 'api-exists-any'
      readonly package: string
      readonly symbols: readonly string[]
    }
  | {
      readonly kind: 'api-absent'
      readonly symbols: readonly string[]
      readonly proofScope:
        | { readonly kind: 'target' }
        | { readonly kind: 'package'; readonly package: string }
    }

export function validateH1TaskSuccessRuleV2(value: unknown): H1TaskSuccessRuleV2
```

- [ ] Use a closed-world object-key validator; do not ignore unknown metadata.
- [ ] Bound accepted symbol alternatives (max 16), require stable dotted identifiers and unique sorted semantic identities.
- [ ] Require an exact package for positive rules; target-wide positive claims never define task success.
- [ ] Require explicit target/package scope for negative rules.

### Task 3: Task-success semantics

**Produces:**

```ts
export type H1TaskSuccessV2 = 'SUCCESS' | 'FAILURE' | 'UNKNOWN'

export function adjudicateH1TaskSuccessV2(
  rule: H1TaskSuccessRuleV2,
  claims: readonly ClassifiedApiClaimV2[],
  truth: ApiTruthUniverseV2,
): H1TaskSuccessV2
```

Positive rules:
- accepted VALID existence in required package -> success candidate;
- accepted symbol claimed in a wrong package -> relevant failure candidate;
- accepted absence/invalid existence -> failure candidate;
- relevant UNKNOWN or simultaneous success+failure candidates -> UNKNOWN;
- no relevant evidence -> UNKNOWN.

Negative rules:
- only claims relevant to the declared proof scope affect task success;
- contradictory existence/absence -> UNKNOWN;
- any relevant explicit existence means FAILURE for an absence task;
- invalid absence means FAILURE;
- authoritative unresolved evidence means UNKNOWN;
- valid absence, or scoped absence independently provable despite a broader target-wide UNKNOWN, means SUCCESS.

### Task 4: Model-outcome convenience wrapper

```ts
export function adjudicateH1ModelOutcomeV2(
  ruleValue: unknown,
  rawAnswer: string,
  truth: ApiTruthUniverseV2,
): {
  readonly parsedApiClaims: readonly ClassifiedApiClaimV2[]
  readonly taskSuccess: H1TaskSuccessV2
}
```

- [ ] Validate rule first.
- [ ] Parse/classify only through generic v2 claim functions.
- [ ] Never inspect task id/prompt.

### Task 5: GREEN and identity freeze

- [ ] Focused tests green.
- [ ] Full `pnpm check` green on Node 22/24/26.
- [ ] Windows/macOS and package/DSH lanes green.
- [ ] Diff audit proves no real H1 task material or production changes.
- [ ] Merge exact head and verify post-merge main CI.
- [ ] In a separate commitment-only change, bind `agent-holdout-h1-v2.commitment.json.measurement.taskAdjudicator.sourceCommit` to the merged adjudicator commit while keeping H1 BLOCKED.
