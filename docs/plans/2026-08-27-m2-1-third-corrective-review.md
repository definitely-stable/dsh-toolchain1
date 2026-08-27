# M2.1 Third Corrective Merge Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Every behavior change is RED -> verified failure -> minimal GREEN -> focused verification.

**Status:** implementation complete. Behavioral RED is CI #343; functional GREEN is CI #345 on `a7fb3871d1f3a25c9555989dfcb1ab93e6c42f20`. This documentation commit exists only to reconcile governance after the functional GREEN; the final merge gate is one fresh full CI on the resulting exact governance HEAD.

**Goal:** close the remaining declaration-surface and aggregate-resource false-positive risks found by the post-CI #337 independent review without expanding M2.1 into full TypeScript semantic checking.

**Architecture:** retain the existing exact-target read-only acquisition pipeline. Make relative declaration target normalization idempotent and shared by module re-exports and triple-slash path references; replace single-witness export propagation with deterministic origin-aware propagation so relative named re-exports are validated against the child surface and ambiguous `export *` names are omitted rather than guessed; add aggregate operation budgets for declaration bytes/files/facts while preserving per-package limits.

**Tech Stack:** TypeScript 6.0.3 syntax API, Node filesystem promises, Vitest, existing Protocol/kernel/CLI/DSH/MCP architecture.

**Spec:** Issue #29, `spec/protocol.md`, ADR-0008, previous M2.1 corrective plans.

## Global constraints

- `dsh-target-v2` and `dsh-contract-index-v1` namespaces do not change.
- M2.1 stays syntax-only/read-only: no TypeScript semantic checker, target JavaScript execution, network acquisition, persistent cache, embeddings, or M2.2 live Agent Inspect.
- Machine paths/timestamps remain excluded from Contract Index identity.
- Relative declaration traversal remains lexically and canonically contained under the exact package root.
- Ambiguous or unproven API names must never become `declaration-export` facts.
- A single ambiguous `export *` name must not make unrelated valid contracts in the package unavailable; ambiguity is fail-closed at symbol level.
- Aggregate limits must fail with `CONTRACT_DECLARATION_LIMIT_EXCEEDED` before unbounded cross-package accumulation/canonicalization.
- Final merge gate remains exact packed artifact + real shipped-Web `ToolDefinition -> @deepseek-ai/dsh-tools -> inspect` + Node/platform/multi-train CI on one exact HEAD.

---

### Task 1 — Idempotent declaration target normalization

**Files:**
- Modify: `src/acquisition/typescript-declaration-syntax.ts`
- Test: `tests/acquisition/typescript-declaration-syntax.spec.ts`

- [x] RED: declaration-form regressions prove `./foo.d.ts`, `./foo.d.mts`, and `./foo.d.cts` are unchanged.
- [x] RED: triple-slash regressions prove `./foo.ts/.mts/.cts/.tsx` map to declaration siblings and already-declaration forms stay unchanged.
- [x] Verified previous code produced `.d.d.mts` / `.d.d.cts` and left triple-slash source extensions raw in CI #343.
- [x] GREEN: one idempotent declaration-target normalizer is used by re-exports/import-equals and path references.
- [x] Focused syntax regressions pass in CI #345.

### Task 2 — Effective re-export evaluation without false API facts

**Files:**
- Modify: `src/acquisition/dsh-contract-filesystem.ts`
- Test: `tests/acquisition/dsh-contract-semantic-correctness.spec.ts`

**Internal model:** an effective export name carries semantic origins. Named aliases propagate the child's origin; witnesses remain deterministic and minimal. At most two distinct origins are retained per name because two are sufficient to prove ambiguity and additional origins would only amplify memory.

- [x] RED: missing relative named re-export does not become a package fact.
- [x] RED: valid renamed relative export includes child declaration evidence.
- [x] RED: two distinct star origins make only that symbol ambiguous; unique names still propagate.
- [x] RED: explicit relative named export resolves a star conflict.
- [x] RED: the same semantic origin arriving through two star paths is not falsely treated as ambiguous.
- [x] Verified previous `addMinimalWitness()` selected one arbitrary deterministic winner and trusted relative named syntax without child validation in CI #343.
- [x] GREEN: origin-aware propagation validates named bindings, distinguishes star conflicts, preserves namespace/import-equals semantics, and emits a package name only when one semantic origin remains.
- [x] No full TypeScript semantic/type checking was added.
- [x] Focused semantic regressions pass in CI #345.

### Task 3 — Aggregate Contract Index acquisition budgets

**Files:**
- Modify: `src/acquisition/dsh-contract-filesystem.ts`
- Test: `tests/acquisition/dsh-contract-aggregate-budget.spec.ts`

**Operation-wide interface:**

```ts
readonly maxTotalDeclarationFiles: number
readonly maxTotalDeclarationBytes: number
readonly maxTotalNormalizedFacts: number
```

Default bounds are fixed and intentionally below the multiplicative worst case of per-package limits:

```text
maxTotalDeclarationFiles = 8,192
maxTotalDeclarationBytes = 256 MiB
maxTotalNormalizedFacts  = 65,536
```

- [x] RED: exact total declaration-file count N succeeds; N-1 fails despite every package staying under local limits.
- [x] RED: exact total declaration bytes N succeeds; N-1 fails across packages.
- [x] RED: exact total normalized facts N succeeds; N-1 fails across the acquired index.
- [x] RED: an oversized parsed export list fails structurally before iterator/materialization of the effective surface.
- [x] GREEN: one operation-scoped counter flows through sequential package acquisition and enforces total files/bytes/facts.
- [x] GREEN: `maxNormalizedFactsPerPackage` is enforced during declaration-surface construction, not only during final `ContractFact` emission.
- [x] Wall-clock timeouts remain outside semantic acquisition.
- [x] CI #343 is the clean behavioral RED: 8 new tests failed while 216 previous tests passed; CI #345 is the full functional GREEN.

### Task 4 — Governance and authoritative final verification

- [x] Second-corrective Task 8 remains historical completion; CI #337 is superseded as merge evidence by the third corrective gate.
- [x] Third-pass RED chronology recorded: CI #342 was a test-harness type error and therefore not accepted as behavioral RED; after fixing only the harness, CI #343 reproduced all eight intended behavioral failures.
- [x] Functional implementation passed aggregate generated/protocol/architecture/package/CI-storage/lint/typecheck/script/test gate in CI #345.
- [x] CI #345 passed Node 22.19.0 / 24.19.0 / 26 and Windows 2025 / macOS 15.
- [x] CI #345 passed build, exact `pnpm pack`, manifest inspection and installed consumer.
- [x] CI #345 passed real DSH `0.1.1-rc.2` minimal/Web composition and shipped-Web `ToolDefinition -> package:@deepseek-ai/dsh-tools -> inspect`.
- [x] CI #345 preserved multi-train target smoke against `0.1.1-rc.2` and `0.1.0-rc.8`.
- [ ] Run one fresh full CI on the governance-only HEAD produced by this file reconciliation.
- [ ] Re-check PR comments/reviews/threads and base/head state on that exact HEAD.
- [ ] Update Issue #29 and PR #30 metadata to that exact final HEAD and mark PR Ready for review again.

## Verification chronology

- CI #337 was the completed second-corrective governance checkpoint, later superseded by independent review.
- CI #342 stopped at TypeScript weak-type checking in the newly added aggregate-budget test harness; production remained untouched and this run is not treated as behavioral RED evidence.
- CI #343 (`33075046379`) is the accepted third-pass RED: generated/protocol/architecture/package/lint/typechecks passed, then exactly 8 new behavioral regressions failed while 216 previous tests passed. Failures covered `.d.mts/.d.cts` idempotence, triple-slash normalization, missing/ambiguous re-export semantics, explicit re-export evidence, total files/bytes/facts, and early surface-budget enforcement.
- CI #345 (`33075669576`) is the functional GREEN on `a7fb3871d1f3a25c9555989dfcb1ab93e6c42f20`: all six jobs passed, including Node 22/24/26, Windows/macOS, aggregate checks, exact pack, installed consumer, real minimal/Web DSH, shipped-Web Contract Intelligence and multi-train target smoke.
- The next CI on the documentation-only governance HEAD is the authoritative merge checkpoint.

## Review disposition

The external review is accepted on the concrete `.d.mts/.d.cts`, named/star effective-surface, aggregate-budget, triple-slash and governance findings. Its suggested package-wide failure for star ambiguity is intentionally narrowed: M2.1 omits only the ambiguous symbol because the index is a progressive evidence tool, not a TypeScript build validator. Its two aggregate counters are strengthened with `maxTotalDeclarationFiles`, because declaration evidence objects accumulate independently of byte/fact totals.
