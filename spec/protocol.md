# DSH Toolchain Protocol v1

Status: **Baseline specification**

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when capitalized, as defined by RFC 2119 and RFC 8174.

This specification defines Toolchain's transport-neutral semantic contract. MCP, CLI, DSH Service/tools, and DSH Web are projections of this protocol.

## Versioning

`protocolVersion` identifies the complete compatible Protocol schema bundle. Protocol v1 currently uses the string `"1"`.

Within a protocol version, implementations MAY add optional fields and new diagnostic codes. Consumers MUST ignore unknown optional fields unless the relevant schema explicitly closes the object. Removing required fields, changing existing field meaning/type, or reusing a diagnostic code for different semantics requires a new protocol version.

Software package versions and DSH target versions are independent from the Toolchain Protocol version.

## Common result model

Completed application calls return a structured response containing:

- `protocolVersion`;
- `requestId`;
- `snapshotFingerprint` when the operation is target-bound;
- `status`;
- operation-specific `data`;
- zero or more `diagnostics`.

Expected plugin defects MUST be represented as diagnostics/report status, not transport failures. Transport/infrastructure failures are reserved for conditions that prevent the operation from producing its defined semantic result.

## Target snapshot

A `TargetSnapshot` is an immutable normalized view of a DSH target.

A snapshot MUST:
- identify the selected DSH installation/profile;
- contain a semantic fingerprint;
- record the evidence set used to derive compatibility-relevant facts;
- exclude secrets from its public representation;
- separate declared capability from observed runtime availability.

A semantic fingerprint MUST change when compatibility-relevant target state changes and SHOULD remain stable across machines when the effective target semantics are identical.

Search, inspection, validation, and verification results that make target-specific claims MUST identify the snapshot fingerprint.

## Evidence

Evidence records have:
- stable `id`;
- `kind`;
- `strength`;
- source identity/details safe to expose;
- optional content hash or location.

Allowed baseline `kind` values:
`runtime`, `generated-catalog`, `composed-config`, `package`, `manifest`, `type-declaration`, `source`, `heuristic`.

Allowed `strength` values:
`authoritative`, `observed`, `derived`, `heuristic`.

An implementation MUST NOT upgrade a heuristic to an authoritative claim merely because several heuristics agree.

## Diagnostics

A diagnostic includes a stable `code`, `severity`, `domain`, human summary, optional locations/evidence references, and optional repair metadata.

`code` is a compatibility contract. Human wording MAY change without a protocol-version bump.

Severity values:
`info`, `warning`, `error`, `fatal`.

Expected invalid plugin input SHOULD yield diagnostics and as much independently valid analysis as safely possible.

## Contract discovery

### `contract.search`

Search MUST be progressive: it returns compact references/ranking metadata and MUST NOT require returning complete definitions for all matches.

Search results MUST identify the snapshot against which they were computed.

### `contract.inspect`

Inspection returns the normalized definition plus evidence/provenance for one selected contract. It SHOULD distinguish capability from current runtime availability.

The baseline contract kinds are:
`service`, `method`, `event`, `tool`, `client-slot`, `config`, `package`.

Kinds MAY be extended compatibly within Protocol v1.

## Plugin analysis and validation

`plugin.analyze` produces a normalized plugin model plus diagnostics without requiring candidate runtime execution.

`plugin.validate` applies declared validation levels/checks to that model. Static validation MUST NOT execute candidate plugin code.

Validation MUST NOT mutate the user's active DSH profile.

A failed validation is a successful protocol operation whose report status is `failed`.

## Verification

`plugin.verify` follows `spec/verification.md`.

A verification success claim MUST bind to both a candidate artifact fingerprint and a target snapshot fingerprint.

If the target becomes stale in a way relevant to executed checks, the final result MUST NOT be `verified`.

## Operations

Long work uses an `Operation`.

Baseline states:
- `queued`
- `running`
- `input-required`
- `succeeded`
- `failed`
- `cancelled`

`operation.get` retrieves the latest state. `operation.cancel` requests cancellation; cancellation is cooperative where an underlying process cannot be interrupted atomically.

An adapter MAY execute an operation synchronously when its policy allows, but the semantic result MUST be equivalent to the operation result.

## Frontend projections

### DSH

The DSH bundle MUST expose the same application semantics through a Cordis Toolchain Service. Native agent tools SHOULD remain a small progressive surface.

### DSH Web

Web MUST consume Host application semantics rather than implement validation/verification rules in the browser.

### MCP

The MCP projection uses structured results conforming to the Toolchain Protocol. MCP-specific task support MAY map Toolchain Operations onto the current MCP Tasks extension without changing kernel semantics.

### CLI

Machine CLI output MUST be explicitly protocol-versioned. JSON/JSONL mode MUST keep machine output separate from human logs/progress.

## Compatibility status vocabulary

When Toolchain reports its support relationship to a DSH target, the baseline statuses are:
`tested`, `supported`, `experimental`, `unsupported`.

Unknown/pre-release targets MAY be inspected in best-effort/read-only mode, but Toolchain MUST NOT claim verified migration/mutation support without a matching adapter/tested path.
