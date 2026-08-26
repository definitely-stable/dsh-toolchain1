# Development and Release Policy

This document owns the technical development baseline for DSH Toolchain. Contribution/review behavior lives in `CONTRIBUTING.md`; architecture and normative product behavior live in `docs/architecture.md` and `spec/`.

## Toolchain baseline

DSH Toolchain tracks the current upstream DSH development baseline unless an explicit compatibility decision requires otherwise:

- Node.js: `^22.19.0 || >=24.0.0`;
- package manager: pnpm `11.7.0` initially, matching the current upstream DSH repository;
- module system: ESM;
- product source: TypeScript-family only under `src/`;
- lockfile: one committed `pnpm-lock.yaml`;
- installation in CI: `pnpm install --frozen-lockfile`.

The exact package-manager version is pinned in `package.json#packageManager`. Toolchain upgrades are ordinary reviewed changes; do not let local Corepack state silently select a different pnpm major/minor.

Production source, tests, and repository policy scripts use separate TypeScript programs. Production keeps `allowJs: false`; tests may import repository `.mjs` helpers without making them product source; policy scripts are independently checked with `checkJs`.

## Dependency ownership

Dependencies are classified by runtime ownership, not convenience.

### DSH/Cordis host framework dependencies

A package whose runtime/module identity must match the DSH host belongs in both `peerDependencies` and `devDependencies`. It MUST NOT be shipped as a nested runtime copy merely to make local resolution easier.

This rule exists because a second copy of an identity-sensitive DSH/Cordis framework package can split registries/services/types from the host instance even when package versions appear compatible.

Host-identity packages are maintained as an explicit executable registry rather than treating every `@deepseek-ai/*` package as host-owned. Adding a package to that registry is a deliberate architecture decision. The package-policy gate enforces peer + dev placement and requires the exact dev version used by Toolchain tests to satisfy the advertised peer range. Unsupported peer-range forms fail closed until the policy is deliberately extended.

The package policy also rejects install-time lifecycle scripts from the distributable package.

### Toolchain-owned runtime dependencies

Libraries whose runtime lifecycle is owned by Toolchain belong in `dependencies`.

### Development dependencies

Build, test, lint, code-generation, and repository-only tools belong in `devDependencies`.

A new dependency should remove more project-owned code, risk, or maintenance than it introduces. Dependency updates should be scoped and lockfile diffs reviewed for unrelated churn.

## Generated artifacts

Generated code/data has one owning source. Generated output MUST NOT become an independent source of truth and MUST NOT be hand-edited.

Each generated family MUST have:

1. a documented owning source;
2. one deterministic generation command;
3. a CI freshness check that compares expected output without silently mutating tracked files;
4. tests/fixtures proving the generated output is consumable.

For Protocol v1, normative prose defines behavior and JSON Schema defines machine structure. Generated TypeScript/MCP projections derive from those sources.

## Build faces and runtime boundaries

The single release artifact contains explicit internal build faces rather than separate product packages:

- DSH Host;
- DSH browser/client;
- CLI;
- MCP;
- verification worker;
- shared application/analysis kernel.

Build configuration MUST preserve architecture direction: frontend/DSH faces depend on the kernel; the kernel does not import them. The semantic core (`product`, `kernel`, `model`, `protocol`) is runtime-neutral and does not import Node built-in modules or DSH runtime packages and does not use Node process/dynamic-loader escape hatches.

The `src/` architecture is closed-world. Every production module belongs to an explicit layer and every relative source edge is validated against the architecture matrix. A new generic source directory is not implicitly trusted. JavaScript-family files under `src/` are rejected; repository `.mjs` scripts live outside this product boundary and have their own lint/static-check gate.

M1 gives the internal application kernel real acquisition/digest ports and `resolveTarget()`, but the npm root still does not expose the kernel factory as a stable external API. DSH Host, CLI, and MCP compose Node acquisition/digest adapters internally. Promote the factory only when an independent external consumer lifecycle justifies that compatibility promise.

## Target acquisition and pnpm layout policy

Target acquisition is observation, not profile management. It MUST NOT initialize a profile, install dependencies, rewrite manifests, or create the profile patch merely to make `target.resolve` succeed.

Package identity is based on exact installed manifests, not declared semver ranges. Bundle lookup follows DSH's installation-first/profile-second semantics.

pnpm package links require special care: the observed `node_modules/@deepseek-ai/dsh` path may be a symlink while DSH-owned bundle dependencies physically live beside its canonical package target under the pnpm virtual store. Acquisition therefore considers both the observed package anchor and its `realpath()` for package resolution, while retaining the observed evidence location. A regression fixture MUST prove that resolution succeeds without relying on DSH's healed `$DSH_HOME/profiles/node_modules` fallback.

Absolute acquisition paths, evidence locations and timestamps MUST NOT enter the `dsh-target-v1` semantic projection.

## CI security policy

Every GitHub Actions workflow MUST declare explicit least-privilege `permissions`. The default for ordinary validation jobs is:

```yaml
permissions:
  contents: read
```

Additional permissions are granted only to the job that needs them.

Third-party Actions and reusable workflows SHOULD be pinned to full commit SHAs. Release workflows MUST pin third-party Actions to full commit SHAs. A human-readable comment may record the reviewed tag/version beside the SHA.

Workflows MUST NOT expose repository write permissions, OIDC identity tokens, or publishing credentials to jobs that build/test untrusted pull-request code unless that capability is strictly required and the trust model explicitly permits it.

The main CI workflow runs for pull requests, pushes to `main`, and manual `workflow_dispatch`. Feature-branch names MUST NOT be baked into the durable workflow trigger.

## Platform and DSH evidence matrix

Baseline support targets DSH-supported Node versions on Linux, Windows, and macOS without multiplying every expensive runtime check across the full Cartesian product.

Current CI shape:

- primary artifact-truth lane: Ubuntu + Node 24.19;
- Node compatibility lanes: Ubuntu + Node 22.19, 24.19, and current Node 26 major;
- platform boundary lanes: Windows and macOS on Node 24.19 for build/CLI/public-import behavior;
- exact-package composition: primary lane only, using the packed Toolchain tarball against both a minimal `toolchain-smoke` profile and the shipped `web` profile;
- exact-package live service boot: primary lane only, using an external disposable DSH probe bundle in `toolchain-smoke` to observe `ctx.toolchain`, call `ctx.toolchain.describe()`, and request clean shutdown through launcher-owned `ctx.appExit`;
- target-resolution compatibility: primary lane only, resolving shipped `headless` profiles against DSH `0.1.1-rc.2` and `0.1.0-rc.8`.

The minimal package profile proves base composition and live service visibility. The `web` profile is separately required because current upstream DSH composes it from `@deepseek-ai/dsh-base` plus `@deepseek-ai/dsh-web-app`; the canonical README installation path is therefore tested directly rather than inferred from the minimal profile.

The multi-train target smoke is deliberately separate from the exact-tarball boot smoke. DSH itself first initializes the disposable shipped profile. Toolchain then snapshots the profile tree, performs `target resolve`, snapshots again, and requires byte-identical state. The same semantic profile is copied to another absolute `DSH_HOME` and MUST retain the same fingerprint. This proves read-only/path-stable target semantics without pretending that DSH's own profile initialization is read-only.

Node 26 follows the current upstream DSH compatibility pattern as a moving major-line check; pinned 22.19 and 24.19 lanes retain exact lower/current baselines.

Do not multiply registry-backed DSH installation across every OS/Node lane unless a boundary-specific failure class justifies the cost. The matrix exists to find distinct classes of defects, not to repeat identical pure tests.

## Dependency automation

Dependabot is enabled only after the relevant manifests/workflows exist. M0 introduces `.github/dependabot.yml` together with the real package/Actions surfaces.

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

- `next` — prereleases/RCs intended for testers and upcoming DSH trains;
- `latest` — only the release recommended to ordinary users.

A prerelease MUST NOT accidentally become `latest`.

## Release artifact discipline

Public release artifacts are produced by CI, not a maintainer laptop.

The release pipeline target is:

```text
clean checkout
  -> frozen dependency install
  -> generated/protocol/closed-world architecture/package gates
  -> lint product + tests + repository policy scripts
  -> source/test/script static checks
  -> build
  -> npm pack
  -> inspect exact tarball policy
  -> read package.json from that tarball and validate main/types/exports/bin/dsh.bundle.patch targets
  -> install that tarball into a throwaway Node consumer and resolve public package exports/bins
  -> install the same tarball into isolated minimal and shipped Web DSH profiles
  -> compose/dump-config each profile
  -> boot the exact tarball through real DSH and prove ctx.toolchain.describe() through an external probe
  -> separately resolve read-only target snapshots against pinned current + older DSH trains
  -> publish from the verified artifact lineage
```

The packed manifest is the source of truth for package entrypoints. A separate hardcoded list of runtime entrypoints MUST NOT substitute for Node/npm package resolution. Source-tree success is not a substitute for package-artifact verification.

The internal TAR reader in `scripts/check-pack.mjs` is scoped to deterministic npm/pnpm-produced package tarballs created by this pipeline; it is not a general TAR parser or malicious-archive security boundary.

The live boot probe is test infrastructure, not a production Toolchain capability. It MUST remain outside the distributable package and MUST NOT add test-only endpoints, process exits, or smoke modes to production code.

## DSH installation contract

DSH plugin management is profile-scoped. The public package installation shape is:

```bash
dsh plugin --profile <profile> add dsh-toolchain
```

Toolchain MUST NOT document a pseudo-global `dsh plugin add ...` path while Harness requires profile selection. The DSH Loader row is namespaced `dsh-toolchain`; the semantic Cordis capability remains `ctx.toolchain`.

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

A green unit suite is not sufficient evidence for an exact-target or packaged-runtime claim. Such claims require their dedicated real DSH smoke on the same branch head. PR descriptions MUST report only commands/checks that actually ran.

## Public repository publication

The private `dsh-toolchain1` repository is an incubator, not a public history candidate. The public repository is created from curated approved source states according to `docs/internal/publication.md`.
