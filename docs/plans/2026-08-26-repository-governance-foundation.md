# Repository Governance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish contribution, security, repository hygiene, dependency, CI, release, and clean-publication rules before M0 production code starts.

**Architecture:** Keep policy human-readable in `CONTRIBUTING.md`, `SECURITY.md`, and `docs/development.md`, with `AGENTS.md` as an AI-only overlay. Add only low-risk repository configuration that is useful in the private incubator and can be copied unchanged into the future public `definitely-stable/dsh-toolchain`; defer branch rulesets, CODEOWNERS, and publish credentials until the public repository exists.

**Tech Stack:** GitHub, Markdown, YAML, EditorConfig, Git attributes, Dependabot.

**Spec:** `docs/architecture.md`, `spec/protocol.md`, accepted ADRs, and the approved contribution/release policy from the architecture review.

## Global Constraints

- The current private repository remains `definitely-stable/dsh-toolchain1` and is an incubator only.
- The future public repository identity is `definitely-stable/dsh-toolchain` with desired npm package name `dsh-toolchain`.
- The public repository is created from a curated source tree, not by exposing or rewriting incubator history.
- The canonical product distribution remains one installable DSH Toolchain bundle.
- Node support follows upstream DSH: `^22.19.0 || >=24.0.0`.
- pnpm 11 is the development package manager; exact package-manager version is pinned when `package.json` is introduced in M0.
- DSH/Cordis host framework packages with identity-sensitive runtime APIs are peer + dev dependencies, not bundled runtime copies.
- GitHub Actions workflows use least-privilege `permissions`; third-party actions are pinned to full commit SHAs when workflows are introduced.
- Public npm publishing uses Trusted Publishing/OIDC when the public repository and package exist; no long-lived publish token is part of the target design.
- Generated files are never hand-edited and must be freshness-gated in CI once generators exist.

---

### Task 1: Contribution contract

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: architecture/spec/ADR source-of-truth hierarchy.
- Produces: one contribution policy shared by humans and AI; AI-specific overlay in `AGENTS.md`.

- [ ] Define Conventional Commit/PR-title grammar, stable scopes, focused-PR rule, squash-main policy, verification evidence, review-comment prefixes, and comment/JSDoc/TODO rules.
- [ ] Add a compact PR template centered on Why/What/contract impact/verification/risks.
- [ ] Make `AGENTS.md` require `CONTRIBUTING.md` and forbid duplicate policy definitions.
- [ ] Self-review for duplicated or contradictory rules.

### Task 2: Security and issue intake

**Files:**
- Create: `SECURITY.md`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/ISSUE_TEMPLATE/dsh-compatibility.yml`

**Interfaces:**
- Consumes: `docs/security.md`, Protocol diagnostics/evidence vocabulary.
- Produces: private vulnerability-reporting rules and structured issue intake, especially compatibility evidence.

- [ ] Define supported-version disclosure policy without inventing a private reporting address not yet configured.
- [ ] Make security-sensitive reports use GitHub private vulnerability reporting once enabled in the future public repo; explicitly prohibit secrets in public issues.
- [ ] Collect DSH version/profile/platform/Toolchain version/diagnostic codes/target fingerprint/receipt where applicable for compatibility reports.
- [ ] Avoid requiring secrets, session content, or full user environment dumps.

### Task 3: Repository hygiene and dependency automation

**Files:**
- Create: `.editorconfig`
- Create: `.gitattributes`
- Create: `.gitignore`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Produces: cross-platform text normalization and low-noise dependency update policy.

- [ ] Standardize UTF-8, LF in repository text, final newline, and indentation defaults without forcing generated/binary files through text normalization.
- [ ] Ignore Node/pnpm/build/test/editor/OS/temp DSH artifacts without ignoring source fixtures.
- [ ] Configure weekly grouped npm and GitHub Actions Dependabot updates with conservative open-PR limits.

### Task 4: Development, release, and clean-publication policy

**Files:**
- Create: `docs/development.md`
- Create: `docs/internal/publication.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Produces: M0 toolchain baseline, dependency policy, generated-file ownership, CI security rules, release channel/version policy, platform matrix, Definition of Ready/Done, and incubator-to-public export contract.

- [ ] Document Node/pnpm baseline and framework peer-dependency rule.
- [ ] Document least-privilege Actions and full-SHA pinning policy.
- [ ] Document `latest`/`next`, prerelease SemVer, CI-built `npm pack` artifact verification, and OIDC trusted publishing as the public release target.
- [ ] Define curated public export: exclude internal plans, private operational notes, experimental residue, credentials, caches, and incubator-only metadata; preserve normative specs, ADRs, contribution/security docs, fixtures/tests needed to verify claims, and source.
- [ ] Add M0 exit criteria for contribution/security/dependency/CI gates.

### Task 5: Baseline review and PR update

**Files:**
- Review all files changed by PR #1.
- Update PR #1 description.

**Interfaces:**
- Produces: a reviewable Architecture + Governance Baseline before implementation planning.

- [ ] Compare `main...docs/architecture-baseline` and check source-of-truth links.
- [ ] Scan normative/public docs for `TBD`, `TODO`, conflicting package/repo identities, and claims that temporary DSH home is a security sandbox.
- [ ] Validate YAML syntax for issue forms and Dependabot configuration structurally where possible.
- [ ] Confirm the public-name policy distinguishes GitHub repository identity from globally unique npm package identity.
- [ ] Update Draft PR #1 summary and review order.
