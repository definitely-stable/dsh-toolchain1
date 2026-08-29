# M2 P0 Flash Recalibration Implementation Plan

**Goal:** Correct the harness defects exposed by live P0 run `33251975437`, switch the calibration provider to OpenCode Go DeepSeek V4 Flash, and obtain a new validator-clean P0 result without changing H1 or production Toolchain behavior.

**Architecture:** Keep the correction entirely in evaluation/scripts. Model-authored invalid calls to an available tool become bounded in-session tool-error results retained in the runner trace; unexpected broker/runtime failures still cross the process boundary as infrastructure. Re-freeze only P0 resources and provider identity. H1 remains `NOT_COMMITTED`.

**Issue:** #55

## Constraints

- Exact target/index, P0 dataset/oracle, A/B/C semantics and ordinary workspace do not change.
- No `src/**`, Protocol, production retrieval, H1 thresholds/commitment or generic provider framework changes.
- TDD: commit RED behavior tests before implementation.
- Official OpenCode Go raw model id is `deepseek-v4-flash` on `/zen/go/v1/chat/completions`.

## Task 1 — prove the calibration defects

- Add a process fixture that makes an invalid `read_file` call and can continue only if the runner returns a structured tool error in the same session.
- Add a RED integration test proving current behavior incorrectly terminates the attempt as `tool-transport`.
- Add RED assertions that P0 resources must be 24 turns / 150000 input / 12000 output and that OpenCode Go P0 accepts only the Flash binding.
- Run CI on the RED head and record the expected failures in #55/PR.

## Task 2 — correct model tool-error semantics

- In the frozen P0 runtime, classify errors caused by model input separately from unexpected runtime failures.
- Ordinary tool validation/path/not-found/range errors are model errors.
- Pre-validate Toolchain search/inspect arguments with the production Protocol parsers; invalid requests are model errors, while failures after successful parsing remain infrastructure errors.
- Return `{ error: { code: "MODEL_TOOL_CALL_INVALID", message } }` to the child, retain trace `status=error`, and continue the same model session.
- Keep bounded message text and no stack/internal object leakage.

## Task 3 — re-freeze P0 resource and Flash provider identity

- Change only P0 calibration resources to `maxTurns=24`, `maxInputTokens=150000`, `maxOutputTokens=12000`, `maxWallTimeMs=300000`, `concurrency=1`, `maxAttempts=2`.
- Update the OpenCode Go probe, command and child bindings to exact raw model `deepseek-v4-flash`; response-model drift remains fail-closed.
- Keep thinking enabled/high and the current reasoning continuation contract.

## Task 4 — verify, merge, rerun

- Run focused tests, full exact-head CI, package and DSH lanes.
- Audit final diff/reviews for scope drift and secrets.
- Squash-merge the PR only when green.
- Trigger one post-merge live P0 on #43, inspect retained `probe.json`/`result.json`, and close #55 only after the new terminal evidence is recorded.
- Do not start H1 in this slice.
