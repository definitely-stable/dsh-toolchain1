# Public Repository Publication Contract

Status: **incubator-only operational document**. This file is not intended to be copied into the first public source snapshot unless it remains useful after launch.

The private `definitely-stable/dsh-toolchain1` repository is an engineering incubator. The future public repository is a new clean repository named `definitely-stable/dsh-toolchain`.

## Why a new repository

The public project should begin with the reviewed product tree rather than exposing incubator-only plans, discarded experiments, temporary branches, review scaffolding, or private operational history. We do not rewrite the incubator history and pretend it was public development; we create a new repository from approved source states.

## GitHub name

`definitely-stable/dsh-toolchain` is the intended public path.

The current GitHub path resolves as a redirect to the private incubator because this repository previously used that name. Before public creation, confirm no separate repository exists at that path. Creating the new repository under the same organization will supersede the old redirect.

Repository names are scoped by GitHub owner; a repository with the same name under another owner does not block `definitely-stable/dsh-toolchain`.

## npm identity

Desired package name: `dsh-toolchain`.

npm unscoped names are globally unique. A search result or absent npm package page is not a reservation. Immediately before first package creation/publish:

1. query the npm registry directly for `dsh-toolchain`;
2. if unavailable, stop and make an explicit naming decision rather than silently publishing under a different identity;
3. once the package exists, configure Trusted Publishing against the **public** GitHub repository/workflow, not this incubator.

## Public tree inclusion policy

The public history SHOULD introduce everything required to understand, build, test, verify, and contribute to the released project:

- source code and package manifests;
- normative `spec/` documents, schemas, examples, and generators;
- current architecture and accepted ADRs that explain still-active decisions;
- README, CONTRIBUTING, SECURITY, license/required notices;
- tests and fixtures necessary to substantiate compatibility/verification claims;
- GitHub issue/PR templates and CI/release workflows;
- dependency/build configuration required for reproducibility;
- current roadmap when it remains accurate and useful to external contributors.

## Incubator-only material

The public history SHOULD exclude material that is useful only for private incubation or that exposes no current product contract:

- `docs/plans/` implementation scratch/plans once their work is complete;
- `docs/internal/` operational notes unless a document has continuing public value;
- abandoned experiments/prototypes not intentionally shipped;
- private benchmark inputs, labels, credentials, local paths, or unpublished user data;
- caches, generated temporary DSH homes, package tarballs, logs, build output;
- stale review notes and temporary branch metadata;
- private-only URLs or operational identifiers.

Do not exclude tests, fixtures, ADRs, or evidence merely to make the repository look smaller when they are required to justify product behavior.

## Publication preflight

Before creating the public repository:

- architecture/spec baseline is current and contains no private assumptions;
- `CONTRIBUTING.md` and `SECURITY.md` match the public workflow;
- private vulnerability reporting can be enabled immediately;
- repository/package identities have been rechecked;
- license and required third-party notices are correct;
- dependency lockfile and generated artifacts are reproducible;
- secret scanning of the curated tree is clean;
- public README install commands reference the new repository/package identity;
- Actions workflows use explicit least privilege and reviewed SHA-pinned actions where required;
- the package can be built and verified from the exact public tree without private dependencies;
- the initial public version/release channel is decided.

## Curated initial history

The public repository starts with a **small, intentional sequence of meaningful commits**, not the incubator commit graph and not one giant synthetic snapshot. Each commit should represent a coherent layer that can be understood, reviewed, reverted, and bisected on its own.

The exact split follows the final approved tree, but the intended shape is approximately:

```text
docs(architecture): establish DSH Toolchain architecture and protocol
chore(governance): establish contribution and security policy
build(foundation): establish reproducible package and CI foundation
feat(core): add shared Toolchain application kernel
feat(dsh): add installable DSH bundle and ToolchainService
feat(cli): add Toolchain CLI surface
feat(mcp): add Toolchain MCP surface
```

Tests, schemas, generated outputs, and documentation that make one logical change complete travel with that same commit; they are not split into ceremonial “tests later” or “docs later” commits.

The curated history MUST be reconstructed from approved source states rather than cherry-picking the private branch graph wholesale. Incubator-only intermediate fixes, abandoned approaches, temporary workflow bootstrap commits, review scaffolding, and private plans do not cross the boundary.

After the curated initial history is built, ordinary public development follows PR + squash policy from `CONTRIBUTING.md`.

## Post-creation setup

After the curated public history CI succeeds:

1. enable branch ruleset/required checks;
2. enable Dependabot alerts/security updates and scheduled version updates;
3. enable private vulnerability reporting;
4. configure npm Trusted Publishing only after the npm package exists;
5. configure release environment/protection if warranted;
6. verify install from the public package/release artifact in a clean DSH profile.

CODEOWNERS/required human approval are added when the maintainer topology makes them meaningful, not as one-person ceremony.
