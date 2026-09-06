# Contract Inspect Lossless Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce redundant model-facing `contract.inspect` bytes through deterministic lossless evidence interning while preserving the canonical Protocol v1 response and every Contract Intelligence semantic invariant.

**Architecture:** `ApplicationKernel` continues to produce the existing canonical `ContractInspectResponse`. A pure runtime-neutral model projection converts only successful Inspect responses into `dsh-contract-inspect-compact-v1` for model-facing text; native DSH and MCP use that projection, while MCP `structuredContent` and CLI remain canonical Protocol v1. Evaluation independently expands compact responses back to canonical values and measures exhaustive before/after bytes over all 184 frozen Inspect contracts.

**Tech Stack:** TypeScript 6.0.3, Vitest 4.1.8, Node `^22.19.0 || >=24.0.0`, pnpm 11.7.0, existing Toolchain Protocol v1/kernel/DSH/MCP abstractions and M2 frozen fixture.

**Spec:** `docs/superpowers/specs/2026-09-06-contract-inspect-lossless-compaction-design.md`

## Global Constraints

- Protocol v1 schemas and generated types remain unchanged.
- `dsh-target-v2` and `dsh-contract-index-v1` semantic projections/fingerprints remain unchanged.
- Search ranking, scores, evidence selection, strict/intent/no-result behavior and conservative abstention remain unchanged.
- No hidden truncation, lossy summary, evidence removal, resource links, pagination, Protocol v2, embeddings or provider-backed evaluation.
- Failed/stale Inspect responses remain canonical and unchanged.
- Successful compact projection MUST preserve all canonical evidence records and canonical evidence ids; local refs only replace repeated references.
- MCP `structuredContent` and CLI machine JSON remain canonical Protocol v1 in this slice.
- Native DSH and MCP model-facing Inspect text MUST use the same compact semantic projection.
- Production semantic code remains runtime-neutral and introduces no new dependency.
- TDD is mandatory: every production behavior begins with an observed failing test.

---

## File Structure

**Create**
- `src/model/contract-inspect-compact.ts` — pure lossless compact projection and compact representation types.
- `tests/model/contract-inspect-compact.spec.ts` — synthetic RED/GREEN contract, deterministic refs, fail-loud invariants.
- `tests/evaluation/m2-inspect-compaction.spec.ts` — exhaustive 184-contract independent round-trip and byte comparison.
- `tests/evaluation/m2-inspect-duplication-attribution.spec.ts` — exact path-attribution semantics.
- `tests/evaluation/m2-inspect-compaction.ts` — provider-free exhaustive receipt builder.
- `docs/evaluation/m2/contract-inspect-compaction-v1.json` — frozen machine receipt after GREEN execution.
- `docs/evaluation/m2/contract-inspect-compaction-2026-09-06.md` — human receipt and interpretation.

**Modify**
- `src/model/contract.ts` — re-export compact projection from the existing Contract Intelligence model surface; no Search/Inspect semantic changes.
- `src/integrations/dsh/contract-tool.ts` — compact only native DSH Inspect text rendering.
- `src/frontends/mcp/index.ts` — compact only Inspect `content[].text`; keep canonical Protocol v1 `structuredContent` and output schema.
- `tests/dsh/contract-tool.spec.ts` — RED frontend rendering contract.
- `tests/mcp/contract-intelligence.spec.ts` — RED MCP dual-representation contract.
- `tests/evaluation/m2-compactness-metrics.ts` — add deterministic repeated-string occurrence/path attribution helper.
- `docs/evaluation/m2/status.md` — record #186 outcome only after exact-head verification.
- `skills/dsh-toolchain/SKILL.md` only if final compact text changes any model-facing usage instruction; otherwise leave untouched.

---

### Task 1: Establish RED compact-projection semantics

**Files:**
- Create: `tests/model/contract-inspect-compact.spec.ts`
- Create: `tests/evaluation/m2-inspect-compaction.spec.ts`
- Modify: none under `src/`

**Interfaces:**
- Consumes: current `ContractInspectResponse`, frozen M2 kernel harness and exhaustive Contract Index fixture.
- Produces test expectation for future `compactContractInspectModelResponse(response)` exported through `src/model/contract.ts`.

- [ ] **Step 1: Add a synthetic runtime-reflection RED test without importing a nonexistent module**

Use the existing `src/model/contract.ts` module namespace so TypeScript compiles before the future export exists:

```ts
import * as contractModel from '../../src/model/contract.js'
import type { ContractInspectResponse } from '../../src/protocol/index.js'

const compact = (contractModel as unknown as {
  compactContractInspectModelResponse?: (response: ContractInspectResponse) => unknown
}).compactContractInspectModelResponse

expect(compact).toBeTypeOf('function')
```

Then specify one canonical success response where the same long evidence id is referenced at contract level and by two facts. The desired compact result MUST contain:

```ts
{
  representation: 'dsh-contract-inspect-compact-v1',
  protocolVersion: '1',
  requestId: 'compact-test',
  snapshotFingerprint,
  status: 'ok',
  data: {
    contractIndexFingerprint,
    contract: {
      ...canonicalIdentity,
      evidenceRefs: ['e0'],
      facts: [
        { key: 'declaration-export', value: 'ToolDefinition', evidenceRefs: ['e0'] },
        { key: 'declaration-export', value: 'ToolSchema', evidenceRefs: ['e0'] },
      ],
    },
    evidenceByRef: {
      e0: canonicalEvidence,
    },
  },
  diagnostics: [],
}
```

The test MUST assert that the long canonical evidence id appears once in `JSON.stringify(compactValue)`, while the canonical input contains it four times (contract reference + two fact references + evidence record id).

- [ ] **Step 2: Specify deterministic multi-evidence ordering**

Canonical `data.evidence` order `[evidenceB, evidenceA]` MUST map to local refs `{ e0: evidenceB, e1: evidenceA }` regardless of lexical ordering of ids. Contract/fact refs MUST resolve through that canonical order.

- [ ] **Step 3: Specify fail-loud provenance invariants**

Add cases requiring the future projection to throw when:

```text
contract/fact references evidence id absent from data.evidence
canonical data.evidence contains duplicate ids
```

Do not accept best-effort compact output for an internally inconsistent successful canonical response.

- [ ] **Step 4: Specify non-success identity behavior**

For `failed` and `stale` `ContractInspectResponse`, require the compact-model function to return the exact canonical semantic value unchanged; no `representation` field is added.

- [ ] **Step 5: Add exhaustive test-only independent expander**

In `tests/evaluation/m2-inspect-compaction.spec.ts`, implement test-only expansion from compact refs back to canonical evidence ids. It MUST NOT import a production decoder.

For each compact fact:

```ts
const evidenceIds = fact.evidenceRefs.map(ref => {
  const item = response.data.evidenceByRef[ref]
  if (item === undefined) throw new Error(`Unresolved compact evidence ref ${ref}`)
  return item.id
})
```

Rebuild canonical `ContractDefinition`, canonical ordered `evidence` from `Object.values(evidenceByRef)`, and the original success envelope.

- [ ] **Step 6: Require exhaustive 184/184 semantic equality**

Build the frozen rc2 Web `ContractIndex`, inspect every contract via `inspectContractResponse`, call the future compact function, independently expand it, and assert:

```ts
expect(expanded).toEqual(canonical)
```

Also assert exactly 184 successful cases and that every local evidence ref resolves.

- [ ] **Step 7: Run RED in CI**

Because this chat environment does not own a local checked-out worktree, use the isolated GitHub branch and Draft PR CI as the executable environment. Expected result: focused/new tests fail because `compactContractInspectModelResponse` is absent, while existing product tests remain unchanged.

- [ ] **Step 8: Commit RED only**

Commit message:

```text
test(contract): define lossless Inspect compaction
```

No `src/` production file may change in this commit.

---

### Task 2: Implement the minimal lossless compact projection

**Files:**
- Create: `src/model/contract-inspect-compact.ts`
- Modify: `src/model/contract.ts`
- Test: `tests/model/contract-inspect-compact.spec.ts`
- Test: `tests/evaluation/m2-inspect-compaction.spec.ts`

**Interfaces:**
- Consumes: `ContractInspectResponse`, `ContractInspectSuccessResponse`, `Evidence`, `ContractKind`, `ContractAvailability`, `Diagnostic` from Protocol v1.
- Produces: `compactContractInspectModelResponse(response)` plus compact representation types.

- [ ] **Step 1: Define compact types in the focused model file**

Use explicit readonly types:

```ts
export const CONTRACT_INSPECT_COMPACT_REPRESENTATION = 'dsh-contract-inspect-compact-v1' as const
export type CompactEvidenceRef = `e${number}`

export interface CompactContractFact {
  readonly key: string
  readonly value: string
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}

export interface CompactContractDefinition {
  readonly id: string
  readonly kind: ContractKind
  readonly name: string
  readonly qualifiedName: string
  readonly availability: ContractAvailability
  readonly summary?: string
  readonly facts: readonly CompactContractFact[]
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}
```

Define success response with `representation`, canonical envelope fields, `contractIndexFingerprint`, compact contract and `evidenceByRef`.

- [ ] **Step 2: Build the canonical evidence-id -> local-ref map**

Iterate `response.data.evidence` exactly once in existing order:

```ts
const ref = `e${index}` as CompactEvidenceRef
```

Reject duplicate canonical ids before adding them to the map. Freeze copied Evidence records and the dictionary.

- [ ] **Step 3: Convert evidence-id arrays through one helper**

`compactEvidenceRefs(ids, refs)` maps every canonical id to the existing local ref. Unknown ids throw an invariant error naming the missing canonical id.

Preserve original canonical array order; do not sort.

- [ ] **Step 4: Project the contract without changing any descriptive field**

Copy identity/availability/optional summary exactly. Map facts in existing order, copying `key`/`value` and replacing only `evidenceIds` with `evidenceRefs`.

- [ ] **Step 5: Preserve non-success responses**

`compactContractInspectModelResponse` returns `failed`/`stale` input unchanged. Only `status: 'ok'` is converted.

- [ ] **Step 6: Re-export through `src/model/contract.ts`**

Add only:

```ts
export {
  CONTRACT_INSPECT_COMPACT_REPRESENTATION,
  compactContractInspectModelResponse,
} from './contract-inspect-compact.js'
export type { ... } from './contract-inspect-compact.js'
```

Do not touch Search ranker logic, `inspectContractIndex`, Contract Index projection or fingerprints.

- [ ] **Step 7: Run focused GREEN**

Run in CI/focused test environment:

```text
vitest run tests/model/contract-inspect-compact.spec.ts tests/evaluation/m2-inspect-compaction.spec.ts
```

Expected: synthetic semantics and 184/184 independent round-trip parity pass.

- [ ] **Step 8: Commit GREEN**

Commit message:

```text
perf(contract): intern Inspect evidence references
```

---

### Task 3: Establish RED model-facing frontend parity

**Files:**
- Modify: `tests/dsh/contract-tool.spec.ts`
- Modify: `tests/mcp/contract-intelligence.spec.ts`
- Production files unchanged in RED commit.

**Interfaces:**
- Consumes: canonical resolver output and `compactContractInspectModelResponse` semantics from Task 2.
- Produces: required DSH/MCP rendering behavior.

- [ ] **Step 1: Strengthen native DSH fixture so compaction is observable**

Change test-only `inspectResponse()` to include one evidence record referenced at contract and fact level. Do not alter production fixtures.

- [ ] **Step 2: Change native DSH rendering expectation**

Keep Search assertion canonical. For Inspect require parsed text to have:

```ts
expect(rendered).toMatchObject({
  representation: 'dsh-contract-inspect-compact-v1',
  status: 'ok',
  data: {
    contract: { evidenceRefs: ['e0'] },
    evidenceByRef: { e0: expect.objectContaining({ id: 'manifest:tools' }) },
  },
})
expect(rendered).not.toHaveProperty('data.contract.evidenceIds')
```

Also assert `inspect.execute(...)` still returns the canonical Protocol response object.

- [ ] **Step 3: Change MCP fixture so compaction is observable**

Ensure `mockKernel().inspectContract` returns a self-consistent evidence record for `manifest:tools`.

- [ ] **Step 4: Require dual representation in MCP**

For `contract.inspect`:

```ts
expect(result.structuredContent).toEqual(canonicalProtocolResponse)
expect(JSON.parse(result.content[0].text)).toEqual(
  compactContractInspectModelResponse(canonicalProtocolResponse),
)
```

For `contract.search`, retain exact `content text == structuredContent` behavior.

- [ ] **Step 5: Require stale/failed MCP text to remain canonical**

The existing stale test MUST also assert parsed text equals `structuredContent`, because non-success responses bypass compact projection.

- [ ] **Step 6: Run RED**

Expected: only new model-facing text expectations fail because frontends still JSON-stringify canonical Inspect responses.

- [ ] **Step 7: Commit RED only**

Commit message:

```text
test(contract): require compact Inspect model rendering
```

---

### Task 4: Wire compact projection into native DSH and MCP text only

**Files:**
- Modify: `src/integrations/dsh/contract-tool.ts`
- Modify: `src/frontends/mcp/index.ts`
- Test: `tests/dsh/contract-tool.spec.ts`
- Test: `tests/mcp/contract-intelligence.spec.ts`

**Interfaces:**
- Consumes: shared pure `compactContractInspectModelResponse`.
- Produces: compact model text with canonical execution/structured results.

- [ ] **Step 1: Add Inspect-specific native DSH renderer**

Keep generic `output()` for Search. Add:

```ts
function inspectOutput(description: string): DshToolDefinition['output'] {
  return {
    schema: { type: 'object', description },
    render(_args, value) {
      return [{
        type: 'text',
        text: JSON.stringify(compactContractInspectModelResponse(value as ContractInspectResponse)),
      }]
    },
  }
}
```

Use it only for `createContractInspectToolDefinition`.

- [ ] **Step 2: Add MCP Inspect-specific structured result helper**

Do not change the generic `structuredResult` used by target/search/plugin. Add:

```ts
function contractInspectStructuredResult(
  response: ContractInspectResponse,
): McpStructuredResult<ContractInspectResponse> {
  return {
    content: [{ type: 'text', text: JSON.stringify(compactContractInspectModelResponse(response)) }],
    structuredContent: response,
  }
}
```

Use it only in `createContractInspectMcpTool`.

- [ ] **Step 3: Preserve MCP output schema**

Do not modify `protocolDefinitionSchema('contractInspectResponse')`; `structuredContent` remains Protocol v1 and must continue validating against the existing schema.

- [ ] **Step 4: Run focused GREEN**

```text
vitest run tests/dsh/contract-tool.spec.ts tests/mcp/contract-intelligence.spec.ts tests/model/contract-inspect-compact.spec.ts
```

Expected: DSH/MCP compact text and canonical machine result tests pass.

- [ ] **Step 5: Commit**

```text
perf(contract): compact model-facing Inspect text
```

---

### Task 5: Attribute the exact duplication targeted by compaction

**Files:**
- Modify: `tests/evaluation/m2-compactness-metrics.ts`
- Create: `tests/evaluation/m2-inspect-duplication-attribution.spec.ts`

**Interfaces:**
- Consumes: JSON-serializable canonical response.
- Produces: deterministic `RepeatedStringAttribution` categorized by occurrence path.

- [ ] **Step 1: Write synthetic RED attribution test**

Construct a canonical success where one evidence id appears in `contract.evidenceIds`, two fact `evidenceIds`, and one `data.evidence[].id`. Require the canonical evidence-record id to be retained and the three duplicate serialized-string byte occurrences to be attributed to `evidence-reference`.

Include repeated `source`, `contentHash`, fact keys/values and envelope identities so each category has explicit coverage.

- [ ] **Step 2: Define occurrence-path classifier**

Add an evaluation-only traversal producing `{ value, path, category, serializedBytes }` for strings. Categories are exactly:

```ts
export type RepeatedStringAttributionClass =
  | 'evidence-reference'
  | 'evidence-record-id'
  | 'evidence-source'
  | 'evidence-content-hash'
  | 'evidence-location'
  | 'fact-key'
  | 'fact-value'
  | 'contract-identity'
  | 'envelope-identity'
  | 'other'
```

- [ ] **Step 3: Define deterministic retained-occurrence priority**

For duplicate evidence ids, prefer `evidence-record-id`; otherwise retain the first occurrence by traversal order. Attribute every additional exact occurrence to its own path category.

- [ ] **Step 4: Return totals and per-class bytes**

The helper MUST expose total exact repeated string bytes and per-class exact bytes. Sum of per-class duplicate bytes MUST equal total duplicate bytes.

- [ ] **Step 5: Run RED then GREEN**

First observe the new spec fail because attribution is absent. Then implement only the evaluation helper and re-run the focused metric specs.

- [ ] **Step 6: Commit**

```text
test(eval): attribute Inspect duplicate strings
```

---

### Task 6: Build exhaustive before/after compactness receipt

**Files:**
- Create: `tests/evaluation/m2-inspect-compaction.ts`
- Extend: `tests/evaluation/m2-inspect-compaction.spec.ts`
- Create after measured run: `docs/evaluation/m2/contract-inspect-compaction-v1.json`
- Create after measured run: `docs/evaluation/m2/contract-inspect-compaction-2026-09-06.md`

**Interfaces:**
- Consumes: frozen rc2 Web fixture, canonical Inspect response, compact model projection, `measureWireResponse`, repeated-string attribution.
- Produces: deterministic provider-free receipt.

- [ ] **Step 1: Define receipt schema in test code**

Use:

```ts
schema: 'dsh-contract-inspect-compaction-receipt-v1'
identity: {
  baseCommit: '6584765f9f7b1f5a941d9cc14ad263d82c24cb0e'
  fixtureVersion: 'rc2-web-v1'
  targetFingerprint: ...
  contractIndexFingerprint: ...
  representation: 'dsh-contract-inspect-compact-v1'
}
population: { inspectContracts: 184 }
canonical: { wireBytes: DistributionSummary }
compact: { wireBytes: DistributionSummary }
reduction: {
  bytes: DistributionSummary
  rate: DistributionSummary
  improvedCases: number
  unchangedCases: number
  regressedCases: number
}
attribution: { repeatedBytesByClass: Record<..., DistributionSummary> }
worstCases: { ... }
```

- [ ] **Step 2: Compute each case from exact `JSON.stringify` text**

For every successful Inspect response:

```ts
canonicalBytes = measureWireResponse(canonical).wireBytes
compactBytes = measureWireResponse(compact).wireBytes
reductionBytes = canonicalBytes - compactBytes
reductionRate = reductionBytes / canonicalBytes
```

Do not estimate tokens.

- [ ] **Step 3: Add invariant gates**

Require:

```text
inspectContracts == 184
regressedCases == 0
compact p50 < canonical p50
compact p95 < canonical p95
compact max < canonical max
```

Also require any case with at least one duplicated canonical evidence reference to be strictly smaller after compaction.

- [ ] **Step 4: Emit a deterministic one-line receipt during the first GREEN CI run**

Until the committed receipt exists, print exactly one stable JSON line prefixed `INSPECT_COMPACTION_RECEIPT=` from the focused evaluation test. Fetch exact CI job logs, copy that machine value into the committed receipt, then remove the temporary diagnostic print in the same branch.

This avoids hand-estimating metrics or introducing a one-off workflow/artifact dependency.

- [ ] **Step 5: Commit machine and human receipts**

The Markdown receipt records exact p50/p95/max before/after, reduction distribution, attribution conclusion, worst case, identities and the explicit boundary: exact bytes are not provider-billed tokens.

- [ ] **Step 6: Add a receipt equality test**

Load `docs/evaluation/m2/contract-inspect-compaction-v1.json` and require it to equal `buildInspectCompactionReceiptV1()` exactly. This freezes the receipt against implementation/fixture drift.

- [ ] **Step 7: Commit**

```text
test(eval): freeze Inspect compaction receipt
```

---

### Task 7: Regression, architecture and exact-head qualification

**Files:**
- Modify only if required by verified state: `docs/evaluation/m2/status.md`
- No unrelated code changes.

**Interfaces:**
- Consumes: complete branch implementation.
- Produces: reviewable PR evidence and status update.

- [ ] **Step 1: Run focused semantic suites**

```text
pnpm vitest run tests/model/contract-inspect-compact.spec.ts tests/evaluation/m2-inspect-compaction.spec.ts tests/evaluation/m2-inspect-duplication-attribution.spec.ts tests/dsh/contract-tool.spec.ts tests/mcp/contract-intelligence.spec.ts
```

Expected: all pass, 184/184 round-trip.

- [ ] **Step 2: Run repository contract/architecture checks**

```text
pnpm run check:generated
pnpm run check:protocol
pnpm run check:architecture
pnpm run lint
pnpm run typecheck
```

Expected: Protocol generated tree unchanged/fresh; architecture remains closed-world and runtime-neutral.

- [ ] **Step 3: Run full repository check**

```text
pnpm run check
```

Expected: all unit/evaluation/protocol/policy suites pass.

- [ ] **Step 4: Build/package**

```text
pnpm run build
pnpm pack
```

Exact packed/install and DSH composition checks are executed by the repository CI matrix.

- [ ] **Step 5: Review diff boundaries**

Confirm no changes to:

```text
spec/schemas/v1/toolchain-protocol.schema.json
src/protocol/generated.ts
Search ranker/index implementation
Target fingerprint projection
Contract Index fingerprint projection
H1/H2/staged eval semantics
```

- [ ] **Step 6: Update status only from verified evidence**

Add #186 as COMPLETE only after the exact PR head has full green CI and the committed receipt equality test passes. Record exact measured byte values, not estimates.

- [ ] **Step 7: Final exact-head CI gate**

Require all normal repository jobs on the exact head: Node 22.19/24.19/26, Windows/macOS, build/pack/install, exact packed Toolchain vs real DSH, composition and target-resolution gates.

- [ ] **Step 8: PR review and merge discipline**

PR title:

```text
perf(contract): compact lossless Inspect evidence
```

PR body records Why/What/Contract impact/Verification/Risks/Related #186/#160. Do not merge while any required job or blocking review remains unresolved.
