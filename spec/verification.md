# DSH Toolchain Verification Specification

Status: **Baseline specification**

This document defines what `plugin.verify` means. Passing static analysis or a TypeScript build is not equivalent to verified DSH behavior.

## Verification subject

The subject is a concrete candidate artifact plus a concrete DSH target snapshot.

Before runtime installation, Toolchain SHOULD verify the package artifact that would be installed by a user (for an npm-style plugin, the packed tarball/pack preview), not only the working tree.

The report records:
- candidate artifact fingerprint;
- starting target snapshot fingerprint;
- execution policy;
- checks requested and checks executed;
- diagnostics;
- cleanup outcome;
- final freshness status.

## Verification stages

Protocol v1 recognizes the following stage identities:

1. `structure` — required files/layout that can be checked without execution;
2. `manifest` — package/bundle/composition metadata;
3. `dependency` — dependency/peer/core-identity compatibility;
4. `contract` — statically inferable use of DSH contracts;
5. `build` — configured build/type/test commands when policy permits;
6. `package` — inspect the actual distributable package;
7. `install` — install into the temporary target profile;
8. `compose` — run the official DSH composition/configuration path (for example the applicable `--dump-config` route);
9. `boot` — start the selected DSH target/profile;
10. `visibility` — prove declared service/tool/client capability is visible through the relevant live DSH seam;
11. `behavior` — explicitly declared safe fixture behavior.

Implementations MAY skip stages that do not apply, but MUST record the skip and reason. They MUST NOT imply an unexecuted stage passed.

## Isolation

Default verification uses policy `safe` and MUST NOT intentionally mutate the user's active DSH profile.

Runtime candidate execution occurs in a separate process using a temporary DSH home/workspace. The verifier MUST NOT describe this as a security sandbox.

The worker receives an allowlisted environment chosen by Toolchain. Credentials are not silently copied from the user's active profile.

## Freshness

The verifier captures the starting target snapshot. Before producing `verified`, it MUST determine whether compatibility-relevant target state changed during the operation.

If the target changed and the executed evidence cannot be proven to correspond to the new state, final status is `stale`.

## Status

Baseline verification report statuses:

- `verified` — all required requested checks passed against a fresh target;
- `failed` — one or more required checks failed;
- `partial` — some requested checks could not be executed and the caller's policy does not allow a verified claim;
- `stale` — target state invalidated the evidence;
- `cancelled` — operation was cancelled before a terminal verification conclusion.

Infrastructure failure is represented by diagnostics and `failed`/`partial` according to whether semantic checks could be concluded.

## Failure isolation

Where components/checks are independent, failure in one SHOULD NOT discard successful evidence from others. Fatal package-level defects may prevent all downstream execution.

## Cleanup

The verifier MUST attempt cleanup after success, failure, cancellation, and worker errors.

Cleanup failure MUST be reported. A cleanup error MUST NOT rewrite a prior verification failure into success.

## Evidence receipt

A verification report is intended to be portable evidence, not a guarantee for all machines/versions. It MUST name the candidate and target fingerprints and the exact checks executed.

Future CI badges/compatibility databases MUST derive claims from receipts rather than from package version alone.
