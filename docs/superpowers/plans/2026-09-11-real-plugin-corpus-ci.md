# Real Plugin Corpus CI Implementation Plan

Date: 2026-09-11

## Scope

Implement the approved real-plugin corpus as a separate compatibility/evidence contour stacked on the performance/stress harness work. Do not modify production `src/` semantics, frozen M2/H1 evidence, or existing historical DSH smoke trains.

## Task 1 — Pin and validate corpus metadata

1. Add tests for the corpus catalog before implementation.
2. Require six unique entries with exact npm versions and 40-hex source commits.
3. Require DSH target `0.1.5-rc.2`.
4. Require exactly three runtime-verification entries.
5. Require `smoke` to select two static-only checks and `static/full` to select the intended bounded corpus.
6. Observe the expected RED failure from the missing catalog implementation.
7. Implement the minimal immutable catalog and selector.

## Task 2 — Define evidence/result semantics

1. Add tests for parsing Toolchain Protocol envelopes and summarizing semantic outcomes.
2. Prove `incompatible`, `unproven`, and verification `failed` remain evidence rather than runner errors.
3. Prove malformed/missing Protocol JSON is a runner error.
4. Prove summaries count static verdicts, verification outcomes, and harness failures deterministically.
5. Observe RED, then implement minimal result helpers.

## Task 3 — Add workflow policy tests

1. Add a structural test for `.github/workflows/real-plugin-corpus.yml` before the workflow exists.
2. Require read-only permissions, credential-free checkout, Node 24.19, frozen repo dependency install with lifecycle scripts disabled, exact packed Toolchain, bounded modes, weekly full run, no secrets, and 7-day evidence retention.
3. Observe RED, then add the workflow.

## Task 4 — Implement the corpus runner

1. Acquire each selected published npm package at the exact pinned version without candidate lifecycle execution.
2. Capture npm integrity, tarball SHA-256, byte size, and source provenance.
3. Create one disposable DSH `0.1.5-rc.2` target/Toolchain runner environment per corpus run.
4. Run `plugin.check` for every selected entry, accepting Toolchain exit 0/1 while requiring valid Protocol evidence and read-only target behavior.
5. For `full`, run isolated `plugin.verify` only for entries explicitly opted into runtime verification.
6. Persist each result to `results.jsonl` immediately.
7. On harness/infrastructure failure, append a bounded/sanitized failure record, write partial summary/evidence, then fail closed.
8. Emit `summary.json` and human-readable `summary.md`.

## Task 5 — Verify in GitHub Actions

1. Open a stacked draft PR targeting `feat/ci-performance-stress-harness` after the RED tests are committed.
2. Confirm RED fails for the intended missing modules/workflow, not unrelated infrastructure.
3. Implement GREEN and obtain a full repository CI pass.
4. Run real `static` and `full` corpus modes in Actions. If workflow dispatch is unavailable through the connector, use a temporary PR-only trigger, then remove it.
5. Inspect receipts and classify any third-party compatibility findings without changing Toolchain semantics merely to make the corpus green.
6. Remove temporary execution scaffolding.
7. Obtain a final clean-head CI pass and update the stacked PR with exact observed results.
