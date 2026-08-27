# M2.1 Second Corrective Merge Gate

**Status:** active — PR #30 is Draft again.

**Trigger:** independent review after CI #320 exposed semantic coverage gaps that the existing synthetic/unit and exact-package smoke did not exercise.

**Upstream baseline re-verified:** `deepseek-ai/deepseek-harness` master `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `dsh@0.1.1-rc.2`.

## Root causes

1. **Contract package universe is too narrow.** M2.1 currently indexes only the DSH app, ordered profile bundles and explicit profile dependencies. Upstream DSH deliberately makes in-box plugin/API packages resolvable through a BFS dependency closure over the DSH application, including installed `peerDependencies`; a clean shipped `web` profile has empty ordinary dependencies, so important API authorities such as `@deepseek-ai/dsh-tools` are not guaranteed to become Contract Index packages.
2. **Declaration traversal and public-surface propagation are conflated.** The graph walker follows relative re-exports and triple-slash path references, then promotes every export from every visited declaration file to a package-level `declaration-export`. This leaks sibling exports through named re-exports, flattens namespace re-exports, propagates `default` through `export *`, and treats path-reference dependencies as package exports.
3. **Syntax parsing is not fail-closed.** `ts.createSourceFile()` performs parser recovery; `try/catch` alone does not reject malformed declarations. Syntax diagnostics must be checked explicitly without introducing semantic/type checking.
4. **Resource bounds stop at bytes/files/edges/depth.** A bounded declaration corpus can still normalize into an excessive fact set. Package discovery also needs a deterministic bound.

## Fixed architecture decisions

- Do **not** change `dsh-target-v2`. Dependency closure is Contract Intelligence evidence, not target composition identity.
- Keep explicit package roots from M1 evidence exactly as they are today.
- Add a **DSH-owned installed contract closure** rooted at the exact DSH application manifest. Resolution follows the same nearest/first-wins anchor semantics as upstream DSH: each dependency is resolved from the declaring package's manifest anchor; both `dependencies` and installed `peerDependencies` participate.
- The closure may traverse only DSH authority packages (`@deepseek-ai/*`) for M2.1. Explicit out-of-tree profile dependencies/bundles remain indexed themselves but do not recursively explode arbitrary npm dependency graphs.
- Every discovered closure package gets exact manifest/version/content evidence in `dsh-contract-index-v1`; absolute paths remain non-semantic.
- Declaration parsing returns typed edges. Traversal answers “which files are supporting evidence?”; a separate deterministic effective-surface computation answers “which names does this public entrypoint export?”.
- `export { A as B } from './x'` exposes only `B`; `export * as ns` exposes only `ns`; `export *` propagates child public names except `default`; `/// <reference path>` contributes evidence only, never root exports.
- Malformed syntax fails with `CONTRACT_DECLARATION_INVALID`; semantic/unresolved-type errors remain outside M2.1 syntax-only validation.
- Add deterministic `maxContractPackages` and `maxNormalizedFactsPerPackage` limits under the existing structured resource-limit failure family.
- Keep TypeScript 6.0.3 pinned. Lazy-load the parser module only when contract acquisition actually runs; `--version` and `target resolve` should not load the compiler.

## Task 1 — RED: real package-universe coverage

- [ ] Add a focused filesystem fixture where the target has no `@deepseek-ai/dsh-tools` profile dependency, while the exact DSH app reaches it through `@deepseek-ai/dsh-base` dependency closure.
- [ ] Require `package:@deepseek-ai/dsh-tools` and `ToolDefinition` to appear.
- [ ] Prove an arbitrary third-party transitive dependency is not promoted into the Contract Index merely because it is reachable.
- [ ] Observe RED on current `expectedPackages()` root-only behavior.

## Task 2 — GREEN: deterministic DSH authority closure

- [ ] Add read-only package resolution from each manifest anchor without relying on `package.json` exports.
- [ ] Traverse installed `dependencies` + `peerDependencies` breadth-first with deterministic ordering and first resolution wins.
- [ ] Merge closure packages with explicit target-root aliases without duplicate contracts.
- [ ] Hash discovered manifest bytes as Contract Index evidence.
- [ ] Add `maxContractPackages` budget and N/N+1 tests.

## Task 3 — RED→GREEN: effective declaration export semantics

- [ ] Replace untyped `relativeReexports: string[]` with typed declaration edges.
- [ ] Add negative regressions:
  - named re-export does not leak sibling exports;
  - renamed export preserves the exported alias;
  - namespace re-export does not flatten members;
  - `export *` does not propagate `default`;
  - triple-slash path reference does not create package-level exports.
- [ ] Compute effective exports from public entrypoints separately from evidence graph traversal, with deterministic cycle-safe star propagation.
- [ ] Preserve minimal evidence witnesses for resulting facts.

## Task 4 — RED→GREEN: fail-closed syntax diagnostics

- [ ] Add malformed `.d.ts` regression that TypeScript recovers into an AST today.
- [ ] Reject syntactic diagnostics as `CONTRACT_DECLARATION_INVALID`.
- [ ] Do not run semantic/type diagnostics or resolve imported modules through a TypeScript Program.

## Task 5 — RED→GREEN: normalized semantic budgets

- [ ] Add `maxNormalizedFactsPerPackage` with N/N+1 test.
- [ ] Count facts before constructing/canonicalizing the final contract.
- [ ] Reuse `CONTRACT_DECLARATION_LIMIT_EXCEEDED` unless a clearer existing resource diagnostic already exists.

## Task 6 — runtime hygiene

- [ ] Remove eager runtime import of the TypeScript parser from generic acquisition/bootstrap paths.
- [ ] Dynamically load the default syntax adapter only inside contract acquisition; injected test adapters remain supported.
- [ ] Add a package/runtime smoke proving `target resolve` remains independent from TypeScript parser loading where practical.

## Task 7 — authoritative real-web regression

- [ ] Add a primary-lane-only exact-artifact smoke:
  1. install pinned real DSH `0.1.1-rc.2`;
  2. initialize clean shipped `web` profile;
  3. install the exact `dsh-toolchain.tgz`;
  4. run `contract search --query ToolDefinition --kind package` against that real profile;
  5. require `package:@deepseek-ai/dsh-tools`;
  6. inspect that exact result using the returned `dsh-contract-index-v1` fingerprint;
  7. require exact declaration evidence for `ToolDefinition`.
- [ ] Keep this expensive registry/DSH check only in the primary Ubuntu lane.

## Task 8 — governance and final gate

- [ ] Update Issue #29 with this second corrective gate and supersede CI #320 as historical evidence only.
- [ ] Synchronize the first corrective plan checkboxes with its completed state.
- [ ] Update PR #30 body to active corrective state, then to exact final-head evidence only after GREEN.
- [ ] Run aggregate gate, Node 22/24/26, Windows/macOS, exact pack/installed consumer, real DSH composition, real-web Contract Intelligence smoke and multi-train target smoke on one final SHA.
- [ ] Re-check PR comments/reviews/threads.
- [ ] Mark Ready for review only after all gates are GREEN on the exact final HEAD.

## Deferred follow-up

Dependency-closed MCP JSON Schema projection is worthwhile before public alpha to prevent `$defs` growth from wasting model context, but it is not part of this M2.1 correctness repair. Track it separately rather than coupling Protocol-surface optimization to package/export correctness.
