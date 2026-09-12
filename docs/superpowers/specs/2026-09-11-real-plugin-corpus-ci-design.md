# Real Plugin Corpus CI Design

Date: 2026-09-11

## Goal

Add a bounded, evidence-first CI contour that exercises DSH Toolchain against real, popular third-party DeepSeek Harness plugins. This complements the deterministic synthetic performance/stress harness: synthetic fixtures remain the stable performance baseline, while the real-plugin corpus measures ecosystem compatibility and isolated integration behavior.

This contour must not redefine the frozen M2/H1 target/evaluation baseline and must not turn third-party incompatibility into a Toolchain merge failure.

## Target train

The corpus uses `@deepseek-ai/dsh@0.1.5-rc.2`, the current upstream CLI train at the time the corpus is pinned. Existing historical smoke/evaluation trains remain unchanged.

## Corpus v1

Every entry is pinned to an exact package version and canonical source commit SHA. Distribution is explicit: published npm artifacts are acquired by exact version; a source-distributed plugin may be packed from its exact Git commit only when the pinned source already contains its distributable build and the manifest identity is verified before packing. Candidate lifecycle/build scripts are never run during acquisition.

| id | category | distribution artifact | source commit | static check | isolated verify |
| --- | --- | --- | --- | --- | --- |
| modlens | vision | npm `@liustack/modlens@3.26.1` | `a1923d016c2b617ccd1d6ef3f9e9368622841e67` | yes | no |
| better-sidebar | web-ui | npm `dsh-better-sidebar@0.19.1` | `1fcf43ccbedd6e66370b7fb81df2b4dd0ef2604e` | yes | no |
| dsh-tui | terminal | npm `@deepseek-harness-tui/dsh-tui@0.10.1` | `ece45c2eb3b861b768000675b840679ed90bd650` | yes | no |
| dsh-market | marketplace | npm `dshmarket@1.45.1` | `f33c7fbe7dec0d826025383c3b76f5ade5583d04` | yes | yes |
| agent-teams | multi-agent | npm `@nanmicoder/dsh-agent-teams@0.1.17` | `18fba6211fc3aac305fc9bb1c8a7faaf7273137a` | yes | yes |
| at-file | developer-tool | exact Git source `dsh-at-file@0.7.0` | `da602d1a8f1b417b8a1d8d4059e0f4cb1c353524` | yes | yes |

`at-file` is intentionally `github-source`: its pinned `0.7.0` source contains the distributable `lib/` tree, while that exact version is not available from npm. The runner fetches only the exact pinned commit, verifies `package.json` name/version, and packs it with lifecycle scripts disabled.

`ModLens`, `dsh-better-sidebar`, and `dsh-TUI` remain static-only in v1 because their normal runtime surfaces introduce external/native/large interactive dependencies that would make the first corpus unnecessarily noisy. They can graduate to isolated verification later with explicit runtime assertions.

## Modes

### smoke

PR-oriented bounded lane. Runs static `plugin.check` for `modlens` and `at-file` only. Candidate code is never executed.

### static

Runs static `plugin.check` for all six corpus entries.

### full

Runs the complete static corpus, then isolated `plugin.verify` for the three entries marked `isolated verify = yes`.

## Semantics

A corpus result is evidence, not a popularity-based compatibility assertion.

`plugin.check` may legitimately return `compatible-in-scope`, `incompatible`, or `unproven`. `plugin.verify` may legitimately return `verified`, `partial`, or `failed`. `partial` is a valid verification report when runtime execution/cleanup succeeds but one or more required static or runtime claims remain unproven. Those semantic outcomes are recorded and summarized but do not by themselves fail the workflow.

`stale` and `cancelled` are valid Toolchain report states in the general protocol, but this corpus does not request cancellation and requires a stable target epoch. If either appears here, the corpus treats it as invalid run evidence and fails closed rather than counting it as ordinary compatibility evidence.

The corpus runner fails only when Toolchain/infrastructure evidence is invalid: child crash/timeout, malformed or missing Protocol JSON, missing required fingerprints/evidence, failed cleanup, acquisition integrity/provenance failure, unexpected target-epoch/cancellation state, or inability to persist bounded evidence.

## Isolation and security

- `permissions: contents: read` only.
- Checkout does not persist credentials.
- No repository/provider secrets are exposed to candidate execution.
- Candidate acquisition does not run install/package lifecycle scripts.
- Static checks execute no candidate code.
- Runtime verification uses the existing Toolchain `safe` disposable DSH verification boundary. It is isolation for verification correctness, not a malicious-code sandbox.
- Runtime execution is explicitly allowlisted to three exact-pinned entries in v1.
- Large bundles/services are excluded from v1.

## Evidence

Each run initializes durable evidence before third-party acquisition and appends every result immediately so a later failure preserves earlier evidence:

- `environment.json`
- `results.jsonl`
- `summary.json`
- `summary.md`

Each plugin result records corpus identity/provenance, acquisition mode, exact artifact SHA-256, target identity, Toolchain Protocol outcome, diagnostic codes, and optional verification-stage outcomes. Harness error messages are sanitized and length-bounded; raw third-party stdout/stderr is not persisted wholesale.

Artifacts use the repository-supported 7-day retention limit.

## CI topology

A dedicated `.github/workflows/real-plugin-corpus.yml` keeps network-heavy third-party corpus work out of required repository CI.

- pull requests: `smoke`
- manual dispatch: `smoke`, `static`, or `full`
- weekly schedule: `full`

The workflow runs on Ubuntu 24.04 / Node 24.19, packs the exact Toolchain revision, then invokes the corpus runner. Real-plugin semantic incompatibility, unproven evidence, partial verification, or verified runtime behavior is observational; only harness/evidence failure is blocking for that corpus job.
