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

New M1 snapshots use the `dsh-target-v2:<sha256>` namespace defined by ADR-0007. ADR-0007 supersedes the private pre-public `dsh-target-v1` projection from ADR-0006 because v1 did not cover every package/user-declared DSH composition patch input. Toolchain's own package/version/content is observer metadata/evidence and MUST NOT by itself change the target semantic fingerprint.

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

### `dsh-target-v2` declared composition identity

The package/user-declared patch inputs consumed by current DSH boot are applied in this semantic order:

1. each declared bundle patch in `dsh.profile.bundles` order;
2. the profile `cordis.patch.yml`;
3. `$DSH_HOME/cordis.patch.yml`;
4. ordered invocation `--patch` overlays.

Current DSH launchers may synthesize additional live overlays after those inputs, for example environment-driven enable/disable state or app-owned runtime adjustments. Such launcher-synthesized/live state is not represented by `dsh-target-v2`; it belongs to observed runtime availability and execution evidence. A static `TargetSnapshot` MUST NOT be treated as proof that a live DSH launcher applied no additional state.

`dsh-target-v2` includes:

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

The `runtime` field is the Node/platform/architecture under which Toolchain resolves compatibility for this snapshot. It is not proof that an unrelated separately launched DSH process used the same runtime. Later live observations and verification receipts MUST bind their actually executed runtime and the runtime/environment facts relevant to their claims, and MUST NOT silently claim equivalence when runtime-sensitive target semantics or launcher-synthesized availability differ.

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

Target identity deliberately does not hash every package/source file. Later evidence consumers MUST bind caches/claims to the concrete evidence they use. M2 Contract Intelligence uses the separate `dsh-contract-index-v1:<sha256>` identity defined by ADR-0008 over the exact contract evidence and normalized semantics it consumes. Package-version or `TargetFingerprint` equality alone MUST NOT validate a contract cache when same-version local content may differ.

Evidence `location` MAY be used as an acquisition coordinate but MUST NOT by itself affect the Contract Index fingerprint. `contentHash`, when present and consumed, is semantic evidence identity.

## Diagnostics

A diagnostic includes a stable `code`, `severity`, `domain`, human summary, optional locations/evidence references, and optional repair metadata.

`code` is a compatibility contract. Human wording MAY change without a protocol-version bump after the relevant protocol surface is frozen.

Severity values:
`info`, `warning`, `error`, `fatal`.

Expected invalid plugin input SHOULD yield diagnostics and as much independently valid analysis as safely possible.

## Contract discovery

M2 Contract Intelligence is progressive and target-bound. It MUST NOT advertise the complete DSH catalog to a model when a compact search reference is sufficient, and it MUST retain evidence/provenance for returned facts.

The baseline contract kinds are:
`service`, `method`, `event`, `tool`, `client-slot`, `config`, `package`.

Contract availability is independent from declared capability:

- `available` means current runtime evidence proves the capability is mounted/callable in the observed scope;
- `unavailable` means current runtime evidence proves it is not available in that scope;
- `unknown` means the evidence proves a declaration/capability fact but does not establish current runtime availability.

Offline declaration/package evidence MUST NOT be upgraded from `unknown` merely because a declaration exists.

### Contract Index identity

Every successful search/inspection result MUST contain `contractIndexFingerprint` in the `dsh-contract-index-v1:<sha256>` namespace from ADR-0008. The fingerprint is bound to the exact M1 `snapshotFingerprint`, consumed evidence identities/content hashes, and normalized contract semantics. `TargetFingerprint` and `ContractIndexFingerprint` are separate identity axes.

Machine paths, timestamps, acquisition traversal order, request ids, and frontend transport metadata MUST NOT contribute to the Contract Index fingerprint.

### `contract.search`

`contract.search` request contains:

- `target` — the same closed `TargetResolveRequest` used by `target.resolve`;
- `query` — non-empty lexical query;
- optional `kinds` — unique baseline contract kinds;
- optional `limit` — integer `1..25`; implementations use `10` when omitted.

Search MUST be progressive: it returns compact `ContractReference` rows and MUST NOT require returning complete definitions for all matches.

The initial ranker is deterministic and local. It MAY rank exact/prefix/token/name matches above fact/summary matches, but equal semantic inputs MUST produce equal ordering independent of acquisition order. Embeddings or model ranking MUST NOT be required for M2.1.

A successful response has `status: "ok"`, the M1 `snapshotFingerprint`, `ContractSearchResult`, the Contract Index fingerprint, compact matches, and the evidence subset referenced by those matches.

If target acquisition cannot produce a snapshot, expected `TARGET_*` conditions return `status: "failed"` without a `snapshotFingerprint`. If evidence captured by the resolved target changes before contract acquisition can consume one coherent epoch, the response MUST be `status: "stale"` with `CONTRACT_EVIDENCE_STALE`, MUST identify the starting `snapshotFingerprint`, and MUST NOT contain successful `data`.

### `contract.inspect`

`contract.inspect` request contains:

- `target`;
- the caller's exact `contractIndexFingerprint`;
- one non-empty `contractId` selected from search.

Inspection MUST reacquire/rebuild the current target-bound index rather than silently trusting caller-supplied cached facts. If the current fingerprint differs from the requested fingerprint, the response MUST be `status: "stale"` with `CONTRACT_INDEX_STALE`, MUST identify the current operation's target snapshot, and MUST NOT return a contract payload.

If the fingerprint is current but `contractId` is absent, the response is `status: "failed"` with `CONTRACT_NOT_FOUND`. This is distinct from stale index state.

A successful inspection returns exactly one normalized `ContractDefinition`, its `contractIndexFingerprint`, and the evidence needed to support that contract. Facts carry their own `evidenceIds`; callers MUST NOT infer stronger provenance than those references establish.

Current DSH exposes official read-only runtime inspection through `ctx.cordisInspect` / `cordis_inspect_list` / `cordis_inspect_query`. Toolchain MUST prefer/consume that official seam for live runtime contract evidence when the target exposes it rather than reimplementing DSH reflection. Because those queries are Agent-scoped, offline CLI/MCP calls without a real DSH Agent remain usable through package/manifest/type evidence and report live availability as `unknown`.

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

M2 contract projections MUST call the same kernel search/inspect use cases. The DSH adapter MAY enrich live evidence through the host-owned Inspect capability when a real Agent scope exists; it MUST NOT create a second identity-sensitive tools/Inspect runtime merely for Toolchain.

### DSH Web

Web MUST consume Host application semantics rather than implement validation/verification rules in the browser.

### MCP

The MCP projection uses structured results conforming to the Toolchain Protocol. MCP-specific task support MAY map Toolchain Operations onto the current MCP Tasks extension without changing kernel semantics.

Immediate post-M1 target parity MUST project the existing kernel `target.resolve` semantics rather than introducing an MCP-owned target DTO. M2 `contract.search` / `contract.inspect` likewise project Protocol DTOs and shared kernel behavior rather than MCP-owned ranking/acquisition logic.

### CLI

Machine CLI output MUST be explicitly protocol-versioned. JSON/JSONL mode MUST keep machine output separate from human logs/progress.

## Compatibility status vocabulary

When Toolchain reports its support relationship to a DSH target, the baseline statuses are:
`tested`, `supported`, `experimental`, `unsupported`.

Unknown/pre-release targets MAY be inspected in best-effort/read-only mode, but Toolchain MUST NOT claim verified migration/mutation support without a matching adapter/tested path.
