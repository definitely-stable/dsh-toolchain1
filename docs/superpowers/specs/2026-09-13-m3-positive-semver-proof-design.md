# M3.1 Positive SemVer Proof Design

Status: proposed implementation design for Issue #214.

Baseline: `main@b3c1075b2ce55862783a4fd296c9679002de0ab4`.

## Problem

`plugin.check` currently proves an installed Host peer relation only when the resolved target version string is exactly equal to the plugin's declared range string. Real ecosystem plugins commonly declare npm-compatible ranges (`^`, `~`, comparator sets, OR ranges, wildcards). The Real Plugin Corpus therefore records avoidable `unproven` results even where the exact installed version is provably accepted by the declared npm range.

The current conservative behavior is intentional: `spec/protocol.md` forbids a partial home-grown SemVer implementation and explicitly reserves a later npm-compatible adapter. This slice implements that reserved adapter without broadening the public result vocabulary.

## Decision

Use `semver@7.8.5` as the npm-compatible range evaluator. It is an ordinary Toolchain-owned runtime dependency, has no runtime dependencies of its own, and is runtime-neutral. TypeScript declarations use `@types/semver@7.8.0` as a development dependency.

Because `src/model` is semantic core, `semver` is added to the architecture policy as one explicit allowlisted semantic dependency. The deny-by-default policy remains unchanged for every other bare external package and receives regression coverage.

## Semantics

For an installed Host peer whose Contract Index exposes one exact target version:

1. Preserve exact string equality first. This keeps existing behavior for exact non-SemVer package identities and avoids turning a previously proven equality into an unknown solely because the external parser rejects the string.
2. Otherwise evaluate the exact target version against the declared range with canonical `semver.satisfies(targetVersion, range)`.
3. When the result is `true`, emit the existing requirement status `satisfied`.
4. When the result is `false`, or the version/range is malformed, retain the existing `unproven` status and `PLUGIN_DSH_VERSION_UNPROVEN` diagnostic.
5. Do not enable `includePrerelease`, loose parsing, coercion, or custom normalization. Normal npm prerelease semantics are part of the proof.

This is deliberately monotonic evidence strengthening: M3.1 converts only provable positives from `unproven` to `satisfied`. A canonical non-match is not yet promoted to a new public version-mismatch status or diagnostic. That later negative-proof change affects report vocabulary and `plugin.verify` reduction and remains a separate M3 slice.

## Ruleset identity

Keep `plugin-static-alpha-v1`.

The ruleset field identifies the existing static dependency/contract check family. M3.1 does not add/remove a check, requirement status, diagnostic code, Protocol field, or verdict value; it replaces the explicitly temporary exact-only evidence adapter inside the existing dependency-version check with the npm-compatible positive proof already reserved by the normative spec. Bumping the closed Protocol ruleset constant would create schema/generated/frontend churn without identifying a new rule surface.

## Architecture boundary

`analyzePluginCompatibility()` remains pure analysis over immutable `AcquiredPluginSubject` + `ContractIndex`. It performs no filesystem, package-manager, network, process, or DSH runtime access. `semver` is used only as a deterministic pure value evaluator.

The architecture gate changes narrowly from an empty semantic dependency allowlist to exactly `semver`; policy tests must prove `semver` is accepted from semantic code while another arbitrary bare package remains rejected.

## TDD cases

RED must demonstrate the existing exact-only adapter cannot prove:

- stable caret: target `4.0.2`, range `^4.0.1`;
- same-tuple prerelease caret: target `0.1.5-rc.2`, range `^0.1.5-rc.1`;
- OR range containing a matching prerelease comparator branch;
- Schemastery-style stable caret.

Regression cases must preserve:

- exact string equality is satisfied;
- a valid non-matching range remains `unproven`;
- wildcard `*` does not accept a prerelease target under normal npm semantics and therefore remains `unproven` in M3.1;
- malformed version/range remains `unproven` without throwing;
- missing required Host peers remain `incompatible`;
- absent optional peers remain `not-required-from-host`.

## Real-corpus acceptance

After repository CI is green, run the network-heavy Real Plugin Corpus `full` profile against the exact PR head.

Expected evidence direction:

- `dsh-tui` should lose semver-only uncertainty and may become `compatible-in-scope` if all 29 installed optional-peer relations are proven;
- `better-sidebar` must remain `incompatible` because two required Host packages are absent even if its other range relations become satisfied;
- `dsh-market`, `agent-teams`, and `at-file` must remain conservative where their declared ranges do not accept the target under normal prerelease semantics;
- runtime `plugin.verify` evidence remains independently reported and must not override declared static dependency semantics;
- harness failures must remain zero.

Corpus observations are evidence, not hard-coded production exceptions.

## Non-goals

- no new Protocol requirement status or diagnostic code;
- no negative version-mismatch proof in this slice;
- no `includePrerelease`, loose SemVer, version coercion, or DSH-specific range exceptions;
- no M2 retrieval/ranker changes;
- no M4 worker/lifecycle/verification-status changes;
- no target/lifecycle fingerprint changes;
- no provider/model evaluation changes;
- no attempt to make every corpus plugin green.
