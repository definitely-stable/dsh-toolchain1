# Staged Evaluation Control Plane Design

Status: **IMPLEMENTATION DESIGN**

Issue: #149

## Problem

M2 H1 completed its full 864-outcome schedule, but terminal adjudication was `INCONCLUSIVE`: 227 of 576 B/C decision observations were unresolved. The measurement problem was already visible in the earliest execution prefixes, yet the workflow had no health gate capable of stopping before the rest of the model budget was consumed. H1 also spent one third of its schedule on arm A even though the confirmatory decision was C-vs-B, and used three repetitions per task before proving that repetitions were needed for development feedback.

The next evaluation system must optimize for engineering feedback first and reserve publication-grade confirmatory experiments for rare, separately preregistered holdouts.

## Goals

1. Detect a broken evaluator or output contract before expensive model execution.
2. Make ordinary development evaluation roughly 20x cheaper than H1 by default.
3. Eliminate manual chunk loops for normal agent/Codex operation.
4. Separate measurement validity, engineering regression feedback, release confidence, and confirmatory research claims.
5. Preserve H1 unchanged as historical evidence and use its now-disclosed tasks only as a development corpus.
6. Make cost an explicit contract: every mode has a hard model-call budget and no implicit escalation.
7. Keep future H2 statistically clean by requiring a fresh hidden holdout after calibration is complete.

## Non-goals

- Re-running H1 or changing its frozen Truth, scorer, bootstrap, thresholds, schedule, or observed outcomes.
- Treating a 20-task development run as statistically equivalent to the preregistered 96-task H1.
- Changing production `contract.search` or `contract.inspect` behavior in this slice.
- Implementing sequential confirmatory inference for H2 before its design is preregistered.
- Adding an LLM judge where deterministic adjudication is possible.

## Evaluation lifecycle

The repository adopts five explicit evaluation modes.

| Mode | Purpose | Default tasks | Arms | Repetitions | Hard model-call cap | Claim strength |
| --- | --- | ---: | --- | ---: | ---: | --- |
| `deterministic` | tests, fixtures, evaluator self-test | 0 model tasks | none | 0 | 0 | implementation validity only |
| `canary` | prove measurement path is healthy | 8 | B/C | 1 | 16 | no product claim |
| `dev` | normal iteration / compare candidate vs baseline | 20 | B/C | 1 | 40 | engineering signal |
| `release` | pre-merge/pre-release regression gate | 32 | B/C | 1 | 64 | release confidence |
| `research` | larger non-confirmatory investigation | 48 | B/C | 1 | 96 | exploratory evidence |

A future confirmatory H2 is intentionally outside these modes. H2 must have its own preregistration and fresh hidden dataset.

### Why one repetition by default

Repetition is a tool for measured nondeterminism, not a default multiplier. Development modes start with one trial. A separate variance calibration may justify two or more repetitions for a specific benchmark, but increasing repetitions requires an explicit plan/budget change; the controller never silently multiplies calls.

### Why B/C only

The product decision under active development is ordinary exact-target tooling (B) versus B plus Contract Intelligence (C). Arm A remains useful for historical/research decomposition but is not part of the default engineering comparison and therefore is excluded from staged development budgets.

## Budget contract

Budget planning is deterministic and fail-closed.

Each mode defines:

- task count;
- arm count;
- repetitions;
- expected model calls;
- hard maximum model calls;
- optional token warning threshold.

The planner MUST reject:

- unknown modes;
- task/repetition overrides that exceed the selected mode's hard call cap;
- an attempt to use arm A in `canary`, `dev`, or `release` without selecting a separate research design;
- implicit mode escalation.

The normal operator path does not ask a human to choose chunk sizes. The selected mode is the budget.

## Measurement health gate

Quality of the measurement system is evaluated independently of product effect.

The first version freezes these development health thresholds:

- format/schema compliance >= 0.98;
- decision resolution >= 0.95;
- infrastructure failure rate <= 0.02;
- absolute B/C decision-resolution gap <= 0.05.

These are development/calibration controls, not post-hoc changes to H1. They govern whether staged evaluation may advance.

The health gate outputs `PASS` or `STOP` plus machine-readable reasons. A failed canary MUST prevent automatic escalation to `dev` or a more expensive mode.

### Definitions

`formatComplianceRate`
: fraction of model-outcome trials whose result satisfies the structured result contract required by the evaluator.

`decisionResolutionRate`
: fraction of scheduled B/C trials that produce a resolved decision observation.

`infrastructureFailureRate`
: infrastructure-failure attempts divided by all committed attempts represented in the health input.

`resolutionGap`
: absolute difference between B and C decision-resolution rates.

The gate also reports per-arm counts so missingness asymmetry is visible.

## Structured measurement boundary

H1 demonstrated that a free-text convention such as `API_CLAIM ...` is too fragile to serve as an implicit measurement transport.

The staged control plane therefore treats format compliance as a first-class health signal and prepares the next runner for a structured result sidecar. In this first implementation slice, the generic health schema already separates:

- `formatValid`;
- `decisionResolved`;
- `infrastructureFailures`;
- arm identity.

A future runner can populate those fields from provider-native structured output or a deterministic extractor without changing the health controller.

## H1 development corpus

The terminal H1 dataset is disclosed and no longer a holdout. It is archived in the repository as `docs/evaluation/m2/h1-dev-corpus-v1.json` with explicit `DEVELOPMENT_ONLY` status.

It may be used for:

- evaluator calibration;
- regression fixtures;
- targeted retrieval/tool-use experiments;
- failure-cluster reproduction.

It MUST NOT be used as the confirmatory H2 holdout or represented as unseen evidence after product tuning.

## Agent skill

`.agents/skills/dsh-eval/SKILL.md` becomes the canonical agent operator entrypoint.

The skill must:

1. inspect the requested change and choose the cheapest sufficient mode;
2. run deterministic checks before model calls;
3. call the budget planner and display the hard cap before execution;
4. execute canary before any newly introduced/changed measurement path is allowed to run a larger mode;
5. stop on health failure rather than consuming the remaining budget;
6. collect artifacts and summarize quality, cost, and failure clusters;
7. never claim dev/release results are confirmatory H2 evidence;
8. never re-run H1.

The skill is orchestration guidance. Budget and health decisions live in deterministic scripts so model interpretation cannot silently weaken them.

## Operator workflow

Normal change:

```text
change
  -> deterministic checks
  -> plan dev budget (40 calls max)
  -> run/consume dev evidence
  -> health gate
  -> compare candidate/baseline
  -> concise report
```

New evaluator/measurement behavior:

```text
measurement change
  -> deterministic self-test
  -> canary (16 calls max)
  -> health PASS?
       no -> STOP
       yes -> dev/release as explicitly requested
```

A larger research run is never an automatic consequence of a dev run.

## H2 boundary

H2 preparation begins only after the following are true on development/calibration data:

- structured measurement contract is stable;
- canary health passes repeatedly;
- deterministic end-to-end evaluator fixtures cover success/failure/format/infra paths;
- expected cost and token overhead are measured;
- task-selection and repetition policy are frozen without looking at the future H2 holdout.

Only then is a new hidden H2 dataset generated and committed by hash before provider execution. H2 may use a sequential design, but stopping boundaries must be preregistered before outcomes are observed.

## Evidence and reporting

Every staged evaluation report should distinguish three axes:

1. `measurementHealth` — can the result be interpreted?
2. `productSignal` — what did B vs C do on resolved development examples?
3. `cost` — calls, turns, wall time and token usage.

A green GitHub job means the workflow executed correctly. It does not imply that the product passed; a healthy negative result and a measurement STOP are both valid workflow outcomes and must be represented explicitly.

## Cleanup of H1 operations

The one-shot `.github/workflows/m2-h1-finalize-once.yml` served only to finalize completed H1 and dispatch its post-analysis. Once its terminal and post-analysis run IDs are recorded in durable documentation it is removed. The canonical H1 execution/terminal/post-analysis evidence remains unchanged.

## External practice alignment

This design intentionally mirrors current evaluation practice:

- start with small curated development datasets and expand from real failure cases;
- use repetitions only when nondeterminism warrants them;
- preserve sample-level logs and separate scoring from execution;
- use early stopping/sequential methods to avoid fixed-size compute waste, but preregister stopping rules for confirmatory experiments.

The design does not import an external eval framework. The existing repository already has strong evidence/provenance machinery; the missing capability is a lean control plane, not another dependency stack.
