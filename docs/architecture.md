# DSH Toolchain Architecture

Status: **Architecture baseline v1**

## Purpose and product boundary

DSH Toolchain is installed primarily as a DeepSeek Harness bundle, but its core development semantics are not embedded in Harness. The bundle is the distribution/runtime shell; a DSH-independent kernel owns target modeling, contract query, analysis, diagnostics, operations, and verification orchestration.

This split preserves native DSH adoption while making the same toolchain useful to external coding agents and CI.

### Canonical user topology

```text
dsh plugin add dsh-toolchain
          |
          v
+--------------------- DSH Toolchain bundle ----------------------+
|                                                                  |
| DSH Host + native tools     DSH Web client     CLI      MCP      |
|          \                       |               \       /       |
|           +---------------- Application Kernel ----------------+ |
|                                     |                            |
|                         immutable Target Snapshot                 |
|                           /                 \                    |
|                 Evidence acquisition      Verifier worker        |
+------------------------------------------------------------------+
```

The package ships one release train. Separate frontends are implementation faces of the same product, not independently versioned products.

## Design principles

### Plugin-first distribution, independent core

The canonical installation MUST be an installable DSH bundle. The same package SHOULD expose CLI and MCP binaries. Normal DSH use MUST NOT require a side daemon.

The dependency direction is strict:

```text
DSH Host / DSH Client / MCP / CLI
                |
                v
        Application Kernel
                |
                v
       semantic Toolchain model
```

The kernel never imports DSH runtime APIs. This is an application of the same capability boundary DSH uses for Cordis Services: consumers depend on a capability, not a concrete provider.

### Acquire, normalize, analyze

DSH-specific facts enter through acquisition providers:

```text
installed packages / manifests / profile composition
generated DSH/Cordis catalogs
type declarations and selected source metadata
dump-config
live Cordis/runtime observations
```

Providers emit evidence. A normalization/lowering layer converts DSH-specific shapes into stable Toolchain entities. The analysis layer consumes only those normalized values.

This follows the compiler/rust-analyzer pattern: IO belongs at the boundary; the semantic model is an explicit input to pure analysis.

### Immutable target snapshots

A `TargetSnapshot` is the unit of reproducibility. Search, inspection, analysis, validation, and verification claims are evaluated against a snapshot identity, not against an implicitly mutable `~/.dsh`.

A snapshot contains a canonical semantic fingerprint over compatibility-relevant target state. Machine-specific paths, user names, secrets, timestamps, and session contents are excluded from the semantic identity.

If relevant target state changes before a strong verification result is committed, the operation MUST report `stale` rather than silently claiming the new state was verified.

### Evidence, not undocumented confidence

Important facts retain provenance. Evidence records distinguish, at minimum:

- runtime observation;
- generated DSH catalog;
- composed configuration;
- installed package/manifest;
- type declaration;
- source-derived fact;
- heuristic.

Evidence strength is categorical (`authoritative`, `observed`, `derived`, `heuristic`) rather than an arbitrary probability.

Capability and availability are separate concepts: a generated catalog may prove that an API exists while a runtime observation proves that its provider is not mounted in this profile.

### Progressive contract discovery

The model-facing default is `search -> inspect`, not “send every DSH contract to the model”. Search returns small ranked references. Inspection returns the exact contract, target, and evidence only for selected entries.

The initial search implementation is deterministic and local (symbol/prefix/token/field search with a lexical ranker). Embeddings are not an M0/M1 dependency and are added only if evaluation shows material retrieval failure.

## Containers and responsibilities

### Application Kernel

Owns transport-neutral use cases:

- `target.resolve`
- `contract.search`
- `contract.inspect`
- `plugin.analyze`
- `plugin.validate`
- `plugin.verify`
- `operation.get`
- `operation.cancel`

The kernel defines no MCP, CLI, Typert, HTTP, Cordis, or React concepts.

### Semantic model and analysis

Owns `TargetSnapshot`, contract entities, plugin model, diagnostics, evidence references, compatibility facts, and deterministic analysis passes.

Broken plugins are normal input. Analysis prefers partial results plus diagnostics over throwing for expected defects.

### DSH acquisition

Knows how to locate and interrogate a specific installed Harness target. Providers may use package metadata, profile composition, `--dump-config`, generated Cordis API metadata, and runtime inspection seams exposed by the installed DSH version.

Version-specific differences are contained here. Version conditionals MUST NOT spread through analysis rules.

### Verification worker

Performs the execution boundary: build/package checks when requested, actual package installation, DSH composition, boot, runtime probe, capability assertions, and cleanup.

Candidate-plugin execution occurs out of the user's active DSH process and uses a temporary DSH home by default. See `spec/verification.md` and `docs/security.md`.

### DSH Host

Provides a Cordis `toolchain` capability (`ctx.toolchain`) backed by the same application kernel. It also projects a deliberately small set of model-facing native DSH tools.

Other DSH plugins may eventually consume stable Toolchain service methods and extension seams. Extension points are introduced only when a concrete second implementation requires them.

### DSH Web

The browser face is a native DSH client plugin. Business behavior remains on the Host/kernel. Unary browser calls use the DSH business-service/Typert Remote model where appropriate; UI contribution uses DSH Slots. Host and Client code are separate build faces and MUST NOT import each other's concrete implementations.

Long-running verification is represented by the transport-neutral `Operation` model. DSH Web can begin with `start -> status/cancel` rather than forcing a streaming protocol into unary Typert methods.

No core capability may exist only in the Web UI.

### MCP

MCP is the primary generic integration for external coding agents. The initial transport is stdio. MCP tool schemas and structured results project the Toolchain Protocol; MCP does not own domain DTOs.

Long-running operations may map to the current MCP Tasks extension when client support is available, but the kernel remains MCP-independent.

### CLI

The CLI is both a human interface and a stable machine interface for CI/agents that prefer process execution. Machine mode is versioned JSON; progress mode uses JSON Lines. Human formatting is a renderer over the same results.

## Protocol and contract ownership

`spec/protocol.md` is normative for behavior. JSON Schemas under `spec/schemas/v1/` are the machine structural contract for Toolchain Protocol v1. Normative behavior that cannot be expressed structurally remains in the specification text.

One protocol version selects a compatible bundle of DTO schemas rather than independent schema version timelines.

Transport adapters may add transport envelopes required by their protocol, but MUST preserve semantic fields and diagnostic identities.

## Operation model

Potentially long operations are represented explicitly:

```text
queued -> running -> { succeeded | failed | cancelled }
                    \-> input-required (only for operations that declare it)
```

A caller receives an `OperationRef` and can query/cancel it. Synchronous adapters MAY wait and return the final result when the execution completes within their policy.

Operations capture the starting target snapshot. A target change that invalidates verification evidence is represented explicitly, not hidden.

## Extension model

M0/M1 do not define a general plugin framework inside Toolchain. Two seams are anticipated:

- evidence acquisition provider;
- validation rule/check.

They remain internal until there is a concrete external consumer and compatibility policy. The architecture intentionally avoids middleware/event-bus/provider abstractions without a demonstrated second implementation.

## Architecture fitness

The repository will turn the dependency rules in `AGENTS.md` into executable CI checks in M0. Architecture is considered incomplete if it exists only as prose and can be violated by an ordinary import.

## References that informed the baseline

- DeepSeek Harness architecture and plugin/service model: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- DSH Services: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md
- DSH API Gateway/Typert: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/api-gateway.md
- rust-analyzer architecture: https://rust-analyzer.github.io/book/contributing/architecture.html
- Cargo external-tool contracts: https://doc.rust-lang.org/cargo/reference/external-tools.html
- MCP 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28
- Agent Plugins 1.0: https://agent-plugins.org/specification
