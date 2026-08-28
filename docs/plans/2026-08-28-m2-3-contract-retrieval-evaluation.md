# M2.3 Contract Intelligence Evaluation — Implementation Plan

> **For agentic workers:** use TDD for every behavioral evaluator change. This slice measures production M2; it must not alter production retrieval/ranking to improve observed scores.

**Goal:** build a reproducible, artifact-grounded evaluation that measures production Contract Intelligence and preregisters a controlled agent comparison capable of deciding whether M2 is complete.

**Architecture:** registry-artifact fixture → deterministic retrieval/evidence evaluation → real-kernel `search -> inspect` conformance → preregistered agent usefulness experiment. Required CI stays deterministic/offline; actual model runs are recorded separately as versioned evidence.

**Tech Stack:** TypeScript 6, Vitest 4, existing M1/M2 model/kernel/acquisition code, JSON Schema + AJV, Node 22.19+/24/26 CI, pnpm 11.7.

**Spec:** `docs/plans/2026-08-28-m2-3-evaluation-design.md`; Issue #34; parent #28; ADR-0008; protocol/architecture/development docs.

## Global constraints

- Base production behavior is M2.2 squash `d3162bd72bcd84ec8c422108be1e7c529a1a59f6`.
- Canonical target is registry-installable `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`, source/docs provenance `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- Frozen target: `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`.
- Frozen Contract Index: `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`.
- GitHub prerelease/source `dsh-v0.1.2-alpha.1` / `cd5ef814...` is drift-canary evidence only; Issue #33 owns target-identity redesign for `profile.patchReload`.
- Production `searchContractIndex()` is the only ranking implementation used by evaluation.
- No embeddings, reranker, vector DB, model/network call, external judge or persistent search service in required CI.
- Frozen full contract facts precede corpus construction; corpus may never decide which contracts exist.
- Historical baselines are immutable. Corrections require pinned factual provenance and explicit errata.
- Parent #28 remains open until real preregistered H1 agent evidence qualifies.

---

## Task 1 — Correct metric semantics without changing arithmetic

**Status:** complete.

Files:
- `tests/evaluation/m2-retrieval-metrics.ts`
- `tests/evaluation/m2-retrieval-metrics.spec.ts`

- [x] RED asserted `successAt*` / `forbiddenHitRateAt5` terminology instead of misleading Recall/wrong-contract names.
- [x] RED was isolated to old field names.
- [x] Evaluator names changed without changing arithmetic.
- [x] Focused/full CI returned GREEN.

## Task 2 — Artifact-grade frozen rc.2 fixture boundary

**Status:** complete.

Files include:
- `tests/evaluation/m2-retrieval-index.ts`
- `tests/evaluation/m2-retrieval-index.spec.ts`
- `tests/evaluation/fixtures/m2/rc2-web-v1/manifest.json`
- `tests/evaluation/fixtures/m2/rc2-web-v1/target-facts.json`
- `tests/evaluation/fixtures/m2/rc2-web-v1/contract-facts.json`

- [x] Structural RED rejected synthetic target/index identities, malformed provenance and unresolved evidence.
- [x] Frozen facts came from the canonical registry artifact/dependency closure rather than corpus-selected contracts.
- [x] Non-semantic machine locations were excluded while semantic identity remained stable under equivalent ordering.
- [x] Exact target/index fingerprints were frozen and CI returned GREEN.

## Task 3 — Freeze R1 before observing scores

**Status:** complete; R1 is immutable baseline evidence.

Files:
- `tests/evaluation/m2-retrieval-corpus.ts`
- `tests/evaluation/m2-retrieval-corpus.spec.ts`
- `tests/evaluation/m2-retrieval-metrics.ts`

- [x] Corpus validation covers orthogonal metadata, concentration/duplication, no-result semantics and pinned reference routes.
- [x] R1 contains 36 rc.2 tasks across exact, package/API, natural-language, indirect, ambiguity/confusion and version-drift/no-result behavior.
- [x] R1 was committed/frozen before the first complete production-scoring run.

## Task 4 — Measure production retrieval and evidence sufficiency

**Status:** complete; first-run baseline is immutable.

Files:
- `tests/evaluation/m2-retrieval.spec.ts`
- `tests/evaluation/m2-evidence-sufficiency.spec.ts`
- `docs/evaluation/m2/retrieval-baseline-v1.json`
- `docs/evaluation/m2/retrieval-report.md`

- [x] Every R1 task runs only through production `searchContractIndex(index, query, undefined, 5)`.
- [x] Determinism, metric bounds and repeated-order equivalence are asserted without asserting a desired score.
- [x] Required contract/evidence checks distinguish retrieval gaps from acquisition gaps.
- [x] Immutable per-task ranked ids and aggregate/category/domain metrics were recorded.
- [x] Full exact ranking is historical evidence, not a permanent desired-ranking regression contract.

First observed baseline before tuning:
- Success@5 `56.25%`;
- MRR `54.6875%`;
- exact-symbol `100%`;
- package/API `100%`;
- no-result `100%`;
- natural-language `0%`;
- indirect `0%`;
- forbidden-hit rate@5 `20%`.

## Task 5 — Prove the real production `search -> inspect` loop

**Status:** complete.

Files:
- `tests/evaluation/m2-search-inspect.spec.ts`
- `tests/evaluation/m2-search-inspect-fixture.ts`

- [x] Evaluation ports return frozen target/contract facts while invoking production `createApplicationKernel()`.
- [x] Search/inspect target fingerprint, index fingerprint, contract identity and evidence resolution remain continuous.
- [x] Contract-evidence drift after search produces existing stale semantics during inspect.
- [x] Evaluation ports remain test-only; no production abstraction was added.

## Task 6 — Version agent schema, oracle and P0/H1 protocol

**Status:** infrastructure complete; actual P0/H1 execution remains external evidence work.

Files:
- `docs/evaluation/m2/m2-agent-eval-v1.schema.json`
- `tests/evaluation/m2-agent-eval-schema.spec.ts`
- `tests/evaluation/m2-agent-eval-documents.spec.ts`
- `docs/evaluation/m2/agent-comparison.md`
- `docs/evaluation/m2/api-oracle-v1.json`
- `docs/evaluation/m2/agent-pilot-p0.json`
- `docs/evaluation/m2/agent-holdout-h1.commitment.json`

- [x] JSON Schema requires exact target/index, model/harness/tool/resource/retry identities, run-order controls and decision metrics.
- [x] Result records require definition binding, execution time and auditable per-run attempts instead of accepting metadata-only PASS records.
- [x] A=memory, B=conventional exact-target ordinary tools, C=B+Toolchain; C is not forced to call Toolchain.
- [x] P0 is public/non-scoring calibration with terminal status `CALIBRATED`; H1 is the acceptance holdout.
- [x] Oracle classifications are `VALID|INVALID|UNKNOWN`; UNKNOWN is never auto-invalid.
- [x] Positive and negative P0 oracle hints are proven against the complete frozen declaration universe.
- [x] Primary metric is Invalid API Task Rate C vs B; task-success non-inferiority is a required guardrail.
- [x] Three-trial task-level aggregation and paired-task bootstrap uncertainty/decision-rule fields are preregistered in schema rather than chosen after H1.
- [x] H1 file fails closed as `NOT_COMMITTED` / `runAllowed: false` until P0, thresholds and task-set hash are genuinely frozen.
- [ ] Actual P0 model/harness calibration has been executed.
- [ ] MCID/non-inferiority thresholds have been frozen from calibration before H1.
- [ ] Hidden H1 task set has been committed before any H1 outcome.

## Task 7 — Content-addressed experiment integrity

**Status:** integrity infrastructure complete; actual H1 definition/result intentionally absent while H1 is uncommitted.

Files:
- `tests/evaluation/m2-agent-eval-integrity.ts`
- `tests/evaluation/m2-agent-eval-integrity.spec.ts`
- `docs/evaluation/m2/agent-eval-v1.definition.json` — **create only after H1 commitment is valid**.
- result file — **create only after an actual H1 run; never fabricate it**.

- [x] RED tests require canonical, order-independent hashing and sensitivity to target/index/corpus/tool-schema/prompt/oracle/resource/retry/run-order identities.
- [x] Pure evaluation-only canonical hashing uses the existing SHA-256 port pattern; no production protocol identity was added.
- [x] Deterministic balanced scheduling provides exactly three trials for every task/arm; the task remains the analysis unit.
- [x] Bounded infrastructure retries are separated from model outcomes; model-outcome retry is forbidden and attempts are contiguous/retained.
- [x] Fail-closed commitment validator requires `COMMITTED`, `runAllowed=true`, valid task-set SHA-256, positive task count and every preregistration prerequisite.
- [x] Recorded results are cryptographically bound to the exact definition hash and reject post-unblinding changes to preregistered fields.
- [x] Result run coverage must match the frozen schedule one-for-one and in order; missing, extra, duplicate/reordered task-arm-trial entries and task-count drift are rejected.
- [x] Terminal `CALIBRATED`/`PASS`/`NEEDS-IMPROVEMENT` evidence requires a completed model outcome for every scheduled run; infrastructure-only exhaustion forces `INCONCLUSIVE`.
- [x] Unresolved B/C `taskSuccess` or API-claim `UNKNOWN` evidence cannot be silently coerced into a terminal decision and forces `INCONCLUSIVE`.
- [x] While `agent-holdout-h1.commitment.json` is `NOT_COMMITTED`, no H1 definition/result is created merely to satisfy repository shape.
- [ ] After actual P0 and hidden H1 commitment, create and hash the exact experiment definition before the first H1 model outcome.
- [ ] After actual H1, record attempts/transcripts/classifications/result without retroactive definition changes.

## Task 8 — Upstream drift canary and governance

**Status:** documentation/metadata synchronization implemented; final review/merge verification pending.

Files/metadata:
- `docs/evaluation/m2/upstream-drift.md`
- `docs/roadmap.md`
- Issue #33
- Issue #34
- PR #35

- [x] Record GitHub prerelease `dsh-v0.1.2-alpha.1` while canonical M2.3 remains registry-published rc.2.
- [x] Keep alpha.1 lifecycle evidence separate from rc.2 scores and route `patchReload` target identity to Issue #33.
- [x] Update roadmap from stale M2.2/M2.3 state to measured deterministic infrastructure plus pending H1 evidence.
- [x] Update Issue #33, Issue #34 and PR #35 to current semantics/status.
- [ ] Run final full CI on the exact governance HEAD and perform corrective PR review.
- [ ] Merge PR #35 only if final review/CI are clean; merging infrastructure must not close #34/#28.

## Completion states

- **M2.3 evaluation infrastructure complete:** deterministic fixture/R1/baseline/evidence/search-inspect/schema/oracle/integrity/governance are green and frozen. This state may merge without claiming M2 PASS.
- **M2 PASS:** additionally, preregistered committed H1 demonstrates the required C-vs-B Invalid API Task Rate improvement without violating task-success non-inferiority.
- **M2 NEEDS-IMPROVEMENT:** valid H1 fails the primary rule or guardrail; evidence is frozen, parent #28 stays open, and retrieval changes move to a separate issue/PR.
- **M2 INCONCLUSIVE:** only a preregistered reserve/extension path may add evidence; rerunning until a desired answer is prohibited.