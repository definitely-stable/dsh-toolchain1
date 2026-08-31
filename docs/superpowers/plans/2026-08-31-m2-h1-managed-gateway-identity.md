# M2 H1 Managed-Gateway Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unavailable backend-fingerprint requirement from H1 while preserving exact OpenCode Go / `deepseek-v4-flash` configuration, capability evidence, response-model drift detection, and all frozen H1 statistical/execution invariants.

**Architecture:** The raw OpenCode Go probe remains the external evidence source. H1 maps a capability-complete `response-model-only` receipt into an internal `managed-gateway` provider identity committed by receipt SHA. Execution and durable state bind the provider receipt and exact response model, not a hidden backend fingerprint.

**Tech Stack:** TypeScript 6, Vitest 4, Node.js 22.19+/24/26, GitHub Actions, existing H1 evaluation runtime.

**Spec:** `docs/superpowers/specs/2026-08-31-m2-h1-managed-gateway-identity-design.md`

## Global Constraints

- Keep `deepseek-v4-flash`; do not select another H1 model.
- Do not change the 96-task/864-entry prospective H1 design, thresholds, schedule seed, target, resource caps, or inference rules.
- Never invent a backend fingerprint or immutable checkpoint.
- Provider receipt, exact response model, capabilities, configuration and token evidence remain fail-closed.
- Hidden H1 task bytes never enter provider-only probe workflows or public receipts.
- Remove the operating 14-model discovery matrix to avoid quota waste.

---

### Task 1: Commit managed-gateway provider identity

**Files:**
- Modify: `tests/evaluation/m2-h1-provider-identity-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-provider-identity-v2.ts`
- Modify: `tests/evaluation/m2-h1-readiness-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-readiness-v2.ts`
- Modify: `tests/evaluation/m2-h1-synthetic-fixture-v2.ts`

**Interfaces:**
- Consumes: raw `dsh-toolchain-m2-opencode-go-probe-v1` receipt.
- Produces: `H1ProviderIdentityV2` with `identityMode: 'managed-gateway'` and `identityReceiptSha256`, without backend fingerprint fields.

- [ ] Write failing tests that accept the real OpenCode Go observable boundary (`response-model-only`, no fingerprint) only when all exact Flash configuration/capability/token fields are verified.
- [ ] Run CI and retain the expected RED evidence from the old strong-backend requirement.
- [ ] Implement the minimal provider commit/readiness changes and update the synthetic fixture.
- [ ] Run CI and require the complete repository matrix to pass.

### Task 2: Rebind preregistration and execution to the provider receipt

**Files:**
- Modify: `tests/evaluation/m2-h1-execution-definition-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-execution-definition-v2.ts`
- Modify: `tests/evaluation/m2-h1-preregistration-receipt-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-preregistration-receipt-v2.ts`

**Interfaces:**
- Consumes: finalized managed-gateway identity from Task 1.
- Produces: executor identity and ledger binding keyed by provider receipt SHA + expected response model.

- [ ] Write failing tests requiring executor identity `identityMode: managed-gateway` and forbidding `expectedSystemFingerprint`/`expectedBackendFingerprint` from frozen bindings.
- [ ] Run CI for RED evidence.
- [ ] Remove fingerprint dependencies while keeping endpoint/model/settings/receipt binding exact.
- [ ] Run complete CI for GREEN evidence.

### Task 3: Simplify durable H1 runtime bindings

**Files:**
- Modify: `tests/evaluation/m2-h1-run-ledger-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-run-ledger-v2.ts`
- Modify: `tests/evaluation/m2-h1-run-store-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-run-store-v2.ts`
- Modify: `tests/evaluation/m2-h1-attempt-input-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-attempt-input-v2.ts`
- Modify: `tests/evaluation/m2-h1-attempt-coordinator-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-attempt-coordinator-v2.ts`

**Interfaces:**
- Consumes: provider-receipt/response-model ledger binding from Task 2.
- Produces: durable attempts that fail closed on response-model/config drift but do not require provider-hidden metadata.

- [ ] Write failing ledger/store/input/coordinator tests without backend fingerprint fields or required fingerprint environment variables.
- [ ] Run CI for RED evidence.
- [ ] Remove fingerprint fields from headers, pending intents, model ledger entries and H1 process environment requirements.
- [ ] Keep `responseModel === deepseek-v4-flash` mandatory for every model outcome.
- [ ] Permit optional `systemFingerprint` in retained raw provider metadata without using it as acceptance identity.
- [ ] Run complete CI for GREEN evidence.

### Task 4: Restore one-model provider operation and reconcile docs

**Files:**
- Modify: `tests/policy/m2-h1-provider-probe-workflow.spec.ts`
- Modify: `.github/workflows/m2-h1-provider-probe.yml`
- Modify: `docs/evaluation/m2/h1-preregistration-publication-v2.md`
- Modify: `docs/evaluation/m2/status.md` if it states checkpoint fingerprint is a blocker.

**Interfaces:**
- Consumes: existing selectable-model probe CLI.
- Produces: one provider-only H1 readiness probe for `deepseek-v4-flash` and documentation matching the managed-gateway claim boundary.

- [ ] Write failing workflow policy tests requiring a single Flash probe and no matrix.
- [ ] Run CI for RED evidence.
- [ ] Replace candidate matrix with one Flash probe and validate exact capability receipt rather than `system_fingerprint`.
- [ ] Reconcile publication/status text without claiming H1 has executed or preregistration has been published.
- [ ] Run exact-head complete CI and verify provider-only workflow behavior separately before integration.
