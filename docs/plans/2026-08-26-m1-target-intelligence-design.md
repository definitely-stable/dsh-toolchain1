# M1 Target Intelligence — Design

Status: **Approved implementation design**

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

`cordis_inspect_*` is opt-in in current DSH compositions, so it cannot be the only acquisition path. M2 will treat official inspect/runtime data as one evidence provider alongside generated catalogs, package/config metadata, declarations, and source-backed facts.

## M1 scope

M1 defines and implements only the data and behavior required to answer:

> Which exact DSH target am I looking at, and what stable identity should later analysis bind to?

M1 includes:

1. a canonical `TargetLocator` request;
2. read-only DSH/profile/package discovery;
3. normalized target facts and evidence;
4. deterministic semantic projection and fingerprint;
5. `target.resolve` through the application kernel;
6. an initial CLI projection;
7. fixtures proving sensitivity/stability across target changes.

M1 does **not** define contract search, plugin models, typed repairs, verification operations, Web UI, generic package-identity taxonomies, or a security sandbox policy.

## Target locator

The transport-neutral M1 request is intentionally small:

```ts
interface TargetResolveRequest {
  profile: string
  dshHome?: string
  dshPackageRoot?: string
}
```

`profile` is semantic input. `dshHome` and `dshPackageRoot` are acquisition hints and may be absolute paths, but they are never copied into semantic identity.

Defaults at the Node acquisition boundary:

- `dshHome`: current DSH home resolution (`DSH_HOME` when set, otherwise the platform default used by DSH);
- `dshPackageRoot`: resolve the installed `@deepseek-ai/dsh` package from the execution environment, or require an explicit override when it cannot be resolved safely.

The kernel receives the request plus acquisition/digest ports. It does not read environment variables, paths, package files, `process`, or Node crypto directly.

## DSH acquisition model

The first provider is a Node filesystem/package provider because it works from CLI/CI without requiring a live DSH process.

It follows current upstream DSH profile semantics:

- profiles live under `$DSH_HOME/profiles/<name>`;
- profile `package.json` owns `dsh.profile.bundles` in semantic order;
- shipped `web` is `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`;
- shipped `headless` is `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`;
- unknown profiles default to `@deepseek-ai/dsh-base` when DSH initializes them;
- bundle resolution is installation-first, then profile-local, matching upstream loader behavior;
- profile `cordis.patch.yml` is an ordered semantic layer and its content affects target identity.

Acquisition is read-only. Missing/uninitialized targets produce diagnostics instead of mutating or initializing the profile.

## Target semantic projection v1

The fingerprint is not a hash of the public snapshot object. It is a hash of an explicit compatibility projection.

```ts
interface TargetSemanticProjectionV1 {
  schema: 'dsh-target-v1'
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
    }[]
    dependencies: readonly {
      name: string
      version: string
    }[]
    patchHash: string
  }
}
```

Rules:

- bundle order is preserved because DSH applies bundle patches in order;
- profile dependencies are sorted by package name because object declaration order is not semantic;
- `dsh-toolchain` itself is excluded from semantic profile dependencies so changing the observer version does not rename the target; it remains captured as evidence;
- `patchHash` is SHA-256 of the exact profile patch bytes; the path is excluded;
- exact patch bytes are deliberately conservative in v1: comment/format-only edits may change the fingerprint rather than risk false semantic sameness from an incomplete YAML/`!!js` normalizer;
- DSH/package versions are exact resolved versions, not declared ranges;
- Node version, platform, and architecture are included because native/runtime behavior can differ across them;
- timestamps, usernames, absolute paths, `DSH_HOME`, temporary paths, evidence locations, Toolchain's own package version/path, and secrets are excluded.

Canonical serialization is deterministic JSON with recursively sorted object keys. Arrays retain their defined semantic order. The fingerprint is:

```text
dsh-target-v1:<lowercase SHA-256 hex of canonical projection JSON>
```

Changing the semantic projection requires a new namespace (`dsh-target-v2`), not a silent reinterpretation of existing fingerprints.

M1 deliberately does not pretend that a locally modified package with an unchanged package version is indistinguishable from its published artifact forever. Evidence retains content hashes/locations where available; support for stronger development-install identities may be added from real fixtures without redefining `dsh-target-v1`.

## Snapshot and evidence

`TargetSnapshot` is the normalized public result. It includes the semantic fingerprint, capture time, normalized DSH/runtime/profile facts, support status, and evidence references. Absolute acquisition paths remain evidence locations, never semantic identity.

Evidence for the first provider includes at minimum:

- DSH package manifest;
- profile manifest;
- profile patch;
- each resolved bundle manifest;
- resolved top-level profile dependency manifests, including Toolchain itself when installed.

Evidence records use content hashes so later freshness checks can reacquire the same inputs without relying on timestamps.

## Protocol evolution policy

Do not design all future request/response DTOs now.

M1 closes only the `target.resolve` contract:

- `TargetResolveRequest`;
- `TargetResolveResult`;
- the M1 `TargetSnapshot` shape;
- a response schema that binds `data` to `TargetResolveResult` for this operation.

M2 adds search/inspect contracts when those use cases exist. M3 adds plugin/diagnostic contracts. M4 evolves verification/operation contracts with the actual worker.

Protocol v1 remains pre-public in the private incubator. Before the first public Protocol v1 release, the final v1 schema directory will be frozen and later breaking structural changes will require v2.

## Application kernel

M0 intentionally kept `createApplicationKernel()` internal. M1 gives it its first real dependency shape:

```ts
interface TargetAcquisitionPort {
  acquire(request: TargetResolveRequest): Promise<AcquiredTarget>
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

## First frontend

The first projection is CLI because it gives the fastest independent proof outside a live DSH process:

```text
dsh-toolchain target resolve --profile web [--dsh-home PATH] [--dsh-package-root PATH]
```

Machine output is versioned JSON. Human rendering may follow after the machine contract is stable. MCP/DSH parity comes after the core vertical slice is proven; no placeholder tools are advertised.

## Real-target verification

Fixtures cover at least:

- identical semantic target under two different absolute homes → same fingerprint;
- Toolchain observer version/path change only → same fingerprint;
- bundle-order change → different fingerprint;
- profile patch change → different fingerprint;
- resolved bundle version change → different fingerprint;
- profile dependency declaration order only → same fingerprint;
- Node/platform/arch change → different fingerprint;
- timestamp/evidence location change → same fingerprint.

CI also resolves at least the pinned current DSH train and one older supported fixture/profile so the provider is not accidentally hard-coded to one layout.

## Adjacent hardening

A real packaged DSH boot/`ctx.toolchain` visibility smoke is valuable and should be added early in M1, but it is a packaging/runtime integration gate rather than part of the semantic fingerprint algorithm.

A non-blocking `latest` DSH canary and a real MCP child-process negotiation test are also useful M1 hardening, but neither blocks the first target-resolution vertical slice.

## Success criterion

M1's first slice is successful when a coding agent or CI can ask Toolchain for a target and receive a reproducible identity that:

- changes for compatibility-relevant fixture changes;
- stays stable across irrelevant machine/path/observer changes;
- is backed by explicit evidence;
- is produced without mutating the DSH profile;
- is independent of CLI/MCP/DSH transport semantics.
