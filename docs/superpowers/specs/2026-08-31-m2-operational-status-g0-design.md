# M2 Operational Status G0 Design

## Purpose

Create one canonical operational view for M2.3 that answers a narrow question: **what is complete on the current repository state, what is immutable historical evidence, what remains blocked, and what action is permitted next?**

This design does not change M2 measurement semantics, H1 thresholds, frozen target/index identities, production Contract Intelligence, or any historical P0/H1 artifact. It reconciles documentation and issue state with the implementation already merged on `main`.

## Problem

The repository currently distributes rapidly changing M2.3 status across `README.md`, `docs/roadmap.md`, Issues #28/#34, evaluation documents, historical P0 artifacts, and later H1 implementation slices. The durable technical sources are correct, but higher-level status text is stale in several places:

- `README.md` still describes M2.2 as if its merge state were transient and describes M2.3 mainly as a frozen retrieval evaluation.
- `docs/roadmap.md` still marks provider-backed P0 execution and H1 threshold/definition freezing as incomplete, even though the retained P0 run exists and the prospective H1 design has frozen the MCID, non-inferiority margin, three-trial design, task count, and analysis method.
- Issues #28 and #34 retain acceptance checkboxes from before the later M2.3 corrective and H1-readiness slices.
- Historical P0 status is legitimately `INCONCLUSIVE`, but the repository also contains a corrected offline readjudication. Without one operational summary, readers can incorrectly interpret `INCONCLUSIVE` as "P0 never ran" or assume another live P0 is required.
- The real H1 preregistration receipt is still explicitly `NOT PUBLISHED`; therefore no H1 task is authorized for provider execution.

## Source-of-truth boundaries

The existing repository source order remains unchanged:

1. normative specifications under `spec/`;
2. accepted ADRs under `docs/decisions/`;
3. current architecture in `docs/architecture.md`;
4. capability roadmap in `docs/roadmap.md`;
5. implementation plans and Issues.

The new operational status document is **not normative** and does not outrank the sources above. It is a current-state index over already accepted evaluation artifacts and implementation state.

Responsibilities are separated as follows:

- `docs/roadmap.md` owns capability milestones and exit criteria.
- `docs/evaluation/m2/status.md` owns current M2.3 operational state and the next permitted action.
- historical evaluation artifacts own immutable experiment/evidence facts.
- `h1-preregistration-publication-v2.md` owns the public pre-outcome H1 authorization barrier.
- Issues #28/#34 track the remaining work and are synchronized to the canonical status rather than restating every implementation detail.

## Canonical operational state

`docs/evaluation/m2/status.md` will record the following state from current `main`:

| Gate | State |
| --- | --- |
| M2.1 offline Contract Index | COMPLETE |
| M2.2 Agent-scoped Host Inspect enrichment | COMPLETE |
| R1 deterministic retrieval baseline | COMPLETE |
| R1 Success@5 / MRR | 56.25% / 54.6875% |
| R1 natural-language / indirect | 0% / 0% |
| Real provider-backed P0 execution | COMPLETE |
| Historical P0 result | INCONCLUSIVE, immutable |
| P0 corrected offline readjudication | COMPLETE |
| Measurement correction policy | FROZEN |
| H1 MCID | 0.10 absolute Invalid API Task Rate reduction |
| H1 task-success non-inferiority margin | 0.05 |
| H1 trials | 3 per task/arm |
| H1 task count | 96 |
| H1 schedule | 864 entries |
| H1 analysis | paired-task percentile bootstrap, 10,000 resamples |
| Durable H1 ledger/store/coordinator/schedule | IMPLEMENTED |
| Frozen H1 execution-definition machinery | IMPLEMENTED |
| Preregistration receipt constructor/validator | IMPLEMENTED |
| Real hidden H1 dataset | NOT FINALIZED |
| Strong real provider/backend identity | NOT FINALIZED |
| Real finalized H1 commitment | NOT FINALIZED |
| Real public preregistration receipt | NOT PUBLISHED |
| H1 provider execution | PROHIBITED |
| M2 exit | PENDING |

The document will explicitly distinguish **historical status** from **operational readiness**. Historical P0 remains `INCONCLUSIVE`; that does not authorize a rerun. The post-P0 amendment and offline readjudication are calibration evidence, not a replacement historical result.

## Next permitted sequence

The status document will expose exactly one forward sequence:

1. construct and independently review the real private 96-task H1 dataset under the existing construction policy;
2. run provider-only stability probes that use no H1 task/prompt and freeze a strong provider/backend identity receipt;
3. privately finalize the H1 commitment and frozen execution definition;
4. generate and validate the real public preregistration receipt;
5. commit that exact receipt to protected `main` and bind it to an immutable ref/tag;
6. only then initialize the durable H1 store and execute the frozen 864-entry schedule once;
7. resolve M2 strictly as `PASS`, `NEEDS-IMPROVEMENT`, or `INCONCLUSIVE` using the frozen decision rule.

No new live P0 is part of this sequence unless a separately justified, decision-relevant missing observation is proven under the existing correction policy.

## Documentation changes

### `docs/evaluation/m2/status.md`

New canonical operational summary with:

- scope and non-normative status;
- canonical frozen rc.2 target/index identities;
- current gate table;
- immutable historical P0 clarification;
- R1 measured retrieval gaps;
- H1 authorization barrier;
- next permitted sequence;
- M2 exit routing;
- explicit non-goals.

### `README.md`

Replace stale repository-status prose with a compact statement that M2.1/M2.2 are merged, M2.3 has completed R1/P0/corrected measurement and H1 execution machinery, and the real H1 remains blocked until preregistration publication. Link to `docs/evaluation/m2/status.md` for current operational state and to `docs/roadmap.md` for capability sequencing.

The README remains product-oriented and will not duplicate the gate table.

### `docs/roadmap.md`

Keep milestone semantics, but update M2.3 status and exit checkboxes to reflect merged facts:

- provider-backed P0 was executed and retained;
- historical P0 is `INCONCLUSIVE` and immutable;
- corrected measurement/readjudication exists;
- MCID = 0.10 and task-success non-inferiority margin = 0.05 are frozen;
- 96 tasks / 3 trials / 864 schedule and paired-bootstrap analysis are frozen by the H1 prospective/finalization machinery;
- real private H1 dataset/provider identity/public preregistration receipt and actual H1 outcome remain pending.

The roadmap links to the operational status instead of becoming the detailed H1 runbook.

### Issues #28 and #34

Do not rewrite historical discussion. Add a concise synchronization comment after the PR exists, pointing to the canonical operational status and correcting the meaning of the stale checkboxes. The issue bodies may be updated in a later dedicated governance edit if desired, but this G0 slice does not need to erase historical context to make current state unambiguous.

## Validation

This is documentation/governance-only. Validation must prove:

- no `src/**`, protocol/schema, retrieval ranking, H1 threshold, historical P0/H1 artifact, or target-identity file changed;
- all referenced numbers and states match committed artifacts;
- Markdown links resolve to repository paths;
- repository policy checks that cover documentation/state still pass in CI;
- the final PR description states exactly which checks were actually executed and does not claim local commands that were not run.

## Non-goals

- no production `src/**` changes;
- no protocol/schema changes;
- no Contract Index or retrieval-ranking changes;
- no embeddings/reranker/vector database;
- no modification of historical P0 outputs or v1 oracle artifacts;
- no synthetic real H1 dataset/receipt/result;
- no H1 provider call;
- no change to `dsh-target-v2` or Issue #33 lifecycle semantics;
- no M3/M4 implementation in this slice.

## Exit condition for G0

G0 is complete when a reviewable PR contains the canonical status document plus README/roadmap reconciliation, the diff is governance/docs-only, CI is green, and Issues #28/#34 can point to one unambiguous current operational state. The next implementation unit is then real private H1 finalization/preregistration, not another abstraction layer.