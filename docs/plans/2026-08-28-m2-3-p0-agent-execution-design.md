# M2.3 P0 Agent-Executable Calibration Harness — Design

Status: **Design for Issue #36**

Parent: #34 / M2 milestone #28  
Base: `8f2bc74f952dc82fb6b79ff836959cca4b69433d` (PR #35 merged)  
Scope: evaluation/repository tooling only; no `src/**` or public Toolchain API change.

## 1. Problem

M2.3 already owns the frozen rc.2 target/index, R1 retrieval baseline, P0 dataset, H1 commitment barrier, JSON Schema, oracle, schedule semantics, retry rules and result-integrity validator. What is missing is an executable bridge between a scheduled task and an auditable model attempt.

A naive solution would add an OpenAI/Anthropic/provider SDK and build another agent framework. That is the wrong boundary for Toolchain. The experiment needs reproducible **execution evidence**, not ownership of model providers.

There is also an important asymmetry between P0 and H1:

- P0 is non-scoring harness calibration;
- H1 is the acceptance experiment that may decide M2.

An AI agent already working on this repository can do useful P0 work immediately. In particular, the current ChatGPT agent can consume a task packet, use allowed evidence/tools, produce a final answer and return structured evidence. But one long-lived conversational context cannot provide clean independent A/B/C measurements: facts seen in earlier turns can contaminate later arms, and an already informed agent cannot truthfully become a memory-only blank-slate arm A.

Therefore the design deliberately supports **interactive agent execution for mechanics calibration** while making that mode structurally incapable of qualifying as canonical P0 completion or H1 evidence.

## 2. Decision

Introduce an evaluation-only execution harness with a narrow data seam:

```text
frozen dataset + definition/schedule
              |
              v
          RunPacket
              |
       +------+------+
       |             |
interactive agent   isolated executor
(P0-I only)         (canonical P0/H1)
       |             |
       +------v------+
          Submission
              |
              v
 policy + identity + retry + schema validation
              |
       +------+------+
       |             |
P0-I diagnostic    canonical result
(non-comparative)  (existing eval schema)
```

The harness owns packet identity, schedule binding, arm capability policy, attempt accounting, tool-event normalization, raw final-answer hashing, result assembly and validation.

The executor owns only one operation: **given one packet and the capabilities the runner exposes, produce one final model outcome or one infrastructure failure**.

No provider SDK is part of this slice.

## 3. Two execution classes

### 3.1 `interactive-agent` — P0-I mechanics calibration

This class is designed specifically so a currently running AI agent such as ChatGPT can exercise the pipeline without an external model API.

Properties:

- may execute a selected P0 subset or the full P0 schedule;
- may use the current conversation/session as the model context;
- records executor/model/session descriptors as observed metadata;
- cannot prove context isolation between arms or trials;
- cannot prove the agent did not already know exact-target facts;
- therefore produces **diagnostic calibration evidence only**;
- MUST NOT produce the canonical P0 `CALIBRATED` result;
- MUST NOT be used to choose MCID from arm performance, claim C>B, satisfy H1 prerequisites or create an H1 result.

The intended first use is to let the current ChatGPT agent execute a real P0 subset and expose packet/tool/claim/retry/resource-accounting defects before adding automation.

### 3.2 `isolated-executor` — canonical P0/H1

This is the later automation seam. Each scheduled model outcome runs in an isolated model session/context owned by the executor adapter. The exact executor identity is frozen in the canonical experiment definition.

The harness does not require a particular provider. A future adapter may drive a provider API, Codex/OpenCode process, or another agent runtime, provided it satisfies the same packet/submission contract and arm isolation rules.

Canonical P0 completion and all H1 evidence require this class.

## 4. P0-I is not a second experiment

P0-I is a **runner calibration artifact**, not a new statistical arm or dataset. It uses tasks from frozen `agent-pilot-p0.json` but its output is intentionally outside `m2-agent-eval-v1` terminal result semantics.

This avoids two invalid states:

1. marking P0 `CALIBRATED` when the executor context was contaminated;
2. extending the public evaluation schema with a weak result status merely to accommodate an implementation convenience.

A P0-I artifact can say:

- packet generation works;
- C broker actually reached production `contract.search -> contract.inspect`;
- B/A tool-event policy is rejected when violated;
- claim extraction/oracle parsing can consume a real agent answer;
- timing/token/resource fields are present or reveal a gap;
- attempt/retry ledgers validate;
- the interactive path is not isolation-safe.

It cannot say which arm is better.

## 5. Repository boundary

Implementation remains outside production `src/**`:

```text
scripts/
  m2-agent-eval.mts                 # local prepare/record/finalize entry point

tests/evaluation/
  m2-agent-execution.ts             # pure packet/submission/policy logic
  m2-agent-execution.spec.ts        # behavioral tests
  m2-agent-tool-broker.ts           # test/evaluation broker using real kernel
  m2-agent-tool-broker.spec.ts

docs/evaluation/m2/
  p0-interactive-calibration-v1.json  # created only from actual execution
```

Exact filenames may be adjusted during planning to fit existing script/build conventions, but the boundary is fixed: no new production layer, no public npm export and no runtime dependency.

`package.json` may gain convenience scripts only if they invoke repository evaluation tooling and add no dependency.

## 6. RunPacket

A packet is the complete instruction unit for one scheduled attempt. It is generated deterministically from frozen inputs and is safe to hand to an executor.

Conceptual shape:

```ts
interface RunPacket {
  schema: 'dsh-toolchain-m2-run-packet-v1'
  packetSha256: string
  evaluationId: string
  phase: 'P0' | 'H1'
  executionClass: 'interactive-agent' | 'isolated-executor'
  schedule: {
    taskId: string
    arm: 'A' | 'B' | 'C'
    trial: 1 | 2 | 3
    attempt: number
  }
  target: {
    targetFingerprint: string
    contractIndexFingerprint: string
  }
  dataset: {
    id: 'P0' | 'H1'
    commitmentSha256: string
  }
  prompt: string
  capabilities: CapabilityPolicy
  resourceEnvelope: ResourceEnvelope
  retryPolicy: RetryPolicy
}
```

### Packet privacy rule

The packet MUST NOT contain:

- `oracleHints` from P0 dataset tasks;
- expected valid/invalid symbols;
- scoring labels;
- H1 oracle answers;
- R1 expected contract ids unless the task itself legitimately states them;
- hidden chain-of-thought instructions.

Tests compare generated packet JSON against the source dataset and fail if oracle-only keys or known answer fields leak into the executor payload.

### Packet identity

`packetSha256` covers the canonical packet projection excluding the hash field itself. It therefore binds:

- exact target/index;
- dataset commitment;
- schedule entry and attempt number;
- prompt;
- capability policy;
- resources/retries;
- execution class.

A submission for another packet cannot be replayed silently.

## 7. Capability policy

The policy is explicit rather than inferred from prompt prose.

### Arm A

```text
ordinary exact-target tools: none
toolchain: none
```

A submission with any tool event is invalid.

For `interactive-agent`, passing this check proves only that the recorded execution did not submit tool events. It does **not** prove the current model context was free of prior DSH knowledge; that limitation is why P0-I is non-comparative.

### Arm B

```text
ordinary exact-target read/search/docs: allowed
toolchain contract.search/inspect: forbidden
oracle/direct frozen-answer lookup: forbidden
```

The interactive path may use ordinary repository/exact-target evidence tools available to the agent, but every material evidence action is summarized in the submission.

### Arm C

```text
ordinary exact-target read/search/docs: allowed
toolchain contract.search: allowed
toolchain contract.inspect: allowed
all other Toolchain/model-facing contract tools: forbidden
oracle/direct frozen-answer lookup: forbidden
```

For C, the repository provides an evaluation broker that invokes the **real production kernel search/inspect implementation** over the exact frozen rc.2 fixture. It MUST NOT contain an alternate ranker, direct expected-answer table or evaluator-specific search implementation.

The broker is evaluation-only glue around the existing kernel, analogous to the real-kernel M2.3 search/inspect fixture already merged in PR #35.

## 8. AgentSubmission

The executor returns evidence, not reasoning traces.

Conceptual shape:

```ts
interface AgentSubmission {
  schema: 'dsh-toolchain-m2-agent-submission-v1'
  packetSha256: string
  executor: {
    class: 'interactive-agent' | 'isolated-executor'
    provider: string
    model: string
    snapshot: string
    sessionIsolation: 'shared' | 'isolated'
  }
  startedAt: string
  completedAt: string
  outcome: 'model-outcome' | 'infrastructure-failure'
  reason?: RetryableInfrastructureReason
  finalAnswer?: string
  finalAnswerSha256?: string
  toolEvents: ToolEvent[]
  usage: {
    inputTokens?: number
    outputTokens?: number
    turns?: number
  }
}
```

### No chain-of-thought persistence

The harness never requests or stores hidden/private reasoning. Persisted model evidence is limited to:

- final answer;
- content hash;
- bounded tool/action events;
- timestamps;
- resource counters when available;
- infrastructure failure reason.

If the executor exposes only approximate token accounting, the submission records that limitation explicitly in P0-I diagnostics rather than inventing precise values.

## 9. Tool events

Tool events are intentionally compact and auditable:

```ts
interface ToolEvent {
  sequence: number
  family: 'ordinary' | 'toolchain'
  name: string
  requestSha256: string
  responseSha256: string
  status: 'ok' | 'error'
}
```

Raw local file contents or huge search responses need not be duplicated in the result when a stable content hash plus bounded summary is sufficient. For C Toolchain events, the broker additionally records target/index fingerprint continuity so the run cannot claim use of the frozen Toolchain while actually querying another index.

Arm policy validation happens against event names/families before a submission can enter a canonical attempt ledger.

## 10. Interactive ChatGPT operating procedure

For P0-I the current ChatGPT agent is treated as an explicit executor, not as an invisible test oracle.

The harness prepares one packet at a time. The agent receives only the packet-safe prompt and the allowed capability instructions. It then:

1. performs only the tools/actions appropriate for the packet arm as far as the host can enforce them;
2. returns a concise final answer to the task;
3. supplies a structured submission with the final answer and observable tool-event metadata;
4. does not reveal or persist hidden reasoning;
5. never interprets the resulting P0-I records as arm performance evidence.

Because the current conversation already contains DSH project context, the executor descriptor MUST record `sessionIsolation: 'shared'`. Finalization of canonical P0/H1 rejects that value.

The first acceptance proof for Issue #36 is a small actual P0-I subset, chosen to exercise different mechanics rather than maximize score. Recommended subset:

- one positive exact API task;
- one negative/version-drift task;
- at least one C run that actually calls search then inspect;
- one deliberately malformed/disallowed submission generated by a test fixture, not by modifying the real run, to prove fail-closed policy.

The subset does not need 72 model outcomes because its purpose is execution-path calibration. Full canonical P0 later uses the frozen three-trial schedule.

## 11. Finalization rules

### P0-I finalization

Produces `p0-interactive-calibration-v1.json` with:

- exact target/index/dataset identities;
- execution-class identity;
- packet/submission hashes;
- which mechanics were exercised;
- validator outcomes;
- explicit `comparativeEvidence: false`;
- explicit `canonicalP0Complete: false`;
- unresolved harness limitations.

It MUST NOT contain PASS/NEEDS-IMPROVEMENT, MCID estimates or C-vs-B performance claims.

### Canonical P0/H1 finalization

Uses the existing `m2-agent-eval-v1` result schema and `validateAgentResultAgainstDefinition()` path from PR #35.

Before canonical result assembly, the execution harness additionally requires:

- every submission uses `isolated-executor`;
- `sessionIsolation === 'isolated'`;
- full frozen schedule coverage;
- packet hashes match the exact definition/schedule;
- arm tool policy validates;
- attempt counts obey the frozen retry policy.

No parallel acceptance implementation is introduced.

## 12. Retry semantics

The existing rule is preserved exactly:

- `maxInfrastructureRetries = N` means N retries **after** the initial attempt;
- maximum attempts per scheduled run = `1 + N`;
- only preregistered infrastructure reasons are retryable;
- model outcome is terminal and never retried;
- every failed infrastructure attempt remains in the ledger;
- exhaustion without a model outcome is `INCONCLUSIVE` for canonical evidence.

P0-I may deliberately exercise one synthetic infrastructure-failure fixture in tests, but real model outcomes are never rewritten to manufacture a retry case.

## 13. Oracle and claim extraction boundary

The executor never receives oracle labels. After a model outcome is recorded, the harness may apply the existing frozen oracle/claim parser to the final answer.

P0-I uses this only to prove parsing mechanics against real agent text. Its classifications are diagnostic and cannot drive M2 acceptance.

Canonical P0/H1 stores parsed claims and task-success classifications in the existing auditable result structure.

## 14. Security and privacy

- no credentials are committed;
- no `.env` or provider token handling is introduced in this slice;
- no hidden reasoning is persisted;
- tool payloads are bounded/content-addressed;
- interactive execution is explicitly not a security or context-isolation boundary;
- the evaluation broker is read-only over the frozen target/index fixture;
- no candidate plugin is executed;
- this work is separate from M4 verification worker security semantics.

## 15. Test strategy

TDD covers the behavior before implementation.

Required focused tests:

1. deterministic packet generation for the same frozen inputs;
2. packet hash sensitivity to target/index/task/arm/trial/attempt/policy changes;
3. no oracle-hint/answer leakage into packets;
4. arm A rejects any tool event;
5. arm B rejects Toolchain events;
6. arm C accepts only `contract.search`/`contract.inspect` Toolchain events;
7. interactive/shared submissions cannot enter canonical P0/H1 finalization;
8. isolated submissions can be lowered into the existing attempt/result validator;
9. packet replay/mismatched hash is rejected;
10. retry budget follows `1 + N` attempts and model outcomes remain terminal;
11. tool broker search/inspect uses existing production kernel and preserves target/index continuity;
12. P0-I diagnostic finalizer can record a real subset but cannot emit PASS/NEEDS-IMPROVEMENT/canonical-P0-complete state.

Repository-wide `pnpm check`, package/DSH smokes and platform matrix remain required before merge even though this slice does not change production runtime semantics.

## 16. Implementation sequence

After design approval:

1. write a detailed implementation plan under `docs/plans/`;
2. create deterministic packet/policy RED tests;
3. implement packet/submission core;
4. add canonical-finalization isolation gate and prove interactive rejection;
5. add the real-kernel C tool broker;
6. add local prepare/record/finalize command surface;
7. run an actual ChatGPT-driven P0-I subset and freeze the resulting diagnostic artifact;
8. review the measured harness gaps without changing frozen R1 or claiming P0/H1 performance;
9. full CI + corrective review + squash merge;
10. keep #34/#28 open; canonical isolated P0/H1 remains the milestone exit work.

## 17. Alternatives rejected

### Provider-specific API runner first

Rejected for this slice. It adds credentials, provider SDK/runtime behavior and a model-agent loop before we have proven the repository-side packet/evidence contract. It would also tie M2 methodology to one vendor unnecessarily.

### Treat the current ChatGPT conversation as valid A/B/C evidence

Rejected. Context contamination cannot be undone or audited strongly enough for comparative evidence.

### Skip P0 and run H1 directly with the interactive agent

Rejected. It violates the preregistered isolation/evidence intent and would turn H1 into an unverifiable demonstration.

### Build a generic orchestration/plugin framework

Rejected. The experiment needs one narrow executor seam. Generalization waits for a real second production use case.

## 18. Exit from Issue #36

Issue #36 is complete when the repository can prepare and validate agent-executable P0 packets, the current ChatGPT agent has exercised a real calibration subset through that path, the resulting artifact explicitly remains non-comparative/non-canonical, and all required CI is green.

This does **not** complete P0 in #34 and does not close M2. The next evidence step is an isolated executor adapter/full canonical P0 run, followed by frozen thresholds and H1 commitment.