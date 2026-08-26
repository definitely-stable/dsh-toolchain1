# AGENTS.md

DSH Toolchain is contract-first and plugin-first. Automated coding agents follow the same contribution contract as humans: **read and obey `CONTRIBUTING.md` first**. This file adds agent-specific operating constraints; it does not duplicate or replace contribution policy.

Before changing implementation, read `docs/architecture.md`, `spec/protocol.md`, `spec/verification.md`, and the ADRs relevant to the change.

## Source-of-truth order

1. Normative specifications under `spec/`
2. Accepted ADRs under `docs/decisions/`
3. Current-state architecture in `docs/architecture.md`
4. Capability roadmap in `docs/roadmap.md`
5. GitHub issue / implementation plan for the current task

Issues and plans MUST NOT silently redefine a normative contract.

## Required workflow

1. Read `CONTRIBUTING.md` and this file.
2. Read the architecture/spec/ADR relevant to the task.
3. Read the current Issue/implementation plan and its acceptance criteria.
4. Inspect the current implementation before editing; do not code from assumptions about DSH APIs.
5. Make only task-relevant changes.
6. Add or update tests/fixtures together with behavior.
7. Update specs/schemas/examples/generated artifacts in the same PR when affected.
8. Review the final diff for unrelated edits, stale comments, accidental generated-file edits, and contract drift.
9. Run the relevant checks and report exactly what was executed.
10. Open/update the PR using the repository template; do not claim evidence you did not produce.

## Architectural invariants

- The canonical product distribution is one installable DSH Toolchain bundle.
- DSH installation is profile-scoped; do not invent a pseudo-global Harness installation path.
- The application/analysis kernel MUST NOT depend on DSH runtime APIs.
- The semantic core (`product`, `kernel`, `model`, `protocol`) MUST NOT import Node built-in modules; runtime-specific concerns belong at explicit boundaries.
- DSH integration depends on the kernel; the kernel never depends on DSH integration.
- Analysis MUST operate on explicit immutable inputs and MUST NOT perform filesystem, network, package-manager, or subprocess IO.
- DSH-specific acquisition is isolated behind evidence providers and normalizers.
- DSH agents, DSH Web, CLI, and MCP MUST invoke the same application use cases rather than reimplement business behavior.
- Runtime verification MUST NOT mutate the user's active DSH profile by default.
- A temporary DSH home is configuration isolation, not a malicious-code security sandbox.
- Strong compatibility/verification claims MUST identify the target snapshot and evidence used.
- Stale snapshots MUST NOT produce a fresh `verified` result.
- Machine-readable diagnostic codes are compatibility contracts; human wording is not.
- Progressive discovery is preferred to advertising the complete DSH contract catalog to a model.
- Transport-specific names and DTOs MUST NOT become domain concepts.

## Dependency fitness rules

These rules are executable CI gates:

- `product`, `kernel`, `model`, and `protocol` source may not import Node built-ins or `@deepseek-ai/*` runtime packages.
- pure layers may not reach outward adapters through relative imports or package self-references.
- browser/client source may not import Node built-ins or concrete Host implementations.
- DSH Host/Client adapters may depend on public kernel/protocol contracts, never the reverse.
- CLI, MCP, DSH tools, and Web handlers call application use cases.
- verification code is the only normal path allowed to spawn untrusted candidate-plugin execution.

## Agent-specific prohibitions

An agent MUST NOT:

- disable, weaken, skip, or delete a gate merely to make CI green;
- claim an unexecuted test/build/verification step passed;
- silently change a public contract to fit an implementation;
- introduce unrelated cleanup, renames, dependency upgrades, or formatting churn;
- hand-edit generated artifacts when a generator owns them;
- infer current DSH behavior from memory when the relevant installed/runtime evidence can be inspected;
- hide uncertainty behind fallback behavior when the contract requires a loud unsupported/invalid result;
- leave an important explanation only in a PR conversation when future maintainers need it in code/spec/ADR.

## Comments and documentation

Follow `CONTRIBUTING.md#code-comments`. Do not add comments that restate obvious control flow. Preserve non-obvious **why**, compatibility constraints, security/lifecycle invariants, and external protocol requirements. Public JSDoc documents usage contracts where they are not self-evident; ceremonial comments are discouraged.

## Change discipline

A PR that changes a public contract MUST update, in the same PR:

- normative specification;
- machine schema;
- examples;
- generated types once generation exists;
- conformance/contract tests;
- implementation.

Create a new ADR when a change alters a costly architectural decision. Do not rewrite accepted ADR history; supersede it.

## Completion discipline

Before claiming a task complete, run the narrowest relevant unit tests plus contract/schema checks, architecture fitness checks, and DSH composition/runtime checks when the task crosses those boundaries. Record what was actually executed; never treat `tsc` success as plugin verification.

The private `dsh-toolchain1` repository is an incubator. Do not optimize its Git history for public consumption or create public-only release artifacts here. The future public `definitely-stable/dsh-toolchain` is produced from a curated source-tree export according to `docs/internal/publication.md`.
