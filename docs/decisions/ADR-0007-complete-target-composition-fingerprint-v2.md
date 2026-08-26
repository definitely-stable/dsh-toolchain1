# ADR-0007: Complete target composition fingerprint v2

- Status: Accepted
- Date: 2026-08-27
- Supersedes: ADR-0006 for new target snapshots

## Context

ADR-0006 introduced `dsh-target-v1` before M1 had been reviewed against the complete current DSH composition contract. Current DeepSeek Harness composes a profile over an empty root in this order:

1. each bundle patch in `dsh.profile.bundles` order;
2. the profile's `cordis.patch.yml`;
3. the home-level `$DSH_HOME/cordis.patch.yml`;
4. each invocation `--patch` overlay in argv order.

The v1 projection captured bundle package names/versions and only the profile patch hash. That permits false sameness when a bundle patch changes without a version bump, when the home patch differs, or when invocation overlays differ.

The project is still a private unpublished incubator and Protocol v1 is explicitly pre-public, so the identity namespace should be corrected before public compatibility claims depend on it.

## Decision

New snapshots use namespace `dsh-target-v2`.

The semantic projection contains:

- exact `@deepseek-ai/dsh` version;
- the resolution/compatibility runtime's Node version, platform and architecture;
- profile name;
- ordered resolved bundle identities `{ name, version, patchHash }`, excluding `dsh-toolchain` itself as the observer;
- sorted top-level profile dependency identities `{ name, version }`, excluding `dsh-toolchain` itself;
- `profilePatchHash`;
- `homePatchHash`;
- ordered `overlayPatchHashes` supplied by the caller for this target resolution.

A present patch hash is SHA-256 of the exact UTF-8 bytes read as text. Missing optional built-in user layers use distinct sentinel inputs:

```text
dsh-target-v2:profile-patch:absent
dsh-target-v2:home-patch:absent
```

A bundle that declares a patch but whose patch cannot be resolved is not a valid exact target and fails acquisition. A caller-supplied overlay that cannot be read also fails acquisition.

Objects are serialized as deterministic JSON with recursively code-point-sorted keys. Arrays preserve semantic order: bundles and overlays preserve order; dependencies are normalized by package name then version.

The fingerprint is:

```text
dsh-target-v2:<lowercase sha256 hex(canonicalProjectionJson)>
```

## Acquisition paths are not identity

`dshHome`, `dshPackageRoot`, overlay filenames, absolute package locations, evidence locations, timestamps, usernames and the Toolchain observer's own package version/content do not enter the semantic projection.

`TargetResolveRequest.patches` is an ordered list of acquisition paths analogous to DSH `--patch` arguments. Their ordered content hashes, not paths, enter v2 identity.

## Runtime meaning

The `runtime` field binds the snapshot to the Node/platform/architecture under which Toolchain resolves compatibility for the target. It is not evidence that an unrelated separately launched DSH process used the same runtime. A later live observation or verification receipt must record its executed runtime and must not claim equivalence when runtime-sensitive target semantics differ.

## Same-version package edits outside composition

V2 deliberately does not hash entire package/source trees. Bundle patch bytes are included because they are direct inputs to DSH composition. M2 Contract Intelligence must bind its cache/index identity to the actual catalog/type/source/runtime evidence it consumes so a same-version local contract edit cannot be hidden by package-version equality.

## Consequences

- Existing private v1 fingerprints are invalidated; there is no public compatibility promise to preserve.
- M1 target identity now follows the complete patch composition boundary used by current DSH boot.
- Target resolution remains read-only and inexpensive relative to full package-tree hashing.
- M2 can build contract-specific evidence identity without bloating the foundational TargetSnapshot.
