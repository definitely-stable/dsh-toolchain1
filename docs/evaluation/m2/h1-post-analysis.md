# M2.3 H1 post-analysis

This layer starts only after a successful `M2 H1 Terminal Adjudication` run. It is intentionally downstream of the frozen H1 execution and terminal adjudicator.

It must not change or reinterpret the preregistered H1 decision rule, Truth v2, task-success adjudicator, thresholds, bootstrap configuration, schedule, retry semantics, or retained model outcomes.

## Operator flow

1. Finish H1 execution until its durable ledger is `COMPLETE`.
2. Run `M2 H1 Terminal Adjudication` with the final H1 execution run ID.
3. Record the terminal run ID after that workflow completes successfully.
4. Run `M2 H1 Post Analysis` from `main` with `terminal_adjudication_run_id=<terminal run id>`.
5. Read the GitHub Job Summary and download the `m2-h1-post-analysis-<terminal-run-id>` artifact.

The post-analysis workflow verifies that the supplied source run is the successful manual terminal adjudication workflow on `main`, downloads its evidence artifact, and verifies the terminal manifest and SHA-256 bindings before deriving diagnostics.

## Outputs

- `h1-post-analysis-v1.json` — exploratory arm-level, Toolchain-adoption, failure-taxonomy, domain and rule-kind diagnostics.
- `h1-task-diagnostics-v1.jsonl` — one derived record per H1 task with A/B/C summaries, C-vs-B task effects and C Toolchain usage.
- `h1-final-report.md` — human-readable report for the M2.3 decision record.
- `h1-decision-receipt-v1.json` — machine-readable frozen status plus an explicitly non-gating recommendation for the next action.
- `h1-post-analysis-sha256sums.txt` — SHA-256 bindings for the derived outputs.

## Decision routing

The terminal status remains authoritative.

- `PASS` -> `ADVANCE_M2`. Diagnostics may create non-blocking follow-up issues but do not hold the M2 exit gate open.
- `NEEDS-IMPROVEMENT` -> `OPEN_SEPARATE_IMPROVEMENT_SLICE`. The exploratory recommendation selects the dominant observed bottleneck: Toolchain invocation, search-to-inspect adoption, Toolchain runtime reliability, agent/task-success integration, or retrieval/evidence quality.
- `INCONCLUSIVE` -> `RESOLVE_PREREGISTERED_RECOVERY_PATH`. Product tuning must not start until the frozen validity/recovery rules are resolved.

The engineering-slice recommendation is a deterministic diagnostic heuristic, not a scientific endpoint and not a replacement scorer.

## Local command

```sh
pnpm m2:h1:post-analyze -- \
  --terminal-dir <downloaded-terminal-artifact-directory> \
  --output-dir <empty-output-directory> \
  --terminal-run-id <terminal-adjudication-run-id>
```

The output directory must be empty because derived files are written with exclusive-create semantics.
