# Staged evaluation runbook

Status: **ACTIVE DEVELOPMENT CONTROL PLANE — MEASUREMENT / PRODUCT OUTCOME SEPARATED**

This runbook replaces H1-style manual chunking for ordinary engineering evaluation. H1 is immutable: staged evaluation does not alter, extend, or rerun it. The disclosed H1-derived corpus is `DEVELOPMENT_ONLY`; staged results are engineering evidence, not H2 confirmatory evidence.

## Operator surface

The supported GitHub Actions entry point is **M2 Staged Development Evaluation**. The operator selects one bounded mode: `canary`, `dev`, `release`, or `research`. The workflow creates a fresh managed OpenCode Go provider probe, binds the evaluation to that receipt, invokes the staged runner once, and uploads run-local probe/report evidence.

Equivalent local/provider command:

```text
pnpm eval:run -- --mode <mode> --manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json --output <report.json>
```

Before a local provider run, provide `OPENCODE_API_KEY` and set `M2_STAGED_PROVIDER_PROBE` to a fresh verified OpenCode Go probe receipt. Historical H1 provider evidence must not be reused as current provider identity.

There is no operator-facing chunk size, arm selector, repetition count, or continuation count. B/C parity, one repetition, the **16-call B/C measurement-health canary**, and hard call budgets are deterministic policy.

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
measurement plane trustworthy?
   ├─ no → STOP; zero remainder calls are authorized
   └─ yes → spend only the pre-authorized remainder
                 ↓
        bounded product outcome
        + API validity
        + cost/tool-use evidence
        + safe per-observation receipts
```

Modes remain fixed by `scripts/eval/budget-plan.mjs`:

- `deterministic`: 0 model calls;
- `canary`: 8 B/C tasks, 16 calls;
- `dev`: 20 B/C tasks, 40 calls;
- `release`: 32 B/C tasks, 64 calls;
- `research`: 48 B/C tasks, 96 calls.

All model-backed modes use one repetition. Every larger mode consumes the same 16-call measurement-health prefix first. A genuine measurement `STOP` terminates the run and authorizes zero remainder.

## Development corpus and frozen dev-v2 selection

`h1-dev-corpus-v1/manifest.json` references SHA-verified disclosed H1 task shards. The corpus is `DEVELOPMENT_ONLY`, has `futureHoldoutAllowed=false`, and must never become an H2 holdout.

The original domain-only selector failed in run `33939213526`: its 20-task dev-v1 sample contained 20 `api-absent` checks and 0 `api-exists-any` discovery tasks because lexical `n*` identifiers sorted before `p*` identifiers.

The repaired selector is explicitly stratified by `domain × successRule.kind`. It never infers semantics from task-id prefixes, prompt text, package names, or symbols. The exact 20-task development selection remains frozen in [`staged-dev-v2-selection.json`](staged-dev-v2-selection.json):

- 12 `api-exists-any` discovery tasks;
- 8 `api-absent` checks;
- all eight domains represented;
- both oracle kinds in every domain;
- exact selected task ids and source-shard SHA-256 identities committed before model outcomes.

Any future selection change is a new versioned development experiment. Do not silently mutate the frozen selection after seeing outcomes.

## Execution boundary

The staged executor reuses the exact P0 evaluation substrate for the frozen rc.2 target: B/C capability manifests, ordinary evidence workspace, production Toolchain search/inspect runtime, and the isolated process-executor boundary. It does not import or write the historical H1 run-store.

Each provider attempt receives a fresh process/session. B receives conventional exact-target ordinary tools. C receives the same ordinary tools plus `toolchain_contract_search` and `toolchain_contract_inspect`. The common `submit_staged_result` measurement function is isolated from product exploration and is never dispatched as a product tool.

Only preregistered provider/tool transport failures receive the single permitted infrastructure retry. Model outcomes are not retried for quality.

The product tool-call budget remains **31 calls per observation**. This number is an execution-budget boundary, not a target to tune after observing B/C results.

## Three independent evidence planes

Staged evaluation now separates three questions that must not be collapsed into one status.

### 1. Measurement health

Measurement health asks whether provider/process/finalization evidence is trustworthy. It does **not** decide whether the agent solved the product task.

Current fail-closed rules:

| Measurement condition | Requirement |
| --- | ---: |
| structured format compliance among observations where measurement finalization was attempted | >= 98% |
| unrecovered infrastructure missingness | <= 2% |
| model outcomes with zero measurement attempts in the entire canary | STOP |

`decisionResolutionRate` and B/C `resolutionGap` remain reported as diagnostics, but they are no longer measurement STOP criteria. An arm-dependent difference in whether an agent reaches a bounded product result can itself be treatment behavior and must not be censored as a broken measurement channel.

True malformed/unsupported structured finalization still lowers measurement-format compliance and remains fail-closed. Unrecovered provider/process/tool infrastructure remains missing evidence and remains fail-closed.

Historical H1 prefix-health audits preserve their original legacy health definition locally; they are not retroactively reinterpreted under the new staged health-v2 semantics.

### 2. Bounded product outcome

Product execution has an explicit closed terminal outcome surface.

Currently recognized outcomes:

- `completed` — product exploration reached measurement finalization;
- `budget-exhausted / tool_budget_exhausted` — product exploration exceeded the unchanged 31-call product-tool budget before measurement finalization.

A product-budget terminal is a valid model/product outcome. It is **not** an infrastructure failure and is **not** automatically a malformed structured measurement.

The internal staged provider envelope uses an explicit `product-terminal` kind so `tool_call_limit` cannot be projected to `STRUCTURED_TRANSPORT_UNSUPPORTED`.

### 3. Cost and trajectory evidence

Cost and safe operational trajectory evidence are first-class engineering outputs:

- input/output tokens;
- wall time;
- turns and provider completions;
- attempts/retries/infrastructure failures;
- total, ordinary and Toolchain product-tool calls;
- exact counts for `read_file`, `search_text`, `toolchain_contract_search`, `toolchain_contract_inspect`;
- C observations with actual model outcomes that used Toolchain.

The report does not persist prompts, assistant reasoning/chain-of-thought, raw model prose, raw tool arguments/results, workspace contents, credentials, or provider bodies.

## Report v3 semantics

`dsh-toolchain-staged-eval-report-v3` preserves the old resolved-only API-validity view for continuity but adds non-censored bounded metrics.

### Conditional API validity

`pairedTasks.apiValidityDeltaCMinusB` remains a complete-case diagnostic over pairs where both arms reached deterministic API adjudication. It must not be mistaken for a full bounded-success estimate when one arm has product terminals.

### Bounded completion

Eligible observations are model outcomes whose product result is either:

- a recognized bounded product terminal; or
- a completed product exploration with a valid measurement-format result.

Budget exhaustion remains in the denominator and counts as non-completion. True infrastructure/measurement corruption is excluded from the product denominator and handled by measurement health.

Report v3 publishes per-arm and paired bounded-completion rates plus the paired contingency `bothCompleted / bOnly / cOnly / neither`.

### Bounded API success

Using the same product-eligible denominator, an observation succeeds only when deterministic adjudication exists and `apiValid=true`. Budget exhaustion, a valid-but-unresolvable claim, or API-invalid claim is non-success.

This remains an **API-task engineering proxy**, not an independently measured end-to-end developer-task success metric. The report continues to state `taskSuccessGuardrail.measured=false`.

### Safe observation receipts

Each executed observation is retained in ordinal order using operational metadata only:

- task id, arm, repetition;
- task domain and oracle kind;
- model-outcome / measurement-attempt flags;
- bounded product outcome and terminal reason;
- failure code and `apiValid` when available;
- cost and exact tool-count summaries.

This provides task-level auditability without storing chain-of-thought or raw trajectory contents.

## Historical staged outcomes

### Accepted structured measurement repair

The canonical receipt is [`staged-measurement-repair-acceptance-2026-09-04.md`](staged-measurement-repair-acceptance-2026-09-04.md). Run `33839417550` returned measurement `PASS` with 16/16 format-valid and 16/16 decision-resolved observations after the isolated two-phase claim-only finalizer was introduced.

### Dev-v1 — measurement healthy, sample invalid for product comparison

Run `33939213526` executed 40/40 observations with zero infrastructure failures/retries and B=C=20/20 API validity. The old selector selected 20/20 `api-absent` tasks, so the product comparison is **UNINFORMATIVE / CEILING-SATURATED DUE TO SELECTION BIAS**. Exact rationale is in [`staged-dev-v1-outcome-2026-09-05.md`](staged-dev-v1-outcome-2026-09-05.md).

Do not rerun dev-v1 to obtain a preferred result.

### Dev-v2 — original report STOP exposed outcome/measurement conflation

Run `33948582894` executed the frozen dev-v2 canary on exact main `8e8df50df16018374808741f1a2073d3b3a5cd37`:

- 16/16 model outcomes;
- zero infrastructure failures/retries;
- B reached adjudication 6/8;
- C reached adjudication 8/8;
- C used Toolchain 8/8;
- two B observations ended with `tool_call_limit`;
- original report-v2 mapped those two terminals to `STRUCTURED_TRANSPORT_UNSUPPORTED` and returned measurement `STOP`;
- remainder authorization remained 0/24.

The original artifact remains historically `STOP`. The durable analysis is [`staged-dev-v2-outcome-2026-09-05.md`](staged-dev-v2-outcome-2026-09-05.md).

Do not report the complete-case API delta of zero as Toolchain equivalence: only six pairs entered that calculation. Do not report 6/8 vs 8/8 as a confirmed +25 pp product effect either: bounded completion was not preregistered as the primary endpoint for that run and the remainder never executed.

## Cost discipline

A mode budget is a hard cap, not a chunk size. `dev` means at most 40 scheduled B/C observations: 16 canary calls plus 24 remainder calls only after measurement `PASS`. Authorized infrastructure retries are reported separately as attempts/cost; there is no manual continuation loop.

Token overhead, turns, wall time, ordinary-vs-Toolchain substitution, and bounded completion are joint engineering evidence. A product delta without incremental cost must not be treated as sufficient evidence for promotion.

The dev-v2 canary specifically showed materially higher C input-token and wall-time cost even while C avoided the two B-only budget terminals. That tradeoff must be addressed in subsequent product/evaluation decisions rather than hidden by an aggregate accuracy number.

## Next authorized work

After the product-outcome separation implementation is merged and its exact post-merge CI is green:

1. do **not** automatically rerun `33948582894` or dispatch another provider-backed experiment merely because the methodology changed;
2. define an independent end-to-end developer-task success guardrail suitable for a future H2 design;
3. decide whether one additional versioned DEVELOPMENT_ONLY run is worth its provider cost to validate prospective report-v3 bounded metrics;
4. if such a run is authorized, freeze its identity/selection/decision rules before model outcomes;
5. only after useful development evidence and complete preregistration may a fresh hidden H2 be executed.

`release`, `research`, and H2 are not automatically authorized by merging the evaluation repair.

## H1 and H2 boundaries

H1 remains `INCONCLUSIVE`, immutable, and MUST NOT be rerun. The disclosed H1-derived development corpus may support calibration/regression only.

H2 must be a separate preregistered confirmatory experiment with a newly authored hidden task set/commitment. H1 and staged development tasks/outcomes cannot be recycled as unseen H2 evidence.

Before H2 provider outcomes exist, freeze at minimum:

1. product candidate and exact target;
2. hidden dataset commitment;
3. B/C capability boundary;
4. model/provider/reasoning identity;
5. an independent primary end-to-end outcome plus API/reliability/cost guardrails;
6. repetition, retry, resource, and stopping policy;
7. paired analysis/statistical decision rules;
8. handling of bounded product terminals and infrastructure/measurement missingness.

Passing a DEVELOPMENT_ONLY staged run does not by itself authorize a confirmatory product claim.
