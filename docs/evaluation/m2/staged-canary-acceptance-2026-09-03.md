# M2 staged canary acceptance — 2026-09-03

Status: **STOP**

This receipt records the real provider-backed 16-call acceptance event required by Issue #151. It is development evidence only. It does not change the historical H1 result, does not authorize an H1 rerun, and is not H2 confirmatory evidence.

## Bound evidence

- workflow run: `33763657085` (`M2 Staged Eval Acceptance Once`);
- tested commit: `db6e85812c8a4d6bd884d0ab70f14ac0bbabb2cd`;
- artifact: `9896788535`, `m2-staged-eval-acceptance-33763657085-1`;
- artifact digest: `sha256:72db499f827330ebd0234027815de5c1d794608f368f7fdeef27a81420d78c5c`;
- corpus evidence class: `DEVELOPMENT_ONLY`;
- provider: `opencode-go`;
- request/response model: `deepseek-v4-flash` / `deepseek-v4-flash`;
- provider probe: function-tool call verified, reasoning continuation verified, token measurement verified, reasoning effort `high`, thinking enabled.

The temporary branch-only acceptance workflow was deleted immediately after the run was queued. It is not part of the final product workflow and cannot trigger another provider run.

## Execution

The canary completed **16 / 16** scheduled B/C model observations:

- B: 8 observations;
- C: 8 observations;
- model calls: 16;
- attempts: 16;
- retries: 0;
- infrastructure failures: 0;
- unrecovered infrastructure observations: 0;
- wall time: 360276 ms;
- input tokens: 541734;
- output tokens: 33595;
- turns: 201;
- tool calls: 185.

Authorization remained bounded exactly as designed:

- planned calls: 16;
- canary calls: 16;
- remainder planned: 0;
- remainder authorized: 0;
- executed calls: 16.

## Measurement health

The health gate returned `STOP` with:

- `FORMAT_COMPLIANCE_BELOW_MINIMUM`;
- `DECISION_RESOLUTION_BELOW_MINIMUM`.

Observed health:

- model outcomes: 16 / 16;
- structured-format-valid observations: 0 / 16 = 0%;
- resolved decisions: 0 / 16 = 0%;
- unrecovered infrastructure rate: 0%;
- B/C decision-resolution gap: 0 percentage points.

Because measurement health failed, product B/C deltas are not interpretable. The report correctly contains zero resolved product observations and zero paired tasks rather than manufacturing a product verdict.

## Acceptance interpretation

This is an accepted **fail-closed runner result**, not a successful measurement result. The one-dispatch runner proved that it can execute the exact 16-call canary, account for cost, evaluate health, return a scientific `STOP`, and authorize zero continuation. No larger mode or remainder was run.

The next measurement work is to diagnose why the managed provider/model path produced no schema-valid staged result observations. That investigation must remain a bounded development task. A future `dev`, `release`, `research`, or H2 run is not authorized by this receipt.

H1 remains immutable and `INCONCLUSIVE`; this acceptance event neither rewrites nor reruns H1.

## Pre-acceptance operator-path defect

An earlier one-shot run (`33762879523`) stopped before staged provider calls because pnpm 11 forwarded the argument separator `--` to the script. The parser defect was reproduced by a regression test and fixed in `f207b83246541ab9de78981f6311a7f622a65731` by accepting only one leading package-manager separator. The accepted run above exercised the corrected documented `pnpm eval:run -- ...` path.
