# M1 Target Intelligence Implementation Plan

> Status: **implemented; authoritative final-head verification is recorded on PR #16.**

**Goal:** resolve one installed DSH profile into an immutable, evidence-backed `TargetSnapshot` with a deterministic `dsh-target-v1` fingerprint and expose the first useful `target resolve` CLI path.

**Architecture:** Node-specific filesystem/package discovery lives in `src/acquisition/`; canonical target semantics live in `src/model/`; the internal application kernel composes acquisition and digest ports and owns `resolveTarget()`. Protocol v1 is expanded only for the M1 target request/result. CLI is the first external projection; DSH/MCP parity follows after this vertical slice rather than being represented by placeholder operations.

**Tech stack:** TypeScript 6 / NodeNext ESM, Node 22.19+/24/26, pnpm 11.7, Vitest 4, JSON Schema Draft 2020-12, AJV 8. Node `crypto`/`fs`/`module` are confined to acquisition/frontend/test boundaries.

**Design:** [`2026-08-26-m1-target-intelligence-design.md`](2026-08-26-m1-target-intelligence-design.md)

**Fingerprint decision:** [`ADR-0006`](../decisions/ADR-0006-target-semantic-fingerprint-v1.md)

## Non-negotiable constraints

- Semantic core (`product`, `protocol`, `model`, `kernel`) MUST remain free of Node builtins, DSH runtime packages, `process`, `Buffer`, and `fetch`.
- Acquisition is read-only and MUST NOT initialize or mutate DSH profiles.
- Fingerprint namespace is exactly `dsh-target-v1`; changing projection semantics requires a new namespace.
- Absolute paths, timestamps, and evidence locations MUST NOT affect semantic fingerprint.
- Bundle order remains semantic; profile dependency identities are normalized deterministically.
- `dsh-toolchain` itself remains evidence but is excluded from semantic target identity.
- Only `target.resolve` is an implemented closed M1 operation contract. M2–M4 operations MUST NOT be advertised as callable capabilities.
- `createApplicationKernel()` remains internal package API.
- Runtime integration evidence must use real DSH/package seams rather than a fake host.

## Executed task map

| Task | Issue | State | Primary evidence |
| --- | --- | --- | --- |
| 1. Close target Protocol contract | #17 | complete | schema/examples/generated types/conformance |
| 2. Implement semantic fingerprint v1 | #18 | complete | model sensitivity/stability tests + ADR-0006 |
| 2A. Close review drift | #17/#18 | complete | closed success/failure response + safe profile names |
| 3. Read-only target acquisition | #19 | complete | fixture tree immutability + typed failures |
| 4. Kernel `resolveTarget()` | #20 | complete | fake-port RED→GREEN + architecture fitness |
| 5. CLI `target resolve` | #21 | complete | Protocol JSON projection + exit semantics |
| 6. Real DSH trains/layouts | #22 | complete | registry-backed current/older train smoke |
| 7. Exact packaged DSH service boot | #23 | complete | real DSH loader/service probe + clean exit |
| 8. Final docs/review/evidence | PR #16 | repository updates complete | current-head CI and PR metadata are authoritative |

---

## Task 1 — Close the M1 target Protocol contract

Implemented:

- `TargetResolveRequest = { profile, dshHome?, dshPackageRoot? }`;
- exact `ResolvedPackageIdentity`;
- M1 `TargetSnapshot` with DSH/runtime/profile/evidence fields;
- `TargetResolveResult`;
- closed `TargetResolveSuccessResponse | TargetResolveFailureResponse`;
- canonical success and failure examples;
- generated TypeScript types owned by JSON Schema.

Acceptance properties:

- arbitrary `data` cannot validate as target success;
- success requires snapshot data and fingerprint;
- failure requires at least one diagnostic and cannot carry success data;
- unsafe profile names are rejected by protocol and acquisition boundaries;
- pre-public Protocol v1 evolution rules are explicit.

M1 did not create request/result schemas for Contract Intelligence, Plugin Analysis, or Verification.

## Task 2 — Deterministic target semantic projection and fingerprint

Implemented `TargetSemanticProjectionV1` and runtime-neutral `Sha256Port`.

Canonical identity includes:

- exact `@deepseek-ai/dsh` version;
- Node version/platform/architecture;
- profile name;
- ordered resolved bundle identities, excluding `dsh-toolchain`;
- sorted resolved top-level profile dependency identities, excluding `dsh-toolchain`;
- exact profile-patch content hash or the absent-patch sentinel hash.

Canonical identity excludes:

- `DSH_HOME` and absolute package paths;
- evidence locations;
- timestamps;
- Toolchain observer version/path;
- usernames/machine identifiers/secrets.

Tests prove path/observer stability plus sensitivity to bundle order, patch bytes, exact package versions, and runtime coordinates. Digest adapters that do not return 64 lowercase SHA-256 hex characters are rejected.

## Task 2A — Review corrections before filesystem acquisition

Corrections implemented before broad acquisition work:

- success/failure response union made closed and operation-specific;
- profile traversal names rejected before filesystem path composition;
- canonical ordering uses locale-independent code-point comparison;
- Toolchain observer excluded from both semantic bundle/dependency lists;
- absent `cordis.patch.yml` receives the exact `dsh-target-v1:profile-patch:absent` sentinel input.

These corrections are recorded in Protocol, generated types, tests, design, and ADR-0006 rather than existing only in review history.

## Task 3 — Read-only Node target acquisition

Implemented:

- Node SHA-256 adapter in `src/acquisition/node-sha256.ts`;
- read-only DSH filesystem/package provider in `src/acquisition/dsh-filesystem.ts`;
- stable `TargetAcquisitionError` codes;
- content-hashed manifest/profile/patch/bundle/dependency evidence;
- installation-first then profile-local bundle resolution;
- exact installed profile dependencies rather than declared ranges;
- upstream-compatible missing `dsh` section / missing patch behavior;
- whole-fixture before/after checks for expected success and failure paths.

Acquisition uses reads and package resolution only. Missing profiles are reported rather than initialized.

## Task 4 — First real application-kernel use case

The internal kernel now requires explicit ports:

```ts
createApplicationKernel({
  targetAcquisition,
  digest,
  now?,
})
```

and exposes internally:

```ts
resolveTarget(request): Promise<TargetResolveResult>
```

Flow:

```text
TargetResolveRequest
  -> TargetAcquisitionPort.acquire() exactly once
  -> TargetSemanticProjectionV1
  -> dsh-target-v1 fingerprint
  -> immutable TargetSnapshot
  -> TargetResolveResult
```

TDD evidence established that the new kernel tests failed before `resolveTarget()` existed and passed after minimal orchestration was added.

Architecture fitness explicitly permits runtime adapters (DSH/CLI/MCP) to depend on acquisition while prohibiting semantic kernel code from importing the Node acquisition implementation.

## Task 5 — CLI `target resolve`

Implemented syntax:

```text
dsh-toolchain target resolve --profile <name> [--dsh-home <path>] [--dsh-package-root <path>]
```

Semantics:

- success: Protocol v1 JSON on stdout, exit `0`;
- expected target acquisition failure: `TargetResolveFailureResponse` JSON on stdout, exit `1`;
- CLI syntax error: stderr, exit `2`;
- unexpected infrastructure failures are not disguised as stable target diagnostics.

The CLI delegates target semantics to the shared kernel. It does not duplicate acquisition logic. Help advertises `target resolve` but not future M2/M3/M4 commands.

## Task 6 — Real DSH trains and package layouts

Authoritative registry-backed smoke covers:

- DSH `0.1.1-rc.2`;
- DSH `0.1.0-rc.8`;
- shipped `headless` profile.

For each train:

1. install exact DSH into a disposable runner;
2. let official DSH initialize the shipped profile;
3. snapshot the profile tree;
4. invoke built Toolchain `target resolve` with explicit DSH home/package root;
5. require the profile tree to remain byte-identical;
6. copy the semantic profile to another absolute `DSH_HOME`;
7. resolve again and require the same fingerprint.

The smoke also verifies Protocol version, exact DSH version/profile, and `dsh-target-v1:<64 lowercase hex>` format.

### Real pnpm layout defect found by this task

The first real smoke exposed a production defect hidden by flat test fixtures: `node_modules/@deepseek-ai/dsh` may be a pnpm symlink while DSH-owned bundles live beside its canonical target under `.pnpm/.../node_modules`. The original resolver accidentally succeeded in the first DSH home because DSH had healed `$DSH_HOME/profiles/node_modules`; the copied home correctly exposed the missing installation lookup.

A dedicated RED regression fixture reproduced that topology without the healed fallback. The production fix now resolves package candidates from both the observed anchor and `realpath(anchor)`, while evidence preserves the observed location. This keeps installation-first semantics correct for real pnpm installs.

The regression test remains permanent so future resolver refactors cannot silently restore dependence on DSH's healed fallback.

## Task 7 — Exact packaged DSH boot and service visibility

The existing exact-tarball smoke now advances beyond composition:

```text
pack exact Toolchain .tgz
  -> install into disposable DSH profile
  -> dump/validate real composition
  -> install external disposable probe bundle
  -> actual `dsh --profile toolchain-smoke` boot
  -> probe injects `toolchain`
  -> `ctx.toolchain.describe()`
  -> validate descriptor marker
  -> launcher-owned `ctx.appExit(0)`
  -> clean shutdown
```

The probe is test infrastructure outside the distributable Toolchain package. Production code gains no smoke endpoint, test mode, or process-exit branch.

The exact package smoke still separately validates the canonical `web` composition.

## Task 8 — Final review and evidence discipline

Repository documentation now states the actual M1 capability rather than the previous M0-only status. Final review specifically checks:

- semantic layers contain no Node/DSH runtime dependency leaks;
- fingerprint projection contains no paths/timestamps/evidence locations;
- Protocol implementation changes are target-specific;
- no future Contract/Plugin/Verification operation is advertised as implemented;
- acquisition remains read-only;
- stable expected acquisition failures have typed codes and locations;
- exact-package live boot remains separate from read-only multi-train target acquisition;
- real package and registry checks run only in the authoritative primary lane rather than being multiplied across every OS/Node cell.

A CI run proves only the branch head it executed. Therefore this file intentionally does not hard-code a “final” run number or head SHA. The authoritative current-head verification, test count, DSH versions/profiles, and RED→GREEN evidence belong in PR #16 immediately before review/merge.

## M1 boundary after completion

Implemented:

```text
exact installed DSH target
        ↓
read-only evidence acquisition
        ↓
normalized semantic projection
        ↓
dsh-target-v1 fingerprint
        ↓
immutable TargetSnapshot
        ↓
CLI Protocol v1 target.resolve
```

Not implemented by M1:

- `contract.search` / `contract.inspect`;
- plugin source/artifact analysis;
- isolated candidate verification / receipts;
- DSH Web UI;
- public native DSH/MCP `target.resolve` projections beyond shared internal kernel wiring.

Those capabilities must reuse this target model rather than creating another target identity layer.
