# M2.3 Isolated Execution Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Every behavioral task follows RED -> GREEN -> review.

**Goal:** Replace the rejected executor-self-report design with an isolated, runner-owned execution-evidence contract and `m2-agent-eval-v2` that can support trustworthy canonical P0/H1 runs.

**Architecture:** Keep all new behavior in evaluation/repository tooling outside `src/**`. Separate runner-only control from model-visible input, freeze exact capability manifests, persist runner-owned content-addressed trace/isolation/resource receipts, and make v2 canonical results retain references to that evidence. Arm C uses the real production DSH Toolchain tool-definition factories over the frozen production-kernel fixture.

**Tech Stack:** TypeScript 6, Vitest 4, JSON Schema 2020-12, AJV 8, existing Toolchain production kernel/tool definitions, existing SHA-256 port/evaluation canonicalization.

**Spec:** `docs/plans/2026-08-28-m2-3-p0-agent-execution-design.md`

## Global Constraints

- No shared-context/conversational execution mode.
- No provider SDK or model call in required CI.
- No production `src/**` behavior or retrieval-ranking change.
- `m2-agent-eval-v1` stays immutable historical evidence.
- Newly executed canonical P0/H1 must use `m2-agent-eval-v2`.
- Executor output is never authoritative for tool use, isolation, timing, retry classification or resource compliance.
- C must expose the exact production Toolchain search/inspect tool definitions.
- Required CI remains offline/deterministic.
- Issue #34 and parent #28 remain open after this infrastructure PR.

---

### Task 1: RunControl, ModelEnvelope and CapabilityManifest

**Files:**
- Create: `tests/evaluation/m2-agent-execution-evidence.ts`
- Create: `tests/evaluation/m2-agent-execution-evidence.spec.ts`

**Interfaces:**
- Produces `ModelTask`, `RunControl`, `ModelEnvelope`, `CapabilityManifest`, `createModelTask()`, `createModelEnvelope()`, `createRunControl()`, `validateCapabilityManifests()`.
- Reuses `canonicalizeEvaluationJson()` / SHA-256 evaluation helpers from `m2-agent-eval-integrity.ts`.

- [ ] **Step 1: Write RED tests for allowlist-only task projection**

Create a source task containing `id`, `prompt`, `oracleHints`, `successCriteria`, and a future unknown field. Assert `createModelTask()` returns exactly `{ id, prompt }` and no other key.

- [ ] **Step 2: Write RED tests for RunControl/ModelEnvelope separation**

Assert model envelopes never contain `phase`, `arm`, `trial`, `attempt`, retry policy, evaluation id, target fingerprints or dataset commitment unless those bytes are legitimately part of explicitly model-visible static content.

- [ ] **Step 3: Write RED tests for envelope invariants**

For one task:
- B trial 1 vs B trial 3 -> canonical envelope equality;
- B attempt 1 vs retry attempt -> canonical envelope equality;
- B vs C -> all fields equal except C has exactly the two Toolchain model-visible definitions.

- [ ] **Step 4: Write RED tests for exact capability manifests**

Assert:
- A has no ordinary/Toolchain tools;
- B has a frozen conventional exact-target manifest;
- C normalizes to B plus exactly two Toolchain definitions;
- adding/removing/altering any ordinary tool/schema/root/network/static-doc setting breaks equivalence.

- [ ] **Step 5: Run focused RED test**

Run the evaluation Vitest file; expected failure is missing execution-evidence exports, not unrelated baseline failures.

- [ ] **Step 6: Implement minimal types/builders/validators**

Use explicit field construction; never `{...task}` followed by deletion. Hash canonical projections with the existing SHA-256 port.

- [ ] **Step 7: Run focused GREEN and repository type/lint checks**

Expected: all new envelope/capability tests pass.

- [ ] **Step 8: Commit**

`test(m2.3): define isolated model envelope boundary`

---

### Task 2: Runner-owned content, trace, isolation and resource receipts

**Files:**
- Modify: `tests/evaluation/m2-agent-execution-evidence.ts`
- Modify: `tests/evaluation/m2-agent-execution-evidence.spec.ts`

**Interfaces:**
- Produces `ContentRef`, `TraceReceipt`, `IsolationReceipt`, `ResourceReceipt`, `ExecutorIdentity`, `createInlineContentRef()`, `validateContentRef()`, `validateTraceReceipt()`, `validateIsolationReceipt()`, `validateResourceReceipt()`.

- [ ] **Step 1: Write RED tests proving executor output cannot contain authoritative evidence**

Define the executor model-outcome shape so accepted fields are only final answer + provider-native completion metadata. Assert tool events, `sessionIsolation`, runner timestamps and resource-compliance fields are rejected by the parser/validator.

- [ ] **Step 2: Write RED content-reference tests**

Assert an inline canonical request/response re-hashes to its declared SHA-256; tampered bytes, wrong byte length or unsupported canonicalization fail.

- [ ] **Step 3: Write RED trace-policy tests**

Runner-owned trace validation must reject:
- any A tool event;
- Toolchain event in B;
- any C Toolchain event except the exact search/inspect production names;
- non-contiguous sequence;
- request/response content hash mismatch.

- [ ] **Step 4: Write RED isolation tests**

Reject receipts with reused model session, memory carry-over, shared mutable environment, missing tool-state reset, wrong workspace snapshot or retry policy other than fresh session per attempt.

- [ ] **Step 5: Write RED resource tests**

Assert configured policy, observed usage and measurement source remain separate. Required-but-unavailable measurement -> `unverifiable`, not `compliant`. Runner-enforced wall time/turns/attempts exceeding policy -> `non-compliant`.

- [ ] **Step 6: Implement minimal receipt/content validators**

Do not add IO. Validators consume explicit immutable evidence only.

- [ ] **Step 7: Run focused GREEN**

- [ ] **Step 8: Commit**

`test(m2.3): add runner-owned execution receipts`

---

### Task 3: Retry evidence with partial activity

**Files:**
- Modify: `tests/evaluation/m2-agent-execution-evidence.ts`
- Modify: `tests/evaluation/m2-agent-execution-evidence.spec.ts`
- Reuse: `tests/evaluation/m2-agent-eval-integrity.ts`

**Interfaces:**
- Produces `RunnerAttemptEvidence`, `validateRunnerAttemptSequence()`.
- Reuses `validateAgentAttempts()` for the existing `1 + N` semantic contract.

- [ ] **Step 1: Write RED partial-activity retry test**

Attempt 1 contains runner-owned tool entries and ends `infrastructure-failure`; attempt 2 must retain attempt 1 and use a different fresh-session isolation receipt while keeping identical ModelEnvelope hash.

- [ ] **Step 2: Write RED quality-independent classification tests**

Infrastructure failure requires runner classification from the preregistered set and a `qualityIndependent: true` evidence bit. A classification that depends on answer quality is not eligible for retry.

- [ ] **Step 3: Write RED terminal model-outcome test**

Any attempt after a model outcome fails, preserving existing `modelOutcomeRetries = 0` semantics.

- [ ] **Step 4: Implement minimal sequence validator**

Reuse the existing retry validator rather than creating a second budget algorithm.

- [ ] **Step 5: Run focused GREEN**

- [ ] **Step 6: Commit**

`test(m2.3): retain partial execution across retries`

---

### Task 4: Production-faithful Arm C broker

**Files:**
- Create: `tests/evaluation/m2-agent-tool-broker.ts`
- Create: `tests/evaluation/m2-agent-tool-broker.spec.ts`
- Reuse: `tests/evaluation/m2-search-inspect-fixture.ts`
- Import only: `src/integrations/dsh/contract-tool.ts`

**Interfaces:**
- Produces `createFrozenToolchainBroker()` returning runner-owned tool definitions/execute functions plus trace events.
- Must use `createContractSearchToolDefinition()` and `createContractInspectToolDefinition()`.

- [ ] **Step 1: Write RED fidelity tests**

Assert broker tool names, descriptions and parameter schemas equal the production factories/constants, not hand-authored approximations.

- [ ] **Step 2: Write RED execution test**

Invoke broker search with a real frozen target request, then inspect a returned contract using the returned index fingerprint. Assert production DTO shape and target/index continuity.

- [ ] **Step 3: Write RED trace-ownership test**

Assert request/response content refs are produced by the broker around execution; caller/executor cannot inject an alternative trace.

- [ ] **Step 4: Implement minimal broker**

Wrap frozen production-kernel resolvers with the production DSH tool-definition factories. No alternate ranker, oracle lookup or expected-answer table.

- [ ] **Step 5: Run focused GREEN**

- [ ] **Step 6: Commit**

`test(m2.3): bind C to production Toolchain tools`

---

### Task 5: `m2-agent-eval-v2` closed schema

**Files:**
- Create: `docs/evaluation/m2/m2-agent-eval-v2.schema.json`
- Create: `tests/evaluation/m2-agent-eval-v2-schema.spec.ts`

**Interfaces:**
- v2 preserves v1 definition/schedule/metrics/oracle semantics and adds exact capability/resource/execution-evidence requirements.

- [ ] **Step 1: Write RED schema tests**

Assert a minimal valid v2 definition/result is rejected while schema is absent. Include negative cases for:
- naked hashes without execution evidence;
- missing isolation/resource/trace refs;
- executor-supplied tool evidence;
- result with v1 schema id presented as newly executed v2 evidence;
- H1 with null MCID/margin.

- [ ] **Step 2: Add strict JSON Schema 2020-12**

Keep `additionalProperties: false`. Use content-ref and execution-evidence definitions. Definition freezes capability manifests, runner/executor identity and resource measurement/enforcement policy.

- [ ] **Step 3: Run AJV strict-mode GREEN**

- [ ] **Step 4: Commit**

`test(m2.3): define agent evaluation v2 schema`

---

### Task 6: v2 definition/result integrity

**Files:**
- Create: `tests/evaluation/m2-agent-eval-v2-integrity.ts`
- Create: `tests/evaluation/m2-agent-eval-v2-integrity.spec.ts`
- Reuse: `tests/evaluation/m2-agent-eval-integrity.ts`

**Interfaces:**
- Produces `validateAgentV2ResultAgainstDefinition()`.
- Reuses canonical definition hashing, balanced schedule and retry validators from v1 implementation where semantics are unchanged.

- [ ] **Step 1: Write RED exact-binding tests**

Reject changed definition hash, model, capability manifest, resource policy, schedule order/task count or dataset identity.

- [ ] **Step 2: Write RED execution-chain tests**

For every model attempt require content-valid refs for:
`runControlSha256`, `modelEnvelopeSha256`, `traceSha256`, `executorIdentitySha256`, `isolationReceiptSha256`, `resourceReceiptSha256`, `rawAnswer`.

Reject a trace/receipt whose embedded `runControlSha256` does not match the run.

- [ ] **Step 3: Preserve v1 decision invariants**

Reuse/port tests for one terminal model outcome, complete schedule, UNKNOWN -> INCONCLUSIVE, P0 `CALIBRATED`, H1 PASS/NEEDS-IMPROVEMENT/INCONCLUSIVE and task-level preregistration.

- [ ] **Step 4: Add historical-version guard**

Prove v1 remains parseable by its historical tests but cannot be accepted by the new v2 canonical-execution validator.

- [ ] **Step 5: Implement minimal v2 integrity validator**

Do not duplicate v1 schedule/retry logic where reusable exports exist.

- [ ] **Step 6: Run focused/full evaluation GREEN**

- [ ] **Step 7: Commit**

`test(m2.3): bind v2 results to execution evidence`

---

### Task 7: Normative evaluation documentation

**Files:**
- Modify: `docs/evaluation/m2/agent-comparison.md`
- Modify: `docs/plans/2026-08-28-m2-3-evaluation-design.md` only if needed to state v1 historical/v2 execution semantics without rewriting the frozen retrieval methodology.
- Modify: Issue #36 / PR #37 metadata.

- [ ] **Step 1: Document runner-owned trajectory/isolation/resource trust boundary**

- [ ] **Step 2: Document RunControl/ModelEnvelope and exact capability manifest invariants**

- [ ] **Step 3: Document v1 historical / v2 required-for-execution versioning**

- [ ] **Step 4: Document partial-activity retry retention and resource measurement policy**

- [ ] **Step 5: Verify no repository design/issue/PR path proposes shared-context/conversational execution for M2.3**

- [ ] **Step 6: Commit**

`docs(m2.3): require runner-owned v2 execution evidence`

---

### Task 8: Full verification and corrective review

**Files:** no intended product changes.

- [ ] **Step 1: Run/observe `pnpm check` through PR CI on exact HEAD**

Require Node 22.19, 24.19 and 26 quality gates.

- [ ] **Step 2: Require Windows/macOS boundary smokes**

- [ ] **Step 3: Require primary build/pack/install + exact minimal/Web DSH composition + cross-train target resolution**

- [ ] **Step 4: Review full PR diff**

Confirm no `src/**` behavior change, no workflow/provider credential path, no v1 rewrite, no retrieval baseline/corpus tuning and no unrelated dependency change.

- [ ] **Step 5: Review PR threads and update verification section with only executed evidence**

- [ ] **Step 6: Mark ready and squash-merge only with exact expected head SHA after all checks are green**

- [ ] **Step 7: Verify post-merge main CI; keep #34/#28 open**
