# M2.3 controlled agent comparison

Status: preregistration protocol. This document defines the agent-level usefulness experiment for the exact canonical `@deepseek-ai/dsh@0.1.1-rc.2` Web target. It does not contain an H1 result and must not be interpreted as evidence that M2 has passed.

## Decision question

The experiment asks whether giving an otherwise equivalent exact-target agent access to DSH Toolchain Contract Intelligence materially reduces invalid concrete DSH API claims without materially reducing task success.

The primary comparison is **C vs B**. Arm A exists as a memory-only reference and is not the M2 acceptance comparator.

## Frozen arms

- **A — memory:** model answers from its pre-existing model context. Ordinary repository/file/docs tooling is unavailable and DSH Toolchain is unavailable.
- **B — conventional exact-target:** same model, prompts, limits and runner as C. The agent has ordinary exact-target file/search/docs access, but no DSH Toolchain Contract Intelligence.
- **C — conventional exact-target + Toolchain:** identical to B, plus `contract.search` and `contract.inspect` bound to the exact frozen target/index. **C is never forced to call Toolchain**; tool use is an observed behavior, not a success requirement.

No arm receives privileged oracle labels, hidden holdout answers or later-train API information.

## Exact target and oracle boundary

All arms are evaluated against the frozen rc.2 Web target identified by:

- `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`
- `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`

`api-oracle-v1.json` is the only API-validity oracle. Its classifications are `VALID`, `INVALID`, and `UNKNOWN`. **UNKNOWN is not INVALID** and may not be coerced into INVALID to improve measured separation. Concrete declaration claims are adjudicated from the complete frozen artifact universe; runtime/behavioral claims outside captured authoritative evidence remain UNKNOWN unless an append-only adjudication was recorded before outcome unblinding.

Later DSH source or documentation may be used only as drift-canary context and cannot override the canonical rc.2 oracle.

## P0 calibration

`agent-pilot-p0.json` is public and non-scoring. It exists only to calibrate the experiment machinery: runner behavior, prompt/tool wiring, transcript capture, oracle parsing, bounded infrastructure retry classification and resource accounting.

P0 may reveal defects in the evaluation harness. It must not be counted toward M2 PASS/FAIL. A completed P0 result uses the distinct terminal status `CALIBRATED`; it is never relabeled PASS or NEEDS-IMPROVEMENT.

The **MCID** for Invalid API Task Rate and the task-success **non-inferiority** margin are frozen only after P0 calibration is complete and before H1 is committed or executed. The holdout task set may not be rewritten in response to H1 outcomes.

## H1 commitment barrier

`agent-holdout-h1.commitment.json` is fail-closed. **H1 MUST NOT run while `status` is `NOT_COMMITTED`.**

Before H1 can become runnable, all of the following must be true in one immutable preregistration boundary:

1. P0 calibration is complete and any harness-only corrections are recorded.
2. The primary MCID is numeric and frozen.
3. The task-success non-inferiority margin is numeric and frozen.
4. The final hidden H1 task set is serialized canonically and its SHA-256 commitment is published.
5. The exact model, model snapshot, reasoning mode, runner/harness version, prompts, tool schemas, static-doc identity, oracle identity, resources, retry policy, deterministic run-order definition and statistical analysis configuration are content-addressed.
6. No H1 model output has been observed.

After that boundary, H1 tasks, thresholds, oracle rules, arm semantics, trial aggregation, bootstrap configuration and decision rules cannot be changed in response to outcomes. Corrections require an explicit erratum and invalidate the affected run unless the preregistered reserve/extension rule permits otherwise.

## Execution and retries

Every task/arm uses the same global resource envelope. Each task/arm is executed exactly **three trials** using the deterministic balanced schedule derived from the preregistered seed. The **analysis unit is the task**. Trials measure stochastic consistency and are aggregated within each task/arm; they are not treated as independent task samples.

Model-outcome retries are forbidden. Only bounded infrastructure retries are allowed, only for preregistered infrastructure classes such as provider transport, tool transport or runner infrastructure. `maxInfrastructureRetries = N` means **N retries after the initial attempt**, so a run may contain at most `1 + N` attempts total. Every attempt, including failed infrastructure attempts, must be retained. A retry never erases the original attempt.

A terminal `CALIBRATED`, `PASS`, or `NEEDS-IMPROVEMENT` result requires every frozen schedule entry to end in exactly one model outcome. If any scheduled run exhausts the allowed infrastructure path without a model outcome, the experiment evidence is **INCONCLUSIVE**. Infrastructure failure is never converted into a favorable model score.

## Primary endpoint and trial-to-task aggregation

For each model outcome, concrete DSH API claims are deterministically extracted and classified against `api-oracle-v1`.

For each trial, define the **invalid API indicator**:

- `1` if the final answer contains at least one concrete API claim classified `INVALID`;
- `0` if it contains no `INVALID` claim and every extracted claim needed for the B/C decision is resolved;
- unresolved `UNKNOWN` claims are never converted to `0` or `1` for a terminal B/C decision.

For each task and arm, the task-level invalid score is the arithmetic mean of its three trial invalid indicators. The primary paired task effect is:

`B task invalid score - C task invalid score`

so a positive value favors Toolchain. The aggregate primary estimand is the mean of those paired task effects across H1 tasks.

Uncertainty is preregistered in the exact experiment definition as **paired-task bootstrap**. Its confidence level, resample count and deterministic seed are frozen before the first H1 outcome. The H1 primary decision rule is `lower-bound-at-least-mcid`: the configured confidence lower bound for the C-vs-B absolute reduction must be at least the frozen MCID.

If a B or C result still contains an API claim classified `UNKNOWN` after the preregistered adjudication boundary, H1 cannot be reported as PASS or NEEDS-IMPROVEMENT from that evidence; the result remains **INCONCLUSIVE**. UNKNOWN is therefore neither silently penalized nor silently rewarded.

## Task-success guardrail

Task success is evaluated independently from API validity. For each trial, define the task-success indicator:

- `1` for `SUCCESS`;
- `0` for `FAILURE`;
- `UNKNOWN` is unresolved evidence and is not coerced to either value.

For each task and arm, the task-level success score is the arithmetic mean of the three trial success indicators. The paired guardrail effect is:

`C task success score - B task success score`.

The guardrail uses the same preregistered paired-task bootstrap family, with its own frozen seed/configuration in the definition. Its decision rule is `lower-bound-at-least-negative-margin`: the configured confidence lower bound must be at least the negative frozen non-inferiority margin.

A B/C `taskSuccess: UNKNOWN` prevents a terminal PASS or NEEDS-IMPROVEMENT classification and forces **INCONCLUSIVE** until a preregistered valid adjudication path resolves it. A reduction in invalid API claims therefore cannot qualify as M2 PASS by refusing useful work, omitting required answers or dropping uncertain outcomes.

Secondary diagnostics may include Toolchain invocation rate, search/inspect continuity, invalid-claim categories, UNKNOWN rate, token use, turns and latency, but none may replace or redefine the frozen primary endpoint or guardrail after H1 commitment.

## Definition/result integrity

The exact experiment definition is canonicalized and SHA-256 content-addressed before H1 execution. The recorded result must carry that exact `definitionSha256` and preserve every preregistered field unchanged.

The result run ledger must match the frozen schedule **one-for-one and in the frozen order**: no missing run, extra run, duplicate run or reordered task/arm/trial entry is accepted. `dataset.taskCount` must agree with the unique tasks represented by the schedule. Every attempt remains visible, and the retry ledger is validated against the frozen retry policy.

Raw model answers are content-addressed; parsed API claims and task-success classifications are retained as auditable result evidence. A metadata-only PASS without run evidence is invalid.

## Outcome states

- **PASS:** all required decision evidence is resolved; C meets or exceeds the frozen C-vs-B MCID under the preregistered paired-task uncertainty rule and satisfies task-success non-inferiority.
- **NEEDS-IMPROVEMENT:** all required decision evidence is resolved and the experiment is valid, but the primary improvement or guardrail fails.
- **INCONCLUSIVE:** preregistered validity criteria prevent a PASS/FAIL interpretation, including incomplete scheduled execution or unresolved B/C API/task-success evidence; only a preregistered reserve/extension path may add evidence.

No repeated H1 execution is allowed merely to obtain a preferred outcome. Parent Issue #28 remains open until a valid committed H1 result qualifies under this rule.
