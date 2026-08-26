# ADR-0006: Target semantic fingerprint v1

- Status: Accepted
- Date: 2026-08-26

## Context

ADR-0002 requires target-specific claims to bind to an immutable `TargetSnapshot` and semantic fingerprint, but it intentionally did not define the canonical algorithm. M1 needs one exact algorithm before `target.resolve` can become a working contract.

DSH profile semantics are order-sensitive: bundle patches are applied in `dsh.profile.bundles` order and the profile's own `cordis.patch.yml` is applied after bundle layers. Compatibility also depends on the exact DSH/runtime and resolved package identities, while absolute machine paths, timestamps, and Toolchain's own observer version must not make the same target look different.

## Decision

The first namespace is `dsh-target-v1`.

The semantic projection contains only:

- exact `@deepseek-ai/dsh` package version;
- exact Node version, platform, and architecture;
- profile name;
- ordered resolved bundle package names and exact versions;
- resolved top-level profile dependency package names and exact versions, sorted by name, **excluding `dsh-toolchain` itself**;
- SHA-256 of the profile patch contents.

`dsh-toolchain` remains ordinary acquisition evidence and may appear in the captured package graph, but it is excluded from semantic projection so upgrading the observer does not rename an otherwise identical DSH target.

The projection does not contain:

- absolute paths or `DSH_HOME`;
- usernames or machine identifiers;
- timestamps;
- evidence locations;
- Toolchain's own package version/path;
- secrets/session contents.

Objects are serialized as deterministic JSON with recursively sorted keys. Arrays preserve the order defined by their semantics: bundle order is preserved; dependency identities are sorted before serialization.

The fingerprint is:

```text
dsh-target-v1:<lowercase sha256 hex(canonicalProjectionJson)>
```

Changing the meaning or fields of the semantic projection requires a new namespace such as `dsh-target-v2`.

## Conservative patch identity

M1 hashes the exact profile patch bytes rather than attempting to parse and semantically normalize arbitrary YAML/`!!js` expressions. This intentionally prefers a false difference over false sameness: comment/format-only patch edits may change a v1 fingerprint, but a semantic patch change cannot be hidden by an incomplete normalizer.

If field evidence later justifies a safe canonical patch representation, that change belongs to a new fingerprint namespace rather than silently reinterpreting `dsh-target-v1`.

## Consequences

The same effective target copied to another absolute home can keep the same semantic fingerprint. Toolchain upgrades alone do not change target identity. Bundle order, profile patch bytes, runtime coordinates, or exact resolved target dependency versions do change the fingerprint.

M1 does not claim that package version alone detects every locally modified development install. Evidence retains content hashes and source locations so stronger development-install identity can be added from real evidence without silently redefining `dsh-target-v1`.

## Verification

Fixtures MUST prove:

- path/timestamp changes do not alter the fingerprint;
- Toolchain's own package version/path does not alter it;
- bundle order does alter it;
- profile patch content does alter it;
- resolved bundle/target-dependency version changes alter it;
- dependency declaration order alone does not alter it;
- runtime Node/platform/arch changes alter it.
