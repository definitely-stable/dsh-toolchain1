# H1 preregistration publication v2

Status: **NOT PUBLISHED** — the real H1 preregistration receipt does not exist in this repository yet.

This document defines the public pre-outcome barrier for the M2.3 H1 controlled experiment. It does not finalize H1, publish synthetic evidence, authorize a model call, or modify the pristine `agent-holdout-h1-v2.commitment.json` source template.

## Invariant

No H1 task may be sent to the provider until a real `dsh-toolchain-m2-h1-preregistration-receipt-v2` generated from the reviewed private H1 dataset and the frozen provider identity has been committed to protected `main` and bound to an immutable repository ref/tag.

The public receipt contains only content-addressed identities and frozen experiment metadata. It does not contain hidden task bytes, task prompts, domains, success rules, answers, model outcomes, API credentials or authorization headers.

## Publication procedure

1. Author the real 96-task H1 dataset privately under `h1-dataset-construction-policy-v2.md`. No H1 provider call is permitted while constructing or reviewing it.
2. Independently review the private dataset and validate its construction-policy invariants.
3. Run provider-only stability probes that use no H1 task or prompt. Freeze the strong provider receipt and backend system fingerprint.
4. Privately execute `finalizeH1CommitmentV2()` using the pristine public BLOCKED commitment, the reviewed private dataset and the provider receipt. The result must be `COMMITTED`, `READY` and `runAllowed=true`.
5. Privately execute `createFrozenH1ExecutionDefinitionV2()` against the exact frozen ordinary workspace. The definition must contain exactly 96 tasks projected as `{id,prompt}`, 864 balanced task/arm/trial schedule entries and concurrency 1.
6. Generate `dsh-toolchain-m2-h1-preregistration-receipt-v2` with `createH1PreregistrationReceiptV2()` and independently validate it with `validateH1PreregistrationReceiptV2()`.
7. Commit the exact real receipt JSON and its `receiptSha256` to protected `main`. Do not replace or edit `agent-holdout-h1-v2.commitment.json`; it remains the historical pristine BLOCKED source template.
8. Bind the publication commit/receipt SHA to an immutable tag/ref before any H1 model outcome is observed.
9. Only after steps 1–8 may the canonical durable H1 run store be initialized and the exact frozen schedule executed.
10. After terminal `PASS`, `NEEDS-IMPROVEMENT` or `INCONCLUSIVE`, publish the exact hidden dataset bytes and verify that they reproduce the precommitted dataset SHA and model-task projection SHA.

## Public receipt contents

The receipt exposes the exact target/Contract Index/workspace identities, finalized commitment SHA, frozen measurement/design/threshold/analysis identities, hidden dataset SHA/count/model-task-projection SHA, non-secret provider/backend identity, exact execution definition SHA, schedule parameters, harness hashes, execution ContentRef SHAs, ledger binding and the disclosure policy.

The receipt intentionally withholds the material whose premature publication would unblind the holdout. Credentials are runtime-only and are never part of the commitment, definition receipt, Git history or result identity.

## Current repository state

The constructor/validator implementation and required-CI tests may use synthetic private inputs to prove determinism and fail-closed behavior. Such fixtures are test evidence only and MUST NOT be committed as a real preregistration receipt.

Until a separate reviewed publication commit adds the real receipt, H1 remains **not publicly preregistered for execution** and no real H1 provider run is authorized.
