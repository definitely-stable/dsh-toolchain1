# One-Dispatch Staged Evaluation Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one bounded command/workflow that selects a disclosed development corpus, executes exactly the authorized B/C calls with a mandatory 16-call canary, stops automatically on unhealthy measurement, and emits one inspectable health/product/cost report.

**Architecture:** Keep the new runner in repository evaluation tooling, outside production `src/**`. Reuse the merged `budget-plan.mjs`, `development-corpus.mjs`, and `health-gate.mjs` as policy sources; isolate provider execution behind an injected executor function so required CI remains deterministic and provider-free. Structured model output is parsed by a closed development-only transport before deterministic Truth/task adjudication. The orchestrator owns call authorization: no caller can skip canary, add arm A/repetitions, or execute remainder after STOP.

**Tech Stack:** Node.js ESM, existing TypeScript checkJs configuration for scripts, Vitest, GitHub Actions, existing M2 exact-target/provider execution helpers.

**Spec:** GitHub issue #151 (`M2: add one-dispatch canary-first staged eval runner`) and `docs/evaluation/m2/staged-evaluation.md`.

## Global Constraints

- H1 is immutable historical `INCONCLUSIVE` evidence and MUST NOT be rerun or written to.
- Development corpus is `DEVELOPMENT_ONLY` and MUST NOT be called a holdout.
- Model modes are `canary|dev|release|research`; deterministic mode performs zero provider calls.
- Model work is B/C only, one repetition by default.
- Canary phase is exactly 16 calls: 8 selected tasks × B/C × one repetition.
- `dev` hard cap is 40 calls; `release` 64; `research` 96.
- A STOP canary authorizes zero remainder calls.
- A PASS canary authorizes only the remainder already implied by the original mode plan.
- Structured-result capability/schema failure is measurement STOP, not permission to fall back to free text.
- Task/API validity remains deterministic against frozen exact-target Truth; no LLM judge.
- Recovered infrastructure retries are cost/reliability evidence; only unrecovered missingness enters the health threshold.
- Required repository CI must not make external model/provider calls.
- No H2 hidden corpus or confirmatory inference in this feature.

---

### Task 1: Closed structured-result transport

**Files:**
- Create: `scripts/eval/structured-result.mjs`
- Test: `tests/evaluation/staged-eval-structured-result.spec.ts`

**Interfaces:**
- Produces: `parseDevelopmentStructuredResult(value)` returning immutable `{ schema, taskId, apiValid, taskSuccess, claims }`.
- Produces: `STRUCTURED_RESULT_SCHEMA = 'dsh-toolchain-staged-eval-result-v1'`.

- [ ] **Step 1: Write failing parser tests**

Cover one valid result plus fail-closed cases for unknown keys, wrong schema, mismatched task id, non-boolean decision fields, malformed claims, and free-text-only provider output.

```ts
expect(parseDevelopmentStructuredResult({
  schema: 'dsh-toolchain-staged-eval-result-v1',
  taskId: 'tool-basic-001',
  apiValid: true,
  taskSuccess: true,
  claims: [{ kind: 'service', name: 'tools' }],
})).toMatchObject({ apiValid: true, taskSuccess: true })

expect(() => parseDevelopmentStructuredResult({ text: 'API_CLAIM ...' })).toThrow()
```

- [ ] **Step 2: Verify RED in CI**

Run: `pnpm vitest run tests/evaluation/staged-eval-structured-result.spec.ts`
Expected: module/function missing.

- [ ] **Step 3: Implement the closed parser**

Use explicit key allowlists; no permissive object spread from provider payloads. Validate strings/booleans/claim objects and freeze returned structures.

- [ ] **Step 4: Verify GREEN and script typecheck**

Run: `pnpm vitest run tests/evaluation/staged-eval-structured-result.spec.ts && pnpm run check:scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(eval): add structured development result transport`

---

### Task 2: Deterministic call schedule and canary partition

**Files:**
- Create: `scripts/eval/staged-schedule.mjs`
- Test: `tests/evaluation/staged-eval-schedule.spec.ts`

**Interfaces:**
- Consumes: `planEvalBudget`, `selectEvaluationTasks`.
- Produces: `buildStagedSchedule({ mode, tasks })` returning immutable `{ plan, selectedTasks, canaryCalls, remainderCalls }`.
- Call tuple: `{ ordinal, taskId, arm: 'B'|'C', repetition: 1 }`.

- [ ] **Step 1: Write failing schedule tests**

Assert:
- canary => 16 canary, 0 remainder;
- dev => 16 canary + 24 remainder = 40 total;
- release => 16 + 48 = 64;
- research => 16 + 80 = 96;
- all tuples are B/C only and repetition 1;
- no duplicate `(taskId,arm,repetition)` tuple;
- call order is deterministic and canary is a prefix of the authorized full schedule.

- [ ] **Step 2: Verify RED**

Run the focused test; expected missing module.

- [ ] **Step 3: Implement schedule construction**

Call `planEvalBudget({mode})`, select exactly `plan.taskCount` tasks, expand task-major B/C tuples, and split at ordinal 16. Reject deterministic mode in this model-runner API rather than silently inventing work.

- [ ] **Step 4: Verify GREEN**

Run focused tests plus existing budget/corpus tests.

- [ ] **Step 5: Commit**

Commit: `feat(eval): build deterministic canary-first schedule`

---

### Task 3: Provider executor boundary and observation normalization

**Files:**
- Create: `scripts/eval/staged-execution.mjs`
- Test: `tests/evaluation/staged-eval-execution.spec.ts`

**Interfaces:**
- Consumes: schedule tuples and `parseDevelopmentStructuredResult`.
- Injected executor: `execute(call) -> Promise<{ transportStatus, structuredContent?, attempts, infrastructureFailures, usage, wallTimeMs, toolUsage }>`.
- Produces: normalized measurement observation compatible with `evaluateMeasurementHealth` plus cost fields.

- [ ] **Step 1: Write failing executor-boundary tests**

Test successful structured output, provider without structured-result support, malformed structured payload, recovered retry, and unrecovered infrastructure failure.

- [ ] **Step 2: Verify RED**

Expected missing implementation.

- [ ] **Step 3: Implement normalization**

Rules:
- parser success => `formatValid:true`, explicit deterministic decisions;
- unsupported/malformed structured transport => `formatValid:false`, `decisionResolved:false` and no prose fallback;
- recovered retry with model outcome => `unrecoveredInfrastructure:false`;
- no model outcome after attempts => `unrecoveredInfrastructure:true`.

- [ ] **Step 4: Verify GREEN**

Run focused tests + health-gate tests.

- [ ] **Step 5: Commit**

Commit: `feat(eval): normalize staged provider observations`

---

### Task 4: Fail-closed canary orchestrator

**Files:**
- Create: `scripts/eval/staged-runner.mjs`
- Test: `tests/evaluation/staged-eval-runner.spec.ts`

**Interfaces:**
- Consumes: `buildStagedSchedule`, execution boundary, `evaluateMeasurementHealth`.
- Produces: `runStagedEvaluation({ mode, tasks, execute })`.
- Returns immutable run record with `measurementStatus: 'STOP'|'PASS'`, phase counts, observations, health, and authorization accounting.

- [ ] **Step 1: Write RED tests for STOP and PASS**

STOP test must prove executor is called exactly 16 times for `dev` when canary health fails and **never** for any remainder tuple.

PASS test must prove executor is called exactly 40 times for `dev`, where calls 17–40 are executed only after health PASS.

Also assert canary mode executes exactly 16 calls total and never has a remainder phase.

- [ ] **Step 2: Verify RED**

Expected missing runner.

- [ ] **Step 3: Implement two-phase orchestration**

Pseudo-flow:

```js
const schedule = buildStagedSchedule({ mode, tasks })
const canary = await executeCalls(schedule.canaryCalls)
const health = evaluateMeasurementHealth({ observations: canary.map(x => x.measurement) })
if (health.status === 'STOP') return stoppedRecord(schedule, canary, health)
const remainder = await executeCalls(schedule.remainderCalls)
return passedRecord(schedule, canary, remainder, health)
```

Do not evaluate a later PASS to override an initial STOP. The initial 16-call health result is the sole continuation authorization.

- [ ] **Step 4: Verify GREEN**

Run focused runner/schedule/execution/health tests.

- [ ] **Step 5: Commit**

Commit: `feat(eval): enforce canary STOP before remainder`

---

### Task 5: Product and cost report

**Files:**
- Create: `scripts/eval/staged-report.mjs`
- Test: `tests/evaluation/staged-eval-report.spec.ts`

**Interfaces:**
- Consumes: staged run record.
- Produces: schema `dsh-toolchain-staged-eval-report-v1` separating `measurement`, `product`, and `cost`.

- [ ] **Step 1: Write report RED tests**

Require:
- measurement section: health status/reasons/metrics;
- product section: B/C success/API-validity counts and paired task deltas only for resolved observations;
- cost section: model calls, attempts, retries, wall time, token totals when supplied, turns and tool usage;
- STOP report remains a valid successful artifact and states that remainder was not authorized/executed.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement pure report projection**

No provider calls or filesystem mutation in report generation.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

Commit: `feat(eval): emit staged health product cost report`

---

### Task 6: One-command operator entrypoint

**Files:**
- Create: `scripts/eval/run-staged.mjs`
- Modify: `package.json`
- Test: `tests/evaluation/staged-eval-command.spec.ts`

**Interfaces:**
- Command: `pnpm eval:run -- --mode <canary|dev|release|research> --manifest <path> --output <path>`.
- No `--chunk-size`, `--arms`, or implicit repetitions option.

- [ ] **Step 1: Write CLI RED tests**

Require only allowed modes; reject chunk-size/arm/repetition overrides; require DEVELOPMENT_ONLY manifest; serialize one report to the requested output path.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement command composition**

The CLI loads corpus, selects tasks from the mode plan, resolves the real executor adapter, calls `runStagedEvaluation`, writes one report, and exits zero for both scientific PASS and scientific STOP when execution itself completed correctly. Infrastructure/configuration failure exits non-zero.

- [ ] **Step 4: Verify GREEN**

Required CI tests inject a fake executor; they never contact a provider.

- [ ] **Step 5: Commit**

Commit: `feat(eval): add one-command staged runner`

---

### Task 7: Real executor adapter without historical H1 run-store writes

**Files:**
- Create: `scripts/eval/m2-development-executor.mjs`
- Test: `tests/evaluation/staged-eval-development-executor.spec.ts`

**Interfaces:**
- Reuse existing exact-target/workspace/tool-runtime primitives from M2 execution code.
- Adapter must not import or write the durable H1 run store.

- [ ] **Step 1: Write architecture/policy tests**

Assert source contains no historical H1 run-store write API/path and that B/C mapping uses the existing exact-target workspace/tool runtime.

- [ ] **Step 2: Add deterministic adapter tests**

Inject the child/process boundary and verify structured-result request configuration, explicit task identity, B/C arm configuration, usage/retry projection, and provider structured-capability failure classification.

- [ ] **Step 3: Implement minimal adapter**

Reuse established child-process/provider configuration instead of duplicating H1 orchestration. The adapter returns executor-boundary data only; it does not make continuation decisions.

- [ ] **Step 4: Verify GREEN**

- [ ] **Step 5: Commit**

Commit: `feat(eval): connect staged runner to development executor`

---

### Task 8: Single workflow_dispatch surface

**Files:**
- Create: `.github/workflows/m2-staged-eval.yml`
- Test: `tests/policy/m2-staged-eval-workflow.spec.ts`

**Interfaces:**
- One workflow input: `mode` choice `canary|dev|release|research`.
- No chunk-size input.
- Artifact contains the single staged report plus minimal execution evidence needed to audit it.

- [ ] **Step 1: Write workflow policy RED tests**

Assert the exact mode choices, absence of chunk-size/repetition/arms inputs, one `eval:run` invocation, artifact upload under an immutable run-specific name, and no historical H1 write/finalization command.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement workflow**

Use the same provider secret/managed gateway conventions already accepted for M2 provider workflows. Required normal CI only parses/tests the workflow; it does not dispatch it.

- [ ] **Step 4: Verify GREEN**

Run policy tests and full repository CI.

- [ ] **Step 5: Commit**

Commit: `ci(eval): add one-dispatch staged evaluation`

---

### Task 9: Operator skill and durable documentation

**Files:**
- Modify: `.agents/skills/dsh-eval/SKILL.md`
- Modify: `docs/evaluation/m2/staged-evaluation.md`
- Modify: `docs/evaluation/m2/status.md`
- Test: `tests/evaluation/staged-eval-policy.spec.ts`

**Interfaces:**
- Agents use the one command/workflow; manual continuation loops stay prohibited.

- [ ] **Step 1: Extend policy tests**

Require one-dispatch wording, 16-call canary, STOP=no remainder, and explicit distinction between development signal and future H2 confirmatory evidence.

- [ ] **Step 2: Update skill/docs**

Document report interpretation and exact continuation authorization semantics.

- [ ] **Step 3: Verify GREEN**

- [ ] **Step 4: Commit**

Commit: `docs(eval): document one-dispatch staged workflow`

---

### Task 10: Real 16-call provider canary and merge gate

**Files:**
- No production-code change unless the real canary exposes a reproduced transport defect.
- If a defect is reproduced, add the smallest failing fixture/test before changing implementation.

**Interfaces:**
- Uses `.github/workflows/m2-staged-eval.yml` with `mode=canary`.

- [ ] **Step 1: Complete full provider-free repository CI**

Node 22/24/26, Windows/macOS and primary artifact chain must be GREEN.

- [ ] **Step 2: Dispatch exactly one real `canary` run**

Expected authorization: 16 model calls, B/C only, one repetition, no remainder by definition.

- [ ] **Step 3: Inspect the uploaded report**

Verify structured transport support, exact call count, health metrics/reasons, retry/cost accounting and absence of H1 run-store mutation.

- [ ] **Step 4: If canary STOPs, preserve STOP as evidence**

Do not manually continue. Fix only reproduced implementation/transport defects with TDD; an honestly unhealthy provider/measurement path is a valid scientific STOP.

- [ ] **Step 5: Final PR review and merge**

Close #151 only after the real 16-call canary artifact is inspected and full CI remains GREEN.
