# M2.1 Corrective Merge Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use Superpowers TDD/executing-plans task-by-task.

**Status:** implementation complete at the functional GREEN checkpoint; one governance-only exact-head CI remains before Ready for review.

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

- [x] RED: add mutation tests for `index.contracts`, `contract.facts`, contract/fact `evidenceIds`; add model test rejecting an empty fact evidence list; add Protocol test rejecting `contractFact.evidenceIds: []`.
- [x] Verify RED fails only because nested arrays are mutable / empty fact evidence is accepted.
- [x] GREEN: freeze nested arrays explicitly in `freezeFact()`/`freezeContract()` and reject zero-evidence facts in `validateReferences()`.
- [x] GREEN: add `minItems: 1` to `contractFact.evidenceIds`; regenerate Protocol types.
- [x] Run focused model/protocol tests and aggregate CI gate.

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

- [x] RED: files N+1, bytes/file N+1, bytes/package N+1, reference edges N+1 and depth N+1 each fail with the new expected error while N succeeds.
- [x] RED: add explicit symlink-to-outside declaration fixture.
- [x] Verify RED isolates missing budget behavior.
- [x] GREEN: carry `{ location, depth }` in BFS queue; account unique files and edges deterministically; check file size before reading; enforce cumulative bytes before parsing.
- [x] Do not introduce wall-clock timeout into semantic acquisition.
- [x] Run focused acquisition tests and aggregate gate.

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
  readonly relativeReexports: readonly DeclarationReexportEdge[]
  readonly relativePathReferences: readonly string[]
}

export interface DeclarationSyntaxPort {
  parse(fileName: string, content: string): ParsedDeclarationSyntax
}
```

The filesystem adapter consumes this port; TypeScript is used only for syntax parsing/syntactic diagnostics. Target-package JavaScript is never loaded or executed.

- [x] RED parser corpus: line/block comments and string literals create neither exports nor graph edges; private imports do not expose symbols; `export interface/type/class/function/default`, named/type-only re-export, `export *`, namespace/module and triple-slash relative path cases are represented deterministically.
- [x] RED acquisition proves a commented-out missing re-export no longer yields `CONTRACT_EVIDENCE_READ_FAILED`.
- [x] Verify RED fails on the previous regex parser.
- [x] GREEN: parse `.d.ts/.d.mts/.d.cts` through pinned TS6 syntax API behind `DeclarationSyntaxPort` and reject parser-recovery ASTs with public syntactic diagnostics.
- [x] Follow only public relative re-export edges plus supported relative path references; ordinary imports are not traversal roots merely because they exist.
- [x] Replace `declaration-symbol` with the semantically narrower `declaration-export` fact for syntax-proven public exports.
- [x] Keep availability `unknown`; syntax does not imply live Service/Event/Tool capability.
- [x] Run parser/acquisition tests, package-policy check and exact pack smoke after dependency changes.

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

- [x] RED: one package with many declaration evidence records, query matching one declaration export, and `limit: 1` returns one match plus only the evidence necessary to explain that match rather than the whole package graph.
- [x] RED: package-name matches return manifest provenance; fact matches return the fact's evidence.
- [x] Verify RED fails because `reference()` previously copied `contract.evidenceIds`.
- [x] GREEN: lexical scoring chooses the deterministic minimal witness for the winning tier; `ContractReference.evidenceIds` carries only that witness.
- [x] Inspect continues to return the selected contract's complete supporting evidence subset.
- [x] Run focused model/kernel tests and aggregate gate.

### Task 5 — Shared request validity and invalid-input parity

**Files:**
- Modify: shared Protocol request validation module.
- Modify: `src/frontends/cli/index.ts`
- Modify: `src/integrations/dsh/target-tool.ts`
- Modify: `src/integrations/dsh/contract-tool.ts`
- Modify: `src/frontends/mcp/index.ts` only where needed to assert semantic validity after MCP schema validation.
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Regenerate: `src/protocol/generated.ts`
- Test: `tests/frontends/contract-parity.spec.ts`
- Test: CLI/DSH/MCP focused tests.

**Interfaces:**

Shared runtime-neutral parsers validate target/search/inspect transport values before kernel delegation. All throw `TypeError` on invalid transport input. Frontends may have different error text/framing, but all agree on accept/reject.

- [x] RED invalid parity matrix: duplicate/unknown kind, whitespace-only query, limit 0/26/non-integer, bad index prefix/hash/case, unknown property, invalid target, empty contract id.
- [x] RED Protocol schema rejects whitespace-only query and continues to reject malformed fingerprints/unknown properties.
- [x] Verify RED exposes previous CLI/DSH/MCP drift.
- [x] GREEN: closed-world request validation is shared; CLI/DSH parsing delegates to it rather than defining separate semantics.
- [x] GREEN: schema requires at least one non-whitespace query character.
- [x] Preserve CLI flag syntax as transport-only lowering; it does not define different Protocol semantics.
- [x] Run parity matrix plus aggregate gate.

### Task 6 — M2.2 seam documentation only

**Files:**
- Parent Issue #28 / M2.1 design notes / M2.2 tracking Issue #31.

**Decision:** do not add an unused `ContractOperationContext` or Agent type to M2.1. M2.2 adapts a real DSH `ToolExecution` into a per-call live-evidence port capturing `exec.agent` and `exec.signal`; kernel/model remain DSH-neutral and own merge/fingerprint semantics.

- [x] Record this decision without introducing production abstractions in PR #30.

### Task 7 — Full regression and exact-artifact boundary

**Files:** existing CI/smoke/tests only unless a defect is found.

- [x] Run/verify generated Protocol, Protocol conformance, architecture, package, CI-storage, lint, product/test/script typechecks and all tests.
- [x] Require Node 22/24/26 and Windows/macOS lanes green.
- [x] Require build, exact `pnpm pack`, manifest inspection and installed-consumer smoke green.
- [x] Require exact packed Toolchain on real DSH `0.1.1-rc.2` to expose/execute target + contract search/inspect through host-owned ToolRuntime.
- [x] Preserve multi-train target smoke against `0.1.1-rc.2` and `0.1.0-rc.8`.
- [x] Functional checkpoint CI #334 on `d74638d6bc3640ab9edfc91f739fb022a6708242` passes all of the above, including the shipped-`web` `ToolDefinition -> @deepseek-ai/dsh-tools -> inspect` proof.

### Task 8 — Governance cleanup / merge gate

**Files:**
- Modify: `docs/plans/2026-08-27-m2-1-contract-index.md`
- Modify: README/roadmap/development only if implementation facts changed.
- Update: PR #30 body and Issue #29 acceptance status.

- [x] Mark completed implementation-plan tasks accurately.
- [ ] Update PR body from corrective placeholder to exact final-head evidence after governance CI.
- [x] Keep Issue #29 open until merge and parent #28 open for M2.2/M2.3.
- [x] Check PR comments, reviews and unresolved threads at the functional GREEN checkpoint; none are present.
- [ ] Mark PR ready only after final governance exact-head CI is fully green.
- [ ] Do not merge until a final review has no blocker.
