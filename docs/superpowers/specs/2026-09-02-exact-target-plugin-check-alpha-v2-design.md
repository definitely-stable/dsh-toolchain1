# Exact Target Plugin Check Alpha v2 Design

Status: proposed corrective design for Issue #154. It supersedes the implementation assumptions in PR #158 before production code is merged.

## Product question

The first user-facing Toolchain workflow answers one bounded question:

> For this plugin subject and this exact installed DSH target, what compatibility facts can Toolchain prove statically, what incompatibilities can it prove, and what remains unproven?

The operation is `plugin.check`. It is a shared application/kernel use case projected by CLI, native DSH and MCP. Candidate plugin code is never imported or executed by this static alpha.

## Contract-first correction

The current architecture/protocol baseline still names `plugin.analyze` and `plugin.validate` as separate future Protocol operations. Shipping `plugin.check` without correcting those normative documents would create two overlapping public semantic surfaces.

Before implementing the Protocol schema, update `spec/protocol.md` and `docs/architecture.md` atomically so that:

- `plugin.check` is the first public static plugin operation;
- normalization, analysis and validation are internal passes behind that operation unless a future independently useful public use case justifies exposing them;
- `plugin.verify` remains the separate M4 runtime/execution boundary.

Protocol v1 is still explicitly pre-public, so this correction is allowed before the public freeze.

## One application operation

`plugin.check` owns all compatibility report semantics. Frontends own argument/transport framing only.

Operational completion is distinct from compatibility:

- transport/application `status: ok` means the check completed and returned a report;
- `compatibility: compatible-in-scope` means every rule in the named static ruleset was proven satisfied;
- `compatibility: incompatible` means at least one rule proved an incompatibility;
- `compatibility: unproven` means no incompatibility was proved but at least one required claim lacks sufficient evidence.

`compatible-in-scope` MUST NOT be rendered as runtime verification. Runtime proof is reserved for M4.

Every result names its ruleset, initially `dsh-plugin-check-static-alpha-v1`.

## Subject model and identity

### Directory first

The first executable vertical slice accepts only:

```ts
{ kind: 'directory'; path: string }
```

Packed `.tgz` acquisition is a follow-on adapter that lowers to the same normalized subject model. It MUST NOT create another compatibility engine.

### Semantic subject fingerprint

`dsh-plugin-subject-v1:<sha256>` is a semantic fingerprint over the normalized compatibility-relevant subject projection consumed by the current model version. It excludes:

- absolute paths;
- timestamps;
- raw manifest formatting;
- unrelated manifest fields that do not affect current compatibility semantics.

The alpha projection includes, when valid:

- package name/version;
- normalized declared DSH bundle patch metadata and the patch content hash when consumed;
- normalized DSH-owned dependency relationships used by the ruleset.

Raw evidence bytes retain independent `contentHash` values. A comment/description-only manifest edit may therefore change evidence content without changing semantic subject identity.

If later source/import analysis requires an incompatible expansion of semantic identity, introduce a new subject projection/fingerprint version rather than silently redefining `dsh-plugin-subject-v1`.

### Packed artifact identity

When packed-subject support is added, exact archive bytes receive a separate artifact fingerprint. Archive identity and normalized subject identity are distinct: two differently packed archives can normalize to the same semantic subject while remaining different artifacts.

## Dependency relationship model

Do not treat every `@deepseek-ai/*` package in `dependencies` as a Host requirement.

Upstream DSH explicitly models peer dependencies as shared-instance relationships. The subject model therefore classifies DSH-owned package declarations as:

```ts
type PluginPackageRelationship =
  | 'host-peer-required'
  | 'host-peer-optional'
  | 'artifact-dependency'
```

Rules:

- a `peerDependencies` entry is a Host peer requirement;
- `peerDependenciesMeta[name].optional === true` changes it to `host-peer-optional`;
- an ordinary `dependencies` entry is an `artifact-dependency` and its absence from the target ContractIndex alone MUST NOT prove target incompatibility;
- duplicate declarations are normalized deterministically and conflicting relationship/range facts fail into stable subject diagnostics rather than being guessed away.

The first missing-package incompatibility rule applies only to `host-peer-required` relationships.

## Version evidence

M2 package contracts already contain an authoritative normalized `version` fact for the exact target package, so version reasoning should consume that fact rather than parse display summaries.

The first minimal vertical slice may prove exact version equality and return `PLUGIN_DSH_VERSION_UNPROVEN` for non-exact ranges. It MUST NOT implement an incomplete range parser and call it authoritative.

Before broad alpha release, add strict npm-compatible semver reasoning through a separately reviewed runtime-neutral adapter/dependency decision. Preserve normal prerelease semantics (`includePrerelease: false`); DSH prerelease trains make this especially important. Non-semver protocols/ranges such as unsupported workspace forms remain `unproven` unless explicitly specified.

## Static alpha checks

### Manifest

- `package.json` must be a readable JSON object;
- malformed/missing manifest returns stable diagnostics, not an uncaught process error;
- package name/version absence may yield partial subject data plus diagnostics where safely possible.

### Bundle patch

When `dsh.bundle.patch` is declared:

- it must be a supported relative package path;
- lexical resolution and filesystem-resolved containment must remain within the subject root;
- symlink, junction, reparse-point or equivalent escape is rejected;
- the file is read under explicit byte limits;
- candidate JavaScript is not imported or executed.

### Host peer requirements

For each `host-peer-required` DSH-owned package:

- absence of `package:<name>` from the exact ContractIndex proves `incompatible` with `PLUGIN_DSH_PACKAGE_MISSING`;
- an optional peer never creates this incompatibility merely because it is absent;
- an artifact dependency never creates this incompatibility merely because it is absent from the Host target.

### Version

- exact equality against the package contract's authoritative `version` fact can be proved;
- unsupported/non-exact range semantics are `unproven` in the minimal slice;
- later semver support upgrades only rules backed by strict tested semantics.

### Availability

Declaration-only `availability: unknown` is capability evidence, not runtime liveness. A rule requiring observed runtime availability cannot be marked satisfied from declarations alone.

### Target/index binding

A check result binds to the exact `TargetSnapshot.fingerprint` and `ContractIndex.fingerprint` used for analysis. Stale/reacquired evidence cannot silently yield `compatible-in-scope`.

## Evidence and partial results

Expected plugin defects are report data. Independent valid findings should survive another check becoming `unproven` or invalid where doing so is safe.

Diagnostics reference subject evidence and/or target ContractIndex evidence. Report identity must never depend on machine-specific paths or request IDs.

## Acquisition safety

Directory acquisition is untrusted-input handling, not subprocess sandboxing.

Required controls:

- lexical containment before file access;
- filesystem-resolved containment after `realpath`-equivalent resolution;
- symlink/junction/reparse escape rejection;
- Windows drive/UNC-safe containment semantics;
- regular-file checks for consumed files;
- explicit manifest/patch byte limits;
- bounded dependency counts/string sizes;
- no `npm install`, `npm pack`, lifecycle script, dynamic import or candidate execution.

This matches the Agent Plugins 1.0 principle that filesystem-resolved plugin paths must stay inside the resolved plugin root while explicitly not claiming subprocess sandboxing.

## Protocol shape

The operation-specific Protocol v1 schema should introduce only the DTOs needed by this vertical slice:

- `pluginSubjectRequest`;
- `pluginCheckRequest`;
- `pluginSubjectSnapshot`;
- `pluginPackageRequirement`;
- `pluginCheckItem`;
- `pluginCheckResult`;
- success/failure/stale response forms.

The result includes at minimum:

- subject fingerprint/snapshot;
- target fingerprint;
- ContractIndex fingerprint;
- ruleset;
- compatibility;
- deterministic check items;
- referenced evidence;
- diagnostics through the normal response envelope.

Request objects remain closed (`additionalProperties: false`).

## Initial diagnostics

Stable initial codes:

- `PLUGIN_MANIFEST_READ_FAILED`
- `PLUGIN_MANIFEST_INVALID`
- `PLUGIN_SUBJECT_LIMIT_EXCEEDED`
- `PLUGIN_BUNDLE_PATCH_MISSING`
- `PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT`
- `PLUGIN_BUNDLE_PATCH_NOT_FILE`
- `PLUGIN_DSH_PACKAGE_MISSING`
- `PLUGIN_DSH_VERSION_UNPROVEN`
- `PLUGIN_DSH_VERSION_MISMATCH` once authoritative range/equality reasoning can prove it

Diagnostic code meaning is stable; human wording may evolve.

## Frontend parity

After the shared kernel operation is green:

- CLI: `dsh-toolchain plugin check --subject <directory> --profile <name> [target hints]`;
- native DSH: `toolchain_plugin_check`;
- MCP: `plugin.check`.

All three delegate to one response/application implementation. Native Agent-scoped calls may reuse M2 live Contract enrichment; this does not execute candidate plugin code.

The shipped model-facing Toolchain skill should prefer `plugin.check` for normal static plugin review once frontend parity is proven.

## Deferred

- packed candidate acquisition until directory semantics are stable;
- source import/reference analysis;
- arbitrary M3 rule catalogs;
- build/install/boot/runtime verification;
- automatic repair/codemods;
- H2 evaluation;
- any claim that static compatibility equals runtime verification.

## Exit criteria for the directory vertical slice

- one directory request produces a deterministic report against an exact target;
- equivalent normalized subjects at different filesystem roots have the same semantic fingerprint;
- irrelevant manifest fields do not rename the semantic subject;
- changing a compatibility-relevant field does rename it;
- required Host peer absence is proven incompatible;
- optional Host peer absence and ordinary artifact-dependency absence are not mislabeled incompatible;
- unsupported range semantics remain unproven rather than guessed;
- malformed/path-escaping/oversized subject input yields stable diagnostics, not crashes;
- candidate code is never executed;
- target/index identity is present and stale-safe;
- CLI/native/MCP parity is proven before calling the alpha complete;
- full supported CI matrix remains green.
