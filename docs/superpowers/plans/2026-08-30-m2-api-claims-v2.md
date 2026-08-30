# Generic API Claims v2 Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate task-neutral API claim parsing/classification from P0-specific task-success rules without changing any observed P0 semantics or derived evidence identity.

**Architecture:** A new evaluation-only `m2-api-claims-v2.ts` owns the structured `API_CLAIM` grammar, bounded parsing and classification against `ApiTruthUniverseV2`. `m2-agent-p0-adjudication-v2.ts` becomes a thin P0 task-rule layer and re-exports compatibility names so existing callers do not churn. H1 readiness can then bind the generic claim classifier without depending on `p0-01`…`p0-08` semantics.

**Tech Stack:** TypeScript 6, Node.js `^22.19.0 || >=24`, Vitest 4, existing `ApiTruthUniverseV2`.

**Spec:** GitHub Issues #77 and #76; `docs/evaluation/m2/agent-comparison-amendment-2026-08-30.md`; `AGENTS.md`; `CONTRIBUTING.md`.

## Global Constraints

- Evaluation-only: no `src/**`, Protocol, Contract Index/ranking, dependencies, provider/resource/workflow changes.
- Truth v2 semantics and the retained P0 observations remain unchanged.
- `api-oracle-v1.json`, retained P0 fixture and `p0-readjudication-v2.json` remain byte-unchanged.
- No H1 task content, provider run or model outcome is introduced.
- Existing P0 compatibility exports stay available during this extraction.
- The retained replay report SHA must remain `aaba6e82c2506d0af0b440cb0bf34c1ebf68efc9293f32ca8eeeadeb294bdd69`.

---

### Task 1: Freeze a task-neutral RED contract

**Files:**
- Create: `tests/evaluation/m2-api-claims-v2.spec.ts`
- Create later: `tests/evaluation/m2-api-claims-v2.ts`

- [x] Write RED tests importing `parseApiClaimsV2` / `classifyApiClaimsV2` from the missing generic module.
- [ ] Run exact-head CI and confirm the new test fails because the generic module does not exist while existing tests remain unchanged.

The generic contract must prove dotted symbols, exact members, unique bare-member resolution, wrong-package detection, complete package absence, target-wide absence and fail-closed incomplete-universe behavior without naming any P0 task id.

### Task 2: Extract generic parsing/classification

**Files:**
- Create: `tests/evaluation/m2-api-claims-v2.ts`
- Modify: `tests/evaluation/m2-agent-p0-adjudication-v2.ts`

- [ ] Move only grammar/parser/classifier code and its task-neutral types into the generic module.
- [ ] Rename generic identities from `*P0*` to task-neutral names.
- [ ] Keep `m2-agent-p0-adjudication-v2.ts` responsible for `P0_TASK_RULES_V2`, relevant-claim selection, scoped negative proof and task-success verdicts.
- [ ] Re-export aliases `ParsedP0ApiClaimV2`, `ClassifiedP0ApiClaimV2`, `P0ApiClaimResolutionV2`, `parseP0ApiClaimsV2`, `classifyP0ApiClaimsV2` so existing P0 code remains source-compatible.
- [ ] Ensure no `p0-` token exists in `m2-api-claims-v2.ts`.

### Task 3: Prove semantic identity and merge

- [ ] Run focused generic/P0/re-adjudication tests.
- [ ] Assert retained report SHA is unchanged.
- [ ] Run `pnpm check` through required CI plus build/pack/install/composition/platform matrix.
- [ ] Audit diff: only evaluation tests/module/plan files; no historical evidence changes.
- [ ] Merge exact-head green PR and verify post-merge `main` CI.
- [ ] Close #77; continue #76 on the clean generic classifier boundary.
