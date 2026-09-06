# M4.2 Plugin Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose one kernel-owned `plugin.verify` operation that combines static Exact Target Plugin Check evidence with the isolated M4.1 worker and final target freshness into a Protocol v1 `VerificationReport`.

**Architecture:** Keep runtime execution in `src/verification/**`; add a pure deterministic reducer plus a runtime-neutral execution port at the kernel boundary. The application kernel acquires the exact packed subject/artifact, resolves the initial target, performs static analysis, invokes the M4.1 worker through the port, re-resolves the target, and reduces the result. Frontends remain projections only.

**Tech Stack:** TypeScript 6.0, Vitest 4.1.8, pnpm 11.7, Node 22.19+/24/26, existing Protocol v1 JSON Schema/generator, real DSH CI.

**Spec:** `docs/superpowers/specs/2026-09-06-m4-2-plugin-verify-design.md`

## Global Constraints

- Issue #190 is the canonical M4.2 tracker.
- Protocol v1 remains pre-public; new closed verify DTOs must be added atomically with normative spec, schema, generated types, tests and implementation.
- Do not change `dsh-target-v2`, `dsh-contract-index-v1`, `dsh-plugin-subject-v1`, or `dsh-plugin-artifact-v1` semantics.
- Do not change Contract Search ranking, H1/H2/evaluation logic, or `plugin.check` verdict semantics.
- M4.2 supports packed subjects and execution policy `safe` only.
- The active DSH profile must not be mutated by verification.
- The kernel must not import Node filesystem/process APIs.
- No frontend may own verification status reduction.

---

### Task 1: Pure verification reducer

**Files:**
- Create: `src/model/plugin-verify.ts`
- Create: `tests/model/plugin-verify.spec.ts`

**Interfaces:**
- Consumes: `PluginCheckResult`, `Diagnostic`, `VerificationReport`, M4.1 execution-shaped runtime-neutral data.
- Produces: `reducePluginVerification(input): VerificationReport`.

- [ ] **Step 1: Write RED tests** covering `verified`, static/runtime `failed`, cleanup/static `partial`, target `stale`, and `cancelled` precedence. Include artifact identity mismatch and preservation of all 11 check ids.
- [ ] **Step 2: Run targeted test** with `pnpm vitest run tests/model/plugin-verify.spec.ts`; expected RED because reducer module/function does not exist.
- [ ] **Step 3: Implement minimal pure reducer** with deterministic canonical check ordering, static placeholder replacement, status precedence and diagnostic preservation.
- [ ] **Step 4: Run targeted and aggregate tests**; expected GREEN.
- [ ] **Step 5: Commit** as `feat(verify): add public verification reducer`.

### Task 2: Kernel orchestration and freshness

**Files:**
- Modify: `src/kernel/index.ts`
- Create/modify: `tests/kernel/plugin-verify.spec.ts`
- If needed create: `src/verification/port.ts` containing only runtime-neutral execution interfaces.

**Interfaces:**
- Add `PluginVerificationExecutionPort.verify(...)`.
- Add `ApplicationKernel.verifyPlugin(...)` returning target-bound `VerificationReport` outcome.

- [ ] **Step 1: RED tests** prove initial target snapshot is the one passed to execution, exact authoritative packed content hash is passed to worker, final target resolution is mandatory, target drift yields semantic stale, and worker is not called when no authoritative complete packed artifact exists.
- [ ] **Step 2: Run targeted kernel tests** and confirm RED.
- [ ] **Step 3: Implement orchestration** by reusing the existing static acquisition/analysis seams rather than calling a frontend or duplicating analysis.
- [ ] **Step 4: Add runtime adapter** delegating to `runPackedPluginVerification` outside the semantic kernel layer.
- [ ] **Step 5: Run targeted + aggregate tests** and commit.

### Task 3: Close Protocol v1 plugin.verify DTOs

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify: `spec/protocol.md`
- Regenerate: `src/protocol/generated.ts`
- Modify generated/conformance fixtures/tests under `tests/protocol/**` as required by existing generator conventions.

**Interfaces:**
- `PluginVerifyRequest` with exact `target`, packed-only `subject`, and `executionPolicy:'safe'`.
- `PluginVerifySuccessResponse` with `status:'ok'` and `data: VerificationReport`.
- `PluginVerifyFailureResponse` only for failure to produce a semantic report.
- `PluginVerifyResponse` union.

- [ ] **Step 1: RED schema/conformance tests** for request shape and semantic stale/failed reports returned inside successful operation envelope.
- [ ] **Step 2: Update normative spec and schema atomically**.
- [ ] **Step 3: Run `pnpm generate`** and verify generated types contain the exact closed DTOs.
- [ ] **Step 4: Run protocol tests and aggregate tests** and commit.

### Task 4: Frontend parity

**Files:**
- Modify existing CLI/native DSH/MCP adapter files following current `plugin.check` patterns.
- Add/update tests under `tests/cli/**`, `tests/dsh/**`, `tests/mcp/**`, and `tests/frontends/**`.

**Interfaces:**
- One shared operation name `plugin.verify`.
- Frontends call kernel/application response helper and do not reduce statuses locally.

- [ ] **Step 1: RED parity tests** that feed the same fake kernel result through each frontend and compare semantic report fields.
- [ ] **Step 2: Add minimal projections** using existing request validation and response serialization patterns.
- [ ] **Step 3: Ensure CLI exit-code policy distinguishes transport failure from semantic report status without changing the report itself.
- [ ] **Step 4: Run frontend-specific + aggregate tests** and commit.

### Task 5: Real DSH exact-artifact acceptance

**Files:**
- Modify/add smoke script under `scripts/**` only if the existing M4.1 smoke cannot exercise the public kernel path.
- Modify `.github/workflows/ci.yml` only when required to run the public path.
- Update M4 status/docs after evidence is green.

- [ ] **Step 1: Add a smoke that invokes the built public application path on the exact packed Toolchain/fixture and frozen real DSH target, not the worker directly.
- [ ] **Step 2: Assert returned report binds exact `dsh-plugin-artifact-v1` and `dsh-target-v2`, package/install/compose/boot pass, cleanup succeeds, and status is `verified`.
- [ ] **Step 3: Run full exact-head CI on Node 22/24/26 plus Windows/macOS boundary lanes and real DSH smoke.
- [ ] **Step 4: Review all changed files for frontend-local semantics, hidden target mutation, protocol drift, and scope creep.
- [ ] **Step 5: Update PR body with exact head SHA and CI evidence; merge only with expected-head guard after all checks are GREEN.
