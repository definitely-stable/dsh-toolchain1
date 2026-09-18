# H2 scoring runbook

Operator steps for the confirmatory H2 run. The experiment's design and its frozen policy live in
[`h2-design-preregistration.md`](h2-design-preregistration.md); section 21 records why the paid run
happens on GitHub Actions instead of the operator's machine. This file is the checklist that goes
with it.

Everything below assumes the harness change that introduced the ownership guard and the scoring
workflow is already merged into `main`: the workflow refuses any other ref.

## 1. Repository secrets (one-time)

| Secret | Contents |
| --- | --- |
| `H2_DATASET_GZIP_BASE64` | the private corpus as `base64(tar.gz)` |
| `OPENCODE_API_KEY` | the frozen route's credential (already used by the staged evaluation lane) |

Build the corpus secret from the authoring machine. The archive must contain a top-level
`h2-dataset-v1/` directory, because the workflow extracts it and points `H2_DATASET_DIR` at exactly
that path:

```powershell
# from the directory that holds the private corpus
tar -czf h2-dataset-v1.tar.gz -C D:\h2-private h2-dataset-v1
[Convert]::ToBase64String([IO.File]::ReadAllBytes('h2-dataset-v1.tar.gz')) | Set-Content -NoNewline h2-dataset-v1.b64
(Get-Item h2-dataset-v1.b64).Length   # must stay under 49152 bytes
```

The measured corpus is 13 231 bytes of `tar.gz` and 17 644 bytes base64. Paste the contents of the
`.b64` file into the secret; never commit it, and delete it afterwards.

The benchmark re-verifies the corpus against the public commitment
(`docs/evaluation/h2/h2-commitment-v1.json`), so a wrong archive fails closed at `h2:validate`
rather than producing a scored run on the wrong dataset.

## 2. Dispatch

Actions → **H2 Scoring** → *Run workflow* on `main`. The job runs, in order:

```text
pnpm h2:validate      # frozen policy, commitment, corpus, target, credential
pnpm h2:preflight     # corpus commitment, credential, deletion-guard self-test -> protection report
pnpm h2:freeze --force    # seals the preregistration receipt for this commit
pnpm h2:dry-run       # 2 non-scoring observations (calibration task)
pnpm h2:run --confirm-scoring --run-budget-minutes <input>
pnpm h2:finalize --out docs/evaluation/h2/h2-report-v1.json
```

Expected wall time is hours: 36 observations of at most 24 provider completions and 600 s each, plus
a real DSH composition/boot per grade. Leave the job alone — cancelling it discards everything the
run produced, because deferred retention keeps no durable intermediate evidence.

## 3. After the job

Download the `h2-scoring-evidence` artifact (retention: 1 day) and check what it contains:

- `technical-dry-run.json` — the dry-run gate: composition parity, telemetry resolved, no identity drift;
- `ledger.json` — one entry per scheduled observation with its terminal reason;
- `report.json` — the terminal product report: `CONFIRMED_BENEFIT`, `INCONCLUSIVE`, or `STOPPED_INVALID`;
- `**/receipts/observation.json` — the sanitized per-observation receipts;
- `deletion-journal.json` — every tree the run removed;
- `protection-report.json` — the guard self-test that authorized the run.

Then publish the result in one commit:

1. copy `report.json` to `docs/evaluation/h2/h2-report-v1.json` (the same bytes the generator wrote —
   `h2:finalize --out` exists so a human never edits it);
2. write `docs/evaluation/h2/h2-terminal-outcome-<date>.md` in the shape of the H1 outcome record:
   run id, candidate commit, packed artifact SHA-256, target fingerprint, dataset commitment,
   schedule hash, measurement health, primary and secondary endpoints, the decision, and the
   disclosure boundary;
3. update the H2 row in `docs/evaluation/m2/status.md` and the H2 paragraph in `docs/roadmap.md`;
4. commit the sealed preregistration receipt the job produced (`.artifacts/h2/...` is ignored by Git,
   so take the receipt from the job log or the artifact) together with the documents.

A published report must never be edited by hand, and a non-terminal report cannot be published at
all: `h2:finalize --out` refuses it.

## 4. When the run stops early

`STOPPED_INVALID` is a result, not a failure to hide. It means an observation did not resolve —
infrastructure failure, cancellation, model identity drift, or the internal run budget — and **no
confirmatory estimate may be computed from it**. Report it as it is, with the stop reason from the
ledger.

- A **harness** defect is fixed, the preregistration is re-sealed by the next dispatch, and the run
  starts over from observation 1; the interrupted run's observations stay non-confirmatory.
- A **product** fix is a new experiment version, not a continuation of this one (design section 17).
- Never dispatch again hoping for a friendlier label. The canonical result is the first valid
  committed scoring run.

A dry run that stops on `the target does not offer the frozen model option` is neither: the target
cannot advertise a model its installed catalog does not ship, and the run now declares the frozen
model itself (design section 22). That correction lives in the route patch and keeps the frozen
identity and the policy hash unchanged, so the dispatch is repeated rather than re-frozen.

## 5. Never do this

- Do not run `h2:run` or `h2:dry-run` on the operator's machine: the design's venue is the runner,
  and the local path is not part of the frozen experiment.
- Do not copy the private corpus into the checkout, into the repository, or into a path the agent
  under test can name; `h2:run` refuses a repository copy and the CI venue requires a random
  temporary directory.
- Do not raise the frozen limits (24 completions, 600 s) after a scoring outcome exists.
- Do not cancel a scoring job to "restart cleanly"; cancel discards the run's evidence by design.
