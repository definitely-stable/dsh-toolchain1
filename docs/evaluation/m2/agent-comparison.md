# M2.3 controlled agent comparison

Status: preregistration protocol. This document defines the agent-level usefulness experiment for the exact canonical `@deepseek-ai/dsh@0.1.1-rc.2` Web target. It contains no H1 result and is not evidence that M2 has passed.

## Decision question

The experiment asks whether giving an otherwise equivalent exact-target agent access to DSH Toolchain Contract Intelligence materially reduces invalid concrete DSH API claims without materially reducing task success. The primary comparison is **C vs B**. Arm A is a memory-only reference and is not the M2 acceptance comparator.

## Frozen arms and causal boundary

- **A — memory:** no ordinary exact-target tooling and no Toolchain.
- **B — conventional exact-target:** the frozen conventional exact-target capability manifest.
- **C — conventional exact-target + Toolchain:** exactly the B capability manifest plus the production `toolchain_contract_search` and `toolchain_contract_inspect` model-facing definitions.

B and C use the same model/snapshot, system prompt, task prompt, ordinary evidence, static documentation, resource policy, retry policy and runner implementation. The only permitted model-visible B→C difference is the two Toolchain definitions. **C is never forced to call Toolchain**; usage is an observed runner trace, not a success requirement.

No arm receives oracle labels, expected symbols, hidden holdout answers, direct frozen-answer lookup or later-train API information.

## Exact target and oracle boundary

All arms are evaluated against:

- `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`
- `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`

`api-oracle-v1.json` is the API-validity oracle. Its classifications are `VALID`, `INVALID`, and `UNKNOWN`. **UNKNOWN is not INVALID** and is never silently converted to either valid or invalid. Later DSH source/documentation may be used only as drift-canary context and cannot override the canonical rc.2 oracle.

## Execution trust boundary

The tested model is not an authoritative source for how it was executed. Canonical P0 and H1 use an isolated runner that owns execution evidence.

### Runner-only `RunControl`

`RunControl` binds evaluation id, phase, task, arm, trial, attempt, exact target/index, dataset commitment, capability-manifest hash, resource/retry policy hashes, executor identity and model-envelope hash. These fields are control-plane state and are not copied into model-visible input.

### Model-visible `ModelEnvelope`

`ModelEnvelope` is constructed by allowlist projection only. Dataset tasks contribute only explicitly model-visible fields such as `id` and `prompt`; new dataset/oracle metadata cannot flow into the model automatically.

Required invariants:

- same task/arm across trials has byte-identical envelope;
- an infrastructure retry receives the same envelope as the original attempt;
- B and C envelopes differ only by the two Toolchain tool definitions;
- phase, arm, trial, attempt, retry state, commitments and evaluation identity are not model-visible control metadata.

### Exact capability manifests

Each arm has a content-addressed `CapabilityManifest`, not a prose/boolean approximation. It freezes ordinary tool names and schemas, adapter/backend identity, filesystem roots, read-only/reset policy, search behavior/truncation, static evidence identity and network policy. Validation proves C = B + exactly the production Toolchain search/inspect surface.

## Runner-owned execution evidence

Canonical execution produces a content-addressed evidence chain:

`RunControl + ModelEnvelope + TraceReceipt + IsolationReceipt + ResourceReceipt + ExecutorIdentity + raw answer`.

The tested executor may return only final model output plus provider-native completion metadata that the runner cannot independently observe. It cannot author authoritative tool events, isolation state, runner timestamps, retry classification or resource-compliance claims.

### TraceReceipt

Tool calls/results are recorded by runner-owned brokers. Every entry keeps re-hashable request/response content references, sequence, timestamps, status and tool identity. Toolchain calls additionally preserve exact target/index continuity. Arm policy is validated from this trace:

- A: no tool calls;
- B: no Toolchain calls;
- C: Toolchain calls limited to the exact production search/inspect definitions.

The C broker is built with `createContractSearchToolDefinition()` and `createContractInspectToolDefinition()` over frozen production-kernel resolvers. It does not expose an evaluator-specific ranker or cleaner internal API.

### IsolationReceipt

Every task × arm × trial begins with a fresh model session. The runner records no memory carry-over, workspace snapshot/reset mode, tool-state reset, immutable ordinary-evidence identity and non-shared mutable environment. Parallel runs may not share mutable state. Every retry also starts a fresh session/environment while retaining the failed attempt evidence.

### ResourceReceipt

Configured limits, observed usage, measurement source and compliance are separate. The runner controls wall time, turns, attempts and concurrency. Token compliance is enforceable only when the preregistered measurement route can actually support it; unavailable required measurement is `unverifiable`, never silently `compliant`.

## P0 calibration

`agent-pilot-p0.json` is public and non-scoring. P0 uses the **same isolated runner, capability manifests, trace/isolation/resource receipts and v2 result contract as H1**. It calibrates runner mechanics, prompt/tool wiring, evidence retention, oracle parsing, retry classification and resource accounting.

P0 results never contribute to the primary endpoint. A valid completed P0 result is `CALIBRATED`; it is never relabeled PASS or NEEDS-IMPROVEMENT. Harness-only corrections discovered by P0 are recorded and re-frozen before H1 commitment.

The MCID for Invalid API Task Rate and the task-success non-inferiority margin are frozen only after P0 calibration and before H1 commitment/execution.

## H1 commitment barrier

`agent-holdout-h1.commitment.json` is fail-closed. H1 MUST NOT run while `status` is `NOT_COMMITTED`.

Before H1 can run:

1. P0 calibration and any harness-only corrections are complete.
2. Primary MCID and task-success non-inferiority margin are numeric and frozen.
3. The hidden H1 task set is canonicalized and its SHA-256 commitment is published.
4. Exact model/snapshot/reasoning, runner, prompts, capability manifests, static evidence, oracle, resource/retry policies, run order and statistical configuration are content-addressed.
5. The execution-evidence contract is `m2-agent-eval-v2`.
6. No H1 model output has been observed.

After commitment, tasks, thresholds, oracle rules, arm semantics, trial aggregation, bootstrap configuration and decision rules cannot be changed in response to outcomes.

## Retry semantics and partial activity

Model-outcome retries are forbidden. `maxInfrastructureRetries = N` means N retries after the initial attempt, so at most `1 + N` attempts exist for one scheduled run.

An infrastructure retry is allowed only when the runner classifies the failure using a preregistered infrastructure reason **independently of answer quality**. Partial generation and partial tool activity remain in the failed attempt trace; retry never erases evidence. A retry uses the identical ModelEnvelope but a new model session and reset/fresh mutable environment.

If the allowed infrastructure path is exhausted without a model outcome, terminal evidence is `INCONCLUSIVE`. Infrastructure failure is never converted into a favorable model score.

## Evaluation artifact versioning

`m2-agent-eval-v1` remains immutable historical infrastructure from the earlier M2.3 work. It is not redefined retroactively.

**All newly executed canonical P0/H1 evidence uses `m2-agent-eval-v2`.** v2 preserves the useful v1 preregistration/schedule/retry/statistical invariants and additionally makes the persisted result self-auditing by binding each attempt to:

- `runControlSha256`;
- `modelEnvelopeSha256`;
- `traceSha256`;
- `executorIdentitySha256`;
- `isolationReceiptSha256`;
- `resourceReceiptSha256`;
- re-hashable raw-answer content.

A pre-finalization check whose execution evidence is discarded is insufficient. The canonical result must retain the evidence chain after the run is over.

## Primary endpoint and trial-to-task aggregation

For each model outcome, concrete DSH API claims are extracted deterministically and classified against `api-oracle-v1`.

Per trial, invalid API indicator is:

- `1` if at least one concrete API claim is `INVALID`;
- `0` if none is invalid and all claims required for the B/C decision are resolved;
- unresolved `UNKNOWN` cannot be coerced to 0/1 for a terminal B/C decision.

For each task/arm, the task-level invalid score is the mean of the three trial indicators. The paired task effect is `B - C`; positive favors Toolchain. H1 uses preregistered paired-task bootstrap. Confidence level, resample count and seed are frozen before H1. PASS requires the configured lower bound to meet or exceed the frozen MCID.

## Task-success guardrail

Task success is independent of API validity. Per trial: SUCCESS=1, FAILURE=0, UNKNOWN unresolved. Task-level score is the mean of three trials. Guardrail effect is `C - B`, evaluated with the preregistered paired-task bootstrap and frozen non-inferiority margin.

Any unresolved B/C API claim or task-success value prevents PASS/NEEDS-IMPROVEMENT and yields `INCONCLUSIVE` until an allowed preregistered adjudication path resolves it.

## Definition/result integrity

The exact v2 definition is canonicalized and content-addressed before execution. Result `definitionSha256` must match it exactly and all preregistered fields remain unchanged.

The run ledger matches the frozen schedule one-for-one and in order. Every attempt is retained. For every model attempt the v2 integrity validator checks the complete execution-evidence hashes and validates that embedded receipts bind the same RunControl. A metadata-only result, naked unverifiable hashes, discarded traces or a newly executed v1 result cannot satisfy canonical P0/H1 integrity.

## Outcome states

- **CALIBRATED:** P0 execution infrastructure completed validly; never an M2 usefulness result.
- **PASS:** H1 is valid/resolved; C meets the frozen C-vs-B MCID and task-success non-inferiority.
- **NEEDS-IMPROVEMENT:** H1 is valid/resolved but primary improvement or guardrail fails.
- **INCONCLUSIVE:** preregistered validity criteria prevent PASS/FAIL interpretation, including incomplete execution, unverifiable required resources or unresolved B/C evidence.

No repeated H1 execution is allowed merely to obtain a preferred outcome. Issue #34 and parent #28 remain open until valid committed H1 evidence qualifies under this protocol.
