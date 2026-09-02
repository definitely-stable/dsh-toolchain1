# Staged evaluation runbook

Status: **ACTIVE DEVELOPMENT CONTROL PLANE**

This runbook replaces H1-style manual chunking for ordinary engineering evaluation. It does not replace H1 history and it is not the H2 preregistration.

## Lifecycle

```text
deterministic checks
    ↓
select bounded mode
    ↓
plan hard model-call budget
    ↓
16-call canary when measurement/model execution is involved
    ↓
measurement health PASS?
   ├─ no → STOP, diagnose measurement
   └─ yes → spend only the remaining calls in the selected mode
                 ↓
        product + cost report
```

Modes are fixed by `scripts/eval/budget-plan.mjs`:

- `deterministic`: 0 model calls;
- `canary`: 8 B/C tasks, 16 calls;
- `dev`: 20 B/C tasks, 40 calls, normal default;
- `release`: 32 B/C tasks, 64 calls;
- `research`: 48 B/C tasks, 96 calls, explicit exploratory use only.

All model modes use one repetition by default. Repetitions are increased only after measured variance justifies the cost and the budget is explicitly revised.

## Development corpus

`h1-dev-corpus-v1/manifest.json` references four SHA-verified shards containing all 96 disclosed H1 tasks. The corpus is `DEVELOPMENT_ONLY` and must never become the H2 holdout.

`development-corpus.mjs` verifies every shard hash and selects tasks deterministically. Selection is domain-balanced: the first selection pass takes one task from each domain before taking a second task from any domain. This prevents small canaries from accidentally measuring only one easy surface.

## Measurement validity before product metrics

`health-gate.mjs` has four fail-closed development thresholds:

| Metric | Requirement |
| --- | ---: |
| structured format compliance | >= 98% |
| decision resolution | >= 95% |
| unrecovered infrastructure missingness | <= 2% |
| B/C decision-resolution gap | <= 5 pp |

A transient infrastructure failure that is successfully recovered is not the same as missing evidence. Retry attempts are reported separately as operational cost; only unrecovered infrastructure contributes to the validity threshold.

If the gate returns `STOP`, do not continue to a larger task count and do not interpret B/C quality differences as a release/product verdict.

## Cost discipline

The mode budget is a hard cap, not a chunk size. A `dev` run means at most 40 B/C model outcomes total. The first 16 outcomes are the measurement canary; passing it permits at most 24 additional outcomes. There is no manual continuation loop.

The report should include provider token usage when available. H1 showed that Contract Intelligence can materially increase context consumption, so quality and token overhead are both engineering metrics. A quality improvement that doubles context cost should be visible rather than hidden inside an aggregate success rate.

## H1 historical boundary

H1 remains `INCONCLUSIVE`. Canonical IDs/hashes are archived in `h1-terminal-outcome-2026-09-02.md`. The old one-shot H1 finalizer is retired. No staged-eval result changes H1 status.

The H1 development corpus may be used to:

- reproduce structured-output failures;
- validate new evaluator/sidecar behavior;
- test retrieval/tool-use changes;
- build regression cases from observed failure clusters.

It may not be used to claim fresh confirmatory evidence.

## Future H2 entry gate

Do not create or execute H2 until all of these are true:

1. structured result transport is deterministic and covered by end-to-end fixtures;
2. the 16-call canary passes the health thresholds repeatedly on development/calibration data;
3. recovered vs unrecovered infrastructure semantics are tested;
4. token/call budgets are measured and bounded;
5. task selection and repetition policy are frozen before seeing the H2 holdout;
6. a fresh H2 task set is generated, hidden and committed by hash;
7. any sequential stopping boundaries are preregistered before provider outcomes exist.

H2 is then a separate confirmatory experiment. The staged dev/release modes remain fast engineering feedback, not substitutes for that experiment.
