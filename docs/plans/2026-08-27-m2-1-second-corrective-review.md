# M2.1 Second Corrective Merge Gate

**Status:** completed. Functional GREEN was CI #334 and governance-head GREEN was CI #337. A later independent review opened a separate third corrective gate; this file is now historical execution evidence for the second pass.

**Trigger:** independent review after CI #320 exposed semantic coverage gaps that the existing synthetic/unit and exact-package smoke did not exercise.

**Upstream baseline re-verified:** `deepseek-ai/deepseek-harness` master `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `dsh@0.1.1-rc.2`.

## Root causes

1. **Contract package universe was too narrow.** M2.1 originally indexed only the DSH app, ordered profile bundles and explicit profile dependencies. Upstream DSH deliberately makes in-box plugin/API packages resolvable through an installed dependency closure; a clean shipped `web` profile does not guarantee important API authorities such as `@deepseek-ai/dsh-tools` are explicit profile dependencies.
2. **Declaration traversal and public-surface propagation were conflated.** The graph walker followed relative re-exports and triple-slash path references, then promoted every export from every visited declaration file to a package-level `declaration-export`. This leaked sibling exports through named re-exports, flattened namespace re-exports, propagated `default` through `export *`, and treated path-reference dependencies as package exports.
3. **Syntax parsing was not fail-closed.** `ts.createSourceFile()` performs parser recovery; `try/catch` alone did not reject malformed declarations. Public syntactic diagnostics are now checked without introducing semantic/type checking of target packages.
4. **Resource bounds stopped at bytes/files/edges/depth.** A bounded declaration corpus could still normalize into an excessive fact set, and package discovery itself needed a deterministic bound.
5. **Real published declaration graphs contain NodeNext declaration specifiers not represented by the first fixtures.** Cordis uses relative declaration references such as `./context.ts`; declaration acquisition must resolve those to declaration files (`context.d.ts`) rather than reject them or read source TypeScript.
6. **Package `exports` wildcard targets are templates, not files.** Real `@deepseek-ai/dsh-host-apiproxy` publishes a shape such as `"./api/*": { "types": "./lib/types/api/*.d.ts" }`. Recursively collecting every `types` value erased the export-map key semantics and attempted to read the wildcard target literally.

## Fixed architecture decisions

- Do **not** change `dsh-target-v2`. Installed dependency closure is Contract Intelligence evidence, not target composition identity.
- Keep explicit package roots from M1 evidence exactly as they are today.
- Add a **DSH-owned installed contract closure** rooted at all explicit DSH-owned target roots. Resolution follows nearest/first-wins anchor semantics: each dependency is resolved from the declaring package's manifest anchor; `dependencies` and installed `peerDependencies` participate.
- The closure may traverse only DSH authority packages (`@deepseek-ai/*`) for M2.1. Explicit out-of-tree profile dependencies/bundles remain indexed themselves but do not recursively explode arbitrary npm dependency graphs.
- Every discovered closure package gets exact manifest/version/content evidence in `dsh-contract-index-v1`; absolute paths remain non-semantic.
- Declaration parsing returns typed edges. Traversal answers “which files are supporting evidence?”; a separate deterministic effective-surface computation answers “which names does this public entrypoint export?”.
- `export { A as B } from './x'` exposes only `B`; `export * as ns` exposes only `ns`; `export *` propagates child public names except `default`; `/// <reference path>` contributes evidence only, never root exports.
- Malformed syntax fails with `CONTRACT_DECLARATION_INVALID`; semantic/unresolved-type errors remain outside M2.1 syntax-only validation.
- Relative `.ts/.mts/.cts` specifiers in declaration evidence resolve to `.d.ts/.d.mts/.d.cts`, preserving declaration-only acquisition.
- Concrete package export `types` entrypoints are consumed; wildcard subpath keys/targets are not treated as literal files or expanded into an unbounded filesystem glob in M2.1.
- Add deterministic `maxContractPackages` and `maxNormalizedFactsPerPackage` limits under the existing structured resource-limit failure family.
- Keep TypeScript 6.0.3 pinned. Lazy-load the parser module only when contract acquisition actually runs; `--version` and `target resolve` do not need the compiler.

## Task 1 — RED: real package-universe coverage

- [x] Add a focused filesystem fixture where the target has no `@deepseek-ai/dsh-tools` profile dependency, while an explicit DSH-owned bundle reaches it through dependency closure.
- [x] Require `package:@deepseek-ai/dsh-tools` and `ToolDefinition` to appear.
- [x] Prove an arbitrary third-party transitive dependency is not promoted into the Contract Index merely because it is reachable.
- [x] Observe RED on the previous root-only behavior.

## Task 2 — GREEN: deterministic DSH authority closure

- [x] Add read-only package resolution from each manifest anchor without relying on `package.json` exports.
- [x] Traverse installed `dependencies` + `peerDependencies` deterministically with first-resolution-wins semantics.
- [x] Merge closure packages with explicit target-root aliases without duplicate contracts.
- [x] Hash discovered manifest bytes as Contract Index evidence.
- [x] Add `maxContractPackages` budget and N/N+1 tests.

## Task 3 — RED→GREEN: effective declaration export semantics

- [x] Replace untyped relative re-export strings with typed declaration edges.
- [x] Add negative regressions: named re-export does not leak siblings; renamed export preserves the exported alias; namespace re-export does not flatten members; `export *` does not propagate `default`; triple-slash path reference does not create package-level exports.
- [x] Compute effective exports from public entrypoints separately from evidence graph traversal, with deterministic cycle-safe star propagation.
- [x] Preserve minimal evidence witnesses for resulting facts.

## Task 4 — RED→GREEN: fail-closed syntax diagnostics

- [x] Add malformed `.d.ts` regression that TypeScript recovers into an AST.
- [x] Reject syntactic diagnostics as `CONTRACT_DECLARATION_INVALID`.
- [x] Do not run semantic/type diagnostics or execute target packages.

## Task 5 — RED→GREEN: normalized semantic budgets

- [x] Add `maxNormalizedFactsPerPackage` with N/N+1 test.
- [x] Count facts before constructing/canonicalizing the final contract.
- [x] Reuse `CONTRACT_DECLARATION_LIMIT_EXCEEDED` for deterministic package/fact acquisition resource limits.

## Task 6 — runtime hygiene and real declaration forms

- [x] Remove eager runtime import of the TypeScript parser from generic acquisition/bootstrap paths.
- [x] Dynamically load the default syntax adapter only inside contract acquisition; injected test adapters remain supported.
- [x] Preserve target-only startup/resolution independence from the TypeScript parser.
- [x] Support declaration-semantic `.ts/.mts/.cts -> .d.ts/.d.mts/.d.cts` resolution without opening source TypeScript.
- [x] Treat wildcard package-export `types` targets as templates rather than literal declaration files; retain concrete export entrypoints.

## Task 7 — authoritative real-web regression

- [x] Add a primary-lane-only exact-artifact smoke:
  1. install pinned real DSH `0.1.1-rc.2`;
  2. initialize clean shipped `web` profile;
  3. install the exact `dsh-toolchain.tgz`;
  4. run `contract search --query ToolDefinition --kind package` against that real profile;
  5. require `package:@deepseek-ai/dsh-tools`;
  6. inspect that exact result using the returned `dsh-contract-index-v1` fingerprint;
  7. require exact declaration evidence for `ToolDefinition`.
- [x] Keep this expensive registry/DSH check only in the primary Ubuntu lane.
- [x] CI #334 on `d74638d6bc3640ab9edfc91f739fb022a6708242` proves the exact packed artifact passes this shipped-`web` smoke and the existing multi-train target smoke.

## Task 8 — governance and final gate

- [x] Supersede CI #320 as historical evidence rather than merge approval.
- [x] Synchronize the original and first corrective implementation-plan completion state.
- [x] Update Issue #29 and PR #30 metadata to the exact final governance-head evidence after the final CI.
- [x] Functional checkpoint CI #334 passes aggregate gate, Node 22/24/26, Windows/macOS, exact pack/installed consumer, real DSH composition, real-web Contract Intelligence smoke and multi-train target smoke.
- [x] Run the same required CI once more on governance-only SHA `2c7609badaae9f1a9b54ea345e14481b604d42ea`: CI #337 (`33070190485`) GREEN.
- [x] Re-check PR comments/reviews/threads; none were present at the second-pass final checkpoint.
- [x] Mark Ready for review after CI #337. A later independent review subsequently returned PR #30 to Draft for the separate third corrective gate.

## Verification chronology

- CI #320 was the first full GREEN checkpoint but is historical evidence only because later semantic review found missing coverage.
- CI #322 reproduced the second-pass semantic gaps with focused RED regressions while the prior suite remained otherwise green.
- Later authoritative real-Web smoke exposed real upstream declaration forms that synthetic fixtures had missed: declaration `.ts` specifiers and wildcard package-export templates.
- CI #333 (`33068823748`) is the clean wildcard TDD RED: one new semantic-correctness test failed while 214 tests passed.
- CI #334 (`33069654095`) is the functional GREEN checkpoint on `d74638d6bc3640ab9edfc91f739fb022a6708242`: all six jobs and every required primary boundary passed.
- CI #337 (`33070190485`) is the completed governance-head GREEN on `2c7609badaae9f1a9b54ea345e14481b604d42ea` for this second corrective pass.

## Deferred follow-up

Dependency-closed MCP JSON Schema projection is worthwhile before public alpha to prevent `$defs` growth from wasting model context, but it is not part of this M2.1 correctness repair. Track it separately rather than coupling Protocol-surface optimization to package/export correctness.
