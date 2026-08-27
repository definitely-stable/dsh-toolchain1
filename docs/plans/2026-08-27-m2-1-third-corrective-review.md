# M2.1 Third Corrective Merge Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Every behavior change is RED -> verified failure -> minimal GREEN -> focused verification.

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

**Interface:** replace the re-export-only normalizer with one relative declaration-target normalizer used by both module re-export edges and `sourceFile.referencedFiles`.

- [ ] RED: add declaration-form regressions proving `./foo.d.ts`, `./foo.d.mts`, and `./foo.d.cts` are unchanged.
- [ ] RED: add triple-slash regressions proving `./foo.ts/.mts/.cts/.tsx` map to declaration siblings and already-declaration forms stay unchanged.
- [ ] Verify current code produces `.d.d.mts` / `.d.d.cts` and leaves triple-slash source extensions raw.
- [ ] GREEN: first return already declaration-form `.d.ts/.d.mts/.d.cts` unchanged, then map source `.ts/.mts/.cts/.tsx` spellings; use the helper for both re-exports/import-equals and path references.
- [ ] Run `pnpm vitest run tests/acquisition/typescript-declaration-syntax.spec.ts`.

### Task 2 — Effective re-export evaluation without false API facts

**Files:**
- Modify: `src/acquisition/dsh-contract-filesystem.ts`
- Test: `tests/acquisition/dsh-contract-semantic-correctness.spec.ts`

**Internal model:** an effective export name carries one or more semantic origins. A base origin is stable per declaration evidence + source export name; named aliases propagate the child's origin rather than inventing a new authoritative source. Witness selection remains deterministic and minimal per origin.

- [ ] RED: `export { Missing } from './child.js'` where child exports only `Real` must not produce `Missing`.
- [ ] RED: `export { Real as Alias } from './child.js'` must produce `Alias` with child declaration evidence in its witness.
- [ ] RED: two `export *` edges that expose the same name from distinct origins must not produce that ambiguous name, while unrelated unique names still propagate.
- [ ] RED: explicit relative named resolution of a conflicting star name must restore that name from the selected child.
- [ ] RED: the same underlying origin reaching an entrypoint through two star paths must remain usable rather than being treated as ambiguous merely because two paths exist.
- [ ] Verify current `addMinimalWitness()` chooses one origin and current `record.exports` trusts relative named exports without child validation.
- [ ] GREEN: initialize only directly proven exports plus namespace/import-equals bindings; propagate relative named bindings only from child effective surfaces; propagate star origin sets; explicit syntactic exports shadow star candidates; package entrypoints emit a name only when that entrypoint resolves it to one semantic origin.
- [ ] Do not add full TypeScript semantic/type checking.
- [ ] Run focused semantic-correctness tests.

### Task 3 — Aggregate Contract Index acquisition budgets

**Files:**
- Modify: `src/acquisition/dsh-contract-filesystem.ts`
- Test: `tests/acquisition/dsh-contract-filesystem.spec.ts`
- Test: `tests/acquisition/dsh-contract-semantic-correctness.spec.ts`

**Interface:** extend `ContractAcquisitionBudgetV1` with:

```ts
readonly maxTotalDeclarationFiles: number
readonly maxTotalDeclarationBytes: number
readonly maxTotalNormalizedFacts: number
```

Production defaults remain fixed and generous enough for the real pinned DSH baseline, while deterministic tests inject tiny values.

- [ ] RED: exact total declaration-file count N succeeds; N-1 fails with `CONTRACT_DECLARATION_LIMIT_EXCEEDED` even though each package remains under its local file limit.
- [ ] RED: exact total declaration bytes N succeeds; N-1 fails across multiple packages while local package byte limits remain satisfied.
- [ ] RED: exact total normalized facts N succeeds; N-1 fails across the whole acquired index.
- [ ] RED: an over-budget parsed export list must fail structurally before the adapter materializes an oversized effective-surface map.
- [ ] GREEN: carry one operation-scoped acquisition counter through sequential package acquisition; enforce total files/bytes during declaration graph reads and total facts in `pushFact()`.
- [ ] GREEN: enforce `maxNormalizedFactsPerPackage` while constructing declaration surfaces/star propagation, not only when converting the completed map into facts.
- [ ] Keep wall-clock timeouts out of semantic acquisition.
- [ ] Run focused acquisition tests and aggregate `pnpm check`.

### Task 4 — Governance and authoritative final verification

**Files/metadata:**
- Modify: `docs/plans/2026-08-27-m2-1-second-corrective-review.md`
- Update: this plan, Issue #29, PR #30 body/state.

- [ ] Mark stale second-corrective Task 8 status/checks as historical completion; CI #337 becomes a superseded checkpoint once third-pass commits exist.
- [ ] Record the third-pass RED run and exact failing regressions before GREEN implementation.
- [ ] Run aggregate generated/protocol/architecture/package/CI-storage/lint/typecheck/script/test gate.
- [ ] Require Node 22.19.0 / 24.19.0 / 26 and Windows 2025 / macOS 15 green.
- [ ] Require build, exact `pnpm pack`, manifest inspection and installed consumer green.
- [ ] Require real DSH `0.1.1-rc.2` minimal/Web ToolRuntime and shipped-Web `ToolDefinition -> package:@deepseek-ai/dsh-tools -> inspect` green.
- [ ] Preserve multi-train target smoke against `0.1.1-rc.2` and `0.1.0-rc.8`.
- [ ] Re-check PR comments/reviews/threads and base/head state.
- [ ] Only then update Issue/PR to the exact final HEAD and mark PR Ready for review again.

## Review disposition

The external review is accepted on the concrete `.d.mts/.d.cts`, named/star effective-surface, aggregate-budget, triple-slash and governance findings. Its suggested package-wide failure for star ambiguity is intentionally narrowed: M2.1 omits only the ambiguous symbol because the index is a progressive evidence tool, not a TypeScript build validator. Its two aggregate counters are strengthened with `maxTotalDeclarationFiles`, because declaration evidence objects accumulate independently of byte/fact totals.
