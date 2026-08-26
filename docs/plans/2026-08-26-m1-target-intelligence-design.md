# M1 Target Intelligence — Design

Status: **Approved implementation design; corrected by ADR-0007 before merge**

## Product decision

DSH Toolchain is not another plugin doctor, lifecycle runner, marketplace, or hosted compatibility radar. Its primary responsibility is to turn one exact DSH target into a stable, evidence-backed machine model that every later capability can reuse.

The first useful product path is therefore:

```text
exact installed DSH target
        ↓
target.resolve
        ↓
immutable TargetSnapshot + evidence
        ↓
contract intelligence / plugin checks / verification later
```

The longer-term user-facing product is **Exact Target Plugin Check**: a plugin source/artifact checked against one exact installed target with contract, dependency, diagnostic, and verification evidence. M1 builds only the target half of that flow.

## External ecosystem boundary

Current ecosystem tools validate the problem but do not change Toolchain's core boundary:

- official DSH generated catalogs and `cordis_inspect_*` provide authoritative/observed acquisition seams and should be consumed rather than reimplemented;
- `dsh-plugin-doctor` is a useful fast author-side preflight and evidence source for known failure classes;
- `dsh-testkit` is a useful reference/integration candidate for deep real-host lifecycle verification;
- `upstream-radar` is a useful hosted compatibility/evidence consumer, not a capability Toolchain needs to reproduce as a service.

Toolchain may integrate with these systems later, but its semantic model and receipts must not depend on any one community implementation.

`cordis_inspect_*` is opt-in in current DSH compositions, so it cannot be the only acquisition path. M2 treats official inspect/runtime data as one evidence provider alongside generated catalogs, package/config metadata, declarations, and source-backed facts.

## M1 scope

M1 defines and implements only the data and behavior required to answer:

> Which exact DSH target am I looking at, and what stable identity should later analysis bind to?

M1 includes:

1. a canonical `TargetResolveRequest`;
2. read-only DSH/profile/package discovery;
3. normalized target facts and evidence;
4. deterministic semantic projection and fingerprint;
5. `target.resolve` through the application kernel;
6. an initial CLI projection;
7. fixtures and real-target smoke proving sensitivity/stability across target changes.

M1 does **not** define contract search, plugin models, typed repairs, verification operations, Web UI, generic package-identity taxonomies, or a security sandbox policy.

## Target locator

The transport-neutral M1 request is intentionally small:

```ts
interface TargetResolveRequest {
  profile: string
  dshHome?: string
  dshPackageRoot?: string
  patches?: string[]
}
```

`profile` is semantic input. `dshHome` and `dshPackageRoot` are acquisition hints and may be absolute paths, but they are never copied into semantic identity. `patches` contains ordered acquisition paths corresponding to DSH invocation-level `--patch` overlays; the paths remain evidence only while their ordered content hashes are semantic.

Defaults at the Node acquisition boundary:

- `dshHome`: current DSH home resolution (`DSH_HOME` when set, otherwise the platform default used by DSH);
- `dshPackageRoot`: deterministic Node package resolution from the installed Toolchain/profile graph, or an explicit override when detached inspection cannot resolve the target safely;
- `patches`: empty unless the caller is describing a DSH invocation with explicit overlays.

Default discovery MUST NOT initialize/heal the DSH home and MUST NOT search PATH or launch a subprocess merely to guess an unrelated DSH installation. CI proves the no-hint path by installing the exact Toolchain `.tgz` and the tested DSH train into one real disposable package graph. Native DSH projection in M1.1 can use installation context supplied by the Host.

The kernel receives the request plus acquisition/digest ports. It does not read environment variables, paths, package files, `process`, or Node crypto directly.

## DSH acquisition model

The first provider is a Node filesystem/package provider because it works from CLI/CI without requiring a live DSH process.

It follows current upstream DSH profile/boot semantics:

- profiles live under `$DSH_HOME/profiles/<name>`;
- profile `package.json` owns `dsh.profile.bundles` in semantic order;
- shipped `web` is `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`;
- shipped `headless` is `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`;
- unknown profiles default to `@deepseek-ai/dsh-base` when **DSH itself** initializes them; Toolchain never performs that initialization for resolution;
- bundle resolution is installation-first, then profile-local, matching upstream loader behavior;
- each declared bundle patch is an ordered semantic input and its exact UTF-8 bytes affect target identity;
- profile `cordis.patch.yml`, when present, follows bundle layers;
- `$DSH_HOME/cordis.patch.yml`, when present, follows the profile patch;
- caller-declared `patches` model ordered invocation-level `--patch` overlays applied after the home layer.

Acquisition is read-only. Missing/uninitialized targets produce diagnostics instead of mutating or initializing the profile.

## Target semantic projection v2

The fingerprint is not a hash of the public snapshot object. It is a hash of an explicit compatibility projection. ADR-0007 supersedes the private pre-public v1 projection after corrective review found that v1 omitted some effective composition layers.

```ts
interface TargetSemanticProjectionV2 {
  schema: 'dsh-target-v2'
  dsh: {
    name: '@deepseek-ai/dsh'
    version: string
  }
  runtime: {
    nodeVersion: string
    platform: string
    arch: string
  }
  profile: {
    name: string
    bundles: readonly {
      name: string
      version: string
      patchHash: string
    }[]
    dependencies: readonly {
      name: string
      version: string
    }[]
    profilePatchHash: string
    homePatchHash: string
    overlayPatchHashes: readonly string[]
  }
}
```

Rules:

- bundle order is preserved because DSH applies bundle patches in order;
- every non-observer bundle identity contains the exact resolved version plus SHA-256 of its declared patch bytes;
- `dsh-toolchain` itself is removed from semantic bundles/dependencies while preserving every other bundle's relative order; observer manifests/patches remain evidence;
- profile dependencies are sorted by package name then version because object declaration order is not semantic;
- `profilePatchHash` hashes exact profile patch contents or `dsh-target-v2:profile-patch:absent`;
- `homePatchHash` hashes exact home patch contents or `dsh-target-v2:home-patch:absent`;
- `overlayPatchHashes` preserve caller order and hash exact patch contents; overlay paths are excluded;
- a missing declared bundle patch or requested overlay fails exact acquisition instead of fabricating an identity;
- exact patch bytes are deliberately conservative: comment/format-only edits may change the fingerprint rather than risk false semantic sameness from an incomplete YAML/`!!js` normalizer;
- DSH/package versions are exact resolved versions, not declared ranges;
- Node version, platform, and architecture are included because native/runtime behavior can differ across them;
- timestamps, usernames, absolute paths, `DSH_HOME`, temporary paths, evidence locations, Toolchain's own package version/content/path, and secrets are excluded.

Canonical serialization is deterministic JSON with recursively sorted object keys. Arrays retain their defined semantic order. The fingerprint is:

```text
dsh-target-v2:<lowercase SHA-256 hex of canonical projection JSON>
```

Changing the semantic projection again requires a new namespace rather than silently reinterpreting v2.

M1 deliberately does not hash entire package/source trees. Bundle patch bytes are included because they directly determine DSH composition. M2 must define a separate contract evidence/index identity over the actual generated catalog/type/source/runtime evidence it consumes so same-version local contract edits cannot validate stale contract caches.

## Runtime meaning

`TargetSnapshot.runtime` records the Node/platform/architecture under which Toolchain resolves compatibility for the snapshot. It is not proof that an unrelated separately launched DSH process used the same runtime.

A later live observation or verification receipt records its actually executed runtime and must not claim equivalence when runtime-sensitive target semantics differ. M1 does not introduce speculative `inspectionRuntime`/`verificationRuntime` DTOs before those use cases exist.

## Snapshot and evidence

`TargetSnapshot` is the normalized public result. It includes the semantic fingerprint, capture time, normalized DSH/runtime/profile facts, support status, and evidence references. Absolute acquisition paths remain evidence locations, never semantic identity.

Evidence for the first provider includes at minimum:

- DSH package manifest;
- profile manifest;
- profile patch or observed absence sentinel;
- home patch or observed absence sentinel;
- each resolved bundle manifest and its declared patch;
- resolved top-level profile dependency manifests, including Toolchain itself when installed;
- each caller-declared invocation overlay.

Evidence records use content hashes so later freshness checks can reacquire the same inputs without relying on timestamps.

## Protocol evolution policy

Do not design all future request/response DTOs now.

M1 closes only the `target.resolve` contract:

- `TargetResolveRequest`;
- `ResolvedBundleIdentity` / `ResolvedPackageIdentity` required by the target result;
- `TargetResolveResult`;
- the M1 `TargetSnapshot` shape;
- a response schema that binds `data` to `TargetResolveResult` for this operation.

M2 adds search/inspect contracts when those use cases exist. M3 adds plugin/diagnostic contracts. M4 evolves verification/operation contracts with the actual worker.

Protocol v1 remains pre-public in the private incubator. Before the first public Protocol v1 release, the final v1 schema directory will be frozen and later breaking structural changes will require a new Protocol version. The target fingerprint namespace is a separate compatibility axis and already moved from private v1 to v2 under ADR-0007.

## Application kernel

M0 intentionally kept `createApplicationKernel()` internal. M1 gives it its first real dependency shape:

```ts
interface TargetAcquisitionPort {
  acquire(request: TargetResolveRequest): Promise<AcquiredTargetFacts>
}

interface Sha256Port {
  sha256Utf8(value: string): Promise<string>
}

interface ApplicationKernel {
  describe(): KernelDescriptor
  resolveTarget(request: TargetResolveRequest): Promise<TargetResolveResult>
}

function createApplicationKernel(options: {
  targetAcquisition: TargetAcquisitionPort
  digest: Sha256Port
  now?: () => string
}): ApplicationKernel
```

The acquisition port returns normalized acquisition facts plus evidence inputs; the kernel/model performs semantic normalization/fingerprinting without Node/DSH IO. Node implementations of SHA-256 live in the acquisition/runtime boundary; a future browser projection can provide WebCrypto without changing target semantics.

The factory remains internal package API during M1. Frontends inside the same package compose the correct provider.

## First frontend and immediate parity

The first projection is CLI because it gives the fastest independent proof outside a live DSH process:

```text
dsh-toolchain target resolve --profile web \
  [--dsh-home PATH] \
  [--dsh-package-root PATH] \
  [--patch PATH ...]
```

Machine output is versioned JSON. Human rendering may follow after the machine contract is stable.

After M1 merges, M1.1 immediately projects the same kernel use case through `ctx.toolchain`, one small native DSH model-facing target tool, and MCP. That parity work must not duplicate acquisition/fingerprint logic or introduce transport-owned target DTOs.

## Real-target verification

Fixtures and CI cover at least:

- identical semantic target under two different absolute homes → same fingerprint;
- Toolchain observer version/content/path change only → same fingerprint;
- bundle-order change → different fingerprint;
- bundle patch byte change without version bump → different fingerprint;
- profile patch change → different fingerprint;
- home patch change → different fingerprint;
- invocation overlay content/order change → different fingerprint;
- overlay path change with the same contents/order → same fingerprint;
- resolved bundle version change → different fingerprint;
- profile dependency declaration order only → same fingerprint;
- Node/platform/arch change → different fingerprint;
- timestamp/evidence location change → same fingerprint;
- exact packed Toolchain + DSH co-install resolves without `dshPackageRoot`;
- no-hint versus explicit-root discovery of equivalent targets → same fingerprint.

CI resolves the pinned current DSH train and one older train/profile so the provider is not accidentally hard-coded to one layout.

## Adjacent hardening

A real packaged DSH boot/`ctx.toolchain` visibility smoke is part of M1 hardening, but it is a packaging/runtime integration gate rather than part of the semantic fingerprint algorithm.

A non-blocking `latest` DSH canary and a real MCP child-process negotiation test remain useful follow-up work; neither is allowed to replace exact pinned artifact evidence.

## Success criterion

M1 is successful when a coding agent or CI can ask Toolchain for a target and receive a reproducible identity that:

- changes for every current DSH composition layer represented by the target;
- stays stable across irrelevant machine/path/observer changes;
- is backed by explicit evidence;
- is produced without mutating the DSH profile;
- can discover DSH without an explicit package root in a supported co-install graph;
- is independent of CLI/MCP/DSH transport semantics.
