# M2.3 Isolated Agent Execution Evidence — Design

Status: **Corrected design for Issue #36 / PR #37**

Parent: #34 / M2 milestone #28  
Base: `8f2bc74f952dc82fb6b79ff836959cca4b69433d` (PR #35 merged)  
Scope: evaluation/repository tooling only; no `src/**` or public Toolchain API change.

## 1. Problem

PR #35 froze deterministic M2.3 retrieval evidence and introduced the first agent-evaluation schema/integrity layer. What is still missing is a trustworthy execution boundary for P0/H1.

The execution harness must prove how a model run was conducted. The tested executor cannot be trusted to self-report its own tool use, isolation, timestamps, retry classification or resource compliance. Those facts must be produced by the evaluation runner and the brokers it controls.

The earlier draft also mixed runner-only experiment metadata with model-visible input. That creates evaluation-awareness and makes B/C comparability harder to audit. Finally, the historical `m2-agent-eval-v1` result cannot retain the richer execution evidence required by the new runner boundary.

## 2. Decision

Use one isolated, runner-owned evidence path for both canonical P0 and H1:

```text
frozen dataset + preregistered definition
                 |
                 v
            RunControl
          (runner only)
                 |
      +----------+----------+
      |                     |
CapabilityManifest      ModelEnvelope
      |                 (model visible)
      +----------+----------+
                 |
          isolated executor
                 |
          final model output
                 |
                 v
        trusted runner/brokers
        |       |        |
      Trace  Isolation  Resource
      Receipt   Receipt   Receipt
        \       |        /
         +------v-------+
        ExecutionEvidence
                 |
                 v
       m2-agent-eval-v2 result
```

The executor returns only the final model outcome plus provider-native completion metadata that the runner cannot observe directly. It does **not** provide authoritative tool events, isolation claims, attempt timestamps or resource-compliance claims.

No shared-context, conversational or interactive execution mode exists in the repository. Canonical P0 and H1 both require the same isolated runner/evidence boundary. P0 remains non-scoring; H1 remains the M2 acceptance experiment.

## 3. Trust boundary

### Runner-owned authoritative evidence

The runner is authoritative for:

- run start/end and attempt identity;
- tool calls and tool results routed through runner-owned brokers;
- request/response bytes or bounded canonical representations;
- retry classification and whether partial activity occurred;
- resource envelope enforcement and observed counters available to the runner;
- workspace/session/tool-state reset policy;
- isolation receipts;
- exact capability manifests exposed to the executor;
- exact model-visible envelope delivered for an attempt.

### Executor-owned output

The executor may return:

- final answer text;
- provider-native completion identifier/finish reason;
- provider-reported token/cost counters when the provider is the only source.

Provider-reported counters are observations, not proof of limits unless the configured policy explicitly treats that provider measurement as enforceable.

The harness never requests or persists hidden chain-of-thought.

## 4. RunControl and ModelEnvelope are separate

### RunControl

`RunControl` is runner-only and may contain:

```ts
interface RunControl {
  schema: 'dsh-toolchain-m2-run-control-v1'
  evaluationId: string
  phase: 'P0' | 'H1'
  taskId: string
  arm: 'A' | 'B' | 'C'
  trial: 1 | 2 | 3
  attempt: number
  targetFingerprint: string
  contractIndexFingerprint: string
  datasetCommitmentSha256: string
  capabilityManifestSha256: string
  resourcePolicySha256: string
  retryPolicySha256: string
  executorIdentitySha256: string
  modelEnvelopeSha256: string
}
```

`phase`, `arm`, `trial`, `attempt`, retry state, evaluation id and hidden commitments are never copied into model-visible input merely because they exist in control state.

### ModelEnvelope

`ModelEnvelope` is constructed by allowlist projection only:

```ts
interface ModelEnvelope {
  schema: 'dsh-toolchain-m2-model-envelope-v1'
  systemPrompt: string
  taskPrompt: string
  staticContext: readonly ContentRef[]
  tools: readonly ModelVisibleTool[]
}
```

Task projection starts from exactly the model-visible fields, for example `{ id, prompt }`; it never spreads a dataset task and deletes oracle fields afterwards. Future dataset metadata therefore cannot leak automatically.

Required invariants:

- the same task/arm has byte-identical `ModelEnvelope` across trials;
- infrastructure retry has the same `ModelEnvelope` as the original attempt;
- B and C share system prompt, task prompt, ordinary evidence and resource policy;
- C differs from B only by the two frozen Toolchain model-facing tool definitions.

## 5. CapabilityManifest

Boolean `ordinaryTools: true` is insufficient for a causal comparison. Each arm receives a content-addressed `CapabilityManifest` that freezes the actual environment surface.

It records at minimum:

- ordinary tool names and exact model-visible schemas;
- backend/adapter identity and version;
- allowed filesystem roots and read-only/reset policy;
- search behavior and result truncation policy;
- static documentation/content identity;
- network policy;
- model-visible Toolchain definitions when present.

Arm invariants:

- A has no ordinary exact-target tools and no Toolchain tools;
- B has the conventional exact-target manifest;
- C must equal B plus exactly the production Toolchain search and inspect definitions;
- no oracle/direct frozen-answer capability is exposed to any arm.

The validator compares normalized manifests, not prose descriptions.

## 6. Production-faithful Toolchain surface for C

C must receive the same model-facing Toolchain surface a real DSH agent receives.

The evaluation broker therefore builds C tools with the existing production factories:

- `createContractSearchToolDefinition()`;
- `createContractInspectToolDefinition()`.

This preserves the production tool names, descriptions, input JSON Schema, request parsers, limits, response DTOs and inspect stale semantics. The broker supplies frozen-target production-kernel resolvers behind those definitions. It must not call a benchmark-specific scorer or expose a cleaner internal API.

The runner records every broker request/result in the trace and includes target/index continuity evidence for Toolchain calls.

## 7. Content-addressed execution ledger

A hash is useful only when the referenced bytes remain auditable. The execution layer uses content references:

```ts
interface ContentRef {
  sha256: string
  mediaType: string
  canonicalization: string
  byteLength: number
  path?: string
  inline?: string
}
```

Exactly one retrievable representation is required for canonical evidence: a repository-relative/path-backed artifact or a bounded inline value. Validators recalculate the hash from the referenced bytes.

Tool trace entries contain content references for requests and responses rather than naked digests.

## 8. Runner-owned TraceReceipt

```ts
interface ToolTraceEntry {
  sequence: number
  family: 'ordinary' | 'toolchain'
  name: string
  startedAt: string
  completedAt: string
  status: 'ok' | 'error'
  request: ContentRef
  response: ContentRef
  targetFingerprint?: string
  contractIndexFingerprint?: string
}

interface TraceReceipt {
  schema: 'dsh-toolchain-m2-trace-v1'
  runControlSha256: string
  entries: readonly ToolTraceEntry[]
  traceSha256: string
}
```

Only the runner/broker can create authoritative trace entries. The executor has no field through which it can claim that a tool was or was not used.

Arm policy validation is performed against this runner-owned trace.

## 9. IsolationReceipt

Isolation is an operational receipt, not a string supplied by the executor.

```ts
interface IsolationReceipt {
  schema: 'dsh-toolchain-m2-isolation-v1'
  runControlSha256: string
  sessionIdSha256: string
  freshModelSession: true
  memoryCarryover: false
  workspaceMode: 'fresh' | 'read-only-reset'
  workspaceSnapshotSha256: string
  toolStateReset: true
  ordinaryEvidenceSha256: string
  mutableEnvironmentIdSha256: string
  parallelMutableStateShared: false
  retrySessionPolicy: 'fresh-session-per-attempt'
}
```

Canonical P0/H1 rejects an attempt if any required invariant cannot be proven by the runner.

Every task × arm × trial begins in a fresh model session. A retry also begins a fresh session and retains the failed attempt evidence.

## 10. ResourceReceipt

The definition separates the configured envelope from observed usage and enforcement:

```ts
interface ResourceReceipt {
  schema: 'dsh-toolchain-m2-resource-v1'
  runControlSha256: string
  configuredPolicySha256: string
  observed: {
    wallTimeMs: number
    turns: number
    attempts: number
    inputTokens?: number
    outputTokens?: number
  }
  measurement: {
    wallTime: 'runner'
    turns: 'runner'
    tokens: 'provider-reported' | 'runner' | 'unavailable'
  }
  compliance: 'compliant' | 'non-compliant' | 'unverifiable'
}
```

The runner always controls wall time, turns, attempts and concurrency. Token limits are enforceable only when the preregistered policy names a trustworthy measurement route. A required but unavailable measurement cannot silently become compliant.

## 11. Retry and partial-activity semantics

Existing `1 + N` infrastructure retry semantics remain.

Additional rules:

- retry eligibility is classified by the runner independently of answer quality;
- a partial generation or partial tool trajectory never disappears;
- the failed attempt keeps its complete trace/receipts;
- model outcome is terminal and never retried;
- retry uses a fresh model session and reset/fresh mutable environment;
- if the runner cannot distinguish an infrastructure failure from a model outcome without using answer quality, the evidence is not eligible for a favorable terminal decision.

## 12. `m2-agent-eval-v2`

`m2-agent-eval-v1` remains immutable historical infrastructure evidence from PR #35. It is not silently redefined.

All actual canonical P0/H1 execution after this correction uses `m2-agent-eval-v2`.

Each v2 model attempt carries an execution-evidence link:

```ts
interface ExecutionEvidenceRef {
  runControlSha256: string
  modelEnvelopeSha256: string
  traceSha256: string
  executorIdentitySha256: string
  isolationReceiptSha256: string
  resourceReceiptSha256: string
  rawAnswer: ContentRef
}
```

The v2 result keeps the existing valuable v1 invariants:

- exact definition hash;
- preregistration fields unchanged after unblinding;
- exact frozen schedule coverage/order;
- contiguous retry ledger;
- one terminal model outcome;
- `UNKNOWN` / `INCONCLUSIVE` semantics;
- task-level three-trial aggregation and paired bootstrap.

It adds the execution-evidence chain so a persisted canonical result remains self-auditing after pre-finalization state is gone.

## 13. Executor identity

Executor identity is runner configuration, not model self-report. It is content-addressed and records provider/runtime adapter, exact model/snapshot, reasoning configuration and adapter version required by the experiment definition.

The runner creates the identity before launching an attempt and binds it into `RunControl`.

## 14. P0 and H1

P0 and H1 use the same isolation, capability, tracing, resource and result-evidence machinery.

- P0 is public and non-scoring; it calibrates harness mechanics and ends as `CALIBRATED`.
- P0 may justify harness-only corrections before H1 commitment, with changes recorded and re-frozen.
- P0 results never contribute to the M2 primary endpoint.
- H1 remains hidden/committed and may start only after the existing holdout prerequisites are satisfied.

There is no alternate weak calibration result format and no non-isolated execution route.

## 15. Repository boundary

Implementation remains outside production `src/**` except that tests may import existing production tool-definition/kernel boundaries to prove fidelity.

Planned evaluation files:

```text
docs/evaluation/m2/
  m2-agent-eval-v2.schema.json

tests/evaluation/
  m2-agent-execution-evidence.ts
  m2-agent-execution-evidence.spec.ts
  m2-agent-eval-v2-integrity.ts
  m2-agent-eval-v2-integrity.spec.ts
  m2-agent-tool-broker.ts
  m2-agent-tool-broker.spec.ts
```

A later provider/process adapter may live under repository `scripts/` or another explicitly reviewed evaluation boundary. This PR does not add a provider SDK or execute H1.

## 16. Test strategy

Required TDD coverage:

1. model-task allowlist projection cannot leak new dataset/oracle keys;
2. RunControl and ModelEnvelope are distinct and independently hashed;
3. same task/arm across trials and retries yields identical ModelEnvelope;
4. B/C envelope difference is exactly the two Toolchain definitions;
5. CapabilityManifest proves C = B + exact Toolchain surface;
6. tool events cannot be supplied by executor output;
7. runner trace enforces A/B/C tool policy;
8. content references are hash-verifiable and retrievable;
9. IsolationReceipt rejects carry-over/shared mutable state/missing reset proof;
10. ResourceReceipt separates configured, observed and compliance state;
11. partial-activity infrastructure failure remains in the ledger before retry;
12. retry is `1 + N`, model outcomes remain terminal and retry uses a fresh isolation receipt;
13. C broker uses production DSH Toolchain definitions and real kernel resolvers;
14. v2 result binds all execution-evidence hashes and exact definition/schedule;
15. v1 remains accepted only as historical v1 data and is not treated as sufficient for newly executed canonical P0/H1;
16. required repository CI remains deterministic/offline.

## 17. Implementation sequence

1. replace the rejected draft trust model with this design and synchronize #36/#37;
2. commit a detailed TDD implementation plan;
3. add RED tests for RunControl/ModelEnvelope/capability manifests;
4. implement runner-owned trace/content/isolation/resource evidence;
5. add and validate `m2-agent-eval-v2` schema/integrity;
6. build the C broker from production Toolchain tool definitions;
7. add retry/partial-activity and evidence-chain tests;
8. update the frozen agent methodology to require v2 for actual P0/H1;
9. run full CI and corrective review;
10. merge only after exact-head CI is green; keep #34/#28 open because actual isolated P0/H1 execution remains exit evidence.

## 18. Non-goals

- testing M2 from an existing conversational context;
- any shared-context or interactive executor mode;
- executor self-report as proof of tool use/isolation/resources;
- provider-specific SDK integration in this slice;
- a generic agent orchestration framework;
- hidden reasoning persistence;
- retrieval tuning or R1 changes;
- H1 execution before its existing commitment barrier;
- production `src/**` behavior changes.