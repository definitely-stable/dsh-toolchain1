# Contributing to DSH Toolchain

DSH Toolchain is developed contract-first. These rules apply equally to human contributors and automated coding agents. Agent-specific operating instructions live in `AGENTS.md`; they do not replace this file.

Before changing code, read the relevant current-state architecture, normative specification, and accepted ADRs. An Issue or implementation plan may narrow work, but it must not silently redefine a public contract.

## Source of truth

When sources disagree, use this order:

1. normative specifications under `spec/`;
2. accepted ADRs under `docs/decisions/`;
3. current architecture in `docs/architecture.md`;
4. capability roadmap in `docs/roadmap.md`;
5. the current implementation plan and GitHub Issue.

If the intended change conflicts with a higher source, update that source explicitly in the same change or propose an ADR when the decision is architectural.

## Change units

A pull request should have one coherent reason to exist. Include all files required to make that change complete—implementation, tests, schemas, examples, generated outputs, and documentation—but do not mix unrelated cleanup or refactors into the same PR.

Prefer the smallest independently reviewable change. Large generated/schema diffs are not a reason to split one semantic change. Large handwritten changes should be split unless their reviewable behavior cannot be separated without creating invalid intermediate states.

Refactoring and behavior changes should normally be separate when either can be reviewed and verified independently.

## Commit and PR titles

The future public repository uses squash merge by default, so the PR title becomes the durable `main` commit title. PR titles MUST follow Conventional Commits 1.0.0:

```text
<type>(<scope>): <description>
```

Allowed baseline types:

- `feat` — new externally meaningful capability;
- `fix` — bug fix;
- `refactor` — structural change without intended behavior change;
- `perf` — performance improvement;
- `test` — tests/fixtures only;
- `docs` — documentation only;
- `build` — packaging/build/toolchain changes;
- `ci` — CI/repository automation;
- `chore` — maintenance that fits no more precise type.

Preferred stable scopes:

`core`, `protocol`, `dsh`, `web`, `mcp`, `cli`, `verify`, `compiler`, `migration`, `deps`, `docs`.

Examples:

```text
feat(protocol): add target snapshot fingerprint
fix(verify): reject stale verification receipts
refactor(core): isolate evidence normalization
docs(architecture): clarify DSH host boundary
```

Breaking public changes use `!` and explain the compatibility effect in the PR:

```text
feat(protocol)!: change diagnostic envelope
```

Working-branch commits SHOULD be coherent and descriptive, but temporary `fixup!`/WIP commits are acceptable in Draft PRs because the public history is squash-oriented. Do not spend review time polishing intermediate commit history that will not survive merge.

## Pull request description

Every non-trivial PR MUST answer:

- **Why** — the problem, constraint, or opportunity that makes the change necessary;
- **What** — the concrete behavior or structure changed;
- **Contract / architecture impact** — affected specifications, schemas, ADRs, public APIs, diagnostics, or `None`;
- **Verification** — exact commands/checks actually executed and their result;
- **Risks** — compatibility, lifecycle, security, packaging, or platform implications that remain;
- **Related** — Issues/PR dependencies when applicable.

Do not claim a test, build, DSH composition, or verification step passed unless it was actually executed for the current change. A successful typecheck is not evidence that a DSH plugin composes, boots, or exposes its intended capability.

## Public contract changes

A PR that changes a public Toolchain contract MUST update all affected sources in the same PR:

- normative specification;
- machine schema;
- canonical examples;
- generated types/outputs once generation exists;
- conformance/contract tests;
- implementation and frontend projections.

Machine diagnostic codes are compatibility identifiers. Do not reuse an existing code for new semantics.

Generated files MUST NOT be edited manually. Change their owning source and regenerate them. CI enforces generator freshness against the canonical source.

## Tests and verification

Match evidence to the changed boundary:

- pure analysis/model behavior → focused unit/property tests;
- protocol/schema behavior → schema + canonical example + conformance tests;
- architecture behavior → negative fixtures proving the forbidden edge/source form fails, plus the repository-wide closed-world architecture gate;
- package behavior → inspect the exact `.tgz` against its packed manifest and exercise it from a throwaway installed consumer;
- DSH composition behavior → install the exact packed artifact through profile-scoped DSH plugin management and run real composition smoke for every canonical profile path affected by the change;
- candidate runtime behavior → isolated verification worker/runtime checks;
- browser projection → Host/Client parity and browser-facing checks;
- platform-specific behavior → the relevant OS integration path.

Every production source file under `src/` must belong to a declared architecture layer. Do not introduce an implicit `shared`, `util`, JavaScript shim, path alias, or package self-reference to route around dependency rules. Adding a layer or allowed inter-layer edge is an architecture-policy change and requires explicit negative tests.

Semantic-core third-party dependencies are deny-by-default. A new bare external import from `product`, `protocol`, `model`, or `kernel` is permitted only after an explicit architecture-policy allowlist change proves the dependency is runtime-neutral and adds negative coverage that prevents runtime/transport coupling.

Repository policy scripts are part of the merge safety boundary. They are linted and statically checked separately from production TypeScript; do not weaken or exclude a policy script merely to make CI green.

Run focused checks while iterating. Repository-wide and platform-matrix verification belongs to CI unless the change is inherently repository-wide or you are reproducing a CI failure.

Tests describe required behavior, not a historical implementation. When intended behavior changes, update tests and explain the reason in the PR.

## Code comments

Prefer clear names, types, and structure over comments that narrate the code.

Comments SHOULD preserve information that the code cannot express clearly by itself, especially:

- why an apparently simpler implementation is incorrect;
- a compatibility quirk in a specific DSH/Cordis/runtime contract;
- a security assumption or threat prevented by a guard;
- a lifecycle, ordering, teardown, or concurrency invariant;
- an intentional asymmetry between otherwise similar paths;
- a performance trade-off that justifies additional complexity;
- an external protocol constraint with a useful source reference;
- an invariant not representable by the type system.

Good:

```ts
// Do not cache by DSH version alone. Profiles with the same DSH version can
// resolve different bundle/package graphs and therefore different contracts.
```

Bad:

```ts
// Get the profile.
const profile = getProfile()
```

Do not store review history or reasoning transcripts in source comments. Explain the current reason the code must remain this way; Git preserves history.

### Public JSDoc

Public/exported APIs SHOULD document non-obvious usage contracts: purpose, relevant preconditions/postconditions, failure semantics, ownership/lifecycle, and compatibility obligations. Do not narrate the implementation step by step.

If the function/type is self-explanatory and carries no non-obvious contract, do not add ceremonial prose merely to increase documentation coverage.

### TODO/FIXME

Avoid context-free markers such as `TODO: fix later`. A deferred item SHOULD reference an Issue and explain the removal/activation condition:

```ts
// TODO(#127): Remove the legacy adapter after the minimum supported DSH train
// no longer exposes the old event name.
```

Use `FIXME` only for a known defect that should not be mistaken for normal follow-up work.

## Review comments

Use prefixes when they improve clarity:

- `blocking:` must be addressed before merge;
- `suggestion:` recommended improvement that may be declined with rationale;
- `question:` clarification or design question;
- `nit:` non-blocking polish.

Review comments should explain the technical reason for a requested change. If discussion reveals that future readers could misunderstand the code, improve the code/comment/spec rather than leaving the explanation only in the review thread.

## Dependencies

Use pnpm for development. The supported Node range follows upstream DSH: `^22.19.0 || >=24.0.0`; CI exercises Node 22.19, Node 24.19, and the current Node 26 major as defined in `docs/development.md`.

Framework packages whose runtime/module identity must match the DSH host are maintained in an explicit host-identity registry. They belong in `peerDependencies` plus `devDependencies`, not as nested runtime copies, and the exact development version used by our tests must satisfy the advertised peer range. Adding another host-identity package is an explicit architecture/package-policy decision.

Ordinary Toolchain-owned runtime libraries belong in `dependencies`; build/test-only tools belong in `devDependencies`.

Add a dependency only when it removes more project-owned complexity/risk than it introduces. Inspect the lockfile diff and avoid unrelated dependency churn.

## Security-sensitive changes

Read both `SECURITY.md` and `docs/security.md`. Never commit credentials, tokens, `.env` contents, session data, or user secrets. Do not describe a temporary DSH home/process as a malicious-code security sandbox.

Candidate-plugin execution belongs behind the verification execution boundary. A change that broadens filesystem/network/process/credential exposure must state that risk explicitly in the PR.

## Definition of ready

An implementation Issue is ready when it states:

- why the work is needed;
- scope;
- measurable acceptance criteria;
- relevant spec/ADR links;
- dependencies;
- explicit non-goals where ambiguity would otherwise remain.

## Definition of done

A change is done only when:

- the intended behavior is implemented;
- relevant tests/fixtures pass;
- contracts/docs are updated where affected;
- the author/agent reviewed the final diff;
- required CI checks pass;
- executed verification is recorded accurately;
- blocking review conversations are resolved.

## Public repository model

This repository is the private development incubator. The future public project is `definitely-stable/dsh-toolchain` with desired npm identity `dsh-toolchain`. Public launch uses curated approved source states rather than exposing or rewriting incubator history; see `docs/internal/publication.md`.
