# M2.3 Contract Intelligence Evaluation — Design

**Status:** accepted design for Issue #34 / PR #35, amended by Issue #36 / PR #37 for runner-owned agent execution evidence.

## Purpose

M2.3 is the exit evaluation for M2 Contract Intelligence. It must establish, with reproducible evidence, whether the existing production `contract.search -> contract.inspect` path reduces invalid DSH API use for agents working against an exact installed target. M2.3 evaluates production behavior; it must not introduce benchmark-specific retrieval behavior.

## Core principles

1. **Artifact truth first.** The canonical baseline is registry-installable `@deepseek-ai/dsh@0.1.1-rc.2` Web. Published package bytes, manifests and shipped declarations are primary truth.
2. **Exact identities are preserved.** Evaluation uses real `dsh-target-v2:<sha256>` and `dsh-contract-index-v1:<sha256>` identities.
3. **The full production contract universe is frozen before the corpus.** Corpus requirements never decide which contracts exist.
4. **Capability and regression evidence are distinct.** Historical capability baselines are immutable; later regression suites may evolve conservatively.
5. **Ranking and progressive semantics are evaluated separately.** `searchContractIndex()` is the deterministic scorer; a real-kernel conformance gate proves `search -> inspect`, evidence continuity and stale behavior.
6. **Agent usefulness is a controlled experiment.** M2 exit is based on a preregistered comparison against a competent conventional exact-target coding agent, not eyeballed retrieval scores or an LLM judge.
7. **Execution evidence is runner-owned.** The tested model cannot be authoritative for its own tool use, isolation, timing, retry classification or resource compliance.
8. **CI stays deterministic and offline.** Required CI makes no model, registry, GitHub, reranker, embedding or paid-network calls.

## Canonical target and drift policy

Canonical M2.3 target:

- package: `@deepseek-ai/dsh@0.1.1-rc.2`;
- documentation/source provenance: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`;
- profile: `web`;
- fixture-generation runtime: Node `24.19.x`, pnpm `11.7.0`, Linux x64;
- no user/home/overlay patches beyond the canonical installed profile.

Upstream `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc` is a drift canary, not a second M2.3 target. Issue #33 owns target-identity changes required by later lifecycle semantics.

## Frozen artifact fixture

A one-time generator uses production M1/M2.1 acquisition/canonicalization. It resolves the canonical target in an isolated root, acquires the complete target/contract closure, strips only non-semantic machine locations and persists evaluation facts plus provenance.

The fixture records package/profile/runtime provenance, resolved inventory, package/declaration hashes, Toolchain generator commit, target fingerprint, ContractIndex fingerprint and generation/sanitization policy. Equivalent bytes generated in different roots must yield the same semantic identities. Missing shipped declarations are acquisition defects; GitHub source is never a fallback.

## Deterministic retrieval evaluation

Metrics match their actual mathematics:

- `Success@1`, `Success@3`, `Success@5`;
- `MRR`;
- `noResultCorrectness`;
- `forbiddenHitRateAt5`.

R1 is a frozen public capability corpus with linguistic categories plus `domain`, `intentGroup`, `sourceKind` and optional risk tags. Positive tasks have exact artifact-backed reference routes. True no-result tasks have no useful exact-target replacement. R1 was frozen before its first production score and is immutable except explicit factual errata.

## Evidence sufficiency and progressive conformance

Retrieval score alone is insufficient. Evaluation separately proves that required authoritative facts exist in the frozen index and that the real application kernel preserves target/index identity through `search -> inspect`; changed contract evidence must produce stale rather than silently inspect a different index.

## Agent datasets

- **R1:** public deterministic retrieval capability corpus.
- **P0:** public, non-scoring execution/harness calibration corpus. It never contributes to M2 PASS/FAIL.
- **H1:** hidden committed acceptance holdout. Before execution only its canonical commitment/distribution metadata are public; tasks are revealed after the run to verify commitment. A reserve/extension set may be used only through a preregistered `INCONCLUSIVE` path.

## Agent arms

- **A — memory:** no ordinary exact-target evidence tools and no Toolchain.
- **B — conventional exact-target:** exact rc.2 conventional evidence/tool capability manifest.
- **C — B plus Toolchain:** exactly B plus production `toolchain_contract_search` and `toolchain_contract_inspect` definitions.

B is the primary comparator. B and C share exact model/snapshot/reasoning, prompts, ordinary evidence, runner, resource policy, retry policy and execution environment. C differs only by the two content-addressed Toolchain definitions and is not forced to call them.

## Isolated runner-owned execution

Actual P0 and H1 execution use the same isolated evidence boundary.

### RunControl vs ModelEnvelope

Runner-only `RunControl` contains evaluation id, phase, task/arm/trial/attempt, exact target/index, commitments and hashes of capability/resource/retry/executor/model-envelope configuration.

Model-visible `ModelEnvelope` is created by allowlist projection only and contains only prompt/task/static context/tool surface intended for the model. Control-plane evaluation metadata does not leak into it. Same task/arm has an identical envelope across trials and retries; B/C envelopes differ only in the two Toolchain definitions.

### CapabilityManifest

Each arm freezes exact ordinary tool names/schemas, backend/version, allowed roots, read-only/reset/search/truncation behavior, static evidence identity, network policy and model-visible Toolchain definitions when applicable. Validation proves C = B + exactly the production Toolchain search/inspect surface.

### Runner-owned receipts

The runner/brokers create:

- `TraceReceipt` for actual tool calls/results and re-hashable request/response bytes;
- `IsolationReceipt` proving fresh model session, no memory carry-over, workspace/tool reset and non-shared mutable state;
- `ResourceReceipt` separating configured limits, observed usage, measurement source and compliance;
- content-addressed executor identity and raw model output.

The tested executor returns only final model output plus provider-native completion metadata that the runner cannot directly observe. It does not supply authoritative tool/isolation/resource evidence.

Arm C uses the production `createContractSearchToolDefinition()` and `createContractInspectToolDefinition()` factories over frozen production-kernel resolvers, preserving the real request parsing, schemas, limits, response DTOs and stale semantics.

## Retry and partial activity

Each task/arm runs three trials on the preregistered balanced schedule. Analysis remains task-level.

Model-outcome retries are forbidden. `maxInfrastructureRetries=N` means N retries after the initial attempt. Infrastructure classification must use preregistered reasons independently of answer quality. Partial output/tool activity remains attached to the failed attempt. Retry uses the same ModelEnvelope but a fresh model session and reset/fresh mutable environment. Exhaustion without a model outcome yields `INCONCLUSIVE`.

## Agent scoring

Primary endpoint is **Invalid API Task Rate**. Guardrail is task success under a preregistered non-inferiority margin. Three trials are aggregated within each task/arm; paired task effects are analyzed with preregistered paired-task bootstrap.

The API oracle is built from shipped rc.2 evidence with `VALID | INVALID | UNKNOWN`; UNKNOWN is never silently coerced. LLM judges may assist qualitative analysis only, never the primary decision. Model output remains deployment-like prose/code; deterministic extraction/adjudication happens after the recorded model outcome.

## Preregistration and result versioning

Before H1, the definition freezes/content-addresses target/index, H1 commitment, model/reasoning, runner/executor identities, prompts, exact capability manifests, static evidence, resource/retry policies, run schedule, oracle/scorer and all primary/guardrail/uncertainty parameters.

`m2-agent-eval-v1` is immutable historical infrastructure from PR #35. **All newly executed canonical P0/H1 uses `m2-agent-eval-v2`.**

Each v2 model attempt retains re-hashable execution evidence bound to its exact RunControl:

- model envelope;
- trace;
- executor identity;
- isolation receipt;
- resource receipt;
- raw answer;
- partial output for applicable infrastructure failures.

The v2 result preserves the valuable v1 invariants: exact definition hash, unchanged preregistration, frozen schedule coverage/order, contiguous `1 + N` retry ledger, one terminal model outcome, `UNKNOWN/INCONCLUSIVE` semantics and task-level statistical configuration. A newly executed v1 record is insufficient because it cannot retain the runner-owned execution-evidence chain.

## Decision

Possible H1 outcomes are `PASS`, `NEEDS-IMPROVEMENT`, or `INCONCLUSIVE`. PASS requires the preregistered C-vs-B improvement and task-success guardrail. P0 ends only as `CALIBRATED` or `INCONCLUSIVE` and never contributes to the M2 endpoint.

No repeated H1 run is allowed merely to obtain a preferred result. Issue #34 and parent #28 remain open until a valid committed H1 result qualifies under the frozen protocol.

## Persistence and CI

Historical retrieval baselines and agent definitions/results are immutable machine-readable evidence. Required CI verifies fixture/corpus/schema integrity, hashes/identities, production retrieval, evidence sufficiency, search/inspect/stale semantics and v2 definition/result execution-chain integrity across supported Node lanes. Model execution remains outside required CI.

## Non-goals

M2.3 does not add embeddings, vector storage, semantic reranking, a second production scorer, hosted evaluation dependency, Python evaluation stack, provider-specific SDK in this infrastructure slice, generic agent orchestration framework, permanent secret benchmark service, broad multi-version/model matrices, retrieval tuning or production APIs for evaluation-only concerns.
