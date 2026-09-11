# Real Plugin Corpus CI Design

Date: 2026-09-11

## Goal

Add a bounded, evidence-first CI contour that exercises DSH Toolchain against real, popular third-party DeepSeek Harness plugins. This complements the deterministic synthetic performance/stress harness: synthetic fixtures remain the stable performance baseline, while the real-plugin corpus measures ecosystem compatibility and isolated integration behavior.

This contour must not redefine the frozen M2/H1 target/evaluation baseline and must not turn third-party incompatibility into a Toolchain merge failure.

## Target train

The corpus uses `@deepseek-ai/dsh@0.1.5-rc.2`, the current upstream CLI train at the time the corpus is pinned. Existing historical smoke/evaluation trains remain unchanged.

## Corpus v1

All entries are pinned by exact npm package version and canonical source commit SHA. The initial corpus deliberately favors popular standalone plugins over large bundles/runtimes so CI stays bounded.

| id | category | npm artifact | source commit | static check | isolated verify |
| --- | --- | --- | --- | --- | --- |
| modlens | vision | `@liustack/modlens@3.26.1` | `a1923d016c2b617ccd1d6ef3f9e9368622841e67` | yes | no |
| better-sidebar | web-ui | `dsh-better-sidebar@0.19.1` | `1fcf43ccbedd6e66370b7fb81df2b4dd0ef2604e` | yes | no |
| dsh-tui | terminal | `@deepseek-harness-tui/dsh-tui@0.10.1` | `ece45c2eb3b861b768000675b840679ed90bd650` | yes | no |
| dsh-market | marketplace | `dshmarket@1.45.1` | `f33c7fbe7dec0d826025383c3b76f5ade5583d04` | yes | yes |
| agent-teams | multi-agent | `@nanmicoder/dsh-agent-teams@0.1.17` | `18fba6211fc3aac305fc9bb1c8a7faaf7273137a` | yes | yes |
| at-file | developer-tool | `dsh-at-file@0.7.0` | `da602d1a8f1b417b8a1d8d4059e0f4cb1c353524` | yes | yes |

The source commit is provenance metadata. CI consumes the published npm artifact that users actually install, records its exact SHA-256 and npm integrity metadata, and does not execute package lifecycle scripts while acquiring it.

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

`plugin.check` may legitimately return `compatible-in-scope`, `incompatible`, or `unproven`. `plugin.verify` may legitimately return `verified` or `failed`. Those semantic outcomes are recorded and summarized but do not by themselves fail the workflow.

The corpus runner fails only when Toolchain/infrastructure evidence is invalid: child crash/timeout, malformed or missing Protocol JSON, missing required fingerprints/evidence, target/profile mutation, acquisition integrity failure, or inability to persist bounded evidence.

## Isolation and security

- `permissions: contents: read` only.
- Checkout does not persist credentials.
- No repository/provider secrets are exposed to candidate execution.
- Published candidate acquisition does not run install/package lifecycle scripts.
- Static checks execute no candidate code.
- Runtime verification uses the existing Toolchain `safe` disposable DSH verification boundary. It is isolation for verification correctness, not a malicious-code sandbox.
- Large bundles/services are excluded from v1.

## Evidence

Each run writes incrementally so a later failure preserves earlier evidence:

- `environment.json`
- `results.jsonl`
- `summary.json`
- `summary.md`

Each plugin result records corpus identity/provenance, exact artifact identity, target identity, elapsed time, Toolchain Protocol outcome, diagnostic codes, and optional verification-stage outcomes. Raw third-party stdout/stderr is not persisted wholesale.

Artifacts use the repository-supported 7-day retention limit.

## CI topology

A dedicated `.github/workflows/real-plugin-corpus.yml` keeps network-heavy third-party corpus work out of required repository CI.

- pull request changes to corpus-related files: `smoke`
- manual dispatch: `smoke`, `static`, or `full`
- weekly schedule: `full`

The workflow runs on Ubuntu 24.04 / Node 24.19, packs the exact Toolchain revision, then invokes the corpus runner. Real-plugin semantic incompatibility is observational; harness/evidence failure is blocking for that corpus job.
