# DSH Toolchain Protocol v1

Status: **Baseline specification (pre-public)**

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when capitalized, as defined by RFC 2119 and RFC 8174.

This specification defines Toolchain's transport-neutral semantic contract. MCP, CLI, DSH Service/tools, and DSH Web are projections of this protocol.

## Versioning

`protocolVersion` identifies the complete compatible Protocol schema bundle. Protocol v1 currently uses the string `"1"`.

Protocol v1 is still pre-public while DSH Toolchain remains an unpublished private incubator package. Until an explicit Protocol v1 freeze/public release, incompatible v1 edits MAY be made only atomically with the affected normative specification, schema, generated types, canonical examples, conformance tests, and implementation. This pre-public rule exists so real M1–M4 use cases can correct speculative baseline DTOs before they become an external compatibility promise.

After Protocol v1 is frozen for public release, implementations MAY introduce new diagnostic codes, diagnostic domains, and other values only where the machine schema intentionally leaves that vocabulary open. Implementations MUST NOT emit undeclared properties into schema objects that declare `additionalProperties: false`. Adding/removing fields in a closed object, changing an existing field's meaning/type, or reusing a diagnostic code for different semantics requires a new protocol version unless the schema explicitly defines a compatible extension point.

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

The generic baseline response envelope remains available for operation families whose concrete payloads are not yet implemented. Once an operation becomes an implemented Toolchain capability, its success payload SHOULD be bound by an operation-specific response schema rather than relying on unconstrained generic `data`.

## Target resolution

### `target.resolve`

`target.resolve` is the first closed operation-specific Protocol contract.

The request requires:

- `profile` — the DSH profile name whose effective target is being inspected. It follows upstream naming rules and MUST NOT be `.`, `..`, `node_modules`, or contain `/` or `\\`.

The request MAY also contain acquisition hints:

- `dshHome` — an explicit Harness home path;
- `dshPackageRoot` — an explicit installed `@deepseek-ai/dsh` package root.

Acquisition hints MAY be absolute machine paths. They MUST NOT contribute directly to the semantic target fingerprint and MUST NOT be copied into semantic target fields merely because they were supplied by a caller.

Target resolution is read-only. Toolchain MUST NOT initialize a missing profile, install packages, rewrite profile manifests, or mutate the active profile merely to make `target.resolve` succeed. A missing/unreadable/unresolvable target is represented by diagnostics or infrastructure failure according to whether a semantic response can still be produced.

A successful `TargetResolveResponse` has `status: "ok"` and MUST contain `data`, `snapshotFingerprint`, and `diagnostics`. Its `TargetResolveResult` contains one immutable `TargetSnapshot`. The snapshot records exact resolved package/runtime/profile identities and evidence used by the acquisition provider; it MUST use resolved package versions rather than dependency ranges for compatibility identity.

A failed `TargetResolveResponse` has `status: "failed"`, MUST contain at least one structured diagnostic, and MUST NOT contain successful `data` or `snapshotFingerprint` fields.

M1 fingerprints use the `dsh-target-v1:<sha256>` namespace defined by ADR-0006. Toolchain's own package/version is observer metadata/evidence and MUST NOT by itself change the target semantic fingerprint.

## Target snapshot

A `TargetSnapshot` is an immutable normalized view of a DSH target.

A snapshot MUST:
- identify the selected DSH installation/profile;
- contain a semantic fingerprint;
- record exact runtime coordinates used by the target identity;
- record ordered resolved bundle identities and normalized top-level target dependency identities required by the current fingerprint namespace;
- record the evidence set used to derive compatibility-relevant facts;
- exclude secrets from its public representation;
- keep acquisition paths/evidence locations separate from semantic identity;
- separate declared capability from observed runtime availability when those facts are introduced by later milestones.

A semantic fingerprint MUST change when compatibility-relevant target state changes and SHOULD remain stable across machines when the effective target semantics represented by that fingerprint namespace are identical.

For `dsh-target-v1`, present profile patch UTF-8 contents are conservatively content-hashed rather than semantically normalized. Formatting/comment-only patch changes may therefore produce a different v1 fingerprint; this avoids false sameness until a safe canonical patch representation is proven. An absent `cordis.patch.yml` is valid and uses SHA-256 of the exact sentinel `dsh-target-v1:profile-patch:absent`, which is distinct from a present empty file.

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

`code` is a compatibility contract. Human wording MAY change without a protocol-version bump after the relevant protocol surface is frozen.

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

These M2 contracts remain descriptive baseline text until their operation-specific schemas and implementations are introduced. Do not infer a callable M1 capability from their presence here.

## Plugin analysis and validation

`plugin.analyze` produces a normalized plugin model plus diagnostics without requiring candidate runtime execution.

`plugin.validate` applies declared validation levels/checks to that model. Static validation MUST NOT execute candidate plugin code.

Validation MUST NOT mutate the user's active DSH profile.

A failed validation is a successful protocol operation whose report status is `failed`.

These M3 contracts remain baseline semantics until their operation-specific request/result schemas are implemented.

## Verification

`plugin.verify` follows `spec/verification.md`.

A verification success claim MUST bind to both a candidate artifact fingerprint and a target snapshot fingerprint.

If the target becomes stale in a way relevant to executed checks, the final result MUST NOT be `verified`.

The M4 verification DTOs remain pre-public baseline vocabulary until the real verification worker is implemented and the contract is reviewed against that implementation.

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

The detailed Operation payload remains M4-owned and MUST be evolved from actual long-running worker requirements rather than expanded speculatively during M1.

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
