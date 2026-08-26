# M1 Target Intelligence Implementation Plan

> Status: **implemented; final corrective verification is tracked by PR #16 and `2026-08-27-m1-corrective-closure.md`.**

**Goal:** resolve one installed DSH profile/invocation into an immutable, evidence-backed `TargetSnapshot` with a deterministic `dsh-target-v2` fingerprint and expose the first useful `target resolve` CLI path.

**Architecture:** Node-specific filesystem/package discovery lives in `src/acquisition/`; canonical target semantics live in `src/model/`; the internal application kernel composes acquisition and digest ports and owns `resolveTarget()`. Protocol v1 is expanded only for the M1 target request/result. CLI is the first external projection; immediate M1.1 DSH/MCP parity follows after this vertical slice rather than being represented by placeholder operations.

**Tech stack:** TypeScript 6 / NodeNext ESM, Node 22.19+/24/26, pnpm 11.7, Vitest 4, JSON Schema Draft 2020-12, AJV 8. Node `crypto`/`fs`/`module` are confined to acquisition/frontend/test boundaries.

**Design:** [`2026-08-26-m1-target-intelligence-design.md`](2026-08-26-m1-target-intelligence-design.md)

**Current fingerprint decision:** [`ADR-0007`](../decisions/ADR-0007-complete-target-composition-fingerprint-v2.md). [`ADR-0006`](../decisions/ADR-0006-target-semantic-fingerprint-v1.md) is the superseded private pre-public v1 decision.

**Corrective closure:** [`2026-08-27-m1-corrective-closure.md`](2026-08-27-m1-corrective-closure.md)

## Non-negotiable constraints

- Semantic core (`product`, `protocol`, `model`, `kernel`) MUST remain free of Node builtins, DSH runtime packages, `process`, `Buffer`, and `fetch`.
- Acquisition is read-only and MUST NOT initialize, heal, or mutate DSH profiles.
- Fingerprint namespace is `dsh-target-v2`; future projection changes require another namespace.
- Absolute paths, timestamps, evidence locations, and Toolchain observer version/content MUST NOT affect semantic fingerprint.
- Complete current DSH composition ordering is semantic: bundle patches -> profile patch -> home patch -> ordered invocation overlays.
- `dsh-toolchain` itself remains evidence but is excluded from semantic target bundle/dependency identity.
- Only `target.resolve` is an implemented closed M1 operation contract. M2–M4 operations MUST NOT be advertised as callable capabilities.
- `createApplicationKernel()` remains internal package API.
- Runtime integration evidence must use real DSH/package seams rather than a fake host.

## Executed task map

| Task | Issue / gate | State | Primary evidence |
| --- | --- | --- | --- |
| 1. Close target Protocol contract | #17 | complete | schema/examples/generated types/conformance |
| 2. Implement semantic target identity | #18 + corrective gate | complete | v2 model sensitivity/stability tests + ADR-0007 |
| 2A. Close protocol/review drift | #17/#18 | complete | closed success/failure response + safe profile names + v2 contract |
| 3. Read-only target acquisition | #19 + corrective gate | complete | fixture-tree immutability + full patch-stack evidence + typed failures |
| 4. Kernel `resolveTarget()` | #20 | complete | fake-port RED→GREEN + architecture fitness |
| 5. CLI `target resolve` | #21 | complete | Protocol JSON projection + repeatable ordered `--patch` + exit semantics |
| 6. Real DSH trains/layouts | #22 + corrective gate | implementation complete | current/older train smoke + no-hint packaged discovery pending final CI confirmation |
| 7. Exact packaged DSH service boot | #23 | complete | real DSH loader/service probe + clean exit |
| 8. Final docs/review/evidence | PR #16 | in final verification | current-head CI and PR metadata become authoritative at merge |

---

## Task 1 — Closed M1 target Protocol contract

Implemented schema-owned types:

- `TargetResolveRequest = { profile, dshHome?, dshPackageRoot?, patches? }`;
- `ResolvedPackageIdentity = { name, version }`;
- `ResolvedBundleIdentity = { name, version, patchHash }`;
- M1 `TargetSnapshot` with DSH/runtime/profile/evidence fields;
- `TargetResolveResult`;
- closed `TargetResolveSuccessResponse | TargetResolveFailureResponse`;
- canonical success/failure examples.

`patches` is ordered and repeatable. Its path values are acquisition hints; ordered patch content hashes enter target identity.

Acceptance properties:

- arbitrary `data` cannot validate as target success;
- success requires snapshot data and fingerprint;
- failure requires at least one diagnostic and cannot carry successful data;
- unsafe profile names are rejected by protocol and acquisition boundaries;
- pre-public Protocol v1 evolution rules are explicit;
- target fingerprints emitted by the M1 success contract use `dsh-target-v2:<64 lowercase hex>`.

M1 did not create request/result schemas for Contract Intelligence, Plugin Analysis, or Verification.

## Task 2 — Complete deterministic target semantic projection

Implemented `TargetSemanticProjectionV2` and runtime-neutral `Sha256Port`.

Canonical identity includes:

- exact `@deepseek-ai/dsh` version;
- resolution/compatibility Node version/platform/architecture;
- profile name;
- ordered resolved bundle identities `{ name, version, patchHash }`, excluding `dsh-toolchain`;
- sorted resolved top-level profile dependencies, excluding `dsh-toolchain`;
- exact profile-patch content hash or v2 absence sentinel hash;
- exact home-patch content hash or v2 absence sentinel hash;
- ordered invocation-overlay content hashes.

Canonical identity excludes:

- `DSH_HOME`, package roots and overlay paths;
- evidence locations;
- timestamps;
- Toolchain observer version/content/path;
- usernames/machine identifiers/secrets.

Tests prove path/observer stability plus sensitivity to bundle order, bundle patch bytes without a version bump, profile/home patch bytes, overlay content/order, exact package versions, and runtime coordinates. Digest adapters that do not return 64 lowercase SHA-256 hex characters are rejected.

### Why v1 was superseded before merge

The original private v1 design hashed package versions and only the profile patch. Corrective review against current DSH boot semantics proved that this could identify two different effective compositions as the same target when bundle patch bytes, `$DSH_HOME/cordis.patch.yml`, or invocation overlays differed.

The project had no public fingerprint compatibility promise, and ADR-0006 already required a new namespace for semantic changes. ADR-0007 therefore replaces v1 with v2 instead of preserving a known false-sameness defect.

## Task 3 — Read-only Node target acquisition

Implemented:

- Node SHA-256 adapter in `src/acquisition/node-sha256.ts`;
- read-only DSH filesystem/package provider in `src/acquisition/dsh-filesystem.ts`;
- stable `TargetAcquisitionError` codes;
- content-hashed DSH/profile/bundle/dependency manifests;
- content-hashed bundle/profile/home/overlay patch evidence;
- installation-first then profile-local bundle resolution;
- exact installed profile dependencies rather than declared ranges;
- upstream-compatible missing profile/home patch behavior through distinct v2 sentinels;
- hard failure for a missing declared bundle patch or caller-supplied overlay;
- whole-fixture before/after checks for success and expected failure paths.

Default DSH discovery uses deterministic Node package-resolution anchors from Toolchain and the selected profile graph. It does not mutate profile fallback state and does not search PATH/launch subprocesses to guess an installation. Explicit `dshPackageRoot` remains the deterministic detached-inspection override.

## Task 4 — First real application-kernel use case

The internal kernel requires explicit ports:

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
  -> TargetSemanticProjectionV2
  -> dsh-target-v2 fingerprint
  -> immutable TargetSnapshot
  -> TargetResolveResult
```

The snapshot freezes bundle/dependency/overlay arrays and evidence rather than exposing mutable acquisition state.

Architecture fitness permits runtime adapters (DSH/CLI/MCP) to depend on acquisition while prohibiting semantic kernel code from importing the Node acquisition implementation.

## Task 5 — CLI `target resolve`

Implemented syntax:

```text
dsh-toolchain target resolve \
  --profile <name> \
  [--dsh-home <path>] \
  [--dsh-package-root <path>] \
  [--patch <path> ...]
```

Semantics:

- success: Protocol v1 JSON on stdout, exit `0`;
- expected target acquisition failure: `TargetResolveFailureResponse` JSON on stdout, exit `1`;
- CLI syntax error: stderr, exit `2`;
- unexpected infrastructure failures are not disguised as stable target diagnostics.

The CLI delegates target semantics to the shared kernel. It does not duplicate acquisition logic. Help advertises `target resolve` but not future M2/M3/M4 commands.

## Task 6 — Real DSH trains, pnpm layouts, and no-hint discovery

Authoritative registry-backed smoke covers:

- DSH `0.1.1-rc.2`;
- DSH `0.1.0-rc.8`;
- shipped `headless` profile;
- exact packed Toolchain artifact installed into the disposable package consumer.

For each train the final smoke is designed to:

1. install exact DSH and exact Toolchain `.tgz` into one disposable runner;
2. let official DSH initialize the shipped profile;
3. snapshot the profile tree;
4. invoke the installed Toolchain CLI **without** `--dsh-package-root` and require exact DSH discovery through the shared package graph;
5. require the profile tree to remain byte-identical;
6. copy the semantic profile to another absolute `DSH_HOME`;
7. resolve again with an explicit DSH package root;
8. require no-hint and explicit-root discovery to produce the same v2 fingerprint.

This is deliberately not simulated by creating a `$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh` link. Upstream profile fallback does not promise that the DSH application package itself lives there; a synthetic link would prove our fixture, not the product contract.

### Real pnpm layout defect found earlier

The first real M1 smoke exposed that `node_modules/@deepseek-ai/dsh` may be a pnpm symlink while DSH-owned bundles live beside its canonical target under `.pnpm/.../node_modules`. The resolver now considers both observed and `realpath` anchors while preserving observed evidence locations. A dedicated pnpm-symlink regression remains permanent.

## Task 7 — Exact packaged DSH boot and service visibility

The exact-tarball smoke advances beyond composition:

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

Final review specifically checks:

- semantic layers contain no Node/DSH runtime dependency leaks;
- fingerprint projection contains no paths/timestamps/evidence locations;
- every effective current DSH patch layer represented by M1 affects v2 identity;
- Protocol implementation changes remain target-specific;
- no future Contract/Plugin/Verification operation is advertised as implemented;
- acquisition remains read-only and performs no discovery-time healing;
- stable expected acquisition failures have typed codes and locations;
- exact-package live boot remains separate from read-only multi-train target acquisition;
- real package and registry checks run only in the authoritative primary lane rather than being multiplied across every OS/Node cell.

A CI run proves only the branch head it executed. Therefore this file intentionally does not hard-code the final GREEN run/head. The authoritative final-head verification, test count, DSH versions/profiles, RED→GREEN evidence, and merge SHA belong in PR #16 and the corrective closure record immediately before merge.

## M1 boundary after completion

Implemented:

```text
exact installed DSH target + invocation patch evidence
        ↓
read-only evidence acquisition
        ↓
complete normalized composition projection
        ↓
dsh-target-v2 fingerprint
        ↓
immutable TargetSnapshot
        ↓
CLI Protocol v1 target.resolve
```

Not implemented by M1:

- native DSH/MCP public `target.resolve` projections — immediate M1.1;
- `contract.search` / `contract.inspect` and their evidence/index identity — M2;
- plugin source/artifact analysis — M3/alpha check path;
- isolated candidate verification / receipts — M4;
- DSH Web UI — M5.

Those capabilities must reuse this target model rather than creating another target identity layer.
