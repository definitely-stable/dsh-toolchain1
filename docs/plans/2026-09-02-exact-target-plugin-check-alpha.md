# Exact Target Plugin Check alpha

## Goal

Turn M1 exact-target identity plus M2 Contract Intelligence into the first one-call user product:

```text
plugin source directory + explicit exact DSH target
        -> read-only subject acquisition
        -> normalized subject identity
        -> target-bound package/contract reasoning
        -> compatibility result + stable diagnostics + provenance
```

This is a static alpha. Candidate plugin code is never imported or executed. Runtime proof belongs to M4 isolated verification.

## Design decisions

### One application operation

`plugin.check` is owned by the semantic/application kernel. CLI, native DSH and MCP are projections only. The shipped model-facing skill must not contain compatibility business logic.

### Operational success is distinct from compatibility

A successfully executed check may conclude:
- `compatible`: every check in the current alpha scope is proven;
- `incompatible`: at least one current-scope incompatibility is proven;
- `unproven`: no proven incompatibility exists, but required evidence is insufficient.

Transport `status: ok` means the check operation completed. It does not mean the plugin is compatible.

### Subject identity

Initial subject kind is a source `directory`.

Semantic identity includes only normalized bytes/fields consumed by this alpha:
- package name/version when present;
- declared DSH bundle patch path and its content hash;
- relevant DSH-owned dependency/peer-dependency requirements;
- manifest content hash.

Absolute paths and timestamps are acquisition provenance only and do not affect `dsh-plugin-subject-v1:<sha256>`.

Packed `.tgz` support reuses the same normalized subject model in the next slice; it must not create a second compatibility implementation.

### Initial checks

1. `manifest`
   - `package.json` must be readable JSON object;
   - missing/invalid package metadata yields a stable subject diagnostic instead of a crash.
2. `bundle`
   - when `dsh.bundle.patch` is declared, the referenced file must be contained by the subject root and readable;
   - no candidate JavaScript is executed.
3. `dependency`
   - DSH-owned requirements are names under `@deepseek-ai/*` from `dependencies` and `peerDependencies`;
   - a required package absent from the exact target ContractIndex is proven incompatible;
   - version-range satisfaction is `unproven` in the first vertical slice unless exact equality can be proven from current evidence. Do not implement an incomplete semver engine and call it authoritative.
4. `contract`
   - package requirements are resolved only through the exact target-bound ContractIndex;
   - declaration-only `availability: unknown` is capability evidence, not runtime liveness;
   - a future requirement marked as needing runtime observation remains `unproven` without observed live evidence.
5. `target/index`
   - the result is bound to the exact target fingerprint and ContractIndex fingerprint used for reasoning;
   - stale evidence cannot yield a compatibility claim.

### Diagnostics

Initial stable codes:
- `PLUGIN_MANIFEST_READ_FAILED`
- `PLUGIN_MANIFEST_INVALID`
- `PLUGIN_BUNDLE_PATCH_MISSING`
- `PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT`
- `PLUGIN_DSH_PACKAGE_MISSING`
- `PLUGIN_DSH_VERSION_UNPROVEN`

Expected subject defects are report diagnostics, not uncaught infrastructure errors.

## Protocol shape

Add Protocol v1 definitions for:
- `pluginSubjectRequest` (`kind: directory`, `path`);
- `pluginCheckRequest` (`target`, `subject`);
- `pluginSubjectSnapshot`;
- `pluginCheckCompatibility`;
- `pluginCheckItem`;
- `pluginCheckResult`;
- `pluginCheckSuccessResponse` / expected failure response / `pluginCheckResponse`.

`pluginCheckResult` contains:
- subject snapshot/fingerprint;
- target fingerprint;
- ContractIndex fingerprint;
- `compatibility`;
- check items;
- relevant evidence.

Diagnostics remain in the Protocol response envelope, consistent with existing target/contract operations.

## Implementation tasks

### Task 1 — Protocol RED -> GREEN
- add conformance examples and request-validation tests first;
- extend schema;
- regenerate TypeScript from schema;
- add strict `parsePluginCheckRequest` with closed keys and safe directory path string validation.

### Task 2 — Runtime-neutral subject model
- define acquired subject facts and normalized projection;
- deterministic subject fingerprint;
- requirement deduplication/order normalization;
- same semantics under different absolute roots produce the same fingerprint.

### Task 3 — Node directory acquisition
- read `package.json` without importing package code;
- read/hash declared bundle patch only after lexical/realpath containment checks;
- collect bounded DSH-owned dependency/peer-dependency requirements;
- return stable acquisition errors for expected subject defects.

### Task 4 — Kernel `checkPlugin`
- reuse the same `resolveTarget` and `buildContractIndex` path as M2;
- compare subject requirements against package contracts in the exact index;
- derive compatible/incompatible/unproven deterministically;
- preserve partial findings when one independent check is unproven.

### Task 5 — CLI projection

```text
dsh-toolchain plugin check --subject <directory> --profile <name> [target hints]
```

CLI owns argument syntax only and prints the canonical Protocol response.

### Task 6 — DSH native + MCP parity
- `toolchain_plugin_check` native tool;
- `plugin.check` MCP tool;
- both delegate to shared response/application semantics;
- native execution may use Agent-scoped Contract enrichment but does not execute the candidate plugin.

### Task 7 — packed-artifact smoke
- pack the exact Toolchain artifact;
- check a deterministic plugin fixture against published supported DSH;
- prove frontend semantic parity and no candidate execution.

## Test fixtures

Minimum fixtures:
1. valid plugin requiring an available exact-target DSH package;
2. plugin requiring a fictional/missing DSH package;
3. plugin with a real package but non-exact version range -> unproven version check;
4. malformed package.json;
5. missing declared bundle patch;
6. path traversal bundle patch;
7. equivalent directory copies with same semantic fingerprint.

## Exit criteria

The alpha slice exits only when:
- one source-directory command/call returns a deterministic exact-target compatibility result;
- missing required DSH package is proven with stable diagnostic + target/index provenance;
- unknown version semantics are never mislabeled compatible/incompatible;
- expected malformed subject input produces diagnostics rather than crashes;
- no subject JavaScript is imported/executed;
- same semantic subject copied to another path has the same subject fingerprint;
- CLI/native/MCP share application semantics;
- exact packed Toolchain + real supported DSH smoke is green;
- full Node 22/24/26 + Windows/macOS CI is green.

## Explicitly deferred

- full npm semver range solver unless exact current evidence justifies adding one;
- source import/reference analysis;
- arbitrary rule catalog;
- candidate build/install/boot;
- automatic repair/codemods;
- packed subject acquisition until directory vertical slice is stable;
- H2 evaluation.
