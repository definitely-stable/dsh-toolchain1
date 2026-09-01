# M2 H1 terminal placeholder amendment — 2026-09-01

## Scope

This amendment records a terminal-harness correction discovered only after the preregistered H1 execution had reached `COMPLETE`, but before any terminal result or hidden-dataset disclosure was produced.

The completed H1 execution is GitHub Actions run `33533666686`. Its durable ledger contains the full frozen schedule of 864 model outcomes. Those outcomes are not replayed, replaced, or re-scored by model execution.

## Observed terminal failure

The first canonical terminal attempt was GitHub Actions run `33540324411` using terminal source commit `2e3e49702d0581364952affd96d86c518dda361b`.

The run restored the exact completed H1 cache, materialized the committed hidden dataset, verified its raw SHA-256, and then failed inside `pnpm m2:h1:finalize` with:

`H1 terminal fresh adjudication drifted from persisted model-outcome adjudication`

The failure occurred before the workflow step that discloses the hidden dataset. The disclosure, evidence manifest, provenance attestation, and artifact upload steps were therefore skipped. No H1 PASS / NEEDS-IMPROVEMENT / INCONCLUSIVE result was produced by that run.

## Root cause

The frozen H1 execution source intentionally persisted model outcomes with two terminal-derived fields left as pristine placeholders:

- `parsedApiClaims: []`
- `taskSuccess: UNKNOWN`

The retained raw answer bytes and their content references were persisted durably and are the evidence intended for terminal adjudication.

The original terminal implementation incorrectly assumed the two placeholder fields already contained execution-time adjudication. It freshly adjudicated the retained raw answer and then required the fresh result to equal `[] / UNKNOWN`. For any answer that produced a real API claim or a resolved task-success status, that invariant was impossible by construction.

## Correction

Corrected terminal source commit:

`a27e86e2174e782c438abd91881094492f423af3`

The correction is deliberately narrow and fail-closed:

1. require the persisted execution-time derived fields to remain exactly pristine (`parsedApiClaims` empty and `taskSuccess` equal to `UNKNOWN`);
2. reject any model outcome whose derived fields were mutated before terminal adjudication;
3. apply the existing frozen H1 adjudicator exactly once to the retained raw answer using the existing hidden task rule and frozen Truth v2;
4. continue through the unchanged terminal analysis, bootstrap, thresholds, status rule, evidence manifest, attestation, and artifact publication.

The corrected source commit passed the repository's complete CI matrix in run `33541089446` before being pinned by the terminal workflow.

## Scientific invariants unchanged

This amendment does not change:

- any of the 864 retained model outcomes or raw answer bytes;
- task allocation, arms, trials, schedule, seeds, retry semantics, or resource budgets;
- the hidden dataset or its prior commitment;
- Truth v2 or the H1 task-success rules;
- API-claim parsing/classification semantics;
- task-level analysis unit;
- paired bootstrap implementation or bootstrap seeds;
- primary endpoint or guardrail;
- PASS / NEEDS-IMPROVEMENT / INCONCLUSIVE thresholds;
- the rule prohibiting reruns toward a preferred outcome.

Accordingly, H1 execution run `33533666686` remains the sole confirmatory H1 execution. The terminal workflow is rerun only to correct the measurement harness path that consumes its already-frozen evidence.
