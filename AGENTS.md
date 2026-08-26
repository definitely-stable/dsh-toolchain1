# AGENTS.md

DSH Toolchain is contract-first and plugin-first. Before changing implementation, read `docs/architecture.md`, `spec/protocol.md`, `spec/verification.md`, and the ADRs relevant to the change.

## Source-of-truth order

1. Normative specifications under `spec/`
2. Accepted ADRs under `docs/decisions/`
3. Current-state architecture in `docs/architecture.md`
4. Capability roadmap in `docs/roadmap.md`
5. GitHub issue / implementation plan for the current task

Issues and plans MUST NOT silently redefine a normative contract.

## Architectural invariants

- The canonical product distribution is one installable DSH Toolchain bundle.
- The application/analysis kernel MUST NOT depend on DSH runtime APIs.
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

These rules are intended to become executable CI gates in M0:

- `analysis` and `model` code may not import Node IO/process modules.
- protocol/schema code may not import `@deepseek-ai/*`.
- browser/client code may not import Node-only modules or Host implementations.
- DSH Host/Client adapters may depend on public kernel/protocol contracts, never the reverse.
- CLI, MCP, DSH tools, and Web handlers call application use cases.
- verification code is the only normal path allowed to spawn untrusted candidate-plugin execution.

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
