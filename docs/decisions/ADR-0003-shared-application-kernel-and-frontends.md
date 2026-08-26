# ADR-0003: One application kernel for DSH, Web, CLI, and MCP

- Status: Accepted
- Date: 2026-08-26

## Context

Toolchain has several first-party consumers: DSH agents/plugins, DSH Web, CLI/CI, and external coding agents through MCP. Independent implementations would drift in validation policy, diagnostics, and compatibility semantics.

## Decision

Every frontend projects the same transport-neutral application use cases and protocol DTOs. Transport-specific naming, serialization, progress, and authorization live in adapters.

The kernel owns operations such as `target.resolve`, `contract.search`, `plugin.validate`, and `plugin.verify`. It owns no MCP/Typert/CLI/React concepts.

Protocol v1 is a coherent versioned schema bundle. Normative behavior lives in `spec/protocol.md`; machine schemas define structure.

## Consequences

Frontends remain thin and parity can be tested. This requires disciplined DTO ownership and prevents convenient but harmful frontend-local business logic.

## Verification

Conformance fixtures will be executed through multiple frontends and compared at the semantic result layer.
