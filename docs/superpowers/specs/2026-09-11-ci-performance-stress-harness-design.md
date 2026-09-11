# CI Performance & Stress Harness Design

Date: 2026-09-11
Status: approved for implementation

## Problem

The repository has strong correctness CI and staged/H1 model evaluation, but it lacks a dedicated, reproducible performance/stress contour. Existing test output exposes useful timing signals, yet those timings are incidental to Vitest and are not emitted as a stable machine-readable receipt. Real-DSH smoke paths also mix network/package-manager latency with product latency, which makes them unsuitable as direct regression gates.

The new subsystem must answer two different questions without conflating them:

1. Did a deterministic code path become materially slower, more CPU-heavy, or more memory-hungry?
2. Does the product remain stable under repeated/parallel work and repeated worker lifecycle pressure?

Live model/provider evaluation is useful, but quota-bound and non-deterministic. It therefore remains a separate evidence contour and never becomes a required merge gate.

## Goals

- Add dependency-light deterministic performance measurement using Node built-ins.
- Emit durable JSON/JSONL receipts with enough environment identity to compare runs.
- Add bounded stress coverage for repeated work, memory growth, cleanup, and failure stability.
- Keep PR cost small; move expensive repetition to scheduled/manual runs.
- Reuse the existing staged evaluator for a small live-provider canary instead of creating a second evaluator.
- Keep production `src/`, public protocol contracts, DSH target identity, and verification semantics unchanged.

## Non-goals

- No new product/runtime dependency.
- No benchmark vendor/SaaS requirement.
- No H1 redesign.
- No new provider, model, adapter, or orchestration layer.
- No attempt to turn GitHub-hosted runner wall-clock timings into precise laboratory measurements.
- No hard small-percentage latency gate until a run history exists.

## Architecture

### 1. Deterministic benchmark harness

Add `scripts/perf/` as a repository tooling boundary. It uses only Node core APIs:

- `node:perf_hooks` for high-resolution elapsed time and event-loop utilization;
- `process.resourceUsage()` for user/system CPU and maximum RSS;
- `process.memoryUsage()` for RSS/heap snapshots;
- stable, explicit percentile/statistics code owned by the repository.

The harness has a small case API and writes:

- `.artifacts/perf/environment.json` — commit/runtime/OS/CPU/memory/suite identity;
- `.artifacts/perf/samples.jsonl` — one structured record per measured sample;
- `.artifacts/perf/summary.json` — aggregate p50/p95/p99/min/max/mean, CPU, memory and pass/fail facts;
- `.artifacts/perf/summary.md` — compact human summary suitable for `$GITHUB_STEP_SUMMARY`.

The result format is versioned (`dsh-perf-v1`). Each sample carries case name, phase, iteration, concurrency, elapsed milliseconds, CPU deltas, RSS/heap observations, ELU where available, and outcome. The harness never records secrets or arbitrary environment variables.

### 2. Case families

The first implementation focuses on paths that are deterministic and already central to current product quality:

- contract corpus/index construction;
- cold/warm contract retrieval/search workloads;
- contract inspect/compaction transformation;
- plugin/check-like repository fixtures that do not require paid model calls;
- bounded synthetic scaling for the contract corpus;
- worker/process lifecycle microbenchmarks where the repository already exposes an executable seam.

A case may be omitted from the first cut when its current seam would require changing production architecture just to benchmark it. The harness must not distort product design.

### 3. Stress mode

Stress uses the same case registry and receipt format with a different execution profile. It increases iteration count/concurrency and records:

- success/error counts;
- p50/p95/p99 latency;
- throughput;
- start/end/peak RSS and heap;
- CPU usage;
- cleanup/finalization errors;
- deterministic output fingerprint where meaningful.

Stress is not a fuzzing system. It is bounded load/repetition intended to expose leaks, unbounded growth, lifecycle failures, and catastrophic throughput regressions.

### 4. CI topology

Add one workflow, `.github/workflows/performance-validation.yml`, to avoid unnecessary workflow sprawl.

Triggers:

- `pull_request`: run `smoke` only;
- `workflow_dispatch`: selectable `smoke`, `benchmark`, or `stress`;
- `schedule`: run full deterministic `benchmark` nightly and `stress` on the designated weekly schedule through event-sensitive job conditions.

Runner policy:

- primary measurement runner: `ubuntu-24.04`, Node `24.19.0` to match the current primary CI baseline;
- no cross-OS performance comparison in the first cut because GitHub-hosted runner variance would make those numbers misleading;
- existing CI retains Windows/macOS correctness coverage.

The workflow writes the Markdown summary to `$GITHUB_STEP_SUMMARY` and uploads only measurement evidence, with 14-day retention. It must not upload `node_modules`, DSH homes, package tarballs, or other repository-truth artifacts prohibited by storage policy.

### 5. Gating policy

Initial PR behavior is conservative:

Hard failures from day one:

- benchmark command crashes/times out;
- measured case returns an incorrect/error outcome;
- output receipt is malformed;
- deterministic result fingerprint drifts inside the same run when it must remain stable;
- stress run violates an explicit bounded-safety invariant implemented by the case itself.

Not a hard PR failure initially:

- a 5–20% wall-clock change on GitHub-hosted runners;
- network/package install timing;
- live model latency.

The first run history is observational. A future change may add paired base/head regression thresholds after enough measurements exist to select defensible tolerances.

### 6. Live provider contour

Reuse `.github/workflows/m2-staged-eval.yml` and the existing evaluation budget planner. Add one low-frequency schedule that always resolves to `canary` mode for scheduled runs.

Current `canary` is already bounded to:

- 8 tasks;
- B/C arms;
- one repetition;
- expected 16 model calls;
- hard cap 16 model calls.

Manual dispatch continues to allow the existing higher modes. Scheduled execution is never allowed to select `dev`, `release`, or `research`. The live contour remains non-required and separate from performance validation.

### 7. Logging and privacy

Evidence contains only technical measurement metadata required for reproducibility: suite/schema version, git SHA/ref, Node version, platform/arch, runner identity when available, CPU model/count, total memory, seed/profile, case/sample counts and metrics.

Do not serialize secrets, provider tokens, arbitrary environment dumps, user home paths, or temporary DSH contents. Error text stored in measurement receipts must be bounded and sanitized consistently with repository diagnostic practices.

## Implementation boundaries

Expected new files:

- `scripts/perf/statistics.mjs` — deterministic percentile/aggregate helpers.
- `scripts/perf/measure.mjs` — one-sample resource measurement primitive.
- `scripts/perf/suites.mjs` — bounded suite profiles and case registry.
- `scripts/perf/run.mjs` — CLI orchestration and receipt writing.
- `tests/perf/*.spec.ts` — test-first coverage for statistics, schemas/profiles, output safety and CLI behavior.
- `.github/workflows/performance-validation.yml` — smoke/full/stress CI contour.

Expected modified files:

- `package.json` — add `perf:smoke`, `perf:benchmark`, `perf:stress` scripts.
- `.github/workflows/m2-staged-eval.yml` — weekly scheduled canary with explicit scheduled-mode resolution.
- relevant CI policy tests/scripts only where required to validate the new workflow without weakening existing required-CI policy.

## Verification

Local/logical verification:

- targeted Vitest tests for the harness;
- `pnpm check:scripts`/workflow policy tests as applicable;
- `pnpm typecheck` and full `pnpm test` through CI;
- smoke harness must produce valid v1 JSON/JSONL/Markdown artifacts.

Repository verification:

- feature branch CI must pass;
- performance workflow must successfully execute at least `smoke` on the branch/PR;
- live staged evaluator changes must be verified structurally without spending model quota merely to validate YAML; the first scheduled/manual canary remains bounded by the existing 16-call hard cap.

## References

- Node.js Performance Measurement APIs: https://nodejs.org/api/perf_hooks.html
- Node.js `process.resourceUsage()` / memory APIs: https://nodejs.org/api/process.html
- GitHub Actions workflow syntax (`workflow_dispatch`, `schedule`): https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
