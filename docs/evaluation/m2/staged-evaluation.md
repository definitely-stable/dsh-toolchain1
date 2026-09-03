# Staged evaluation runbook

Status: **ACTIVE DEVELOPMENT CONTROL PLANE — RUNNER ACCEPTED / MEASUREMENT STOP**

This runbook replaces H1-style manual chunking for ordinary engineering evaluation. H1 is immutable: staged evaluation does not alter, extend, or rerun it. The disclosed corpus is `DEVELOPMENT_ONLY`; staged results are engineering evidence, not H2 confirmatory evidence.

## Operator surface

The supported GitHub Actions entry point is **M2 Staged Development Evaluation**. The operator selects only one bounded mode: `canary`, `dev`, `release`, or `research`. The workflow creates a fresh managed OpenCode Go provider probe, binds the evaluation to that receipt, invokes the staged runner once, and uploads run-local probe/report evidence.

The equivalent authorized local/provider command is:

```text
pnpm eval:run -- --mode <mode> --manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json --output <report.json>
```

Before the local command, provide `OPENCODE_API_KEY` and set `M2_STAGED_PROVIDER_PROBE` to a fresh verified OpenCode Go probe receipt. Do not reuse historical H1 provider evidence.

There is no operator-facing chunk size, arm selector, repetition count, or continuation count. B/C parity, one repetition, canary size and hard budget are deterministic policy.

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

- `deterministic`: 0 model calls; repository checks only;
- `canary`: 8 B/C tasks, 16 calls;
- `dev`: 20 B/C tasks, 40 calls;
- `release`: 32 B/C tasks, 64 calls;
- `research`: 48 B/C tasks, 96 calls.

All model-backed modes use one repetition. Every larger mode consumes the same 16-call canary first. A `STOP` terminates immediately and authorizes zero remainder.

## Development corpus

`h1-dev-corpus-v1/manifest.json` references SHA-verified disclosed H1 task shards. The corpus is `DEVELOPMENT_ONLY` and must never become the H2 holdout. `development-corpus.mjs` verifies hashes and selects tasks deterministically with domain balancing.

## Execution boundary

The staged development executor reuses the exact P0 evaluation substrate for the frozen target: B/C capability manifests, ordinary evidence workspace, Toolchain search/inspect runtime and the existing process-executor boundary. It does not import or write the historical H1 run-store.

Each provider attempt receives a fresh process/session. The staged OpenCode Go child adds the common `submit_staged_result` measurement function to both B and C. That function is intercepted inside the child and never dispatched as a product tool call. Only preregistered provider/tool transport failures receive the single permitted infrastructure retry; model outcomes are not retried for quality.

Required repository CI remains provider-free. Real provider execution requires the managed-provider credential and a fresh probe receipt.

## Measurement validity before product metrics

`health-gate.mjs` is fail-closed:

| Metric | Requirement |
| --- | ---: |
| structured format compliance | >= 98% |
| decision resolution | >= 95% |
| unrecovered infrastructure missingness | <= 2% |
| B/C decision-resolution gap | <= 5 pp |

Recovered infrastructure retries are reported as cost, not missing evidence. If the gate returns `STOP`, do not continue to a larger task count and do not interpret B/C quality differences as a product or release verdict.

## Real provider acceptance — 2026-09-03

The runner acceptance is complete and recorded in [`staged-canary-acceptance-2026-09-03.md`](staged-canary-acceptance-2026-09-03.md).

Actions run `33763657085` executed exactly `16 / 16` B/C calls after a successful managed-provider probe. The run completed without infrastructure loss or retries, but measurement health returned `STOP`:

- structured-format valid: `0 / 16`;
- resolved decisions: `0 / 16`;
- reasons: `FORMAT_COMPLIANCE_BELOW_MINIMUM`, `DECISION_RESOLUTION_BELOW_MINIMUM`;
- infrastructure failures: `0`;
- retries: `0`;
- remainder authorized/executed: `0 / 0`;
- input/output tokens: `541734 / 33595`;
- turns: `201`;
- product tool calls: `185`.

This is a successful acceptance of the **canary-first fail-closed runner**, not a successful measurement result. It proves the control plane stopped before spending a larger remainder or manufacturing B/C conclusions. Issue #176 owns repair of the staged structured-result transport.

Until #176 produces a healthy bounded canary, `dev`, `release` and `research` must not be used to make product comparisons or authorize larger spending.

## Cost discipline

The mode budget is a hard cap, not a chunk size. A `dev` run means at most 40 B/C model outcomes total: the first 16 are the health canary and only a PASS may authorize the remaining 24. There is no manual continuation loop.

Token overhead is a first-class engineering metric. The accepted STOP canary itself consumed `541734` input and `33595` output tokens, so future measurement repair must preserve explicit cost reporting.

## Product optimization lane before H2

Once #176 establishes healthy structured measurement, disclosed DEVELOPMENT_ONLY data can support product optimization such as search-to-inspect conversion, duplicate-query suppression, result compaction, per-task tool budgets, token-overhead guardrails and failure-cluster targeting.

Do not use `dev` or `release` product deltas while measurement remains STOP. Freeze any selected product candidate before creating a fresh H2 holdout.

## H1 historical boundary

H1 remains `INCONCLUSIVE`. Canonical IDs/hashes are archived in `h1-terminal-outcome-2026-09-02.md`. H1 is immutable and MUST NOT be rerun; no staged-eval result changes its status.

The disclosed H1 corpus may reproduce measurement failures and support development regression work, but it cannot become fresh confirmatory evidence.

## Future H2

Do not create or execute H2 until all of these are true:

1. structured result transport is deterministic and covered by end-to-end fixtures;
2. the 16-call DEVELOPMENT_ONLY canary passes the health thresholds;
3. recovered vs unrecovered infrastructure semantics remain tested;
4. token/call budgets are measured and bounded;
5. the product candidate is frozen;
6. task selection and repetition policy are frozen before seeing H2 outcomes;
7. a fresh H2 task set is generated, hidden and committed by hash;
8. stopping and analysis rules are preregistered before provider outcomes exist.

H2 is a separate confirmatory experiment. The staged modes remain engineering feedback, not substitutes for it.