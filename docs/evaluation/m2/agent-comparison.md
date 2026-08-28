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

P0 may reveal defects in the evaluation harness. It must not be counted toward M2 PASS/FAIL. The holdout task set may not be rewritten in response to H1 outcomes.

The **MCID** for Invalid API Task Rate and the task-success **non-inferiority** margin are frozen only after P0 calibration is complete and before H1 is committed or executed.

## H1 commitment barrier

`agent-holdout-h1.commitment.json` is fail-closed. **H1 MUST NOT run while `status` is `NOT_COMMITTED`.**

Before H1 can become runnable, all of the following must be true in one immutable preregistration boundary:

1. P0 calibration is complete and any harness-only corrections are recorded.
2. The primary MCID is numeric and frozen.
3. The task-success non-inferiority margin is numeric and frozen.
4. The final hidden H1 task set is serialized canonically and its SHA-256 commitment is published.
5. The exact model, model snapshot, reasoning mode, runner/harness version, prompts, tool schemas, static-doc identity, oracle identity, resources, retry policy and deterministic run-order definition are content-addressed.
6. No H1 model output has been observed.

After that boundary, H1 tasks, thresholds, oracle rules, arm semantics and analysis rules cannot be changed in response to outcomes. Corrections require an explicit erratum and invalidate the affected run unless the preregistered reserve/extension rule permits otherwise.

## Execution and retries

Every task/arm uses the same global resource envelope. The planned analysis uses three trials per task/arm with a deterministic balanced/randomized schedule derived from the preregistered seed. The **analysis unit is the task**, not each trial as an independent sample.

Model-outcome retries are forbidden. Only bounded infrastructure retries are allowed, only for preregistered infrastructure classes such as provider transport, tool transport or runner infrastructure. Every attempt, including failed infrastructure attempts, must be recorded. A retry never erases the original attempt.

## Primary endpoint

For each task, concrete API claims are extracted and classified against `api-oracle-v1`. The primary endpoint is **Invalid API Task Rate**: the proportion of scored tasks on which an arm produces at least one concrete `INVALID` API claim.

Acceptance requires C to improve over B by at least the frozen absolute-reduction MCID. UNKNOWN claims do not count as INVALID; they are reported separately.

## Guardrail

Task success is evaluated separately from API validity. C must satisfy the preregistered task-success **non-inferiority** margin relative to B. A reduction in invalid API claims cannot qualify as M2 PASS if it is achieved by refusing useful work, omitting required answers or otherwise violating the task-success guardrail.

Secondary diagnostics may include Toolchain invocation rate, search/inspect continuity, invalid-claim categories, UNKNOWN rate, token use, turns and latency, but none may replace the frozen primary endpoint or guardrail after H1 commitment.

## Outcome states

- **PASS:** C meets or exceeds the frozen C-vs-B MCID and satisfies task-success non-inferiority.
- **NEEDS-IMPROVEMENT:** the experiment is valid but the primary improvement or guardrail fails.
- **INCONCLUSIVE:** preregistered validity criteria prevent a PASS/FAIL interpretation; only a preregistered reserve/extension path may add evidence.

No repeated H1 execution is allowed merely to obtain a preferred outcome. Parent Issue #28 remains open until a valid committed H1 result qualifies under this rule.
