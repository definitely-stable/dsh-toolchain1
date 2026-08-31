# H1 preregistration publication v2

Status: **NOT PUBLISHED** — the real H1 preregistration receipt does not exist in this repository yet.

This document defines the public pre-outcome barrier for the M2.3 H1 controlled experiment. It does not finalize H1, publish synthetic evidence, authorize a model call, or modify the pristine `agent-holdout-h1-v2.commitment.json` source template.

## Invariant

No H1 task may be sent to the provider until a real `dsh-toolchain-m2-h1-preregistration-receipt-v2` generated from the reviewed private H1 dataset and the frozen provider identity has been committed to protected `main` and bound to an immutable repository ref/tag.

The public receipt contains only content-addressed identities and frozen experiment metadata. It does not contain hidden task bytes, task prompts, domains, success rules, answers, model outcomes, API credentials or authorization headers.

## Operator command

After the private 96-task dataset has been independently reviewed and the provider-only probe has produced the strong provider identity receipt, prepare the public receipt with:

```sh
pnpm m2:h1:preregister -- \
  --dataset /absolute/private/path/h1.json \
  --provider-receipt /absolute/path/provider-probe.json \
  --output docs/evaluation/m2/h1-preregistration-receipt-v2.json
```

The hidden dataset path must resolve **outside this repository**. The command rejects in-repository hidden datasets before reading them, refuses to overwrite an existing output, performs no provider/network/model call, and writes only the independently validated public preregistration receipt. It does not write the private finalized commitment, hidden model-task projection, hidden evaluator metadata, credentials or an H1 result.

Successful command output must report `status=PREREGISTERED`, the exact execution-definition SHA, receipt SHA, `scheduleCount=864` and `runAllowedByCommand=false`. The latter is intentional: generating the receipt is not permission to execute H1.

## Publication procedure

1. Author the real 96-task H1 dataset privately under `h1-dataset-construction-policy-v2.md`. No H1 provider call is permitted while constructing or reviewing it.
2. Independently review the private dataset and validate its construction-policy invariants.
3. Run provider-only stability probes that use no H1 task or prompt. Freeze the strong provider receipt and backend system fingerprint.
4. Run `pnpm m2:h1:preregister` with the reviewed private dataset and provider receipt. Internally the command executes the existing `finalizeH1CommitmentV2()` -> `createFrozenH1ExecutionDefinitionV2()` -> `createH1PreregistrationReceiptV2()` -> `validateH1PreregistrationReceiptV2()` chain. Finalization must be `COMMITTED`/`READY`, the dataset must contain exactly 96 tasks, the frozen schedule exactly 864 entries, and concurrency must equal 1.
5. Review the generated public receipt and its reported `receiptSha256`. Confirm that no hidden task bytes, prompts, success rules, outcomes or credentials are present.
6. Commit the exact real receipt JSON to protected `main`. Do not replace or edit `agent-holdout-h1-v2.commitment.json`; it remains the historical pristine BLOCKED source template.
7. Bind the publication commit/receipt SHA to an immutable tag/ref before any H1 model outcome is observed.
8. Only after steps 1–7 may the canonical durable H1 run store be initialized and the exact frozen schedule executed.
9. Execute the frozen schedule once under the preregistered retry/resource/provider contract. Do not rerun model outcomes or alter the holdout after unblinding.
10. After terminal `PASS`, `NEEDS-IMPROVEMENT` or `INCONCLUSIVE`, publish the exact hidden dataset bytes and verify that they reproduce the precommitted dataset SHA and model-task projection SHA.

## Public receipt contents

The receipt exposes the exact target/Contract Index/workspace identities, finalized commitment SHA, frozen measurement/design/threshold/analysis identities, hidden dataset SHA/count/model-task-projection SHA, non-secret provider/backend identity, exact execution definition SHA, schedule parameters, harness hashes, execution ContentRef SHAs, ledger binding and the disclosure policy.

The receipt intentionally withholds the material whose premature publication would unblind the holdout. Credentials are runtime-only and are never part of the commitment, definition receipt, Git history or result identity.

## Current repository state

The constructor/validator implementation and required-CI tests may use synthetic private inputs to prove determinism and fail-closed behavior. Such fixtures are test evidence only and MUST NOT be committed as a real preregistration receipt.

The operator command is preparation infrastructure only. Until a separate reviewed publication commit adds the real receipt and binds it to an immutable ref/tag, H1 remains **not publicly preregistered for execution** and no real H1 provider run is authorized.
