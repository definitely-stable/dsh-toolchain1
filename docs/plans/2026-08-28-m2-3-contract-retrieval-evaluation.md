# M2.3 Contract Intelligence Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use TDD for every behavioral evaluator change. This PR measures production M2; it must not alter production retrieval/ranking to improve scores.

**Goal:** build a reproducible, artifact-grounded evaluation that measures production Contract Intelligence and preregisters a controlled agent comparison capable of deciding whether M2 is complete.

**Architecture:** M2.3 has four layers: registry-artifact fixture → deterministic retrieval/evidence evaluation → real-kernel `search -> inspect` conformance → preregistered agent usefulness experiment. Required CI stays deterministic/offline; model runs are recorded separately as versioned evidence.

**Tech Stack:** TypeScript 6, Vitest 4, existing M1/M2 model/kernel/acquisition code, JSON Schema + AJV, Node 22.19+/24/26 CI, pnpm 11.7.

**Spec:** `docs/plans/2026-08-28-m2-3-evaluation-design.md`; Issue #34; parent #28; ADR-0008; protocol/architecture/development docs.

## Global constraints

- Base production behavior is M2.2 squash `d3162bd72bcd84ec8c422108be1e7c529a1a59f6`.
- Canonical target is registry-installable `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`, documentation/source provenance `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.
- `dsh-v0.1.2-alpha.1` / `cd5ef814...` is a drift canary only; Issue #33 owns target-identity redesign.
- Production `searchContractIndex()` is the only ranking implementation used by evaluation.
- No embeddings, reranker, vector DB, model/network call, external judge or persistent search service in required CI.
- Frozen full contract facts precede corpus construction; corpus may never decide which contracts exist.
- Historical baselines are immutable. Corrections require pinned factual provenance and explicit errata.
- Parent #28 remains open until preregistered agent evidence qualifies.

---

### Task 1: Correct metric semantics without changing arithmetic

**Files:**
- Modify: `tests/evaluation/m2-retrieval-metrics.ts`
- Modify: `tests/evaluation/m2-retrieval-metrics.spec.ts`

**Interfaces:**
- Rename `recallAt1/3/5` → `successAt1/3/5`.
- Rename `wrongContractRate` → `forbiddenHitRateAt5`.
- Keep MRR and no-result semantics unchanged.

- [ ] Add RED assertions that the public metric shape exposes `successAt*` / `forbiddenHitRateAt5` and not misleading Recall names.
- [ ] Confirm CI RED is caused only by the old names.
- [ ] Rename the evaluator fields/helper naming minimally; do not change arithmetic.
- [ ] Confirm focused/full CI GREEN.

### Task 2: Replace the synthetic rc.2 fixture contract with an artifact-grade frozen fixture boundary

**Files:**
- Modify: `tests/evaluation/m2-retrieval-index.ts`
- Modify/Create: `tests/evaluation/m2-retrieval.spec.ts`
- Create: `tests/evaluation/fixtures/m2/rc2-web-v1/manifest.json`
- Create: `tests/evaluation/fixtures/m2/rc2-web-v1/target-facts.json`
- Create: `tests/evaluation/fixtures/m2/rc2-web-v1/contract-facts.json`
- Create later generator support only if production acquisition can be reused without creating a second semantic implementation.

**Interfaces:**
- `M2_RETRIEVAL_TARGET` contains exact DSH version/profile/upstream provenance and real expected target/index fingerprints.
- `createFrozenM2RetrievalIndex()` creates a `ContractIndex` from frozen production-shaped facts with production `createContractIndex()`.

- [ ] Extend the current intentional RED with structural requirements: no synthetic target fingerprint, manifest/facts schema versioned, all evidence refs resolve, package summaries match production, no invented `type:*`, full fixture declares generator/provenance identities.
- [ ] Populate only facts obtained from the canonical registry artifact/dependency closure. Never add a contract because a corpus task wants it.
- [ ] Strip non-semantic machine locations only and prove index identity remains unchanged by equivalent input ordering/location removal.
- [ ] Confirm CI GREEN and record the real fingerprints.

### Task 3: Freeze the R1 retrieval capability corpus before observing scores

**Files:**
- Create: `tests/evaluation/m2-retrieval-corpus.ts`
- Modify: `tests/evaluation/m2-retrieval-metrics.ts`
- Modify: `tests/evaluation/m2-retrieval.spec.ts`

**Interfaces:**
- Extend `M2RetrievalTask` with `domain`, `intentGroup`, `sourceKind`, optional `riskTags`, and `referenceRoute`/equivalent exact provenance.
- Preserve existing linguistic categories.

- [ ] Add RED corpus-validation tests for missing orthogonal metadata, duplicate/near-concentrated intent groups, invalid no-result/replacement semantics and missing reference routes.
- [ ] Implement only evaluation validation needed by those tests.
- [ ] Author about 36 rc.2 tasks with pinned provenance; normally no more than three tasks per intent group. Include version-drift cases where latest/upstream knowledge differs from rc.2.
- [ ] Commit/freeze R1 before executing the full benchmark.

### Task 4: Measure deterministic production retrieval and evidence sufficiency

**Files:**
- Modify: `tests/evaluation/m2-retrieval.spec.ts`
- Create: `tests/evaluation/m2-evidence-sufficiency.spec.ts`
- Create: `docs/evaluation/m2/retrieval-baseline-v1.json`
- Create: `docs/evaluation/m2/retrieval-report.md`

- [ ] Run every R1 task only through production `searchContractIndex(index, query, undefined, 5)`.
- [ ] Assert determinism/invariants, metric bounds and repeated-order equivalence; do not assert a desired capability score.
- [ ] Add representative required-fact/evidence checks so a retrieval hit is distinguished from an acquisition/evidence gap.
- [ ] Record immutable per-task ranked IDs plus aggregate Success@1/3/5, MRR, no-result correctness, forbiddenHitRateAt5 and category/domain diagnostics.
- [ ] Keep capability baseline historical; do not convert the full exact ranking into a permanent regression contract.

### Task 5: Prove the real production `search -> inspect` loop

**Files:**
- Create: `tests/evaluation/m2-search-inspect.spec.ts`

- [ ] Add RED evaluation ports returning frozen target/contract facts while invoking production `createApplicationKernel()`.
- [ ] Prove search/inspect target fingerprint continuity, index fingerprint continuity, exact returned contract identity and evidence resolution.
- [ ] Add one stale proof where contract evidence changes after search and inspect returns existing stale semantics.
- [ ] Keep evaluation ports test-only; no new production abstraction.

### Task 6: Version agent-evaluation schemas, oracle boundary and pilot/holdout protocol

**Files:**
- Create: `docs/evaluation/m2/m2-agent-eval-v1.schema.json`
- Create: `tests/evaluation/m2-agent-eval-schema.spec.ts`
- Create: `docs/evaluation/m2/agent-comparison.md`
- Create: `docs/evaluation/m2/api-oracle-v1.json` (generated/normalized from shipped rc.2 declarations where possible)
- Create: `docs/evaluation/m2/agent-pilot-p0.json`
- Create: `docs/evaluation/m2/agent-holdout-h1.commitment.json`

- [ ] RED schema tests require exact target/index identities, model/harness/tool/resource/retry configuration, run-order seed/schedule, primary/guardrail metrics and result status.
- [ ] Define A=memory, B=conventional exact-target agent with ordinary file/search/docs access, C=B+Toolchain; C is not forced to call Toolchain.
- [ ] Define P0 as non-scoring harness calibration and H1 as acceptance holdout whose tasks are hash-committed before execution and published afterwards.
- [ ] Oracle classifications are `VALID|INVALID|UNKNOWN`; UNKNOWN requires adjudication and is never auto-invalid.
- [ ] Primary metric is Invalid API Task Rate C vs B; task-success non-inferiority is a required guardrail. MCID is frozen after P0 but before H1.

### Task 7: Add content-addressed experiment definition/result integrity

**Files:**
- Create: `tests/evaluation/m2-agent-eval-integrity.ts`
- Create: `tests/evaluation/m2-agent-eval-integrity.spec.ts`
- Create: `docs/evaluation/m2/agent-eval-v1.definition.json`
- Result file is created only after an actual H1 run; never fabricate it.

- [ ] RED tests canonicalize/hash the evaluation definition and reject missing/changed target/index/corpus/tool-schema/prompt/oracle/resource/retry identities.
- [ ] Implement a pure evaluation-only canonical hash helper using the existing SHA-256 port/helper pattern; do not add production protocol identity.
- [ ] Validate bounded infrastructure retries separately from model outcomes and require all attempts to be recorded.
- [ ] Define three trials per task/arm and a deterministic balanced/randomized order; analysis unit remains the task, not each trial.

### Task 8: Upstream drift canary and governance

**Files:**
- Create: `docs/evaluation/m2/upstream-drift.md`
- Modify: `docs/roadmap.md`
- Update: Issue #33, Issue #34, PR #35 metadata/body.

- [ ] Record that GitHub prerelease `dsh-v0.1.2-alpha.1` exists while canonical M2.3 remains rc.2 until registry/installability/support policy changes.
- [ ] Document drift only; do not combine alpha.1 with rc.2 scores.
- [ ] Update roadmap/PR state to reflect actual completed tasks and remaining H1 evidence.
- [ ] Run final full CI and corrective review. Do not close #28 unless a recorded H1 result satisfies the preregistered decision rule.

## Completion states

- `M2.3 evaluation infrastructure complete`: deterministic fixture/R1/search-inspect/schemas are green and immutable evidence exists.
- `M2 PASS`: additionally, preregistered H1 demonstrates the required C-vs-B improvement without violating task-success guardrails.
- `M2 NEEDS-IMPROVEMENT`: M2.3 evidence is frozen, parent #28 stays open, and retrieval/harness changes move to a separate issue/PR.
- `M2 INCONCLUSIVE`: only a preregistered reserve/extension path may add evidence; rerunning until a desired answer is prohibited.
