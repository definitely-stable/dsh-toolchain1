# ADR-0006: Target semantic fingerprint v1

- Status: Superseded by ADR-0007
- Date: 2026-08-26
- Superseded: 2026-08-27

## Context

ADR-0002 requires target-specific claims to bind to an immutable `TargetSnapshot` and semantic fingerprint, but it intentionally did not define the canonical algorithm. M1 needed one exact algorithm before `target.resolve` could become a working contract.

The initial M1 review modeled bundle order and the profile's own `cordis.patch.yml`, but a later corrective review against the complete current DSH boot contract found that v1 did not include bundle patch bytes, `$DSH_HOME/cordis.patch.yml`, or ordered invocation `--patch` overlays. Those omissions permit different effective Cordis compositions to share one v1 fingerprint.

Because the project remains a private unpublished incubator, v1 is superseded before any public compatibility promise depends on it. ADR-0007 defines the corrected `dsh-target-v2` namespace.

## Historical decision

The first namespace was `dsh-target-v1`.

The semantic projection contained:

- exact `@deepseek-ai/dsh` package version;
- exact Node version, platform, and architecture;
- profile name;
- ordered resolved bundle package names and exact versions, excluding `dsh-toolchain` itself;
- resolved top-level profile dependency package names and exact versions, sorted by name, excluding `dsh-toolchain` itself;
- SHA-256 of the profile patch contents.

The projection excluded absolute paths, timestamps, evidence locations, machine identifiers, secrets, and Toolchain observer version/path. Objects used recursively sorted keys; bundle order stayed semantic; dependency identities were sorted.

The historical fingerprint was:

```text
dsh-target-v1:<lowercase sha256 hex(canonicalProjectionJson)>
```

The ADR explicitly required a new namespace if the projection meaning changed. ADR-0007 follows that rule rather than silently redefining v1.

## Historical conservative patch identity

V1 hashed exact profile-patch UTF-8 contents. An absent profile patch used SHA-256 of `dsh-target-v1:profile-patch:absent`, distinct from a present empty file.

That conservative byte-level policy remains valid in principle; the defect was incomplete coverage of the effective composition stack, not the choice to avoid speculative YAML/`!!js` semantic normalization.

## Why it was superseded

V1 can produce false sameness when:

- a declared bundle's patch bytes change without a package-version bump;
- two otherwise identical homes have different `$DSH_HOME/cordis.patch.yml` contents;
- the same profile is launched with different ordered `--patch` overlays.

Those states can produce different runtime composition while retaining a v1 fingerprint, contradicting Toolchain's exact-target product boundary.

See ADR-0007 for the replacement identity and current verification requirements.
