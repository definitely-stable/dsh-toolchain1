# M2 staged evaluation: product-outcome separation design

Date: 2026-09-05
Status: approved for implementation
Parent: #160
Scope: evaluation-only; no production Contract Search or `src/` changes

## Problem

Staged dev-v2 run `33948582894` executed the repaired stratified canary on exact main `8e8df50df16018374808741f1a2073d3b3a5cd37`. Provider/transport infrastructure was healthy and there were no infrastructure failures or retries. Arm C reached deterministic API adjudication on 8/8 canary tasks and used Toolchain on 8/8. Arm B reached adjudication on 6/8. The two B observations exceeded the frozen 31 product-tool-call budget.

The current child encodes `tool_call_limit` as generic `unsupported`. `staged-execution.mjs` therefore reports it as `STRUCTURED_TRANSPORT_UNSUPPORTED`, and the health gate counts it as failed format/decision measurement. The canary consequently STOPs on an arm-dependent product behavior that may itself be treatment signal.

This conflates three different questions:

1. **Measurement health:** did provider/runner/finalization transport produce trustworthy measurement when measurement was attempted?
2. **Bounded product outcome:** did the agent complete the product exploration within the identical frozen execution budget and, if so, make a valid API claim?
3. **Cost/trajectory evidence:** how many model/tool resources did each arm consume and which product tools were used?

The design separates these axes. It does not increase the 31-call limit, change the model/provider, modify the frozen task selection, or tune Contract Search.

## Design principles

Current agent-evaluation practice treats the harness and execution budget as part of the evaluated system. Agent failure, budget exhaustion and evaluation-infrastructure failure must be distinguishable. Trajectory-level evidence should be retained in a bounded, privacy-safe form so aggregate metrics remain auditable. A treatment-dependent task-completion gap must not be filtered out merely because one arm reached a product execution limit.

For this repository that means:

- execution-budget exhaustion is a **valid product terminal outcome**;
- it is not an infrastructure failure and not a structured-result-format failure;
- measurement health gates only the trustworthiness of the measurement plane;
- product metrics retain bounded failures in their denominators instead of complete-case censoring;
- raw reasoning, prompts, raw tool arguments/results and chain-of-thought are not persisted in the staged report.

## Transport contract

Bump the internal staged provider transport envelope to `dsh-toolchain-staged-provider-transport-v2`.

Supported terminal kinds:

- `structured-tool`: measurement finalization succeeded and contains the canonical API claim;
- `unsupported`: measurement/finalization transport was attempted but did not satisfy its contract;
- `product-terminal`: the product phase terminated before measurement finalization for a recognized bounded product reason.

Initially the only recognized product terminal is:

- `tool_budget_exhausted` — product tool-call count exceeded the unchanged `MAX_PRODUCT_TOOL_CALLS = 31` budget.

The child must encode this terminal explicitly. It must not route it through `unsupported`.

## Execution projection

Each staged execution result separates `measurement` from `productOutcome`.

Measurement fields add:

- `measurementAttempted: boolean`.

Semantics:

- infrastructure failure: `hasModelOutcome=false`, `measurementAttempted=false`;
- product budget exhaustion: `hasModelOutcome=true`, `measurementAttempted=false`;
- structured/finalization transport attempt: `hasModelOutcome=true`, `measurementAttempted=true`;
- canonical resolved claim: `measurementAttempted=true`, `formatValid=true`, `decisionResolved=true`;
- malformed/unsupported finalization: `measurementAttempted=true`, `formatValid=false`;
- deterministic oracle mismatch after valid structured parsing: `measurementAttempted=true`, `formatValid=true`, `decisionResolved=false`.

Product outcome is explicit and closed:

- `completed` for observations that reached structured measurement finalization;
- `budget-exhausted` with reason `tool_budget_exhausted` for the bounded terminal.

`TASK_ADJUDICATION_UNRESOLVED` remains a product/claim outcome, not a measurement-health transport failure.

## Measurement health gate

The health gate is restricted to measurement-plane validity.

STOP conditions remain for:

- unrecovered infrastructure missingness above the frozen maximum;
- retry-attempt rate as currently governed if/when a hard threshold is configured;
- measurement-format compliance below the frozen minimum **among observations where measurement was attempted**.

The following are removed as STOP criteria:

- global deterministic-decision-resolution rate;
- B/C decision-resolution gap.

They are product diagnostics because an arm-dependent completion/resolution gap may be the treatment effect.

The gate must fail closed if a canary contains model outcomes but zero measurement attempts, preventing vacuous format PASS.

## Product metrics

Report schema becomes `dsh-toolchain-staged-eval-report-v3`.

It retains resolved-claim API validity for continuity, but adds non-censored bounded metrics.

### Bounded completion

For each arm:

- eligible denominator: observations with `hasModelOutcome=true` and no measurement-plane transport failure;
- success: product outcome `completed`;
- failure: recognized product terminal such as budget exhaustion.

This captures whether the agent can finish under the same execution budget.

### Bounded API success

For each arm:

- same eligible denominator as bounded completion;
- success only when a deterministic decision exists and `apiValid=true`;
- budget exhaustion, unresolved deterministic claim, or API-invalid claim count as non-success.

This is explicitly an **API-task engineering proxy**, not an independent end-to-end developer-task success metric.

### Paired contingency

Across task/repetition pairs where both arms are product-eligible, report:

- `bothSuccess`;
- `bOnly`;
- `cOnly`;
- `neither`;
- paired success-rate delta C−B.

No inferential p-value is added in this development PR. A future H2 design must preregister its paired statistical test and independent end-to-end success guardrail before outcomes.

## Safe per-observation receipt

Report v3 stores a deterministic `observations` array ordered by call ordinal. Each receipt contains only operational evidence:

- ordinal, taskId, arm, repetition;
- task domain and oracle kind;
- hasModelOutcome, measurementAttempted;
- product outcome / terminal reason;
- failure code if any;
- apiValid if adjudicated;
- attempts, infrastructureFailures;
- wallTimeMs;
- inputTokens, outputTokens, turns, providerCompletions;
- aggregate/ordinary/Toolchain tool-call counts and exact counts for `read_file`, `search_text`, `toolchain_contract_search`, `toolchain_contract_inspect`.

Explicitly excluded:

- prompt text;
- assistant reasoning or chain-of-thought;
- raw final prose;
- raw tool arguments/results;
- workspace/file contents;
- credentials or provider request/response bodies.

## Canary authorization semantics

The canary continues to authorize the remainder only when measurement health is PASS.

A product-budget exhaustion alone does **not** STOP the measurement plane. It remains visible in product metrics and per-observation receipts. Real provider/runner/format failure still stops the remainder fail-closed.

## Historical dev-v2 handling

Run `33948582894` remains immutable historical DEVELOPMENT_ONLY evidence. Its original report remains STOP under report-v2 semantics. A durable receipt will document why the STOP was caused by classification/censoring semantics and record only descriptive engineering observations already present in the artifact.

We do not rewrite the artifact, retroactively label the result confirmatory, or rerun merely to obtain a preferred outcome.

## Explicit non-goals

- no change to `MAX_PRODUCT_TOOL_CALLS = 31`;
- no production `src/` changes;
- no Contract Search ranking, abstention, IDF, proximity or evidence tuning;
- no provider/model change;
- no change to frozen dev-v2 task selection or commitment;
- no H1 rerun;
- no hidden H2 construction in this PR;
- no claim that bounded API success is end-to-end task success;
- no persistence of chain-of-thought or raw trajectory contents.

## Acceptance criteria

1. `tool_call_limit` is encoded/decoded as a recognized product terminal, never `STRUCTURED_TRANSPORT_UNSUPPORTED`.
2. Product-budget exhaustion does not lower measurement-format compliance or decision-health gates.
3. True malformed/unsupported measurement finalization still lowers measurement health and can STOP the canary.
4. Report v3 exposes bounded completion, bounded API success, paired contingency, per-arm costs/tool use and safe per-observation receipts.
5. Synthetic regression equivalent to dev-v2 canary (B 6 completed + 2 budget exhausted, C 8 completed) yields measurement PASS and product completion B=6/8, C=8/8.
6. No `src/` file changes.
7. Full repository CI passes on exact PR head and exact post-merge main SHA before the work is declared complete.
