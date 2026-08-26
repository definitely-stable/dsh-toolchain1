# ADR-0001: Plugin-first distribution with a DSH-independent core

- Status: Accepted
- Date: 2026-08-26

## Context

DSH Toolchain must be easy for DSH users to install and must also serve external coding agents. Making the whole implementation a DSH-only plugin maximizes native integration but couples every use case to Cordis/runtime state. Making it only an external daemon weakens DSH adoption and adds unnecessary IPC for native use.

## Decision drivers

- one-step DSH installation;
- native DSH service/tools/Web integration;
- external-agent and CI reuse;
- minimal runtime layers;
- testable semantic core.

## Considered options

1. Entire product as a DSH plugin.
2. External daemon/toolchain with DSH as an RPC client.
3. **Single DSH bundle distribution with an internal DSH-independent kernel and optional external frontends.**

## Decision

Choose option 3.

The canonical product is one installable DSH bundle. The package also ships CLI/MCP entry points. DSH Host executes kernel use cases in-process for normal analysis. Candidate verification may use a subprocess because that process boundary has a concrete isolation/lifecycle purpose.

The kernel MUST NOT import DSH runtime APIs.

## Consequences

Positive:
- native installation/UX and reusable semantics;
- no daemon required for ordinary DSH usage;
- Codex/Claude/OpenCode/CI can use the same kernel through MCP/CLI.

Cost:
- explicit adapter boundaries must be maintained;
- package build needs separate Host/Client/CLI/MCP faces.

## Verification

Architecture fitness tests will reject DSH imports from kernel/protocol/analysis modules and parity tests will compare frontend semantics.
