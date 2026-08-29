# M2 Contract Inspect ID Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production `contract.search -> contract.inspect` handoff unambiguous for agents and return actionable diagnostics when provenance evidence ids are accidentally supplied as `contractId`.

**Architecture:** Keep Protocol semantics unchanged: only `ContractReference.id` is inspectable; evidence ids remain provenance and are never aliases. Strengthen the Protocol/tool affordance and detect an evidence-id namespace mismatch while rebuilding the exact current index, returning deterministic repair guidance through the existing diagnostic `repair` field.

**Tech Stack:** TypeScript 6, JSON Schema 2020-12, Vitest, DSH native tool definitions, MCP.

**Spec:** `spec/protocol.md`, Issue #59.

## Global Constraints

- Do not change target or ContractIndex fingerprint semantics.
- Do not change search ranking, contract ids, evidence ids or response envelope shapes.
- Do not modify P0 B tools, provider settings, P0 resource limits, oracle rules or H1.
- Evidence ids remain invalid as `contract.inspect.contractId` inputs; recovery is guidance, not alias resolution.
- All agent-facing frontends must describe the same `data.matches[].id` handoff.

---

### Task 1: Reproduce the product defect

**Files:**
- Modify: `tests/kernel/contract-intelligence.spec.ts`
- Modify: `tests/dsh/contract-tool.spec.ts`
- Modify: `tests/mcp/contract-intelligence.spec.ts`

**Interfaces:**
- Consumes: existing production search/inspect kernel and frontend definitions.
- Produces: regression requirements for evidence-id diagnostic recovery and agent-facing id guidance.

- [ ] Add a kernel regression that searches a contract, passes the returned evidence id to inspect, and requires `CONTRACT_NOT_FOUND` plus repair guidance naming the inspectable contract id.
- [ ] Add native DSH assertions that search/inspect descriptions and `contractId` parameter explicitly point to `data.matches[].id` and reject evidence ids conceptually.
- [ ] Add MCP assertions that the inspect description/schema exposes the same rule.
- [ ] Run focused tests and record expected RED: current generic `CONTRACT_NOT_FOUND` and missing descriptions.
- [ ] Commit the RED evidence before implementation.

### Task 2: Implement the minimal product correction

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify: `spec/protocol.md`
- Modify: `src/integrations/dsh/contract-tool.ts`
- Modify: `src/frontends/mcp/index.ts`
- Modify: `src/kernel/index.ts`
- Update generated Protocol artifacts only if the repository generator reports drift.

**Interfaces:**
- Consumes: `ContractIndex` contracts/evidence and existing `Diagnostic.repair` object.
- Produces: explicit inspectable-id guidance and deterministic evidence-id mismatch repair metadata.

- [ ] Add JSON Schema descriptions: `ContractReference.id` is the inspectable id; `Evidence.id` is provenance; `contractInspectRequest.contractId` must be copied from `contract.search.data.matches[].id`.
- [ ] Update Protocol prose with the same distinction without changing request/response fields.
- [ ] Update native DSH and MCP tool descriptions; native `contractId` parameter also carries the explicit description.
- [ ] In kernel inspect not-found handling, detect when the supplied id equals evidence present in the current index; derive bounded deterministic contract ids that reference that evidence and return `CONTRACT_NOT_FOUND` with existing diagnostic repair metadata. Never auto-resolve the evidence id.
- [ ] Keep generic unknown contract ids on the existing not-found path.
- [ ] Run focused tests, then `pnpm check`, build/pack/installed-package and exact DSH composition CI through the repository workflow.

### Task 3: Governance and closeout

**Files:**
- No product changes beyond Task 2.

**Interfaces:**
- Consumes: exact-head CI and PR diff.
- Produces: auditable merge evidence for #59 and an explicit no-rerun decision for #60/#43.

- [ ] Audit final diff for accidental P0/ranking/fingerprint changes and secrets.
- [ ] Record RED/GREEN evidence in PR #59 implementation PR.
- [ ] Merge only on exact reviewed head with all required lanes green.
- [ ] Update #43/#60: historical P0 remains preserved; do not launch another 72-run merely to validate this product affordance fix.
