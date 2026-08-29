# M2.3 agent-comparison calibration amendment — 2026-08-30

Status: **post-P0 governance amendment; historical preregistration remains immutable**.

This document does not replace or rewrite `agent-comparison.md`, `api-oracle-v1.json`, `agent-pilot-p0.json`, or any historical P0 result. It records measurement defects discovered by the public non-scoring P0 calibration and defines the only permitted correction path before H1.

## Retained historical evidence

Live P0 run `33264398212` executed the frozen 72-entry schedule from source revision `fee95e4613ffa32210f0800b7e5a9cbd929f0f6d` with definition SHA-256 `240d1e9ff32c976a55c6a312e16f2046833047c512d33f711bb0eef60c8be2c6`.

Its canonical historical status is and remains **`INCONCLUSIVE`**.

The exact Actions artifact was retained before expiry under `tests/evaluation/fixtures/m2/p0-live-33264398212/`. `manifest.json` binds the original run/artifact identity and byte hashes of `probe.json` and `result.json`.

The ledger contains 72 scheduled runs and 69 model outcomes. The three scheduled entries without model outcomes are:

- `p0-03 / A / trial 1`;
- `p0-06 / A / trial 1`;
- `p0-06 / A / trial 2`.

Each exhausted the preregistered infrastructure retry path with `provider-transport`. All 48 scheduled **B/C** entries have model outcomes. Therefore the retained run contains the complete observations required to examine the primary C-vs-B calibration comparison; missing Arm A observations are not a reason to repeat the 72-run provider experiment.

## Measurement defects exposed by P0

P0 exposed defects in the evaluator boundary rather than a justification to tune production Contract Intelligence.

1. **Delegation-depth semantic mismatch.** `p0-05` asks for the API that enforces the child-agent nesting cap, while v1 task adjudication accepts only `assertSubagentMaxDepth`. Exact rc.2 declarations distinguish validation of the configured cap from `resolveChildDepth(...)`, which resolves child depth and enforces that cap.
2. **Qualified-claim grammar mismatch.** The v1 claim parser accepts only one identifier even though the public task and drift canary use qualified spellings such as `profile.patchReload`.
3. **Export-only truth granularity.** v1 classifies API existence from `declaration-export` facts only. Public members such as `ApprovalService.setPolicy` can therefore be marked absent even when they are present in authoritative published declarations.
4. **Task-success/API-validity coupling.** The v1 positive-task adjudicator fails task success when any parsed API claim is invalid and checks contradictions across unrelated claims. This conflicts with the preregistered requirement that task success be an independent guardrail from invalid-API rate.
5. **Shared-normalization oracle risk.** v1 derives API truth from the same normalized Contract Index representation whose usefulness is being evaluated. A production normalization omission can therefore become both the treatment limitation and the oracle's definition of truth.

These defects are tracked by Issue #64. The production search→inspect affordance defect observed in the same traces is separate product work (#62/#59).

## Correction policy

The following rules apply before H1:

- `api-oracle-v1.json`, `agent-pilot-p0.json`, and run `33264398212` MUST remain byte/historically immutable.
- The historical `INCONCLUSIVE` result MUST NOT be relabeled or overwritten.
- No new provider-backed P0 may be launched merely to obtain `CALIBRATED`, improve an aggregate, or validate an evaluator-only correction.
- A corrected evaluator MUST be separately versioned and frozen before it is applied in bulk to retained model outputs.
- Corrected API truth MUST be derived independently from authoritative frozen exact-target package/declaration bytes, not from the production Contract Index as the sole truth oracle.
- Absence MUST fail closed: incomplete authoritative declaration coverage yields `UNKNOWN`, never inferred absence.
- Qualified public members/config paths must use one canonical structured-claim grammar.
- Task success must be adjudicated from task-relevant claims independently from the invalid-API endpoint.
- Production retrieval ranking, B ordinary tools, provider resource limits, target/index fingerprint semantics, and Toolchain behavior MUST NOT be changed solely to improve P0 interpretation.

## Permitted derived analysis

After the corrected oracle/adjudicator is independently reviewed, merged, content-addressed, and frozen, it may be applied **offline** to the immutable retained raw answers.

That operation produces a new derived report with explicit source-result hash, corrected-oracle identity, per-run old→new deltas, and aggregate diagnostics. It does not mutate the historical result and must use a distinct result vocabulary such as `derivedCalibration: RESOLVED | UNRESOLVED`, not the canonical historical P0 status field.

A new provider-backed calibration is justified only if a decision-relevant observation is genuinely absent after this offline analysis. Since all B/C scheduled entries already have model outcomes, evaluator ambiguity alone is not such an absence.

## H1 gate

H1 remains prohibited while `agent-holdout-h1.commitment.json` is `NOT_COMMITTED` / `runAllowed: false`.

Before H1 execution, the corrected oracle and adjudication contract, immutable provider/backend identity, MCID, task-success non-inferiority margin, hidden task-set commitment, schedule/statistical configuration, and exact experiment definition must all be frozen. No H1 outcome may be observed before that barrier.

## Related governance

- #34 — M2.3 evaluation and M2 exit gate
- #43 — actual provider-backed P0 execution
- #60 — preserve invalid v1 oracle semantics and stop outcome-driven reruns
- #64 — corrected measurement semantics before any further live calibration
