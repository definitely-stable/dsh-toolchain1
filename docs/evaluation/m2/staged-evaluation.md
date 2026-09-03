# Staged evaluation runbook

Status: **ACTIVE DEVELOPMENT CONTROL PLANE — IMPLEMENTED, REAL CANARY ACCEPTANCE PENDING**

This runbook replaces H1-style manual chunking for ordinary engineering evaluation. H1 is immutable: staged evaluation does not alter, extend, or rerun it. The disclosed corpus is `DEVELOPMENT_ONLY`; staged results are engineering evidence, not H2 confirmatory evidence.

## Operator surface

The supported GitHub Actions entry point is **M2 Staged Development Evaluation**. The operator selects only one bounded mode: `canary`, `dev`, `release`, or `research`. The workflow creates a fresh managed OpenCode Go provider probe, binds the evaluation to that receipt, invokes the staged runner once, and uploads the run-local probe/report evidence.

The equivalent authorized local/provider command is:

```text
pnpm eval:run -- --mode <mode> --manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json --output <report.json>
```

Before the local command, provide `OPENCODE_API_KEY` and set `M2_STAGED_PROVIDER_PROBE` to the path of a fresh verified OpenCode Go probe receipt. Do not reuse historical H1 provider evidence as that receipt.

There is no operator-facing chunk size, arm selector, repetition count, or continuation count. Arm B/C parity, one repetition, canary size and hard budget are deterministic policy.

## Lifecycle

```text
deterministic checks
    ↓
select bounded mode
    ↓
fresh managed-provider probe
    ↓
16-call B/C canary
    ↓
measurement health PASS?
   ├─ no → STOP; zero remainder calls are authorized
   └─ yes → spend only the pre-authorized remainder
                 ↓
        product + cost report
```

Modes are fixed by `scripts/eval/budget-plan.mjs`:

- `deterministic`: 0 model calls and repository tests only; it is not an `eval:run` mode;
- `canary`: 8 B/C tasks, 16 calls;
- `dev`: 20 B/C tasks, 40 calls, normal default;
- `release`: 32 B/C tasks, 64 calls;
- `research`: 48 B/C tasks, 96 calls, explicit exploratory use only.

All model-backed modes use one repetition. The one-dispatch runner always consumes the same 16-call B/C canary first. If the health gate returns `STOP`, the authorized remainder is zero remainder and the run terminates without spending a larger mode's remaining calls.

## Development corpus

`h1-dev-corpus-v1/manifest.json` references four SHA-verified shards containing all 96 disclosed H1 tasks. The corpus is `DEVELOPMENT_ONLY` and must never become the H2 holdout.

`development-corpus.mjs` verifies every shard hash and selects tasks deterministically. Selection is domain-balanced: the first selection pass takes one task from each domain before taking a second task from any domain. This prevents small canaries from accidentally measuring only one easy surface.

## Execution boundary

The staged development executor reuses the exact P0 evaluation substrate for the frozen target: capability manifests B/C, ordinary evidence workspace, Toolchain search/inspect runtime and the existing process-executor boundary. It does not import or write the historical H1 run-store.

Each provider attempt receives a fresh process/session. The staged OpenCode Go child adds the common `submit_staged_result` measurement function to both B and C at the provider boundary. That function is intercepted inside the child and is never dispatched as a product tool call. Only preregistered provider/tool transport failures receive the single permitted infrastructure retry; model outcomes are not retried for quality.

Required repository CI remains provider-free. Real provider execution exists only behind the explicit operator command/manual workflow and requires the managed-provider credential plus a fresh probe receipt.

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

The report includes provider token usage when available. H1 showed that Contract Intelligence can materially increase context consumption, so quality and token overhead are both engineering metrics. A quality improvement that materially increases context cost must remain visible rather than being hidden inside an aggregate success rate.

## Product optimization lane before H2

Passing measurement calibration is not a reason to immediately spend a fresh holdout. The disclosed development corpus is the place to optimize Contract Intelligence behavior first.

The first optimization targets are derived from H1 operational evidence:

1. **Search-to-inspect conversion** — reduce repeated broad `contract.search` calls and move confidently matched candidates to `contract.inspect` earlier.
2. **Duplicate-query suppression** — canonicalize equivalent search intents and cache repeated exact-target results within one run.
3. **Result compaction** — keep search results small and evidence-oriented; avoid copying large declaration surfaces before the agent has selected a candidate.
4. **Per-task tool budget** — cap search/inspect rounds and stop when evidence confidence is sufficient instead of letting tool use grow until the model limit.
5. **Token overhead guardrail** — always report C-vs-B input-token overhead. H1's C arm consumed materially more input context than B; a future dev change should not hide this cost.
6. **Failure-cluster targeting** — run focused development subsets for `tool-runtime`, approval, session read/search and other observed failure clusters, but retain the balanced canary before any broader claim.

These optimizations use `dev`/`release` evidence only. Once a candidate configuration is chosen, freeze it before generating the new H2 holdout.

## H1 historical boundary

H1 remains `INCONCLUSIVE`. Canonical IDs/hashes are archived in `h1-terminal-outcome-2026-09-02.md`. The old one-shot H1 finalizer is retired. H1 is immutable and MUST NOT be rerun; no staged-eval result changes its status.

The H1 development corpus may be used to reproduce structured-output failures, validate new evaluator/sidecar behavior, test retrieval/tool-use changes and build regression cases from observed failure clusters. It may not be used to claim fresh confirmatory evidence.

## Acceptance state and future H2

The deterministic implementation and provider-free CI path are complete. Acceptance remains pending until a real 16-call provider canary from the manual workflow is inspected. A passing canary proves the staged measurement transport is usable for development; it still does not create confirmatory evidence.

Do not create or execute H2 until all of these are true:

1. structured result transport is deterministic and covered by end-to-end fixtures;
2. the 16-call canary passes the health thresholds repeatedly on development/calibration data;
3. recovered vs unrecovered infrastructure semantics are tested;
4. token/call budgets are measured and bounded;
5. the product candidate has completed the development optimization lane and is frozen;
6. task selection and repetition policy are frozen before seeing the H2 holdout;
7. a fresh H2 task set is generated, hidden and committed by hash;
8. any sequential stopping boundaries are preregistered before provider outcomes exist.

H2 is then a separate confirmatory experiment. The staged dev/release modes remain fast engineering feedback, not substitutes for that experiment.
