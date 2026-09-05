# Staged evaluation runbook

Status: **ACTIVE DEVELOPMENT CONTROL PLANE — MEASUREMENT ACCEPTED / DEV-V2 HARNESS REPAIR**

This runbook replaces H1-style manual chunking for ordinary engineering evaluation. H1 is immutable: staged evaluation does not alter, extend, or rerun it. The disclosed H1-derived corpus is `DEVELOPMENT_ONLY`; staged results are engineering evidence, not H2 confirmatory evidence.

## Operator surface

The supported GitHub Actions entry point is **M2 Staged Development Evaluation**. The operator selects one bounded mode: `canary`, `dev`, `release`, or `research`. The workflow creates a fresh managed OpenCode Go provider probe, binds the evaluation to that receipt, invokes the staged runner once, and uploads run-local probe/report evidence.

Equivalent local/provider command:

```text
pnpm eval:run -- --mode <mode> --manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json --output <report.json>
```

Before a local provider run, provide `OPENCODE_API_KEY` and set `M2_STAGED_PROVIDER_PROBE` to a fresh verified OpenCode Go probe receipt. Historical H1 provider evidence must not be reused as the current provider identity.

There is no operator-facing chunk size, arm selector, repetition count, or continuation count. B/C parity, one repetition, the 16-call health canary, and hard call budgets are deterministic policy.

## Lifecycle

```text
deterministic checks
    ↓
select bounded mode
    ↓
fresh managed-provider probe
    ↓
deterministic task selection
    ↓
16-call B/C measurement-health canary
    ↓
measurement health PASS?
   ├─ no → STOP; zero remainder calls are authorized
   └─ yes → spend only the pre-authorized remainder
                 ↓
        API-validity + cost/tool-use report
```

Modes are fixed by `scripts/eval/budget-plan.mjs`:

- `deterministic`: 0 model calls;
- `canary`: 8 B/C tasks, 16 calls;
- `dev`: 20 B/C tasks, 40 calls;
- `release`: 32 B/C tasks, 64 calls;
- `research`: 48 B/C tasks, 96 calls.

All model-backed modes use one repetition. Every larger mode consumes the same 16-call measurement-health prefix first. A `STOP` terminates the run and authorizes zero remainder.

## Development corpus and dev-v2 selection

`h1-dev-corpus-v1/manifest.json` references SHA-verified disclosed H1 task shards. The corpus is `DEVELOPMENT_ONLY`, has `futureHoldoutAllowed=false`, and must never become an H2 holdout.

The original selector balanced only by domain and sorted task ids lexicographically. Run `33939213526` proved that this was insufficient: the 20-task dev-v1 sample contained 20 `api-absent` checks and 0 `api-exists-any` discovery tasks because every domain's `n*` identifiers sorted before `p*` identifiers.

The repaired selector is explicitly stratified by `domain × successRule.kind`. It never infers semantics from task-id prefixes, prompt text, package names, or symbols. The first 16 selected tasks cover every domain/kind stratum once; additional dev capacity consumes discovery-positive strata before additional negatives at the same depth.

The exact next 20-task development sample is frozen before any provider outcome in [`staged-dev-v2-selection.json`](staged-dev-v2-selection.json):

- `12` `api-exists-any` discovery tasks;
- `8` `api-absent` checks;
- all `8` domains represented;
- both oracle kinds present in every domain;
- exact selected task ids, source shard SHA-256 identities, and a deterministic selection commitment are committed and regression-tested.

Any selection drift requires a new versioned development experiment. Do not silently mutate the frozen selection after seeing model outcomes.

## Execution boundary

The staged executor reuses the exact P0 evaluation substrate for the frozen rc.2 target: B/C capability manifests, ordinary evidence workspace, production Toolchain search/inspect runtime, and the existing isolated process-executor boundary. It does not import or write the historical H1 run-store.

Each provider attempt receives a fresh process/session. B receives conventional exact-target ordinary tools. C receives the same ordinary tools plus `toolchain_contract_search` and `toolchain_contract_inspect`. The common `submit_staged_result` measurement function is isolated from product exploration and is never dispatched as a product tool.

Only preregistered provider/tool transport failures receive the single permitted infrastructure retry. Model outcomes are not retried for quality.

## Measurement health

`health-gate.mjs` remains fail-closed:

| Metric | Requirement |
| --- | ---: |
| structured format compliance | >= 98% |
| decision resolution | >= 95% |
| unrecovered infrastructure missingness | <= 2% |
| B/C decision-resolution gap | <= 5 pp |

Recovered infrastructure retries are cost, not missing evidence. If the gate returns `STOP`, product differences are non-interpretable and no remainder may run.

Structured measurement repair is accepted. The canonical acceptance receipt is [`staged-measurement-repair-acceptance-2026-09-04.md`](staged-measurement-repair-acceptance-2026-09-04.md). Run `33839417550` returned `PASS` with 16/16 format-valid and 16/16 decision-resolved observations after the two-phase claim-only finalizer was introduced.

## Dev-v1 outcome

Run `33939213526` on frozen candidate `8eba7eccba77bb3e047868dbad8ea9c9ced3b033` executed the authorized `dev` budget and returned measurement `PASS`:

- executed calls: `40 / 40`;
- infrastructure failures: `0`;
- retries: `0`;
- B API-valid: `20 / 20`;
- C API-valid: `20 / 20`;
- paired API-validity delta C-B: `0`;
- input/output tokens: `2,473,780 / 120,594`;
- aggregate product tool calls: `594`.

The product comparison is **UNINFORMATIVE / CEILING-SATURATED DUE TO SELECTION BIAS**, not negative evidence against Toolchain. Exact rationale is recorded in [`staged-dev-v1-outcome-2026-09-05.md`](staged-dev-v1-outcome-2026-09-05.md).

Do not rerun dev-v1 to obtain a preferred result.

## Report v2 semantics

The staged development oracle can deterministically adjudicate one API-existence/absence claim. It cannot independently determine end-to-end task completion. Therefore report v2:

- reports `apiValid` as the adjudicated product outcome;
- explicitly records `taskSuccessGuardrail.measured=false` rather than duplicating API validity under a second name;
- reports aggregate and per-arm B/C input/output tokens, wall time, turns, provider completions, retries, infrastructure failures, product-tool calls, and measurement-tool calls;
- reports actual trace-derived ordinary vs Toolchain product-tool counts;
- distinguishes `read_file`, `search_text`, `toolchain_contract_search`, and `toolchain_contract_inspect`;
- reports the number/rate of C observations with an actual model outcome that used at least one Toolchain tool.

Unrecovered C infrastructure attempts remain in cost and missingness accounting but are excluded from the Toolchain-use denominator because no agent tool-selection behavior was observed. Tool-use telemetry is observational: it does not force C to call Toolchain and does not alter model-visible capability manifests or provider transport.

## Cost discipline

A mode budget is a hard cap, not a chunk size. `dev` means at most 40 scheduled B/C observations: 16 health-canary calls plus 24 remainder calls only after `PASS`. Authorized infrastructure retries are reported separately as attempts/cost; there is no manual continuation loop.

Token overhead, turns, wall time, and tool-use differences are first-class engineering metrics. A product delta without its incremental cost must not be treated as sufficient evidence for promotion.

## Next authorized model run

After the dev-v2 harness repair is merged and post-merge `main` CI passes, exactly one new DEVELOPMENT_ONLY `dev` workflow dispatch may be run on merged `main`.

It is a new versioned **dev-v2 engineering-signal** experiment, not a rerun of dev-v1, not `release`/`research`, and not H2.

Interpretation:

- measurement `STOP` → diagnose measurement/infrastructure evidence; no immediate quality rerun;
- measurement `PASS` → inspect B/C API-validity delta together with actual Toolchain-use rate and incremental token/wall/turn/tool cost;
- no Toolchain use in C → investigate agent/tool-selection behavior before judging retrieval value;
- Toolchain used but both arms at ceiling → development sample still lacks discriminating product difficulty; do not claim equivalence;
- useful C improvement with bounded cost → candidate may proceed toward fresh H2 design, subject to an independently defined end-to-end success guardrail.

## H1 and H2 boundaries

H1 remains `INCONCLUSIVE`, immutable, and MUST NOT be rerun. The disclosed H1-derived development corpus may support calibration/regression only.

H2 must be a separate preregistered confirmatory experiment with a newly authored hidden task set/commitment. H1 and staged dev-v1/dev-v2 tasks or outcomes cannot be recycled as unseen H2 evidence.

Before H2 provider outcomes exist, freeze at minimum:

1. product candidate and exact target;
2. hidden dataset commitment;
3. B/C capability boundary;
4. model/provider/reasoning identity;
5. independent primary and guardrail outcomes;
6. repetition, retry, resource, and stopping policy;
7. analysis/statistical decision rules.

Passing a DEVELOPMENT_ONLY staged run does not by itself authorize a confirmatory product claim.
