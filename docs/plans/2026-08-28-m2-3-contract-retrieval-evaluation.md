# M2.3 Contract Intelligence Retrieval Evaluation — Implementation Plan

> **For agentic workers:** execute this plan task-by-task with TDD. Every behavioral evaluator change starts with an observed RED. Do not change production retrieval/ranking in this PR to make the benchmark pass.

**Goal:** freeze and measure the existing M2 `contract.search -> contract.inspect` retrieval loop against real DSH development tasks, then define a reproducible A/B/C agent experiment that decides whether M2 is useful enough to close.

**Architecture:** M2.3 is evaluation-only. Production `searchContractIndex()` remains the only scorer. Frozen rc.2-realistic Contract Index data, task corpus, validators, metric arithmetic and tests live under `tests/evaluation/`; durable methodology/results live under `docs/evaluation/`. CI performs deterministic retrieval evaluation with no network or model calls. Agent usefulness is recorded separately through a versioned A/B/C result schema.

**Tech stack:** TypeScript 6, Vitest 4, existing `src/model/contract.ts`, JSON Schema + AJV for the recorded experiment format, existing Node 22.19+/pnpm 11.7 CI.

**Spec:** Issue #34, parent Issue #28, `docs/roadmap.md`, `docs/architecture.md`, ADR-0008, upstream published DSH `0.1.1-rc.2` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

## Global constraints

- Base is M2.2 squash merge `d3162bd72bcd84ec8c422108be1e7c529a1a59f6`.
- Evaluation baseline is published `@deepseek-ai/dsh@0.1.1-rc.2`, not mutable upstream `master` and not unpublished source version `0.1.2-alpha.1`.
- First frozen corpus contains at least 30 tasks.
- Corpus includes exact-symbol, package/API, natural-language mechanism, indirect/ambiguous, and no-result/obsolete-API categories.
- The frozen index must mirror Toolchain normalization: M2.1 declaration names are facts on `package:<name>` contracts; do not invent `type:*` contracts. M2.2-only examples may use real normalized `service:host:*`, `event:host:*`, and `tool:host:*` shapes.
- Package summaries must mirror production (`Installed package <name>@<version>`). Do not add documentation prose to package summaries because production M2.1 does not.
- `searchContractIndex()` is imported from `src/model/contract.ts` and is the only ranking implementation used by evaluation.
- No embeddings, semantic reranker, LLM judge, external model/network call, persistent search index, or benchmark-specific production branch in this slice.
- Do not edit corpus expectations after observing metrics merely to improve the score. Corrections require provenance/error justification in the PR history.
- If measured retrieval is weak, freeze/report the weakness and create a separate improvement Issue; do not change production ranking in this PR.
- Parent #28 stays open until a controlled recorded A/B/C experiment demonstrates materially fewer invalid API guesses for Toolchain context.

## File map

- Create `tests/evaluation/m2-retrieval-metrics.ts` — evaluation-only types, validation and metric arithmetic. It consumes ranked contract IDs; it does not score contracts.
- Create `tests/evaluation/m2-retrieval-metrics.spec.ts` — arithmetic and fail-closed validation tests.
- Create `tests/evaluation/m2-retrieval-index.ts` — frozen rc.2-realistic `Evidence[]` / `ContractDefinition[]` and deterministic `createContractIndex()` builder.
- Create `tests/evaluation/m2-retrieval-corpus.ts` — frozen >=30 task definitions with provenance.
- Create `tests/evaluation/m2-retrieval.spec.ts` — calls production `searchContractIndex()` over the frozen corpus and asserts determinism/invariants while printing the observed baseline.
- Create `docs/evaluation/m2-contract-retrieval.md` — corpus methodology, provenance, exact measured metrics and honest PASS/NEEDS-IMPROVEMENT interpretation.
- Create `docs/evaluation/m2-agent-comparison-v1.schema.json` — versioned durable A/B/C experiment record schema.
- Create `tests/evaluation/m2-agent-comparison-schema.spec.ts` — AJV validation tests for valid/invalid experiment records.
- Create `docs/evaluation/m2-agent-comparison.md` — controlled experiment procedure; no fabricated result.
- Modify `docs/roadmap.md` only after deterministic measurements are known, and only to reflect M2.3 status rather than declaring M2 complete without an A/B/C result.

---

### Task 1: Freeze evaluator semantics with RED metric tests

**Files:**
- Create: `tests/evaluation/m2-retrieval-metrics.ts`
- Create: `tests/evaluation/m2-retrieval-metrics.spec.ts`

**Interfaces:**

```ts
export type M2RetrievalCategory =
  | 'exact-symbol'
  | 'package-api'
  | 'natural-language'
  | 'indirect'
  | 'ambiguous'
  | 'no-result'

export interface M2RetrievalTask {
  readonly id: string
  readonly category: M2RetrievalCategory
  readonly query: string
  readonly expectedContractIds: readonly string[]
  readonly forbiddenContractIds?: readonly string[]
  readonly expectNoResult?: boolean
  readonly provenance: string
}

export interface M2RankedTaskResult {
  readonly task: M2RetrievalTask
  readonly rankedContractIds: readonly string[]
}

export interface M2RetrievalMetrics {
  readonly taskCount: number
  readonly answerableTaskCount: number
  readonly noResultTaskCount: number
  readonly recallAt1: number
  readonly recallAt3: number
  readonly recallAt5: number
  readonly meanReciprocalRank: number
  readonly noResultCorrectness: number
  readonly wrongContractRate: number
  readonly byCategory: Readonly<Record<M2RetrievalCategory, M2CategoryMetrics>>
}

export function validateM2RetrievalCorpus(
  tasks: readonly M2RetrievalTask[],
  knownContractIds: ReadonlySet<string>,
): void

export function calculateM2RetrievalMetrics(
  results: readonly M2RankedTaskResult[],
): M2RetrievalMetrics
```

Metric definitions are frozen here:
- `Recall@k`: macro fraction of answerable tasks whose top-k intersects `expectedContractIds`; multiple expected ids mean acceptable alternatives, not all-required dependencies.
- `MRR`: macro mean of `1/rank` for the first acceptable expected contract, `0` when absent.
- `noResultCorrectness`: fraction of `expectNoResult` tasks whose ranked result is empty; if there are no no-result tasks, validation fails rather than producing a misleading denominator.
- `wrongContractRate`: among tasks declaring `forbiddenContractIds`, fraction whose top-5 contains at least one forbidden id; if no tasks declare forbidden ids, validation fails.
- per-category metrics use the same hit/MRR semantics plus category task count; no category listed in the union may be absent from the frozen corpus.

- [ ] **Step 1.1 — Write arithmetic RED tests.**

Test a hand-authored set where expected values are calculable without production search:

```ts
expect(metrics.recallAt1).toBeCloseTo(1 / 3)
expect(metrics.recallAt3).toBeCloseTo(2 / 3)
expect(metrics.recallAt5).toBeCloseTo(1)
expect(metrics.meanReciprocalRank).toBeCloseTo((1 + 1 / 2 + 1 / 5) / 3)
```

Also prove no-result correctness and forbidden top-5 accounting.

- [ ] **Step 1.2 — Write validation RED tests.**

Reject duplicate task ids, duplicate expected/forbidden ids, empty/whitespace query, missing expected contract, overlap between expected and forbidden, `expectNoResult` with expected ids, answerable task with zero expected ids, missing category coverage, zero no-result tasks, and zero forbidden-bearing tasks.

- [ ] **Step 1.3 — Push RED only.**

Expected CI behavior: all pre-existing tests pass; only the new evaluator tests fail because the metric module does not exist/implement the contract.

- [ ] **Step 1.4 — Implement minimal pure evaluator.**

No imports from acquisition, DSH integration, CLI or MCP. The helper consumes ranked ids and computes arithmetic only.

- [ ] **Step 1.5 — Verify focused GREEN and full `pnpm check`.**

- [ ] **Step 1.6 — Commit evaluator semantics.**

Suggested commit: `test(m2.3): define frozen retrieval metrics`.

---

### Task 2: Build one rc.2-realistic frozen Contract Index fixture

**Files:**
- Create: `tests/evaluation/m2-retrieval-index.ts`
- Test: `tests/evaluation/m2-retrieval.spec.ts`

**Interfaces:**

```ts
export const M2_RETRIEVAL_TARGET = Object.freeze({
  dshVersion: '0.1.1-rc.2',
  upstreamCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
})

export async function createFrozenM2RetrievalIndex(): Promise<ContractIndex>
```

The fixture models actual normalized output, not source DTOs. Initial package contracts should include real rc.2 package identities such as:
- `package:@deepseek-ai/dsh-tools` with exports including `ToolDefinition`, `ToolExecution`, `ToolExecutionInput`, `PreToolDecision`, tool schema helpers and relevant registry/runtime public types;
- `package:@deepseek-ai/dsh-agent` with its actual public Agent/registry/event-facing exports;
- `package:@deepseek-ai/dsh-session` with session/event/store public exports;
- additional rc.2 packages required by the corpus (approval/system-prompt/scope/subagent/compaction/etc.) only after their package identity/export provenance is checked against rc.2.

Optional live-shaped contracts may be included only where their M2.2 normalized shape is real and stable, e.g. `event:host:tools/change` or representative Agent-visible Tool contracts. Do not invent service/event/tool names to make queries easy.

Every package contract must match production M2.1 shape:

```ts
{
  id: `package:${packageName}`,
  kind: 'package',
  name: packageName,
  qualifiedName: `package:${packageName}`,
  availability: 'unknown',
  summary: `Installed package ${packageName}@0.1.1-rc.2`,
  facts: [
    { key: 'version', value: '0.1.1-rc.2', ... },
    { key: 'declaration-entry', value: '<real entry>', ... },
    { key: 'declaration-export', value: '<real public export>', ... },
  ],
}
```

- [ ] **Step 2.1 — Add RED structural tests for the fixture.**

Assert the frozen index has only unique ids, package summaries use the production form, all evidence refs resolve, target version/provenance is pinned, and no `type:*` contract is invented.

- [ ] **Step 2.2 — Populate verified rc.2 facts.**

Use only public package manifests/declarations/docs at the pinned upstream commit. Record the source path in evidence `source`/test comments; do not import upstream source at runtime.

- [ ] **Step 2.3 — Prove order invariance.**

Create an equivalent index with reversed evidence/contracts/facts input where meaningful and assert `createContractIndex()` yields the same fingerprint.

- [ ] **Step 2.4 — Full check and commit.**

Suggested commit: `test(m2.3): freeze rc2 contract index fixture`.

---

### Task 3: Freeze >=30 real developer-intent tasks before reading their scores

**Files:**
- Create: `tests/evaluation/m2-retrieval-corpus.ts`
- Modify: `tests/evaluation/m2-retrieval.spec.ts`

**Corpus composition:** first accepted corpus must contain at least:
- 5 `exact-symbol` tasks;
- 5 `package-api` tasks;
- 8 `natural-language` tasks;
- 4 `indirect` tasks;
- 3 `ambiguous` tasks;
- 5 `no-result` / obsolete-invalid tasks.

This is a minimum mix, not a target score. Queries should be derived from real rc.2 developer jobs documented in the upstream extension cookbook and package docs, for example registering a tool, intercepting pre-execute, wrapping dispatch for timeout/metrics, observing final results, reacting to tool registry changes, listening to session events, feeding an Agent, approval, restrictions/guards, compaction and subagent mechanisms.

Examples of task shape (expected IDs must be verified before commit):

```ts
{
  id: 'tool-definition-export',
  category: 'exact-symbol',
  query: 'ToolDefinition',
  expectedContractIds: ['package:@deepseek-ai/dsh-tools'],
  provenance: 'deepseek-harness@b150a551 packages/core/tools/src/index.ts',
}
```

```ts
{
  id: 'tool-timeout-wrapper-natural',
  category: 'natural-language',
  query: 'wrap tool execution timeout metrics',
  expectedContractIds: ['package:@deepseek-ai/dsh-tools'],
  provenance: 'deepseek-harness@b150a551 docs/cookbook/extension-cookbook.md',
}
```

Natural-language failures are allowed and expected to be informative because production package summaries do not contain cookbook prose.

- [ ] **Step 3.1 — Commit corpus and provenance before observing metrics.**

This is the anti-overfitting checkpoint. Do not execute the full corpus benchmark until this commit exists.

- [ ] **Step 3.2 — Run the benchmark unchanged.**

For every task call:

```ts
const selection = searchContractIndex(index, task.query, undefined, 5)
```

Store only returned IDs in the evaluator. The benchmark must not call a second scorer.

- [ ] **Step 3.3 — Assert determinism, not a desired score.**

Tests assert metric bounds `[0,1]`, corpus validation, stable results under equivalent index order, and stable repeated execution. Do **not** add `expect(recallAt5).toBeGreaterThan(...)` until the baseline is observed and an exit threshold is justified separately.

- [ ] **Step 3.4 — Capture exact observed baseline in the test output/PR evidence.**

If natural-language retrieval is weak, preserve it. If an expectation is factually wrong, correct it only with pinned upstream provenance and document the correction.

- [ ] **Step 3.5 — Commit observed baseline plumbing.**

Suggested commit: `test(m2.3): freeze real DSH retrieval corpus`.

---

### Task 4: Produce durable deterministic evaluation report

**Files:**
- Create: `docs/evaluation/m2-contract-retrieval.md`
- Modify: `tests/evaluation/m2-retrieval.spec.ts` only if a small exported formatter is needed; do not hard-code a passing threshold into production search.

- [ ] **Step 4.1 — Record identity and methodology.**

Document Toolchain commit, upstream rc.2 commit, frozen index/corpus version, task category counts, metric definitions and the fact that `searchContractIndex()` is production code.

- [ ] **Step 4.2 — Record exact measured metrics.**

Include Recall@1/@3/@5, MRR, no-result correctness, wrong-contract rate and per-category results. Include the most important failure classes with task IDs, not cherry-picked anecdotes.

- [ ] **Step 4.3 — Classify deterministic outcome honestly.**

Use:
- `DETERMINISTIC-RETRIEVAL-ADEQUATE` only if exact/package/API retrieval is strong enough for progressive use and no-result/wrong-contract behavior is acceptable;
- `NEEDS-RETRIEVAL-IMPROVEMENT` if the frozen tasks expose material retrieval gaps.

This classification **does not close M2**; agent A/B/C evidence is still required.

- [ ] **Step 4.4 — If improvement is needed, create a separate Issue before changing ranking.**

The issue must reference the frozen task IDs/metrics. M2.3 benchmark PR remains an evaluation change.

- [ ] **Step 4.5 — Commit report.**

Suggested commit: `docs(m2.3): record frozen retrieval baseline`.

---

### Task 5: Version the controlled A/B/C agent experiment

**Files:**
- Create: `docs/evaluation/m2-agent-comparison-v1.schema.json`
- Create: `tests/evaluation/m2-agent-comparison-schema.spec.ts`
- Create: `docs/evaluation/m2-agent-comparison.md`

**Record schema required fields:**

```text
schema = dsh-toolchain-m2-agent-comparison-v1
corpusVersion
indexFingerprint
targetFingerprint
upstreamDshVersion
upstreamCommit
promptVersion
model.provider
model.name
model.version
runStartedAt
conditions.A / B / C
  taskResults[]
    taskId
    answerArtifact
    parsedApiGuesses[]
    invalidApiGuesses[]
    success = pass | fail | indeterminate
summary
  taskCount
  invalidGuessCount
  invalidGuessRate
  passCount
```

Condition definitions are frozen:
- A: task + normal model instructions, no DSH contract/docs context;
- B: task + one fixed static rc.2 documentation context pack, identical across tasks except the task itself;
- C: task + only progressive Toolchain `contract.search -> contract.inspect` context selected under a fixed tool-use procedure.

- [ ] **Step 5.1 — RED schema tests.**

AJV accepts one complete minimal v1 record and rejects missing model version, corpus/index/target identity, condition, task id, raw artifact reference, invalid-guess list, or summary counts.

- [ ] **Step 5.2 — Add schema and GREEN.**

Schema uses `additionalProperties: false` at semantic record objects so experiment fields cannot silently drift.

- [ ] **Step 5.3 — Document execution protocol.**

Freeze prompt version, task order randomization rule, temperature/sampling settings where provider supports them, context budgets, answer capture, API-guess parsing rules, and success classification. One operator must not manually repair C answers after seeing expected contracts.

- [ ] **Step 5.4 — Explicitly state that no result is recorded yet unless a genuinely controlled run is performed.**

Do not create an invented A/B/C JSON just to satisfy the schema.

- [ ] **Step 5.5 — Commit experiment protocol.**

Suggested commit: `docs(m2.3): version agent comparison protocol`.

---

### Task 6: Governance, corrective review and slice completion

**Files:**
- Modify: `docs/roadmap.md`
- Update GitHub Issue #34 and PR metadata; parent #28 only if exit evidence actually qualifies.

- [ ] **Step 6.1 — Run full CI on exact HEAD.**

Required lanes remain Node 22.19 / 24.19 / 26, Windows 2025, macOS 15, exact pack/install and primary real DSH smoke. M2.3 must not add network/model work to CI.

- [ ] **Step 6.2 — Corrective review the exact HEAD.**

Review especially:
- corpus leakage/overfitting;
- invented contract identities;
- duplicate scoring logic;
- denominator mistakes in metrics;
- categories that make exact-name tasks dominate the aggregate;
- no-result tasks that are actually supported APIs;
- schema fields that permit anecdotal/unversioned A/B/C claims.

Any behavioral correction receives its own RED before GREEN.

- [ ] **Step 6.3 — Update roadmap status precisely.**

If deterministic infra/report is merged but controlled A/B/C has not run, state that M2.3 evaluation infrastructure is complete while parent M2 exit remains blocked on the controlled comparison. Do not write `M2 DONE`.

- [ ] **Step 6.4 — Merge the evaluation PR only on exact-head GREEN.**

Close #34 only if its acceptance criteria are actually complete. If the PR intentionally delivers deterministic benchmark/protocol but the A/B/C run remains outstanding, keep #34 open or split the remaining controlled-run obligation into a specifically linked issue before closure.

- [ ] **Step 6.5 — Parent #28 exit decision.**

Close #28 only when a valid recorded A/B/C run shows a material reduction in invalid API guesses for C versus the chosen baseline and deterministic retrieval evidence is acceptable. Otherwise keep #28 open and link the measured retrieval-improvement work.

## Plan self-review

- Spec coverage: deterministic retrieval metrics, real rc.2 corpus, no-result/wrong-contract behavior, per-category visibility, production scorer reuse, durable report, controlled A/B/C schema/procedure and parent-M2 exit rule are all assigned to explicit tasks.
- Boundary check: all new evaluation logic lives under `tests/` or `docs/`; no runtime-neutral kernel or production integration dependency is added.
- Anti-overfitting check: corpus is committed before first full metric run and ranking changes are forbidden in the evaluation PR.
- Identity check: package exports remain facts on `package:*`; live `service/event/tool` contracts are used only when matching actual M2.2 normalized shapes.
- CI cost check: no model/network job or artifact/cache expansion is required; existing ordinary test lanes execute the deterministic benchmark.