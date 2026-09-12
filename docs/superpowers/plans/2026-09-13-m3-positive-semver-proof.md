# M3.1 Positive SemVer Proof Implementation Plan

Issue: #214

Baseline: `main@b3c1075b2ce55862783a4fd296c9679002de0ab4`.

## Scope guard

Implement only positive npm-compatible SemVer proof inside the existing `plugin.check` dependency-version rule. Do not add a version-mismatch status/diagnostic, do not change `plugin.verify` status semantics, and do not touch M2, target identity, lifecycle identity, provider/model evaluation, or unrelated dependencies.

## Task 1 — lock behavior with RED tests

Update `tests/model/plugin-check.spec.ts` so the required behavior is explicit before production changes:

- prove `4.0.2` satisfies `^4.0.1`;
- prove `0.1.5-rc.2` satisfies `^0.1.5-rc.1`;
- prove an OR range with a matching prerelease branch;
- retain exact equality;
- retain `unproven` for canonical non-match;
- retain `unproven` for `*` against a prerelease target under normal npm semantics;
- malformed target/range does not throw and remains `unproven`.

Update `tests/policy/architecture.spec.ts` to require exactly the narrow semantic dependency exception: `semver` is permitted while an unrelated bare package remains rejected.

Observe CI RED for the new model behavior and/or architecture allowlist before implementation.

## Task 2 — dependency and architecture decision

Add exact runtime dependency `semver@7.8.5` and development declarations `@types/semver@7.8.0`, updating `pnpm-lock.yaml` through pnpm rather than hand-authoring dependency resolution metadata.

Change `scripts/check-architecture.mjs` so `allowedSemanticExternalDependencies` contains only `semver`. Do not allow subpaths or generic packages unless required by the chosen import form.

Verification:

- package/lock policy;
- architecture policy tests;
- `pnpm check:architecture` equivalent repository gate (`node scripts/check-architecture.mjs`).

## Task 3 — implement positive proof

In `src/model/plugin-check.ts`:

- import the canonical npm SemVer evaluator;
- preserve exact-string equality first;
- otherwise use default `semver.satisfies(targetVersion, range)`;
- treat `true` as the existing `satisfied` status;
- treat `false` or parser rejection as the existing `unproven` path;
- do not enable prerelease inclusion, loose mode, coercion, or DSH-specific exceptions.

Keep all existing verdict precedence and evidence IDs unchanged.

Verification:

- focused `plugin-check.spec.ts`;
- TypeScript compilation;
- lint/architecture policy.

## Task 4 — update normative semantics

Replace the temporary exact-only adapter paragraph in `spec/protocol.md` with the M3.1 behavior:

- exact equality and canonical npm range satisfaction can prove `satisfied`;
- default npm prerelease semantics are required;
- non-match/invalid relations remain `unproven` in this slice;
- negative mismatch proof remains future work.

Do not change Protocol schema/generated types because no structural field/value changes.

## Task 5 — repository verification and PR

Run the repository CI matrix on the exact PR head:

- Node 22.19 / 24.19 / 26 aggregate checks;
- Windows/macOS boundary smoke;
- build/package inspection;
- exact packed real-DSH check/verify;
- negative fail-closed verification;
- Host lifecycle;
- profile composition and target resolution.

Open/update a focused PR referencing #214. Resolve all blocking review threads before merge.

## Task 6 — real corpus full evidence

Run Real Plugin Corpus `full` on the exact implementation head (using a temporary validation-only workflow/branch if connector dispatch is unavailable; never leave the temporary workflow in the PR or `main`).

Compare the resulting static requirements with the pre-change full run `34710413402`:

- count `satisfied/unproven/missing/not-required-from-host` per plugin;
- confirm `dsh-tui` behavior from actual evidence rather than expectation;
- confirm `better-sidebar` remains incompatible on the two missing required Host packages;
- confirm prerelease/wildcard non-matches are not incorrectly promoted;
- require zero harness failures;
- ensure runtime receipts remain independently recorded.

Record exact run ID and result in the PR body.

## Completion gate

The slice is complete only when:

- RED was observed before production behavior;
- focused tests and architecture policy are green;
- lockfile is generated and deterministic;
- full repository CI is green on exact PR head;
- real full corpus has been executed with zero harness failures;
- no unresolved blocking review threads remain;
- final diff contains no unrelated M2/M4/target/provider changes.
