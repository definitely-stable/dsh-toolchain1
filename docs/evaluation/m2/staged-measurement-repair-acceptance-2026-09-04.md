# M2 staged measurement repair acceptance — 2026-09-04

Status: **PASS**

This receipt records the bounded real-provider acceptance event for the staged structured-result transport repair in Issue #176 / PR #177. It is development evidence only. It does not change the historical H1 result, does not authorize an H1 rerun, and is not H2 confirmatory evidence.

## Bound evidence

- workflow run: `33839417550` (`M2 Staged Development Evaluation`);
- workflow event: `workflow_dispatch`;
- mode: `canary`;
- tested commit: `cd0df441f3cd49bbed1b1fca7db7bf5721c57c7b`;
- artifact: `9924472353`, `m2-staged-eval-33839417550-1`;
- artifact digest: `sha256:db851b2e0a377c05c812252b695577f39f53bed80e7d6876f06ab31050c3e2e1`;
- corpus evidence class: `DEVELOPMENT_ONLY`;
- provider: `opencode-go`;
- provider base URL: `https://opencode.ai/zen/go/v1`;
- request/response model: `deepseek-v4-flash` / `deepseek-v4-flash`;
- backend identity strength: `response-model-only`;
- reasoning effort: `high`;
- thinking: enabled.

The same exact repair head had already completed repository CI successfully in run `33837513545` before this provider-backed acceptance event.

## Fresh provider capability probe

The run-local probe completed before the canary and verified the exact staged boundary used by the evaluator:

- function tool call: `verified`;
- reasoning continuation: `verified`;
- token measurement: `verified`;
- named staged `tool_choice`: `verified`;
- strict staged result schema: `verified`;
- probe input/output tokens: 1505 / 186.

The probe therefore validated the claim-only strict finalizer without exposing evaluator-owned task identity to model output.

## Execution

The canary completed **16 / 16** scheduled B/C model observations:

- B: 8 observations;
- C: 8 observations;
- model calls: 16;
- attempts: 16;
- retries: 0;
- infrastructure failures: 0;
- unrecovered infrastructure observations: 0;
- provider completions: 147;
- product tool calls: 223;
- measurement tool calls: 16;
- wall time: 240036 ms;
- input tokens: 861022;
- output tokens: 47879;
- legacy turns: 239.

Authorization remained bounded exactly as designed:

- planned calls: 16;
- canary calls: 16;
- remainder planned: 0;
- remainder authorized: 0;
- executed calls: 16.

No `dev`, `release`, `research`, or confirmatory remainder was executed by this canary receipt.

## Measurement health

The health gate returned `PASS` with no reasons.

Observed health:

- model outcomes: 16 / 16;
- structured-format-valid observations: **16 / 16 = 100%**;
- resolved decisions: **16 / 16 = 100%**;
- B resolution: 8 / 8 = 100%;
- C resolution: 8 / 8 = 100%;
- unrecovered infrastructure rate: 0%;
- B/C decision-resolution gap: 0 percentage points;
- failure diagnostics: 0.

All 16 model outcomes terminated through the repaired canonical transport reason:

- `structured_measurement_finalized`: 16 / 16;
- B: 8;
- C: 8;
- missing terminal reasons: 0.

This is the acceptance evidence required for the repaired two-phase structured measurement channel: product exploration and measurement finalization are separated, the model returns only the semantic claim, and evaluator transport owns the exact scheduled task identity, result schema, and one-claim cardinality.

## Product signal in this canary

Because measurement health passed, the 16 canary observations are mechanically interpretable:

- resolved product observations: 16;
- API-valid observations: 16 / 16;
- task-success observations: 16 / 16;
- paired tasks: 8;
- B API-valid / task-success: 8 / 8 and 8 / 8;
- C API-valid / task-success: 8 / 8 and 8 / 8;
- paired C-minus-B delta: 0 for API validity and 0 for task success.

This receipt does **not** claim that B and C are equivalent or that C has no product benefit. A 16-observation transport canary with both arms at the ceiling is not a powered product-effect experiment. Its acceptance purpose is measurement health and transport correctness.

## Acceptance interpretation

Issue #176's transport acceptance gate is satisfied by this event:

- exact final repair head had green deterministic repository CI;
- a fresh managed-provider capability probe verified the strict claim-only finalizer;
- exactly one fresh bounded 16-observation canary executed on that head;
- measurement health returned `PASS`;
- format compliance and decision resolution were 16 / 16;
- no infrastructure failure or retry occurred;
- no remainder was authorized;
- the result used the canonical `structured_measurement_finalized` path for all 16 outcomes.

This acceptance closes the staged measurement **transport repair** only. It does not establish a confirmatory B/C product claim, does not reopen historical P0/H1 evidence, and does not authorize H1 execution.

H1 remains immutable and `INCONCLUSIVE`. The disclosed H1-derived development corpus remains `DEVELOPMENT_ONLY` and MUST NOT be reused as an unseen H2 holdout.
