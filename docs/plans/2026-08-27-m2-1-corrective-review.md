# M2.1 Corrective Merge Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers TDD/executing-plans task-by-task.

**Goal:** correct the identity, acquisition, parsing, progressive-retrieval, provenance, and frontend-validation gaps found in the independent review of PR #30 before M2.1 is eligible for merge.

**Architecture:** keep the existing `TargetSnapshot -> Contract Index -> search/inspect -> shared kernel -> CLI/DSH/MCP` architecture. Tighten invariants rather than introducing a new framework: semantic state becomes deeply immutable; filesystem acquisition gets deterministic structural budgets; TypeScript declaration syntax is parsed through one narrow internal syntax seam; search returns minimal evidence witnesses; request validity is shared across frontends. M2.2 Agent-scoped live Inspect remains out of this PR and will use a per-call DSH-owned live-evidence adapter rather than leaking Agent/Cordis types into the kernel.

**Tech stack:** TypeScript 6 syntax API, Node filesystem promises, Protocol v1 JSON Schema, Vitest, MCP v2, Cordis/DSH ToolRuntime.

**Spec:** `spec/protocol.md`, ADR-0008, Issue #29 and parent #28.

## Global constraints

- `TargetFingerprint` and `ContractIndexFingerprint` remain separate namespaces.
- No target/plugin JavaScript execution during M2.1 acquisition.
- Semantic core remains runtime-neutral and imports no Node or DSH runtime packages.
- Filesystem acquisition remains read-only and fail-closed.
- No embeddings, persistent index cache, daemon, Web UI, M3/M4 work, dummy Agent, or generic evidence-provider framework.
- Candidate package paths must remain lexically and canonically contained under their exact package root.
- Search must be progressive: compact navigation first, full supporting evidence only at inspect.
- All contract facts must be evidence-backed.
- Exact packed artifact + real DSH ToolRuntime smoke remains authoritative.

---

### Task 1 — Deep immutable semantic identity and evidence invariants

**Files:**
- Modify: `src/model/contract.ts`
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Regenerate: `src/protocol/generated.ts`
- Test: `tests/model/contract.spec.ts`
- Test: `tests/protocol/protocol.spec.ts`

**Interfaces:**
- `createContractIndex(...)` continues to return `ContractIndex`.
- Every hashed semantic array/object returned by the index is immutable at runtime.
- `ContractFact.evidenceIds` contains at least one existing evidence id.

- [ ] RED: add mutation tests for `index.contracts`, `contract.facts`, contract/fact `evidenceIds`; add model test rejecting an empty fact evidence list; add Protocol test rejecting `contractFact.evidenceIds: []`.
- [ ] Verify RED fails only because nested arrays are mutable / empty fact evidence is accepted.
- [ ] GREEN: freeze nested arrays explicitly in `freezeFact()`/`freezeContract()` and reject zero-evidence facts in `validateReferences()`.
- [ ] GREEN: add `minItems: 1` to `contractFact.evidenceIds`; regenerate Protocol types.
- [ ] Run focused model/protocol tests and aggregate CI gate.

### Task 2 — Deterministic bounded declaration acquisition

**Files:**
- Modify: `src/model/contract.ts` for the new expected error code only.
- Modify: `src/acquisition/dsh-contract-filesystem.ts`
- Test: `tests/acquisition/dsh-contract-filesystem.spec.ts`

**Interfaces:**

```ts
export interface ContractAcquisitionBudgetV1 {
  readonly maxDeclarationFilesPerPackage: number
  readonly maxDeclarationBytesPerFile: number
  readonly maxDeclarationBytesPerPackage: number
  readonly maxDeclarationReferenceEdgesPerPackage: number
  readonly maxDeclarationDepth: number
}
```

`createDshContractFilesystemAcquisition({ digest?, budget? })` accepts an optional budget. Production defaults are fixed constants; tests inject tiny limits.

Expected breach: `CONTRACT_DECLARATION_LIMIT_EXCEEDED` in diagnostic domain `contract`.

- [ ] RED: files N+1, bytes/file N+1, bytes/package N+1, reference edges N+1 and depth N+1 each fail with the new expected error while N succeeds.
- [ ] RED: add explicit symlink-to-outside declaration fixture.
- [ ] Verify RED isolates missing budget behavior.
- [ ] GREEN: carry `{ location, depth }` in BFS queue; account unique files and edges deterministically; check file size before reading; enforce cumulative bytes before parsing.
- [ ] Do not introduce wall-clock timeout into semantic acquisition.
- [ ] Run focused acquisition tests and aggregate gate.

### Task 3 — Replace regex declaration interpretation with syntax parsing

**Files:**
- Create: `src/acquisition/typescript-declaration-syntax.ts`
- Modify: `src/acquisition/dsh-contract-filesystem.ts`
- Modify: `package.json` / `pnpm-lock.yaml` only if runtime dependency placement changes.
- Test: `tests/acquisition/typescript-declaration-syntax.spec.ts`
- Test: `tests/acquisition/dsh-contract-filesystem.spec.ts`

**Interfaces:**

```ts
export interface ParsedDeclarationSyntax {
  readonly exports: readonly string[]
  readonly relativeReexports: readonly string[]
  readonly relativePathReferences: readonly string[]
}

export interface DeclarationSyntaxPort {
  parse(fileName: string, content: string): ParsedDeclarationSyntax
}
```

The filesystem adapter consumes this port; TypeScript compiler/program/type-checker/module-loader APIs are not used. The parser is syntax-only.

- [ ] RED parser corpus: line/block comments and string literals create neither exports nor graph edges; private imports do not expose symbols; `export interface/type/class/function/default`, named/type-only re-export, `export *`, namespace/module and triple-slash relative path cases are represented deterministically.
- [ ] RED acquisition proves a commented-out missing re-export no longer yields `CONTRACT_EVIDENCE_READ_FAILED`.
- [ ] Verify RED fails on the current regex parser.
- [ ] GREEN: parse `.d.ts/.d.mts/.d.cts` through pinned TS6 syntax API behind `DeclarationSyntaxPort`.
- [ ] Follow only public relative re-export edges plus supported relative path references; ordinary imports are not traversal roots merely because they exist.
- [ ] Replace `declaration-symbol` with the semantically narrower `declaration-export` fact for syntax-proven public exports.
- [ ] Keep availability `unknown`; syntax does not imply live Service/Event/Tool capability.
- [ ] Run parser/acquisition tests, package-policy check and exact pack smoke after dependency changes.

### Task 4 — Truly progressive search provenance

**Files:**
- Modify: `src/model/contract.ts`
- Test: `tests/model/contract.spec.ts`
- Test: `tests/kernel/contract-intelligence.spec.ts`

**Interfaces:**

Internal lexical matching returns both rank and a minimal deterministic witness:

```ts
interface ContractMatch {
  readonly score: number
  readonly evidenceIds: readonly string[]
}
```

- [ ] RED: one package with many declaration evidence records, query matching one declaration export, and `limit: 1` returns one match plus only the evidence necessary to explain that match rather than the whole package graph.
- [ ] RED: package-name matches return manifest provenance; fact matches return the fact's evidence.
- [ ] Verify RED fails because `reference()` currently copies `contract.evidenceIds`.
- [ ] GREEN: lexical scoring chooses the deterministic minimal witness for the winning tier; `ContractReference.evidenceIds` carries only that witness.
- [ ] Inspect continues to return the selected contract's complete supporting evidence subset.
- [ ] Run focused model/kernel tests and aggregate gate.

### Task 5 — Shared request validity and invalid-input parity

**Files:**
- Create: `src/protocol/runtime-validation.ts`
- Modify: `src/frontends/cli/index.ts`
- Modify: `src/integrations/dsh/target-tool.ts`
- Modify: `src/integrations/dsh/contract-tool.ts`
- Modify: `src/frontends/mcp/index.ts` only if required to assert semantic validity after MCP schema validation.
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Regenerate: `src/protocol/generated.ts`
- Test: `tests/frontends/contract-parity.spec.ts`
- Test: CLI/DSH/MCP focused tests.

**Interfaces:**

```ts
parseTargetResolveRequest(value: unknown): TargetResolveRequest
parseContractSearchRequest(value: unknown): ContractSearchRequest
parseContractInspectRequest(value: unknown): ContractInspectRequest
```

All throw `TypeError` on invalid transport input. Frontends may have different error text/framing, but all must agree on accept/reject.

- [ ] RED invalid parity matrix: duplicate/unknown kind, whitespace-only query, limit 0/26/non-integer, bad index prefix/hash/case, unknown property, invalid target, empty contract id.
- [ ] RED Protocol schema rejects whitespace-only query and continues to reject malformed fingerprints/unknown properties.
- [ ] Verify RED exposes current CLI/DSH/MCP drift.
- [ ] GREEN: move closed-world request validation into shared runtime-neutral parsers and delegate CLI/DSH parsing to them.
- [ ] GREEN: schema requires at least one non-whitespace query character.
- [ ] Preserve CLI flag syntax as transport-only lowering; it must not define different Protocol semantics.
- [ ] Run parity matrix plus aggregate gate.

### Task 6 — M2.2 seam documentation only

**Files:**
- Modify: parent Issue #28 and/or `docs/plans/2026-08-27-m2-1-contract-index.md` design notes.

**Decision:** do not add an unused `ContractOperationContext` or Agent type to M2.1. M2.2 will adapt a real DSH `ToolExecution` into a per-call live-evidence port capturing `exec.agent` and `exec.signal`; kernel/model remain DSH-neutral and own merge/fingerprint semantics.

- [ ] Record this decision without introducing production abstractions in PR #30.

### Task 7 — Full regression and exact-artifact boundary

**Files:** existing CI/smoke/tests only unless a defect is found.

- [ ] Run/verify generated Protocol, Protocol conformance, architecture, package, CI-storage, lint, product/test/script typechecks and all tests.
- [ ] Require Node 22/24/26 and Windows/macOS lanes green.
- [ ] Require build, exact `npm pack`, manifest inspection and installed-consumer smoke green.
- [ ] Require exact packed Toolchain on real DSH `0.1.1-rc.2` to expose/execute target + contract search/inspect through host-owned ToolRuntime.
- [ ] Preserve multi-train target smoke against `0.1.1-rc.2` and `0.1.0-rc.8`.

### Task 8 — Governance cleanup / merge gate

**Files:**
- Modify: `docs/plans/2026-08-27-m2-1-contract-index.md`
- Modify: README/roadmap/development only if implementation facts changed.
- Update: PR #30 body and Issue #29 acceptance status.

- [ ] Mark completed implementation-plan tasks accurately.
- [ ] Update PR body from RED/TDD placeholder to exact final-head evidence.
- [ ] Keep Issue #29 open until merge and parent #28 open for M2.2/M2.3.
- [ ] Check PR comments, reviews and unresolved threads.
- [ ] Mark PR ready only after final exact-head CI is fully green.
- [ ] Do not merge until a final review has no blocker.