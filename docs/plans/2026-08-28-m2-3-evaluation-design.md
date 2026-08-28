# M2.3 Contract Intelligence Evaluation — Design

**Status:** accepted design for Issue #34 / PR #35.

## Purpose

M2.3 is the exit evaluation for M2 Contract Intelligence. It must establish, with reproducible evidence, whether the existing production `contract.search -> contract.inspect` path reduces invalid DSH API use for agents working against an exact installed target. M2.3 evaluates production behavior; it must not introduce benchmark-specific retrieval behavior.

## Core principles

1. **Artifact truth first.** The canonical baseline is the registry-installable `@deepseek-ai/dsh@0.1.1-rc.2` Web profile. Published package bytes, manifests and shipped declarations are primary truth. Upstream commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` supplies documentation provenance and semantic explanation, not a fallback for missing package artifacts.
2. **Exact identities are preserved.** The evaluation uses a real `dsh-target-v2:<sha256>` and a real `dsh-contract-index-v1:<sha256>`. Synthetic target/index fingerprints are forbidden after the current RED scaffold.
3. **The full production contract universe is frozen before the corpus.** Corpus requirements never decide which contracts exist in the fixture.
4. **Capability and regression evidence are distinct.** The first retrieval corpus is a historical capability baseline. Critical solved cases may later move into a compact regression suite, but the historical baseline is immutable.
5. **Ranking and progressive semantics are evaluated separately.** `searchContractIndex()` is the only scorer for deterministic retrieval. A second conformance gate uses the real application kernel to prove `search -> inspect`, index continuity, evidence resolution and stale behavior.
6. **Agent usefulness is a controlled experiment.** The M2 exit decision is based on a preregistered comparison against a competent conventional exact-target coding agent, not on eyeballing retrieval scores or an LLM judge.
7. **CI stays deterministic and offline.** No model, npm registry, GitHub, reranker, embeddings or paid/network dependency runs in required CI.

## Canonical target and drift policy

Canonical M2.3 v1 target:

- package: `@deepseek-ai/dsh@0.1.1-rc.2`;
- upstream source/documentation commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`;
- profile: `web`;
- fixture-generation runtime: Node `24.19.x`, pnpm `11.7.0`, Linux x64;
- no user/home/overlay patches beyond the canonical installed profile.

Upstream `dsh-v0.1.2-alpha.1` / commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` is a **drift canary**, not a second M2.3 target. Its source/release changes may generate compatibility-watch evidence, but they do not alter the rc.2 baseline. Issue #33 owns any target-identity redesign required for `profile.patchReload` or later published trains.

## Frozen artifact fixture

A one-time generator uses the same M1/M2.1 acquisition and canonicalization code used by production. It installs/resolves the canonical target in an isolated temporary root, acquires the complete target and contract closure, strips only non-semantic machine locations, and persists evaluation facts plus a provenance manifest.

The manifest records at minimum:

- fixture schema/version;
- DSH package/version/profile and upstream documentation commit;
- package-manager/runtime/platform used for generation;
- resolved package inventory and registry/package integrity where available;
- package manifest/declaration content hashes;
- generator Toolchain commit;
- target fingerprint and contract-index fingerprint;
- generation and sanitization policy versions.

Generation is verified in two different temporary roots. Equivalent package bytes must yield identical target/index identities after non-semantic locations are removed. Missing shipped declarations are acquisition defects; the generator must never silently fill them from GitHub source.

## Deterministic retrieval evaluation

The metric model uses terminology that matches the actual mathematics:

- `Success@1`, `Success@3`, `Success@5`: fraction of answerable tasks whose top-k contains at least one acceptable contract;
- `MRR`: reciprocal rank of the first acceptable contract;
- `noResultCorrectness`: true no-result tasks returning an empty result;
- `forbiddenHitRateAt5`: tasks whose top-5 contains an explicitly wrong but existing contract.

These are macro task metrics. Multiple expected IDs are acceptable alternatives, not a complete relevance set, so calling the metric Recall@k is prohibited.

The initial R1 retrieval capability corpus targets about 36 tasks and must contain all existing linguistic categories plus orthogonal metadata: `domain`, `intentGroup`, `sourceKind`, and optional `riskTags` such as `version-drift`. Near-duplicate intent concentration is bounded; normally no more than three tasks share one `intentGroup`.

Every positive task has a reference route from developer intent to exact rc.2 declaration/evidence. A true no-result task has no useful exact-target replacement. An obsolete API with a valid replacement is an answerable version-drift task, not a no-result task.

R1 is committed before its first full production score is observed. Afterwards factual corrections are append-only errata backed by pinned provenance; score-driven edits are forbidden.

## Evidence sufficiency and progressive conformance

Retrieval success alone is insufficient. For representative tasks, evaluation declares required normalized facts/evidence and verifies that `inspect` returns enough authoritative evidence to justify the intended API decision. This produces a separate evidence-sufficiency diagnostic rather than contaminating Success@k.

A frozen evaluation kernel supplies immutable target/contract acquisition ports but uses production `createApplicationKernel()`. It proves:

- search and inspect expose the expected target fingerprint;
- the contract index fingerprint remains continuous across the loop;
- inspecting a returned ID returns that exact contract with resolvable evidence;
- changed contract evidence causes the existing stale response rather than silently inspecting a different index.

## Agent evaluation protocol

The agent experiment is split into three datasets:

- **R1 retrieval capability corpus**: public deterministic benchmark;
- **P0 pilot (~8 tasks)**: harness/scorer/tool-description/budget debugging only; never contributes to M2 outcome;
- **H1 acceptance holdout (~24 tasks)**: final M2 decision. Before execution only its canonical SHA-256 commitment and distribution metadata are committed; the tasks are published after the run so the commitment can be verified. An optional H1-R reserve may be committed the same way for a preregistered `INCONCLUSIVE` path.

Arms:

- **A — model memory:** task only, no DSH target/docs/Toolchain retrieval;
- **B — conventional exact-target agent:** exact rc.2 workspace plus ordinary file/read/search tools and pinned rc.2 documentation;
- **C — B plus DSH Toolchain:** identical to B, with `contract.search` and `contract.inspect` added. The agent is not forced to call them.

B is the primary comparator. C must demonstrate incremental value over an already competent exact-target coding workflow.

B and C share one resource envelope: model snapshot, reasoning configuration, maximum turns, wall time, model input/output budget, ordinary-tool policy, network policy, concurrency and retry policy. C may spend the same budget on Toolchain calls. Infrastructure failures may receive bounded retries; wrong/refused/model-generated outcomes do not receive retries.

Each task/arm runs three trials. Trial order is preregistered using a deterministic balanced/randomized schedule so provider or infrastructure drift does not align with one arm. Statistical analysis remains task-level; repeated trials measure stochastic consistency and are not treated as independent tasks.

## Agent scoring

Primary endpoint: **Invalid API Task Rate** — the fraction of tasks whose final answer contains at least one invalid DSH API claim.

Guardrail: task success for C must remain within a preregistered non-inferiority margin versus B, so the system cannot win by refusing to name useful APIs.

Secondary endpoints include consistency, valid-first-API-claim rate, tool/context usage, wall time, model tokens and cost.

An evaluation-only API oracle is generated primarily from shipped rc.2 declarations and enriched manually only for semantic aliases, obsolete/replacement mappings and task-specific interpretation. Claim classifications are `VALID`, `INVALID` or `UNKNOWN`; UNKNOWN is never automatically treated as invalid and requires adjudication. LLM judges may be used for qualitative clustering only, never for the primary PASS/FAIL decision.

The canonical agent response remains deployment-like normal developer prose/code. The model is not required to emit an eval-specific `apiClaims[]` schema. A deterministic extractor identifies DSH-shaped imports/types/members/method/event/service claims for oracle scoring; unresolved claims enter append-only adjudication records.

## Preregistration and decision

Before the first H1 model call, commit a content-addressed experiment definition containing hashes/identities for:

- target and ContractIndex;
- H1 commitment;
- model and reasoning configuration;
- system/task prompts;
- Toolchain tool names/descriptions/input schemas;
- B static documentation/common workspace policy;
- resource and retry envelope;
- run-order seed/schedule;
- oracle and scorer versions;
- primary metric, minimum product-relevant effect (MCID), task-success guardrail and uncertainty procedure.

The definition receives an evaluation-only identity such as `dsh-m2-agent-eval-v1:<sha256>`.

Possible outcomes are `PASS`, `NEEDS-IMPROVEMENT`, or `INCONCLUSIVE`. PASS requires the preregistered C-vs-B improvement and guardrails. NEEDS-IMPROVEMENT freezes the evidence and moves ranking changes to a separate issue/PR. INCONCLUSIVE may use only a preregistered reserve/extension path; it never permits rerunning until a desired answer appears.

## Persistence and CI

Historical capability baselines and agent definitions/results are immutable machine-readable evidence with human-readable reports. Current regression checks assert semantic guarantees and critical top-k/no-result constraints rather than exact full ranked-list equality.

Required CI verifies fixture/corpus/schema integrity, content hashes, target/index identity, metric arithmetic, deterministic production retrieval, evidence sufficiency, search/inspect/stale conformance, experiment-definition/result integrity and append-only adjudication consistency across supported Node lanes. Model/network execution remains outside required CI.

## Non-goals

M2.3 does not add embeddings, vector storage, semantic reranking, a second production scorer, a hosted evaluation dependency, a Python evaluation stack, permanent secret benchmark infrastructure, full multi-version/multi-model matrices, or production APIs for evaluation-only concerns.
