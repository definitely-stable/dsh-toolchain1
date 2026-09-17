# CI Performance & Stress Harness — Implementation Reconciliation

Date: 2026-09-12
Status: implemented on PR #209; evidence-bound reconciliation of the approved design and implementation plan

## Purpose

The approved design and implementation plan remain the historical decision record. During implementation, TDD, CI evidence, and PR review refined several details that materially affect how the performance evidence must be interpreted. This document records the final implemented contract without rewriting those earlier records after the fact.

## Final execution model

The permanent harness remains dependency-light and uses Node core APIs only. Default benchmark/stress concurrency is real CPU concurrency implemented through a bounded `node:worker_threads` pool. The pool size is the maximum concurrency of the selected profile, capped by the harness to a safe integer range, and one logical operation is dispatched to one worker task. Injected unit-test case registries remain in-process so tests can provide deterministic synthetic operations without needing a serializable worker protocol.

Profiles are fixed as follows:

| Profile | Scale | Warmups | Measured iterations | Concurrency |
| --- | ---: | ---: | ---: | --- |
| `smoke` | 1 | 1 | 3 | `[1]` |
| `benchmark` | 2 | 2 | 10 | `[1, 4]` |
| `stress` | 4 | 2 | 20 | `[1, 4, 8]` |

The base synthetic Contract Search corpus contains 184 contracts, so stress workers exercise a 736-contract corpus.

## Final default case registry

The default registry contains six deterministic cases:

1. `contract-index-build` — builds the production derived Contract Search index from the synthetic contract index.
2. `contract-search-strict` — exercises queries that are fail-closed verified to use the production strict lane.
3. `contract-search-intent-cold` — exercises intent-lane queries without a supplied derived index, so the production cold path must materialize its reusable derived state.
4. `contract-search-intent-warm` — exercises the same intent-lane queries with a prebuilt derived index and verifies exact selection parity with a deterministic warm reference.
5. `contract-inspect-serialize` — performs production inspect selection plus compact model-response serialization over deterministic contract ids.
6. `sha256-control` — provides a stable CPU/control workload using Node crypto.

Strict and intent measurements are deliberately separated. Intent queries contain one deterministic unmatched token so strict all-token matching cannot accidentally satisfy them. Before any measured default suite starts, `explainContractSearch` is used to prove that every strict query reports lane `strict` and every intent query reports lane `intent`; a mismatch fails closed instead of silently benchmarking the wrong path.

## Evidence contract

The harness emits the versioned `dsh-perf-v1` evidence set:

- `environment.json` — bounded runtime, runner, platform, CPU, memory, git and profile identity;
- `samples.jsonl` — one structured record per measured sample;
- `summary.json` — aggregate machine-readable evidence;
- `summary.md` — a compact human summary used by GitHub Actions.

Summaries are keyed by both case and concurrency level. Latency distributions from concurrency 1, 4, and 8 are never mixed into one percentile set, and throughput is computed for the matching concurrency group.

`process.resourceUsage().maxRSS` is a process-lifetime high-water mark and is therefore reported only once at `summary.runMemory.peakMaxRssKiB`. It is not attributed to individual cases. Per-case/concurrency memory evidence is based on instantaneous process snapshots and contains first, last and peak RSS plus signed RSS delta, together with first, last and peak main-thread V8 heap usage plus signed heap delta. Negative deltas are valid and may reflect reclamation between samples.

Under worker-thread concurrency, process RSS covers the whole Node process including worker isolates, while `heapUsed` observed by the coordinator represents its own isolate rather than a sum of every worker heap. RSS is therefore the primary whole-process soak signal; heap deltas are diagnostic coordinator evidence, not a claim about aggregate worker heaps.

Every deterministic case/concurrency pair has an in-run output fingerprint gate. Error records are bounded and sanitized, and partial evidence is persisted before the runner rethrows a case/fingerprint failure. Arbitrary environment variables, provider tokens, home paths and temporary DSH contents are not serialized.

## CI topology

The permanent `.github/workflows/performance-validation.yml` has exactly one measurement job and preserves the low-cost PR path:

- pull request: `smoke` only;
- manual dispatch: selectable `smoke`, `benchmark`, or `stress`;
- scheduled benchmark: `23 2 * * 1-6`;
- scheduled stress: `41 3 * * 0`;
- runner: `ubuntu-24.04`, Node `24.19.0`;
- evidence retention: 7 days, matching the repository-level maximum observed during implementation.

No small-percentage wall-clock regression gate is introduced. Hosted-runner timings remain observational until enough history exists for a defensible paired/base-head policy.

## Live-provider contour

`.github/workflows/m2-staged-eval.yml` remains a separate, non-required contour. Its weekly schedule resolves scheduled execution only to `canary`; manual execution still exposes the existing higher modes.

The existing canary evaluation budget remains 8 tasks × B/C × one repetition = 16 expected evaluation model calls, with the existing hard cap of 16 evaluation calls. The provider health/probe step is separate and may consume additional provider calls, so 16 must not be presented as a hard total for the whole workflow.

No paid/live model run was spent merely to validate this PR; the scheduled-mode and budget behavior is verified structurally in repository tests.

## PR review remediations

Three review findings changed the implementation contract:

1. The initial `Promise.all` form did not provide real overlap for synchronous CPU-bound default cases. Default benchmark/stress execution now uses bounded `worker_threads` isolation.
2. Initial aggregate summaries mixed concurrency levels. Summaries and Markdown rows are now emitted per `(case, concurrency)`.
3. Initial per-case use of process-wide `maxRSS` was invalid. Lifetime max RSS is now run-scoped, while case rows use instantaneous RSS snapshots and growth deltas.

Regression tests cover worker-pool parallel execution, per-concurrency summaries, run-scoped max RSS and case-level memory growth fields.

## Full merge-ref validation evidence

Because the available connector does not expose GitHub `workflow_dispatch`, a temporary PR-only workflow was added solely to execute both expensive profiles against the PR merge ref and then removed from the final tree.

Validation run: GitHub Actions `34706881410`.

Validated feature commit: `c247e93d4ee9d5c836737c28e44e4a4a17611f0a`.

Validated merge ref: `47211eabd98da84d4d99c4d0314af4716e4bf0ff`, created by GitHub as the merge of that feature commit into `main@fb524baaa908e05d1b2acebc6a43ddbae1e3b6fe`.

Results:

- `benchmark`: SUCCESS, 120 measured samples, zero error samples across every case/concurrency row;
- `stress`: SUCCESS, 360 measured samples, zero error samples across every case/concurrency row;
- temporary validation workflow removed afterwards by commit `99204102f0f3a097e9a38f90da262fc44b40e76d`.

### Benchmark observations

| Case | c | p50 ms | p95 ms | ops/s | RSS delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| contract-index-build | 1 | 6.084 | 11.392 | 143.25 | 6.88 |
| contract-index-build | 4 | 12.565 | 22.528 | 277.74 | 7.85 |
| contract-search-strict | 1 | 7.170 | 10.537 | 132.60 | -0.16 |
| contract-search-strict | 4 | 12.612 | 16.577 | 299.44 | 13.63 |
| contract-search-intent-cold | 1 | 40.151 | 72.616 | 22.21 | 55.12 |
| contract-search-intent-cold | 4 | 79.469 | 95.563 | 48.96 | 148.02 |
| contract-search-intent-warm | 1 | 20.710 | 21.487 | 48.09 | 0.00 |
| contract-search-intent-warm | 4 | 36.275 | 37.903 | 109.80 | 0.00 |
| contract-inspect-serialize | 1 | 0.185 | 0.222 | 5165.86 | 0.00 |
| contract-inspect-serialize | 4 | 0.437 | 0.763 | 8078.95 | 0.75 |
| sha256-control | 1 | 0.091 | 0.094 | 10960.26 | 0.00 |
| sha256-control | 4 | 0.150 | 0.634 | 19670.94 | 0.25 |

Process lifetime maximum RSS for this benchmark run was about 484 MiB.

### Stress observations

| Case | c | p50 ms | p95 ms | ops/s | RSS delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| contract-index-build | 1 | 13.621 | 20.096 | 67.58 | 34.72 |
| contract-index-build | 4 | 42.661 | 53.392 | 92.30 | 296.73 |
| contract-index-build | 8 | 68.944 | 88.876 | 111.39 | 304.94 |
| contract-search-strict | 1 | 19.993 | 20.335 | 49.49 | 0.40 |
| contract-search-strict | 4 | 32.792 | 48.979 | 110.16 | -0.20 |
| contract-search-strict | 8 | 64.904 | 69.497 | 120.80 | -0.47 |
| contract-search-intent-cold | 1 | 109.875 | 118.433 | 8.95 | -0.48 |
| contract-search-intent-cold | 4 | 216.966 | 230.145 | 18.25 | 3.36 |
| contract-search-intent-cold | 8 | 421.380 | 452.310 | 18.83 | 224.09 |
| contract-search-intent-warm | 1 | 59.552 | 59.841 | 16.79 | 0.00 |
| contract-search-intent-warm | 4 | 101.722 | 103.011 | 39.19 | 0.00 |
| contract-search-intent-warm | 8 | 213.934 | 221.251 | 37.27 | 0.00 |
| contract-inspect-serialize | 1 | 0.429 | 0.595 | 2191.44 | 0.13 |
| contract-inspect-serialize | 4 | 0.863 | 1.292 | 4204.28 | 0.50 |
| contract-inspect-serialize | 8 | 1.499 | 2.844 | 4589.69 | 2.63 |
| sha256-control | 1 | 0.220 | 0.233 | 4495.39 | 0.00 |
| sha256-control | 4 | 0.421 | 0.447 | 10363.49 | 0.00 |
| sha256-control | 8 | 0.656 | 0.688 | 12044.55 | 0.13 |

Process lifetime maximum RSS for the stress run was about 1.36 GiB. The run remained successful; this number is evidence for optimization, not a failure threshold.

## Optimization signal and follow-up boundary

The evidence shows that the existing reusable derived Contract Search index is valuable: warm intent search is materially faster than cold intent search. At higher concurrency, however, intent ranking becomes CPU-bound. In stress, cold throughput changes only from 18.25 ops/s at concurrency 4 to 18.83 ops/s at concurrency 8 while p50 grows from 216.97 ms to 421.38 ms. Warm throughput decreases from 39.19 to 37.27 ops/s while p50 grows from 101.72 ms to 213.93 ms.

The strongest focused follow-up is therefore not another cache layer. It is to evaluate candidate pruning through the already-built `ContractSearchIndex.postings` before full ranking, while holding R1/R2 ranking outputs, evidence projection and conservative-abstention behavior invariant. Memory growth during index construction and high-concurrency cold intent search should be measured in the same follow-up, because scale-4 stress reached about 1.36 GiB process RSS.

This optimization work is intentionally outside PR #209. The current PR establishes the evidence and stress contour needed to evaluate it without changing production search semantics.

## Scope preserved

PR #209 adds repository tooling, tests and CI/evaluation workflow policy only. It does not add a production runtime dependency and does not change production `src/`, public protocol, exact DSH target identity, or verification semantics.
