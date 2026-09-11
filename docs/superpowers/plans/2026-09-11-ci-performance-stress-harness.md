# CI Performance & Stress Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dependency-light deterministic performance/stress CI subsystem with structured evidence, plus a separately quota-bounded scheduled live canary.

**Architecture:** Repository tooling under `scripts/perf/` measures deterministic hot paths using Node core timing/resource APIs and emits versioned JSON/JSONL/Markdown receipts. A single performance workflow runs PR smoke plus scheduled/manual benchmark/stress profiles; existing staged evaluation is reused for a weekly 16-call live canary.

**Tech Stack:** Node.js 24.19.0, ES modules, Vitest 4.x, GitHub Actions, existing pnpm 11.7.0 toolchain.

**Spec:** `docs/superpowers/specs/2026-09-11-ci-performance-stress-harness-design.md`

## Global Constraints

- Do not change production `src/` behavior or public protocol contracts to make benchmarking easier.
- Add no runtime or dev dependency for benchmarking.
- Preserve existing required CI, DSH verification semantics, and storage-policy protections.
- Scheduled live evaluation must resolve only to `canary` and retain the existing 16-call hard cap.
- Performance timings on GitHub-hosted runners are observational initially; do not introduce small-percentage latency gates.
- Evidence must not serialize secrets, arbitrary environment variables, user home paths, DSH homes, or package tarballs.

---

### Task 1: Statistics and bounded suite profiles

**Files:**
- Create: `tests/perf/statistics.spec.ts`
- Create: `tests/perf/suites.spec.ts`
- Create: `scripts/perf/statistics.mjs`
- Create: `scripts/perf/suites.mjs`

**Interfaces:**
- Produces: `percentile(values, percentile)`, `summarizeNumbers(values)`, `getPerfProfile(name)`, `listPerfProfiles()`.
- Profiles: `smoke`, `benchmark`, `stress` with explicit warmup/iteration/concurrency/scaling bounds.

- [ ] **Step 1: Write failing statistics tests**

```ts
import { describe, expect, it } from 'vitest'
import { percentile, summarizeNumbers } from '../../scripts/perf/statistics.mjs'

describe('performance statistics', () => {
  it('uses nearest-rank percentiles with sorted-independent input', () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20)
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40)
  })

  it('summarizes a non-empty finite sample', () => {
    expect(summarizeNumbers([1, 2, 3, 4])).toMatchObject({ count: 4, min: 1, max: 4, mean: 2.5, p50: 2, p95: 4, p99: 4 })
  })
})
```

- [ ] **Step 2: Write failing suite-profile tests**

Assert that `smoke < benchmark < stress` for measured iteration count, `smoke` concurrency is bounded to one, all values are positive safe integers where applicable, and unknown profiles throw.

- [ ] **Step 3: Run targeted tests and observe RED**

Run: `pnpm vitest run tests/perf/statistics.spec.ts tests/perf/suites.spec.ts`

Expected: FAIL because `scripts/perf/statistics.mjs` and `scripts/perf/suites.mjs` do not exist.

- [ ] **Step 4: Implement the minimal helpers**

Use a copied/sorted finite-number array, nearest-rank percentile semantics and immutable profile definitions. Do not add dependencies.

- [ ] **Step 5: Run targeted tests and observe GREEN**

Run: `pnpm vitest run tests/perf/statistics.spec.ts tests/perf/suites.spec.ts`

Expected: PASS.

---

### Task 2: One-sample resource measurement primitive

**Files:**
- Create: `tests/perf/measure.spec.ts`
- Create: `scripts/perf/measure.mjs`

**Interfaces:**
- Consumes: Node `performance`, `process.cpuUsage`, `process.resourceUsage`, `process.memoryUsage`.
- Produces: `measureSample({ caseName, phase, iteration, concurrency, operation })` returning a `dsh-perf-sample-v1` record and operation value.

- [ ] **Step 1: Write failing behavior tests**

Verify that a successful async operation yields a positive/non-negative duration, numeric CPU deltas, RSS/heap fields, preserved metadata and `outcome: 'ok'`. Verify a rejected operation rethrows and can be represented by the runner rather than swallowed.

- [ ] **Step 2: Run and observe RED**

Run: `pnpm vitest run tests/perf/measure.spec.ts`

Expected: FAIL because `scripts/perf/measure.mjs` does not exist.

- [ ] **Step 3: Implement minimal measurement**

Take before/after snapshots around `await operation()`. Use `performance.now()` for elapsed milliseconds and delta forms of CPU/resource values. Do not dump process environment.

- [ ] **Step 4: Run and observe GREEN**

Run: `pnpm vitest run tests/perf/measure.spec.ts`

Expected: PASS.

---

### Task 3: Receipt writer and deterministic benchmark cases

**Files:**
- Create: `tests/perf/run.spec.ts`
- Create: `scripts/perf/run.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `getPerfProfile`, `measureSample`, `summarizeNumbers`.
- Produces CLI: `node scripts/perf/run.mjs --profile <smoke|benchmark|stress> --output-dir <path>`.
- Produces files: `environment.json`, `samples.jsonl`, `summary.json`, `summary.md` under the output directory.

- [ ] **Step 1: Write failing CLI/receipt tests**

Use a temporary output directory. Invoke the exported runner with an injected deterministic case registry. Assert schema `dsh-perf-v1`, bounded environment metadata, newline-delimited valid sample JSON, percentile summary, Markdown summary, and absence of arbitrary secret-looking environment values.

- [ ] **Step 2: Run and observe RED**

Run: `pnpm vitest run tests/perf/run.spec.ts`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement minimal runner and first deterministic cases**

Implement a small case registry around repository-owned deterministic work that is already exposed without production changes. Prefer contract-index/search/inspect evaluation seams already used by repository tests/scripts. If importing a production seam would violate architecture, keep the case in repository tooling/evaluation seams instead of changing `src/`.

The default registry must include at least:

- contract index/corpus build or equivalent foundation preparation;
- retrieval/search workload using the repository development corpus;
- compactness/inspect workload using the existing deterministic compaction corpus/measurement seam;
- a synthetic CPU/memory control case so receipt generation itself is always exercised.

- [ ] **Step 4: Add package scripts**

```json
"perf:smoke": "node scripts/perf/run.mjs --profile smoke --output-dir .artifacts/perf",
"perf:benchmark": "node scripts/perf/run.mjs --profile benchmark --output-dir .artifacts/perf",
"perf:stress": "node scripts/perf/run.mjs --profile stress --output-dir .artifacts/perf"
```

- [ ] **Step 5: Run targeted tests and smoke command**

Run:

```bash
pnpm vitest run tests/perf
pnpm perf:smoke
```

Expected: all tests PASS; four evidence files exist and parse.

---

### Task 4: Performance validation workflow and policy tests

**Files:**
- Create: `.github/workflows/performance-validation.yml`
- Create or modify: workflow/policy test under the repository's existing CI-policy test convention.
- Modify only if required: `scripts/check-ci-storage-policy.mjs` without weakening checks for `.github/workflows/ci.yml`.

**Interfaces:**
- PR => `smoke`.
- manual input => `smoke|benchmark|stress`.
- schedule => benchmark/stress jobs selected by explicit event/cron conditions.
- Evidence artifact => `.artifacts/perf/{environment.json,samples.jsonl,summary.json,summary.md}` with 14-day retention.

- [ ] **Step 1: Add failing workflow-policy tests**

Assert Node `24.19.0`, frozen install, no direct `actions/cache`, no model/provider secret, 14-day evidence-only artifact retention, PR smoke, bounded manual modes, and scheduled benchmark/stress selection.

- [ ] **Step 2: Run and observe RED**

Run the narrow policy test/script command used by the repository.

Expected: FAIL because `performance-validation.yml` does not exist.

- [ ] **Step 3: Add workflow**

Use pinned action SHAs consistent with current `ci.yml`. Install once, run the selected `pnpm perf:*` command, append `summary.md` to `$GITHUB_STEP_SUMMARY`, and upload only the four evidence files.

- [ ] **Step 4: Run and observe GREEN**

Run targeted workflow-policy tests and `pnpm check:scripts`.

Expected: PASS.

---

### Task 5: Weekly quota-bounded live canary

**Files:**
- Modify: `.github/workflows/m2-staged-eval.yml`
- Create or modify: staged-eval workflow policy test under the existing test convention.

**Interfaces:**
- Manual dispatch preserves `canary|dev|release|research`.
- Scheduled execution resolves mode to literal `canary` for job naming, concurrency grouping and `pnpm eval:run`.
- Existing `scripts/eval/budget-plan.mjs` remains the call-budget source of truth: scheduled canary = expected/hard-cap 16 calls.

- [ ] **Step 1: Write failing structural tests**

Assert the workflow has exactly the intended weekly schedule, scheduled mode cannot inherit a manual input, and the run command resolves scheduled execution to `canary`.

- [ ] **Step 2: Run and observe RED**

Run the targeted workflow test.

Expected: FAIL because the schedule is absent.

- [ ] **Step 3: Implement scheduled mode resolution**

Add schedule trigger. Set a job-level resolved mode using an expression that maps `schedule` to `canary` and otherwise uses `inputs.mode`. Use the resolved mode consistently. Do not change model/provider identity or budget planner.

- [ ] **Step 4: Run and observe GREEN**

Run targeted staged-eval tests plus existing eval budget tests.

Expected: PASS and budget planner still reports 16/16 calls for canary.

---

### Task 6: Repository verification and CI evidence

**Files:** no new production files.

- [ ] **Step 1: Run repository checks**

Run through branch CI or an equivalent environment:

```bash
pnpm check
pnpm perf:smoke
```

Expected: PASS.

- [ ] **Step 2: Inspect performance receipt**

Confirm schema/version, case list, samples, percentiles, CPU/memory fields, bounded metadata and Markdown summary. Confirm no secret values or arbitrary env dump.

- [ ] **Step 3: Open focused PR**

PR body must describe the three contours, explicitly state that live canary is non-required/quota-bounded, and include exact test/CI evidence.

- [ ] **Step 4: Verify GitHub Actions**

Confirm required repository CI is green and the new performance validation smoke job is green on the PR head. Do not claim benchmark/stress/live-provider runs that were not actually executed.
