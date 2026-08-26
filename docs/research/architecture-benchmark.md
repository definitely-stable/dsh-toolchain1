# Architecture Benchmark — 2026-08-26

Status: **Non-normative research note**

This note records the external designs that informed the baseline. Normative requirements live in `spec/`; accepted decisions live in ADRs. The purpose of this file is to preserve comparative reasoning so future maintainers do not reintroduce already-rejected approaches without new evidence.

## DeepSeek Harness official architecture

Sources:
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/api-gateway.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/typert.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md

Observed strengths:
- capabilities are Cordis Services and consumers depend on named capabilities rather than concrete providers;
- profile composition is explicit and `--dump-config` follows the real composition path;
- Host and Browser are separate plugin/build planes;
- Typert Remote projects selected business-service unary methods instead of centralizing business contracts in an API package;
- DSH is still a developer preview, so exact installed-target knowledge matters more than static assumptions.

Adopted:
- DSH Toolchain is distributed as a native bundle and exposes a `toolchain` capability;
- Host/Client build faces remain separate;
- Web uses business Service -> Typert Remote -> Slots rather than browser-local logic;
- acquisition prefers current generated/runtime DSH evidence over hand-maintained API docs.

Not adopted:
- putting Toolchain's semantic kernel inside Cordis/DSH, because external agents and isolated verification require the same semantics outside the active runtime.

## DSH community plugins

### dsh-mcp-lens

Source: https://github.com/labmimors/dsh-mcp-lens

Strength: reduces a large model-visible MCP catalog to a search/call surface and measures the token/retrieval trade-off.

Adopted: progressive `contract.search -> contract.inspect` and an explicit AI-evaluation requirement.

Not adopted: a generic MCP proxy; Toolchain searches DSH development contracts, not arbitrary remote tool catalogs.

### dsh-agents-plugins-bridge

Source: https://github.com/openma-ai/dsh-agents-plugins-bridge

Strengths: provider/adapter separation, explicit normalized components, reversible rows, failure isolation, Host/Web separation, no assumption that transitive hoisting is a runtime contract.

Adopted: normalize source dialects before domain logic; isolate independent component failures; keep Host lifecycle authoritative.

Not adopted: universal foreign-plugin loading. That problem is already being solved and is outside Toolchain's development/verification mission.

### dsh-web-plugin-manager

Source: https://github.com/LX2000WASD/dsh-web-plugin-manager

Strengths: Web and CLI reuse a protected application chain; offline analysis and install gates share scanners; real rollback/health behavior recognizes that installation is a lifecycle operation, not file copying.

Adopted: one application semantics layer for every frontend and structured diagnostics.

Not adopted: plugin marketplace/management scope and direct management of user plugin state.

### dsh-plugin-kit / dsh-plugin-forge

Sources:
- https://github.com/OneZero-Y/dsh-plugin-kit
- https://github.com/luoyuejun9/dsh-plugin-forge

Strengths: AI-oriented authoring workflow, scaffolding, isolated profile checks, package preview, release gates.

Adopted: verification of the distributable artifact and agent-oriented development ergonomics.

Not adopted: another prompt/workflow-centric plugin generator. Toolchain first supplies exact target knowledge and verification; deterministic generation is downstream in PluginSpec Compiler.

## rust-analyzer

Source: https://rust-analyzer.github.io/book/contributing/architecture.html

Strengths:
- analyzer receives explicit ground state and performs no IO in semantic core;
- build-system-specific concepts are lowered into abstract semantic inputs;
- broken code is normal input and analysis commonly returns partial data plus errors;
- architecture invariants define strict API/dependency boundaries.

Adopted:
- DSH acquisition/normalization is outside analysis;
- immutable normalized snapshots are explicit inputs;
- expected broken plugins produce partial models + diagnostics;
- architecture rules become executable CI fitness checks.

Not adopted initially: incremental-query infrastructure such as Salsa. DSH Toolchain should earn that complexity with profiling data first.

## Cargo

Sources:
- https://doc.rust-lang.org/cargo/reference/external-tools.html
- https://doc.rust-lang.org/cargo/commands/cargo-metadata.html

Strengths: explicit versioned JSON metadata and JSON Lines build messages make machine consumers first-class.

Adopted:
- explicit Toolchain protocol version in machine output;
- JSON/JSONL output separated from human logs;
- semantic identifiers/fingerprints rather than prose parsing.

## MCP 2026-07-28

Sources:
- https://modelcontextprotocol.io/specification/2026-07-28
- https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/

Strengths: full JSON Schema 2020-12 for tool schemas, structured tool output, and an opt-in Tasks extension for long-running work.

Adopted:
- MCP is the generic external-agent frontend;
- structured Toolchain Protocol results project into MCP output schemas;
- Toolchain's transport-neutral `Operation` can map to MCP Tasks when a client supports it.

Not adopted: MCP as the internal application architecture or as required IPC for native DSH calls.

## Agent Plugins 1.0

Source: https://agent-plugins.org/specification

Strengths:
- normative text is authoritative over machine schemas;
- one spec version selects a coherent schema set;
- client-specific extensions are namespaced;
- filesystem containment is clearly distinguished from subprocess sandboxing;
- independent component failures use the narrowest failure boundary.

Adopted:
- BCP14 normative spec + machine schema bundle;
- one Toolchain Protocol version rather than independent DTO timelines;
- accurate isolation wording;
- partial results/failure isolation.

Future use: PluginSpec Compiler SHOULD emit portable Agent Plugins components when DSH-native semantics are unnecessary rather than inventing a competing portable format.

## FastMCP 3

Source: https://gofastmcp.com/servers/transforms/transforms

Strength: Provider -> Transform -> Consumer composition and progressive tool-search transforms.

Adopted conceptually: evidence providers -> normalization/lowering -> semantic snapshot -> analysis/query.

Not adopted literally: a generic transform middleware pipeline. Toolchain keeps extension points internal until a real second implementation justifies a public contract.

## MCP Inspector and multi-frontend tooling

Source: https://github.com/modelcontextprotocol/inspector

Strength: multiple human/machine frontends sharing core semantics rather than each owning configuration/business rules.

Adopted: CLI, MCP, DSH Host, and later DSH Web are adapters to one application kernel and one release train.

## Final comparative conclusion

The baseline intentionally combines a native DSH distribution shell with compiler/analyzer-style internals:

```text
DSH-native install and capability model
                +
rust-analyzer-style IO/semantic separation
                +
Cargo-style machine contracts
                +
MCP progressive/structured external interface
                +
Agent Plugins-style normative/version/failure discipline
```

The project deliberately avoids duplicating solved ecosystem layers: generic plugin bridges, marketplaces, MCP routers, AI workflow generators, and autonomous authoring orchestration are not foundation responsibilities.
