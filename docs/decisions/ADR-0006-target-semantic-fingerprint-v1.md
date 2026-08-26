# ADR-0006: Target semantic fingerprint v1

- Status: Accepted
- Date: 2026-08-26

## Context

ADR-0002 requires target-specific claims to bind to an immutable `TargetSnapshot` and semantic fingerprint, but it intentionally did not define the canonical algorithm. M1 needs one exact algorithm before `target.resolve` can become a working contract.

DSH profile semantics are order-sensitive: bundle patches are applied in `dsh.profile.bundles` order and the profile's own `cordis.patch.yml` is applied after bundle layers. Compatibility also depends on the exact DSH/runtime and resolved package identities, while absolute machine paths and timestamps must not make identical targets look different.

## Decision

The first namespace is `dsh-target-v1`.

The semantic projection contains only:

- exact `@deepseek-ai/dsh` package version;
- exact Node version, platform, and architecture;
- profile name;
- ordered resolved bundle package names and exact versions;
- resolved top-level profile dependency package names and exact versions, sorted by name;
- SHA-256 of the profile patch contents.

The projection does not contain:

- absolute paths or `DSH_HOME`;
- usernames or machine identifiers;
- timestamps;
- evidence locations;
- secrets/session contents.

Objects are serialized as deterministic JSON with recursively sorted keys. Arrays preserve the order defined by their semantics: bundle order is preserved; dependency identities are sorted before serialization.

The fingerprint is:

```text
dsh-target-v1:<lowercase sha256 hex(canonicalProjectionJson)>
```

Changing the meaning or fields of the semantic projection requires a new namespace such as `dsh-target-v2`.

## Consequences

The same effective target copied to another absolute home can keep the same semantic fingerprint. Bundle order, profile patch content, runtime coordinates, or exact resolved package versions change the fingerprint.

M1 does not claim that package version alone detects every locally modified development install. Evidence retains content hashes and source locations so stronger development-install identity can be added from real evidence without silently redefining `dsh-target-v1`.

## Verification

Fixtures MUST prove:

- path/timestamp changes do not alter the fingerprint;
- bundle order does alter it;
- profile patch content does alter it;
- resolved bundle/dependency version changes alter it;
- dependency declaration order alone does not alter it;
- runtime Node/platform/arch changes alter it.
