# Real Plugin Corpus CI Implementation Plan

Date: 2026-09-11

## Scope

Implement the approved real-plugin corpus as a separate compatibility/evidence contour stacked on the performance/stress harness work. Do not modify production `src/` semantics, frozen M2/H1 evidence, or existing historical DSH smoke trains.

## Task 1 — Pin and validate corpus metadata

1. Add tests for the corpus catalog before implementation.
2. Require six unique entries with exact package versions and 40-hex source commits.
3. Make acquisition distribution explicit (`npm` or exact `github-source`) and never use floating refs.
4. Require DSH target `0.1.5-rc.2`.
5. Require exactly three runtime-verification entries.
6. Require `smoke` to select two static-only checks and `static/full` to select the intended bounded corpus.
7. Observe the expected RED failure from the missing catalog implementation.
8. Implement the minimal immutable catalog and selector.

## Task 2 — Define evidence/result semantics

1. Add tests for parsing Toolchain Protocol envelopes and summarizing semantic outcomes.
2. Prove `incompatible`, `unproven`, and verification `partial`/`failed` remain evidence rather than runner errors.
3. Prove malformed/missing Protocol JSON is a runner error.
4. Prove summaries count static verdicts, verification outcomes, and harness failures deterministically.
5. Add durable evidence tests: initialize `environment.json`/`results.jsonl`, append each record immediately, and sanitize/bound harness failure text.
6. Observe RED, then implement minimal result/evidence helpers.

## Task 3 — Add workflow policy tests

1. Add a structural test for `.github/workflows/real-plugin-corpus.yml` before the workflow exists.
2. Require read-only permissions, credential-free checkout, Node 24.19, frozen repo dependency install with lifecycle scripts disabled, exact packed Toolchain, bounded modes, weekly full run, no secrets, and 7-day evidence retention.
3. Observe RED, then add the workflow.

## Task 4 — Implement the corpus runner

1. Acquire npm-distributed entries at the exact pinned version with lifecycle scripts disabled.
2. For explicitly source-distributed entries, fetch only the exact pinned Git commit, verify manifest name/version, and pack the already-distributable source with lifecycle scripts disabled.
3. Record acquisition provenance and tarball SHA-256 for every candidate.
4. Create one disposable DSH `0.1.5-rc.2` target/Toolchain runner environment per corpus run.
5. Run `plugin.check` for every selected entry, accepting Toolchain exit 0/1 while requiring valid Protocol evidence and read-only static semantics.
6. For `full`, run isolated `plugin.verify` only for entries explicitly opted into runtime verification; accept `verified`, `partial`, and `failed` as semantic evidence when required lifecycle/fingerprint/cleanup evidence is valid.
7. Persist each result to `results.jsonl` immediately.
8. On harness/infrastructure failure, append a bounded/sanitized failure record, write partial summary/evidence, then fail closed.
9. Emit `summary.json` and human-readable `summary.md`.

## Task 5 — Verify in GitHub Actions

1. Open a stacked draft PR targeting `feat/ci-performance-stress-harness` after the RED tests are committed.
2. Confirm RED fails for the intended missing modules/workflow, not unrelated infrastructure.
3. Implement GREEN and obtain a full repository CI pass.
4. Run real `static` and `full` corpus modes in Actions. If workflow dispatch is unavailable through the connector, use a temporary PR-only trigger, then remove it.
5. Inspect receipts and classify third-party compatibility findings without changing Toolchain semantics merely to make the corpus green.
6. Treat newly observed valid Toolchain states (for example `partial`) as contract evidence and fix only corpus/parser assumptions that contradict production semantics.
7. Remove temporary execution scaffolding.
8. Obtain a final clean-head CI pass and update the stacked PR with exact observed results.

## Completed evidence

- Temporary full-validation run `34696284330`: `static` and `full` both succeeded with zero harness failures.
- Static corpus: `compatible-in-scope=1`, `incompatible=1`, `unproven=4`.
- Runtime subset: `verified=0`, `partial=3`, `failed=0`; all three partial reports completed cleanup and were limited by static version-proof gaps rather than runtime boot failure.
- Temporary validation workflow was removed before the final head.
- Final clean head `c1f1c3997e2d48e81bb9a6b00e6884b4d874ca92`: CI `34696666046`, Real Plugin Corpus smoke `34696666037`, and Performance Validation `34696666048` all succeeded.
