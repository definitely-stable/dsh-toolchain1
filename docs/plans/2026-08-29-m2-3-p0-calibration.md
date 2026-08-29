# M2.3 Provider-Backed P0 Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the frozen public P0 dataset through the existing isolated `m2-agent-eval-v2` runner, with a deterministic 72-run A/B/C schedule, runner-side API/task adjudication, one narrow DeepSeek provider child, infrastructure-only retries, and a canonical auditable `CALIBRATED | INCONCLUSIVE` result.

**Architecture:** Keep production Toolchain untouched. Add evaluation-only orchestration that composes existing dataset/schedule/capability/attempt/integrity primitives. The repository-owned DeepSeek child is a replaceable process implementation of the already-frozen NDJSON executor protocol; it owns only provider transport and model output, while the runner continues to own tool dispatch, trace/isolation/resource evidence, retry classification and final result integrity.

**Tech Stack:** TypeScript 6, Node.js `^22.19.0 || >=24`, Vitest 4, repository `.mjs` scripts, native Node `fetch`, existing `m2-agent-eval-v2` schema/integrity, existing frozen rc.2 Contract Index/oracle/ordinary workspace.

**Spec:** GitHub Issue #43; `docs/evaluation/m2/agent-comparison.md`; `docs/plans/2026-08-28-m2-3-p0-agent-execution-design.md`; `docs/evaluation/m2/m2-agent-eval-v2.schema.json`; `AGENTS.md`; `CONTRIBUTING.md`.

## Global Constraints

- Evaluation/repository tooling only. Do not modify `src/**`, public Toolchain Protocol, production Contract Intelligence ranking, dependencies/lockfile, or required CI workflow unless a concrete blocker is first reproduced and recorded.
- Canonical target remains `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`, target `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`, Contract Index `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`.
- Conventional B/C evidence remains workspace `ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413`, docs `9325818edcb90fd4ea8d870c6dad3c438cdbc9b72c744d4807b76c2aacc1cacf`.
- A receives no exact-target evidence/tools; B receives only frozen ordinary `read_file`/`search_text`; C equals B plus exactly production `toolchain_contract_search`/`toolchain_contract_inspect`.
- Required CI performs no external model/network call. All provider behavior in required CI uses local deterministic fixtures or a localhost HTTP server.
- Actual P0 uses exactly 8 frozen tasks × 3 trials × 3 arms = 72 scheduled runs, plus only preregistered infrastructure retries.
- Model-outcome retries remain forbidden. UNKNOWN remains UNKNOWN and cannot be coerced to produce `CALIBRATED`.
- Provider API credentials are read from an explicitly named environment variable only inside the provider child and are never copied into evidence, hashes, stdout/stderr, committed config or ModelEnvelope.
- P0 is calibration only: terminal state is `CALIBRATED` or `INCONCLUSIVE`; never `PASS`/`NEEDS-IMPROVEMENT`.
- DeepSeek request model alias and reviewed model snapshot identity are distinct. The adapter must also retain non-secret provider-returned model/backend identity needed to detect drift; a mutable alias alone is not H1 snapshot evidence.

---

### Task 1: Frozen P0 inputs, system prompt and canonical v2 definition

**Files:**
- Create: `tests/evaluation/m2-agent-p0-definition.ts`
- Create: `tests/evaluation/m2-agent-p0-definition.spec.ts`
- Read/reuse: `docs/evaluation/m2/agent-pilot-p0.json`
- Read/reuse: `docs/evaluation/m2/api-oracle-v1.json`
- Read/reuse: `tests/evaluation/m2-agent-ordinary-broker.ts`
- Read/reuse: `tests/evaluation/m2-agent-eval-integrity.ts`

**Interfaces:**

```ts
export interface FrozenP0ProviderIdentity {
  provider: 'deepseek'
  requestModel: string
  reviewedSnapshot: string
  thinking: 'enabled' | 'disabled'
  reasoningEffort: 'low' | 'high' | 'max'
  baseUrl: string
  adapterVersion: 'deepseek-chat-v1'
}

export interface FrozenP0Inputs {
  dataset: P0Dataset
  oracle: P0Oracle
  workspace: OrdinaryWorkspace
  capabilityManifests: { A: CapabilityManifest; B: CapabilityManifest; C: CapabilityManifest }
  schedule: readonly AgentScheduleEntry[]
  definition: Record<string, unknown>
  definitionSha256: string
}

export async function createFrozenP0Inputs(
  provider: FrozenP0ProviderIdentity,
): Promise<FrozenP0Inputs>
```

Frozen system prompt:

```text
You are evaluating public APIs on one exact installed DeepSeek Harness target. Use only evidence available in this run. Do not use knowledge from newer DSH versions. Keep the answer concise. For every concrete API existence claim, emit one line before the explanation using exactly:
API_CLAIM package=<package-or-*> symbol=<symbol> assertion=<exists|absent>
Use package=* only for a target-wide absence claim. Do not emit an API_CLAIM for vague behavioral statements. Then give a brief plain-language explanation.
```

- [ ] **Step 1: Write RED tests for frozen dataset/schedule/model-visible projection**

Tests must assert:

```ts
const inputs = await createFrozenP0Inputs(PROVIDER)
expect(inputs.dataset.taskCount).toBe(8)
expect(inputs.schedule).toHaveLength(72)
expect(new Set(inputs.schedule.map(x => `${x.taskId}/${x.trial}/${x.arm}`)).size).toBe(72)
expect(inputs.definition.phase).toBe('P0')
expect(inputs.definition.schema).toBe('dsh-toolchain-m2-agent-eval-v2')
```

For every dataset task, call existing `createModelTask(task)` and assert only `id`/`prompt` remain; `oracleHints`, `successCriteria`, `domain`, `intent` must not survive model projection.

Assert `validateCapabilityManifests()` succeeds and definition execution references re-hash to the exact A/B/C manifests, ordinary workspace/docs identity and exact retry/resource policies.

- [ ] **Step 2: Run focused RED**

Run:

```text
pnpm vitest run tests/evaluation/m2-agent-p0-definition.spec.ts
```

Expected: FAIL because `m2-agent-p0-definition.ts` does not exist.

- [ ] **Step 3: Implement minimal canonical definition builder**

Implementation must:

1. load JSON via repository-relative URL;
2. validate exact dataset/target identity and unique 8 task ids;
3. load/validate committed ordinary workspace;
4. create production-faithful Toolchain C definitions through the existing frozen broker seam;
5. create/validate A/B/C manifests through `createFrozenP0CapabilityManifests()`;
6. call `createBalancedAgentSchedule(taskIds, 'm2-p0-calibration-v1', sha256)`;
7. build exact v2 definition with P0 metrics MCID/margin `null`;
8. content-address runner identity, executor/provider identity, manifests, resource policy and retry policy using existing `createInlineContentRef()`;
9. set resource policy to the committed P0 envelope:

```ts
{
  maxWallTimeMs: 300_000,
  maxTurns: 12,
  maxAttempts: 2,
  concurrency: 1,
  maxInputTokens: 30_000,
  maxOutputTokens: 6_000,
  tokenMeasurementRequired: true,
}
```

Retry policy:

```ts
{
  maxInfrastructureRetries: 1,
  modelOutcomeRetries: 0,
  retryableReasons: ['provider-transport', 'tool-transport'],
}
```

10. hash the complete definition with `hashEvaluationDefinition()`.

No provider secret/environment variable belongs in the definition.

- [ ] **Step 4: Run focused GREEN and full typecheck**

```text
pnpm vitest run tests/evaluation/m2-agent-p0-definition.spec.ts
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test(m2.3): freeze P0 execution definition`

---

### Task 2: Deterministic structured API-claim parsing and rc.2 oracle classification

**Files:**
- Create: `tests/evaluation/m2-agent-p0-adjudication.ts`
- Create: `tests/evaluation/m2-agent-p0-adjudication.spec.ts`
- Reuse: `tests/evaluation/m2-retrieval-index.ts`

**Interfaces:**

```ts
export interface ParsedP0ApiClaim {
  package: string | '*'
  symbol: string
  assertion: 'exists' | 'absent'
}

export interface ClassifiedP0ApiClaim extends ParsedP0ApiClaim {
  classification: 'VALID' | 'INVALID' | 'UNKNOWN'
  reason: string
  evidenceIds: readonly string[]
}

export function parseP0ApiClaims(answer: string): readonly ParsedP0ApiClaim[]
export async function classifyP0ApiClaims(
  claims: readonly ParsedP0ApiClaim[],
): Promise<readonly ClassifiedP0ApiClaim[]>
```

- [ ] **Step 1: Write RED parser tests**

Cover:

```text
API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=exists
API_CLAIM package=* symbol=patchReload assertion=absent
```

Reject/ignore malformed lines, duplicate exact claims, empty symbols, package traversal/whitespace, unsupported assertions and extra key/value fields. Cap retained claims at 32 and answer input at 128 KiB; overflow must fail closed rather than truncate silently.

- [ ] **Step 2: Write RED oracle-classification tests**

Use the real frozen index and assert:

- `@deepseek-ai/dsh-tools / defineTool / exists` -> VALID;
- `@deepseek-ai/dsh-session-query / compileSessionTextFilter / exists` -> VALID;
- `@deepseek-ai/dsh-tools / ToolAutopilot / exists` -> INVALID;
- `* / ToolAutopilot / absent` -> VALID;
- `* / patchReload / absent` -> VALID;
- an ambiguous/unprovable package/symbol mapping -> UNKNOWN rather than INVALID when completeness/ownership cannot establish the rule.

Classification must derive package/symbol existence and authoritative evidence from the complete frozen index, not from P0 `oracleHints`.

- [ ] **Step 3: Run focused RED**

```text
pnpm vitest run tests/evaluation/m2-agent-p0-adjudication.spec.ts
```

Expected: FAIL because adjudication functions do not exist.

- [ ] **Step 4: Implement minimal parser/classifier**

Build a deterministic lookup from `createFrozenM2RetrievalIndex()`:

- exact package contract id `package:<name>` establishes package presence;
- authoritative declaration-export facts establish public symbol ownership;
- exact target-wide absence is valid only after checking the complete frozen package/declaration universe;
- wrong-package positive claim is INVALID only when the symbol is authoritatively owned elsewhere or absent from the complete authoritative universe under the frozen oracle rules;
- any incomplete/conflicting evidence path returns UNKNOWN.

Never consult live network, later DSH docs, model output beyond the parsed claim, or task expected answers.

- [ ] **Step 5: Run GREEN**

```text
pnpm vitest run tests/evaluation/m2-agent-p0-adjudication.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `test(m2.3): add deterministic P0 API adjudication`

---

### Task 3: Deterministic P0 task-success adjudication and outcome finalization

**Files:**
- Modify: `tests/evaluation/m2-agent-p0-adjudication.ts`
- Modify: `tests/evaluation/m2-agent-p0-adjudication.spec.ts`

**Interfaces:**

```ts
export type P0TaskSuccess = 'SUCCESS' | 'FAILURE' | 'UNKNOWN'

export function adjudicateP0TaskSuccess(
  taskId: string,
  claims: readonly ClassifiedP0ApiClaim[],
): P0TaskSuccess

export function adjudicateP0ModelOutcome(
  taskId: string,
  rawAnswer: string,
): Promise<{
  parsedApiClaims: readonly ClassifiedP0ApiClaim[]
  taskSuccess: P0TaskSuccess
}>
```

- [ ] **Step 1: Write RED tests for all eight P0 tasks**

Freeze machine rules from the already-public P0 criteria:

- p0-01: at least one VALID positive claim in `@deepseek-ai/dsh-tools` among `defineTool`, `DefineToolOptions`, `ParameterSchemaSpec`; no INVALID claim.
- p0-02: at least one VALID positive claim in `@deepseek-ai/dsh-user-approval` among `ApprovalService`, `effectiveApprovalPolicy`, `setApprovalPolicy`; no INVALID claim.
- p0-03: at least one VALID positive scope claim among `createScope`, `bindScopeParent`, `ScopeParentBinding`; no INVALID claim.
- p0-04: VALID positive `@deepseek-ai/dsh-session-query / compileSessionTextFilter`; no INVALID claim.
- p0-05: VALID positive `@deepseek-ai/dsh-subagent / assertSubagentMaxDepth`; no INVALID claim.
- p0-06: at least one VALID positive `@deepseek-ai/dsh-compaction` claim among `compactCheckpointSource`, `CompactionCheckpointSource`; no INVALID claim.
- p0-07: VALID absence claim for `patchReload`; any positive `patchReload` claim is FAILURE.
- p0-08: VALID absence claim for `ToolAutopilot`; any positive `ToolAutopilot` claim is FAILURE.

Any required claim classified UNKNOWN, no parseable required claim, or contradictory exists/absent pair => UNKNOWN. Unrelated INVALID API claims => FAILURE.

- [ ] **Step 2: Run RED, implement and run GREEN**

```text
pnpm vitest run tests/evaluation/m2-agent-p0-adjudication.spec.ts
```

Expected RED before implementation, PASS after minimal table-driven adjudication.

- [ ] **Step 3: Commit**

Commit: `test(m2.3): freeze P0 task-success rules`

---

### Task 4: P0 scheduled-run orchestration and retry ledger

**Files:**
- Create: `tests/evaluation/m2-agent-p0-runner.ts`
- Create: `tests/evaluation/m2-agent-p0-runner.spec.ts`
- Reuse: `tests/evaluation/m2-agent-process-runner.ts`
- Reuse: `tests/evaluation/m2-agent-p0-tool-runtime.ts`
- Reuse: `tests/evaluation/m2-agent-runner-retry-evidence.ts`

**Interfaces:**

```ts
export interface P0ProcessConfiguration {
  command: string
  args: readonly string[]
  cwd: string
  environment: Readonly<Record<string, string>>
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
}

export interface P0RunResult {
  definition: Record<string, unknown>
  result: Record<string, unknown>
}

export async function executeFrozenP0(
  frozen: FrozenP0Inputs,
  process: P0ProcessConfiguration,
): Promise<P0RunResult>
```

- [ ] **Step 1: Write RED deterministic fixture tests**

Use existing process fixtures plus a new deterministic child fixture that reads the ModelEnvelope and emits task-specific structured API claims. Tests must prove:

- exactly 72 result runs in frozen schedule order;
- every run starts at attempt 1;
- one retry occurs only for configured infrastructure failure and retains both attempts;
- retry uses the exact same ModelEnvelope hash and unique session/environment hashes;
- model outcome is never retried;
- A trace contains no tools; B no Toolchain; C may use Toolchain only when exposed;
- raw outcome is runner-adjudicated before result finalization;
- any unresolved B/C outcome forces whole P0 `INCONCLUSIVE`;
- fully resolved complete P0 produces `CALIBRATED` only.

- [ ] **Step 2: Run RED**

```text
pnpm vitest run tests/evaluation/m2-agent-p0-runner.spec.ts
```

Expected: FAIL because suite orchestration does not exist.

- [ ] **Step 3: Implement sequential orchestration**

Use concurrency 1. For each schedule entry:

1. construct `ModelEnvelope` from frozen system prompt + `createModelTask()` + arm manifest;
2. derive non-secret deterministic control ids for session/environment from evaluation/task/arm/trial/attempt plus a runner nonce input; do not reuse an id on retry;
3. call `executeProcessAttemptWithEvidence()`;
4. on model outcome, replace the placeholder empty claims/UNKNOWN task success with `adjudicateP0ModelOutcome()` output while preserving every runner-owned evidence ref/raw answer/provider metadata;
5. on retryable infrastructure failure, append the failed attempt and rerun with attempt+1;
6. on exhausted/non-retryable infrastructure failure, keep the evidence and mark final P0 `INCONCLUSIVE`;
7. after all schedule entries, hash the definition, construct canonical result, validate schema plus `validateAgentV2ResultAgainstDefinition()` before returning.

Never stop early after a poor answer; only infrastructure policy may change attempt count.

- [ ] **Step 4: Focused GREEN**

```text
pnpm vitest run tests/evaluation/m2-agent-p0-runner.spec.ts tests/evaluation/m2-agent-eval-v2-integrity.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test(m2.3): orchestrate frozen P0 schedule`

---

### Task 5: Narrow DeepSeek Chat Completions process child

**Files:**
- Create: `scripts/m2-deepseek-p0-child.mjs`
- Create: `tests/evaluation/m2-deepseek-p0-child.spec.ts`
- Create: `tests/evaluation/fixtures/deepseek-p0-provider/server.mjs` only if the Vitest localhost server cannot be kept entirely inside the spec.

**Interfaces/environment:**

Required child environment:

```text
DEEPSEEK_API_KEY=<secret, never retained>
M2_DEEPSEEK_BASE_URL=https://api.deepseek.com
M2_DEEPSEEK_MODEL=deepseek-v4-pro
M2_DEEPSEEK_REVIEWED_SNAPSHOT=DeepSeek-V4-Pro-0813
M2_DEEPSEEK_THINKING=enabled
M2_DEEPSEEK_REASONING_EFFORT=high
```

- [ ] **Step 1: Write RED local-provider tests**

Run the child against a localhost fake Chat Completions server and prove:

- it accepts exactly one canonical runner `start` envelope and never receives RunControl;
- system/user messages derive only from ModelEnvelope;
- `ModelEnvelope.tools` are translated to OpenAI-compatible function tools without changing names/descriptions/JSON Schema;
- provider `tool_calls` become NDJSON `tool_call` messages;
- runner `tool_result` becomes a subsequent `role: tool` provider message with exact `tool_call_id`;
- thinking-mode follow-up preserves assistant `reasoning_content` and tool call context before tool outputs;
- terminal assistant content becomes `provider_metadata` + `final`;
- provider response `id`, `finish_reason`, input/output token counts, returned `model` and `system_fingerprint` are validated;
- wrong returned model alias, malformed tool arguments, duplicate/missing choice, HTTP failure and `insufficient_system_resource` become provider-transport infrastructure errors;
- API key never appears in stdout/stderr or retained provider metadata.

- [ ] **Step 2: Run RED**

```text
pnpm vitest run tests/evaluation/m2-deepseek-p0-child.spec.ts
```

Expected: FAIL because child does not exist.

- [ ] **Step 3: Implement provider child without SDK dependency**

Use Node native `fetch`. POST non-streaming `/chat/completions`. Set `tool_choice: 'auto'` when tools exist. Validate response as closed enough for consumed fields; do not retain unknown response fields.

For every assistant tool-call turn:

1. emit each `tool_call` to runner;
2. collect corresponding `tool_result` lines;
3. append the assistant message including `reasoning_content` when present and exact provider tool-call ids;
4. append tool result messages;
5. issue the next Chat Completions request.

The child must never execute tools itself.

Provider metadata exposed to the runner must stay non-secret and bounded. If current v2 `ProcessProviderMetadata` requires model/backend observation fields to prove configured provider identity, update the evaluation-only type/schema/integrity atomically in this task with RED tests; do not hide drift in free-form metadata.

- [ ] **Step 4: Run GREEN + script static check**

```text
pnpm vitest run tests/evaluation/m2-deepseek-p0-child.spec.ts tests/evaluation/m2-agent-process-executor.spec.ts
pnpm run check:scripts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test(m2.3): add DeepSeek P0 provider child`

---

### Task 6: Explicit manual P0 command and canonical result writer

**Files:**
- Create: `scripts/run-m2-p0.mjs`
- Create: `tests/evaluation/m2-p0-command.spec.ts`
- Modify: `package.json` only if a reviewed explicit script entry is justified; otherwise document `node scripts/run-m2-p0.mjs` and keep package surface unchanged.

**Command behavior:**

```text
node scripts/run-m2-p0.mjs --output <path>
```

- [ ] **Step 1: Write RED command-boundary tests**

Prove the command refuses to start before any model process when:

- `--output` missing/invalid;
- API key missing;
- provider base/model/snapshot/thinking/reasoning configuration incomplete;
- output path already exists unless explicit `--overwrite-inconclusive` is used and the existing record status is `INCONCLUSIVE`;
- output target is inside the distributable `src/lib` boundary;
- H1 phase/config is requested.

It must print only non-secret frozen identities/configuration and the eventual result path/hash.

- [ ] **Step 2: Run RED and implement minimal command**

The command creates provider identity, calls `createFrozenP0Inputs()`, invokes `executeFrozenP0()` with current Node + `scripts/m2-deepseek-p0-child.mjs`, validates the result again, writes canonical JSON atomically, and prints status plus definition/result SHA-256.

No required CI workflow calls this command against the real API.

- [ ] **Step 3: Run command tests GREEN**

```text
pnpm vitest run tests/evaluation/m2-p0-command.spec.ts
pnpm run check:scripts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Commit: `test(m2.3): add explicit P0 calibration command`

---

### Task 7: Full offline verification, live-run readiness and governance sync

**Files:**
- Modify: `docs/evaluation/m2/agent-comparison.md`
- Modify: `docs/roadmap.md` only after infrastructure state changes materially
- Update GitHub Issue #43 / parent #34 / #28 through GitHub metadata/comments

- [ ] **Step 1: Run full repository gate**

```text
pnpm check
```

Expected: PASS with no new warnings/errors.

- [ ] **Step 2: Corrective full-diff review**

Confirm:

- no `src/**`, dependency/lockfile, production retrieval or required CI workflow drift;
- no provider secret/default secret value anywhere in diff/fixtures/log examples;
- no P0 oracle hint/success criteria reaches ModelEnvelope;
- B/C ordinary environment remains byte-identical;
- child cannot author tool/isolation/resource/retry evidence;
- model outcomes cannot be retried;
- provider alias/snapshot/backend observation cannot silently drift;
- result cannot be `CALIBRATED` with missing scheduled outcomes, unresolved required B/C evidence, unverifiable required token measurement, or failed v2 integrity.

- [ ] **Step 3: Exact-head GitHub CI**

Require all six normal CI jobs GREEN on the exact reviewed PR head before merge.

- [ ] **Step 4: Live P0 preflight**

Run only when a real `DEEPSEEK_API_KEY` and reviewed provider configuration are available. First execute a single non-scoring transport preflight task using the same child and runner; verify provider model/backend metadata, tool round-trip and redaction. This preflight result is not P0 outcome evidence.

- [ ] **Step 5: Execute actual 72-run P0**

Run the explicit command once under the frozen P0 configuration. Do not rerun model outcomes. Infrastructure retries occur only inside the frozen retry policy. Persist the full canonical result/evidence record.

- [ ] **Step 6: Validate and record exit state**

Re-run schema + `validateAgentV2ResultAgainstDefinition()` over the persisted result. Record:

- `CALIBRATED` only if all 72 scheduled runs resolve under P0 rules;
- otherwise `INCONCLUSIVE` with retained failure/UNKNOWN evidence.

Synchronize Issue #43 and parent #34/#28. Do not set H1 thresholds or commitment in the same unreviewed change.

- [ ] **Step 7: Merge infrastructure only when exact-head CI is green**

If live provider credentials are unavailable, merge the validated runner/provider infrastructure but keep #43 open with the final acceptance item unchecked. Never fabricate a P0 result to close the issue.
