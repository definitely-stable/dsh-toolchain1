# Development and Release Policy

This document owns the technical development baseline for DSH Toolchain. Contribution/review behavior lives in `CONTRIBUTING.md`; architecture and normative product behavior live in `docs/architecture.md` and `spec/`.

## Toolchain baseline

DSH Toolchain tracks the current upstream DSH development baseline unless an explicit compatibility decision requires otherwise:

- Node.js: `^22.19.0 || >=24.0.0`;
- package manager: pnpm `11.7.0` initially, matching the current upstream DSH repository;
- module system: ESM;
- lockfile: one committed `pnpm-lock.yaml` once M0 introduces `package.json`;
- installation in CI: `pnpm install --frozen-lockfile`.

M0 MUST pin the exact package-manager version in `package.json#packageManager`. Toolchain upgrades are ordinary reviewed changes; do not let local Corepack state silently select a different pnpm major/minor.

## Dependency ownership

Dependencies are classified by runtime ownership, not convenience.

### DSH/Cordis host framework dependencies

A package whose runtime/module identity must match the DSH host belongs in both `peerDependencies` and `devDependencies`. It MUST NOT be shipped as a nested runtime copy merely to make local resolution easier.

This rule exists because a second copy of an identity-sensitive DSH/Cordis framework package can split registries/services/types from the host instance even when package versions appear compatible.

M0 MUST add an executable dependency-policy gate once the first manifest exists.

### Toolchain-owned runtime dependencies

Libraries whose runtime lifecycle is owned by Toolchain belong in `dependencies`.

### Development dependencies

Build, test, lint, code-generation, and repository-only tools belong in `devDependencies`.

A new dependency should remove more project-owned code, risk, or maintenance than it introduces. Dependency updates should be scoped and lockfile diffs reviewed for unrelated churn.

## Generated artifacts

Generated code/data has one owning source. Generated output MUST NOT become an independent source of truth and MUST NOT be hand-edited.

When generators exist, each generated family MUST have:

1. a documented owning source;
2. one deterministic generation command;
3. a CI freshness check that regenerates and requires a clean diff;
4. tests/fixtures proving the generated output is consumable.

For Protocol v1, normative prose defines behavior and JSON Schema defines machine structure. Generated TypeScript/MCP projections derive from those sources.

## Build faces

The single release artifact contains explicit internal build faces rather than separate product packages:

- DSH Host;
- DSH browser/client;
- CLI;
- MCP;
- verification worker;
- shared application/analysis kernel.

Build configuration MUST preserve architecture direction: frontend/DSH faces depend on the kernel; the kernel does not import them.

## CI security policy

Every GitHub Actions workflow MUST declare explicit least-privilege `permissions`. The default for ordinary validation jobs is conceptually:

```yaml
permissions:
  contents: read
```

Additional permissions are granted only to the job that needs them.

Third-party Actions and reusable workflows SHOULD be pinned to full commit SHAs. Release workflows MUST pin third-party Actions to full commit SHAs. A human-readable comment may record the reviewed tag/version beside the SHA.

Workflows MUST NOT expose repository write permissions, OIDC identity tokens, or publishing credentials to jobs that build/test untrusted pull-request code unless that capability is strictly required and the trust model explicitly permits it.

M0 should keep PR CI simple and fast: one primary Linux/Node 24 lane owns most static/unit checks; broader platform lanes run only for surfaces whose behavior is platform-sensitive or as a dedicated matrix job.

## Platform matrix

Baseline support targets DSH-supported Node versions on Linux, Windows, and macOS.

Recommended CI shape after M0:

- primary PR lane: Ubuntu + Node 24;
- Node compatibility lane: Ubuntu + Node 22.19 and Node 24;
- platform integration lane: Linux, Windows, macOS on Node 24 for filesystem/process/package/profile behavior;
- DSH real-composition/verification lanes: only where the changed capability crosses those boundaries.

Do not multiply every unit/static check across every OS/Node combination. The matrix exists to find boundary differences, not to repeat identical pure tests.

## Dependency automation

Dependabot is enabled only after the relevant manifests/workflows exist. M0 MUST add `.github/dependabot.yml` together with `package.json`/Actions so automation starts against real surfaces rather than producing configuration noise.

Target policy:

- npm version updates: weekly, grouped for non-major updates, conservative open-PR limit;
- GitHub Actions updates: weekly, grouped;
- security alerts/updates: enabled in the future public repository;
- dependency review: enable when available for the repository/plan and make it required only after the check is proven stable.

## Versioning and release channels

Toolchain software versions use SemVer. Toolchain Protocol versions and DSH target versions are separate compatibility dimensions.

Before a useful public vertical slice, private-incubator versions may remain `0.0.x` and need not be published to npm.

Recommended public progression:

- first useful intelligence alpha: `0.1.0-alpha.N` after installable DSH bundle + target/contract intelligence are usable;
- verification alpha: `0.2.0-alpha.N` when isolated package/install/boot/visibility verification is usable;
- beta: `0.x.0-beta.N` once the supported DSH train policy, core frontend parity, and release pipeline are stable;
- `1.0.0`: only after Protocol v1/support/migration/security/release commitments are credible for external consumers.

npm dist-tags:

- `next` — all prereleases/RCs intended for testers and upcoming DSH trains;
- `latest` — only the release recommended to ordinary users.

A prerelease MUST NOT accidentally become `latest`.

## Release artifact discipline

Public release artifacts are produced by CI, not a maintainer laptop.

The release pipeline target is:

```text
clean checkout
  -> frozen dependency install
  -> static/type/test/schema/architecture gates
  -> build
  -> npm pack
  -> inspect exact tarball contents
  -> install that tarball into a clean temporary DSH profile
  -> compose/dump-config
  -> boot/runtime capability checks appropriate to the release stage
  -> publish from the verified artifact lineage
```

Source-tree success is not a substitute for package-artifact verification.

## npm publishing security

The desired public npm package identity is the unscoped name `dsh-toolchain`.

Availability MUST be rechecked directly against the npm registry immediately before the package is first created/published; search-engine absence is not a reservation.

Once the public repository and npm package exist, publishing SHOULD use npm Trusted Publishing with GitHub Actions OIDC rather than a long-lived write token. The release job alone receives `id-token: write`. Public-package provenance is expected when the repository/package meet npm provenance requirements.

Do not configure trusted publishing against the private incubator repository: the final publisher relationship must name the future public `definitely-stable/dsh-toolchain` repository and its release workflow exactly.

## Merge and repository policy

The future public repository uses pull requests and squash merge by default so one coherent PR becomes one durable `main` commit. Required checks/rulesets are enabled only after the corresponding CI jobs exist and have passed on `main`; do not configure nonexistent required checks that can permanently block merges.

Initial public ruleset target:

- PR required;
- required status checks;
- conversation resolution required;
- linear history;
- no force pushes to `main`;
- no deletion of `main`.

Required human approvals and CODEOWNERS become useful when there is more than one maintainer; they are not simulated in the one-maintainer incubator.

## Definition of ready / done

Repository-wide definitions live in `CONTRIBUTING.md`. Implementation plans and Issues may add stricter acceptance evidence for a specific milestone but MUST NOT weaken them.

## Public repository publication

The private `dsh-toolchain1` repository is an incubator, not a public history candidate. The public repository is created from a curated tree according to `docs/internal/publication.md`.
