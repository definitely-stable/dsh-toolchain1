# Public Repository Publication Contract

Status: **incubator-only operational document**. This file is not intended to be copied into the first public source snapshot unless it remains useful after launch.

The private `definitely-stable/dsh-toolchain1` repository is an engineering incubator. The future public repository is a new clean repository named `definitely-stable/dsh-toolchain`.

## Why a new repository

The public project should begin with the reviewed product tree rather than exposing incubator-only plans, discarded experiments, temporary branches, review scaffolding, or private operational history. We do not rewrite the incubator history and pretend it was public development; we create a new repository from the approved source state.

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

The initial public snapshot SHOULD include everything required to understand, build, test, verify, and contribute to the released project:

- source code and package manifests;
- normative `spec/` documents, schemas, examples, and generators;
- current architecture and accepted ADRs that explain still-active decisions;
- README, CONTRIBUTING, SECURITY, license/required notices;
- tests and fixtures necessary to substantiate compatibility/verification claims;
- GitHub issue/PR templates and CI/release workflows;
- dependency/build configuration required for reproducibility;
- current roadmap when it remains accurate and useful to external contributors.

## Incubator-only material

The first public snapshot SHOULD exclude material that is useful only for private incubation or that exposes no current product contract:

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

## Initial history

Create the public repository with a single curated baseline commit representing the reviewed public source state, for example:

```text
chore: establish DSH Toolchain public baseline
```

Subsequent public development follows normal PR + squash history. Do not transplant the private branch/commit graph merely for artificial continuity.

## Post-creation setup

After the first public baseline CI succeeds:

1. enable branch ruleset/required checks;
2. enable Dependabot alerts/security updates and scheduled version updates;
3. enable private vulnerability reporting;
4. configure npm Trusted Publishing only after the npm package exists;
5. configure release environment/protection if warranted;
6. verify install from the public package/release artifact in a clean DSH profile.

CODEOWNERS/required human approval are added when the maintainer topology makes them meaningful, not as one-person ceremony.
