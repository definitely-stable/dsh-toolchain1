# DSH Eval Operator v1 Design

Status: **APPROVED FOR IMPLEMENTATION**

## Problem

M2 H1 proved that the current evaluation process is operationally too expensive for normal development and can waste most of its budget before discovering that the measurement layer is unhealthy. H1 scheduled 864 outcomes (96 tasks × 3 arms × 3 trials), required manual workflow chunks, and ended `INCONCLUSIVE` because the structured adjudication protocol left a large fraction of B/C observations unresolved. The same defect was visible in the first small prefix of the run, but no predeclared health gate could stop execution.

The next evaluation system must make the cheap, diagnostic path the default and reserve publication-grade experiments for rare, separately preregistered milestones.

## Goals

1. Make normal Toolchain agent evaluation a one-command / one-skill operation rather than a sequence of manual chunk dispatches.
2. Default to B/C only. Arm A is not part of the normal product decision loop.
3. Default to one trial per task. Repetitions are added only for explicit stability work, not multiplied across every development run.
4. Cap normal development evaluation at 40 model outcomes and stop after a 16-outcome canary when the measurement layer is unhealthy.
5. Separate measurement validity from product quality. A broken evaluator must produce `MEASUREMENT_INVALID`, not a misleading quality score.
6. Reuse the now-disclosed H1 task corpus only as a calibration/development corpus. It must never be presented as a fresh holdout again.
7. Preserve historical H1 evidence and terminal result unchanged.
8. Produce compact machine-readable evidence that exposes correctness, measurement health, tool usage, latency, token cost, and stop reason.

## Non-goals for v1

- No new confirmatory H2 claim.
- No new hidden dataset or publication-grade statistical power claim.
- No change to the historical H1 scorer, Truth v2, thresholds, bootstrap, schedule, or result.
- No embeddings/retrieval redesign in the same change.
- No LLM-as-judge. Objective API and measurement checks remain deterministic.
- No generalized external eval platform or server.
- The structured-output sidecar replacement is a v2 milestone; v1 detects the current `API_CLAIM` protocol failing early instead of consuming the full budget.

## Evaluation tiers

| Mode | Tasks | Arms | Trials | Maximum model outcomes | Intended use |
|---|---:|---|---:|---:|---|
| `smoke` | 8 | B/C | 1 | 16 | Fast measurement + gross regression check |
| `dev` | 20 | B/C | 1 | 40 | Default agent eval while developing Toolchain |
| `release` | 32 | B/C | 1 | 64 | Broader pre-release regression evidence |
| `research` | 48 | B/C | 1 | 96 | Explicit deeper exploratory analysis only |

`dev` is the skill default. `research` must never be selected automatically merely because a smaller run is noisy.

## Task selection

The disclosed H1 corpus contains eight domains with twelve tasks each. Selection is deterministic so successive runs remain comparable.

- `smoke`: one stable task per domain.
- `dev`: two tasks per domain plus one additional task from each of the four H1 failure-priority domains: `approval-policy`, `tool-runtime`, `session-search`, `session-reads`.
- `release`: four tasks per domain.
- `research`: six tasks per domain.

Within each domain tasks are ordered by task id. The selection policy is development-oriented and is explicitly tuned using disclosed H1 knowledge; therefore these sets are calibration/regression sets, not unseen evidence.

## Canary and health gate

Every mode begins with the eight-task smoke slice (16 B/C outcomes). `smoke` ends there. Other modes may continue only when the canary is healthy.

Health is determined before any product-quality comparison. The v1 thresholds are intentionally strict because a canary exists to prove the ruler works:

- model-outcome rate >= 0.95;
- structured-format compliance rate >= 0.95;
- decision-resolution rate >= 0.95;
- absolute B/C decision-resolution gap <= 0.10;
- unrecovered infrastructure rate <= 0.05.

A canary that violates any threshold produces `MEASUREMENT_INVALID` and stops immediately. No automatic escalation, rerun-until-green, or substitution of complete-case quality metrics is allowed.

Recovered infrastructure retries are recorded separately from unrecovered missing outcomes. A bounded retry may repair transport, but the evidence must retain the original failure count.

## Development runner

The v1 model runner is a calibration replay harness over the disclosed H1 tasks. It reuses the existing exact-target ordinary tools, Toolchain search/inspect tools, provider adapter, Truth v2, task success rules, and one bounded infrastructure retry. It does not use the historical H1 durable ledger and does not append evidence to H1.

For each selected task the runner executes B and C once. Order is deterministic and alternated by task so one arm is not always globally first. After the canary, the health gate decides whether the remainder is allowed.

Result identity must clearly say calibration/development. The runner must not describe its result as H1, preregistered, confirmatory, or holdout evidence even if it reuses H1 task material and evaluation components.

## Result model

Each run writes:

- `dsh-eval-result-v1.json` — mode, selected tasks, health, B/C summaries, costs, status and provenance;
- `dsh-eval-cases-v1.jsonl` — one row per executed B/C outcome;
- `dsh-eval-summary.md` — concise human report;
- `dsh-eval-sha256sums.txt` — hashes for the three content artifacts.

Top-level status:

- `COMPLETE` — canary healthy and the requested mode completed;
- `MEASUREMENT_INVALID` — canary failed and execution stopped before expansion;
- `INFRASTRUCTURE_FAILED` — the runner itself could not produce trustworthy calibration evidence.

Quality metrics are exploratory: resolved invalid-API rate, task-success rate, B/C differences, Toolchain search/inspect usage, tool errors, wall time, turns, input/output tokens, and unresolved counts. They never override measurement status.

## Skill behavior

Repository skill: `.agents/skills/dsh-eval/SKILL.md`.

The skill must:

1. inspect the requested change and use deterministic repository checks first;
2. default to `dev`, with `smoke` for narrow prompt/tool-schema changes and `release` only for an explicit release/pre-merge request;
3. dispatch a single `DSH Eval` workflow rather than ask the user to click repeated chunks;
4. observe the workflow to completion, obtain the artifact/result, and summarize measurement health, quality, Toolchain usage and cost;
5. stop on `MEASUREMENT_INVALID`; do not automatically spend more model calls;
6. never run `research` without explicit user intent;
7. never call the disclosed corpus a holdout.

## GitHub workflow

`.github/workflows/dsh-eval.yml` is manual/agent-dispatched and has one `mode` input. It performs deterministic plan/self-tests before exposing provider credentials. The workflow materializes the already-disclosed H1 corpus from the existing secret, runs the calibration evaluator once, always uploads evidence when evidence exists, and makes `MEASUREMENT_INVALID` visible as a failed gate after artifact upload.

No recurring cron is added.

## Historical H1 cleanup

`.github/workflows/m2-h1-finalize-once.yml` was intentionally one-shot and hard-coded to the completed H1 run. It must be removed after its successful use so it cannot silently re-dispatch terminal analysis later.

Historical H1 execution, terminal and post-analysis workflows remain intact as evidence/reproduction machinery.

## Verification strategy

TDD is required for executable behavior.

- planner tests prove exact mode budgets and that A/repetitions cannot enter the default plan;
- health tests prove a healthy canary passes and an H1-like unresolved prefix stops;
- workflow policy tests prove one dispatch input, no schedule/cron, default `dev`, and evidence upload before the measurement gate fails;
- skill policy tests prove the default budget, no automatic research, and stop-on-invalid instructions;
- runner unit tests exercise deterministic selection and health transition without provider calls;
- GitHub CI remains the repository-wide verification authority.

## Follow-up milestones

### v2 — measurement protocol

Replace free-text `API_CLAIM` dependence with a structured result sidecar or mandatory structured provider output. Validate schema separately from semantic API adjudication. Add an end-to-end synthetic canary (`provider response -> persistence -> adjudicator -> report`) before real tasks.

### v3 — efficiency budgets

Use disclosed calibration cases to reduce `contract.search` fan-out, improve search-to-inspect conversion, cap repeated queries, compress evidence, and introduce explicit token/tool-call budgets. Target a material reduction from H1's approximately 88% C-vs-B input-token overhead without sacrificing correctness.

### H2 — new confirmatory evidence

Only after v2/v3 are stable: create a new unseen dataset, freeze a new measurement contract, use B/C only, one trial by default, and preregister any sequential expansion/stopping rule. H1 remains permanently `INCONCLUSIVE` and is never replayed as confirmatory evidence.