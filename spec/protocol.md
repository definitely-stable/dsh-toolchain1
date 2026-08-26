# DSH Toolchain Protocol v1

Status: **Baseline specification (pre-public)**

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative only when capitalized, as defined by RFC 2119 and RFC 8174.

This specification defines Toolchain's transport-neutral semantic contract. MCP, CLI, DSH Service/tools, and DSH Web are projections of this protocol.

## Versioning

`protocolVersion` identifies the complete compatible Protocol schema bundle. Protocol v1 currently uses the string `"1"`.

Protocol v1 is still pre-public while DSH Toolchain remains an unpublished private incubator package. Until an explicit Protocol v1 freeze/public release, incompatible v1 edits MAY be made only atomically with the affected normative specification, schema, generated types, canonical examples, conformance tests, and implementation. This pre-public rule exists so real M1–M4 use cases can correct speculative baseline DTOs before they become an external compatibility promise.

After Protocol v1 is frozen for public release, implementations MAY introduce new diagnostic codes, diagnostic domains, and other values only where the machine schema intentionally leaves that vocabulary open. Implementations MUST NOT emit undeclared properties into schema objects that declare `additionalProperties: false`. Adding/removing fields in a closed object, changing an existing field's meaning/type, or reusing a diagnostic code for different semantics requires a new protocol version unless the schema explicitly defines a compatible extension point.

Software package versions, target-fingerprint namespaces, DSH target versions, and Toolchain Protocol versions are independent version axes.

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
- `dshPackageRoot` — an explicit installed `@deepseek-ai/dsh` package root;
- `patches` — an ordered array of patch paths corresponding to DSH invocation-level `--patch` overlays for the target being described.

Acquisition hints MAY be absolute machine paths. Their path strings MUST NOT contribute directly to the semantic target fingerprint and MUST NOT be copied into semantic target fields merely because they were supplied by a caller. For `patches`, the ordered content hashes are semantic; the filenames/locations are evidence only. Repeated patches remain meaningful because DSH applies overlays in order, so `patches` is not a set.

When `dshPackageRoot` is omitted, a Node-facing acquisition adapter MAY resolve `@deepseek-ai/dsh` through deterministic package-resolution anchors belonging to the installed Toolchain/profile graph. It MUST NOT silently guess an unrelated installation from PATH merely to make the request succeed. An explicit root, when supplied, has priority.

Target resolution is read-only. Toolchain MUST NOT initialize a missing profile, install packages, rewrite profile manifests, create fallback links, or mutate the active profile merely to make `target.resolve` succeed. A missing/unreadable/unresolvable target is represented by diagnostics or infrastructure failure according to whether a semantic response can still be produced.

A successful `TargetResolveResponse` has `status: "ok"` and MUST contain `data`, `snapshotFingerprint`, and `diagnostics`. Its `TargetResolveResult` contains one immutable `TargetSnapshot`. The snapshot records exact resolved package/runtime/profile identities and evidence used by the acquisition provider; it MUST use resolved package versions rather than dependency ranges for compatibility identity.

A failed `TargetResolveResponse` has `status: "failed"`, MUST contain at least one structured diagnostic, and MUST NOT contain successful `data` or `snapshotFingerprint` fields.

New M1 snapshots use the `dsh-target-v2:<sha256>` namespace defined by ADR-0007. ADR-0007 supersedes the private pre-public `dsh-target-v1` projection from ADR-0006 because v1 did not cover every current DSH composition patch layer. Toolchain's own package/version/content is observer metadata/evidence and MUST NOT by itself change the target semantic fingerprint.

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

A semantic fingerprint MUST change when compatibility-relevant target state represented by its namespace changes and SHOULD remain stable across machines when those effective target semantics are identical.

### `dsh-target-v2` composition identity

Current DSH boot composes the selected profile in this semantic order:

1. each declared bundle patch in `dsh.profile.bundles` order;
2. the profile `cordis.patch.yml`;
3. `$DSH_HOME/cordis.patch.yml`;
4. ordered invocation `--patch` overlays.

`dsh-target-v2` therefore includes:

- exact `@deepseek-ai/dsh` version;
- the resolution/compatibility runtime's Node version, platform, and architecture;
- profile name;
- ordered resolved non-observer bundle identities `{ name, version, patchHash }`;
- sorted non-observer top-level profile dependencies `{ name, version }`;
- `profilePatchHash`;
- `homePatchHash`;
- ordered `overlayPatchHashes`.

The `dsh-toolchain` observer is retained in acquisition evidence but excluded from semantic bundle/dependency identity so upgrading the observer alone does not rename an otherwise identical target.

Patch hashes use exact UTF-8 contents rather than a speculative YAML/`!!js` semantic normalizer. Formatting/comment-only changes may therefore change the target fingerprint. This intentionally prefers a false difference over false sameness.

An absent profile patch is valid and hashes the exact sentinel `dsh-target-v2:profile-patch:absent`. An absent home patch is valid and hashes `dsh-target-v2:home-patch:absent`. These are distinct from each other and from present empty files. A declared bundle patch or caller-supplied overlay that cannot be read cannot produce the requested exact target snapshot.

The `runtime` field is the Node/platform/architecture under which Toolchain resolves compatibility for this snapshot. It is not proof that an unrelated separately launched DSH process used the same runtime. Later live observations and verification receipts MUST bind their actually executed runtime and MUST NOT silently claim equivalence when runtime-sensitive target semantics differ.

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

Target identity deliberately does not hash every package/source file. Later evidence consumers MUST bind caches/claims to the concrete evidence they use. In particular, M2 Contract Intelligence MUST define a target-bound contract evidence/index identity over its actual generated-catalog/type/source/runtime inputs; package-version equality alone MUST NOT validate a contract cache when same-version local content may differ.

## Diagnostics

A diagnostic includes a stable `code`, `severity`, `domain`, human summary, optional locations/evidence references, and optional repair metadata.

`code` is a compatibility contract. Human wording MAY change without a protocol-version bump after the relevant protocol surface is frozen.

Severity values:
`info`, `warning`, `error`, `fatal`.

Expected invalid plugin input SHOULD yield diagnostics and as much independently valid analysis as safely possible.

## Contract discovery

### `contract.search`

Search MUST be progressive: it returns compact references/ranking metadata and MUST NOT require returning complete definitions for all matches.

Search results MUST identify the snapshot against which they were computed and, once the M2 evidence/index identity is introduced, MUST be traceable to the contract evidence/index state that produced them.

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

The M1 CLI vertical slice proves `target.resolve`; immediate post-M1 frontend parity projects that same kernel call through the Toolchain Service/native DSH tool rather than reimplementing target acquisition in the adapter.

### DSH Web

Web MUST consume Host application semantics rather than implement validation/verification rules in the browser.

### MCP

The MCP projection uses structured results conforming to the Toolchain Protocol. MCP-specific task support MAY map Toolchain Operations onto the current MCP Tasks extension without changing kernel semantics.

Immediate post-M1 target parity MUST project the existing kernel `target.resolve` semantics rather than introducing an MCP-owned target DTO.

### CLI

Machine CLI output MUST be explicitly protocol-versioned. JSON/JSONL mode MUST keep machine output separate from human logs/progress.

## Compatibility status vocabulary

When Toolchain reports its support relationship to a DSH target, the baseline statuses are:
`tested`, `supported`, `experimental`, `unsupported`.

Unknown/pre-release targets MAY be inspected in best-effort/read-only mode, but Toolchain MUST NOT claim verified migration/mutation support without a matching adapter/tested path.
