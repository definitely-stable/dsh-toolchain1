# H2 — confirmatory product benchmark (design and preregistration)

Status:

```text
H2 HARNESS READY FOR THE TWO TECHNICAL DRY RUNS
H2 SCORING BLOCKED: OBSERVATION ISOLATION NOT YET SOUND (see section 10)
H2 OUTCOME NOT YET AVAILABLE
```

This document designs and preregisters **H2**, a confirmatory product benchmark for DSH Toolchain.
It is written before any H2 provider outcome exists. No H2 result is asserted here, and none may be
written into this document until the frozen scoring run has actually completed.

H2 is a **new experiment**. It is not an H1 rerun, not a staged-development run, and not a retrieval
benchmark:

- H1 is immutable, permanently `INCONCLUSIVE`, and MUST NOT be rerun or relabelled.
- The disclosed H1 / dev-v1 / dev-v2 / R1 / R2 material is `DEVELOPMENT_ONLY`. None of it may become
  hidden H2 evidence, and no H2 task may be tuned with it.
- Staged evaluation remains the engineering control plane. H2 is the confirmatory product question.

## 1. Causal question

> Does installing the production DSH Toolchain into a real DeepSeek Harness agent make that agent
> more successful at real DSH plugin development tasks, and at what cost in tokens, time, and tool
> calls?

The primary endpoint is **real developer-task success**, decided by an independent deterministic
oracle over the modified workspace — not by the model's final answer and not by any API-claim
adjudication.

## 2. Arms and the causal boundary

Both arms run a real DSH agent through the automation-only `acp` profile, with the same model,
prompt, workspace, permissions, resources, and task order.

| Arm | Composition |
| --- | --- |
| **B** (baseline) | unmodified DSH `acp` profile |
| **C** (treatment) | exactly B **plus** the production DSH Toolchain bundle |

The production Toolchain is the real shipped surface: the packed `dsh-toolchain` artifact installed
profile-scoped with upstream `dsh plugin add`, contributing its one bundle patch row
(`id: dsh-toolchain`, `name: dsh-toolchain/dsh`). That row is the whole difference; C therefore
receives the production capabilities a user gets after installation (target resolve, Contract
Search, Contract Inspect, plugin check, plugin verify) with no evaluation-only additions.

`C = B + DSH Toolchain` is proven twice, programmatically:

1. structurally, by `assertBcParity` over the two arm compositions
   (`scripts/eval/h2/h2-composition.mjs`), which rejects any extra plugin, patch, bundle, or
   profile change;
2. empirically, by `assertDumpParity` over the two real `dsh --dump-config` outputs, which requires
   Arm B to contain no Toolchain row and Arm C to add exactly one row — the Toolchain's. The dry
   run calls `runCompositionParityProbe` before its first model call and records the verified
   delta in the dry-run receipt; scoring refuses to start from a receipt without it.

Both arms additionally carry one identical profile-layer setting: session-log compression is
disabled (`session-persistence-jsonl` keeps its `root` and sets `compression: 'none'`). It adds,
removes, and renames no plugin, bundle, or row, and it exists because the frozen completion budget
and every token metric are read from the append-only session log, which this train writes as
multi-frame zstd (`session.v3.jsonl.zstd`) that Node cannot decode in one call. The setting is
written into each observation's fresh home by `writeTelemetryOverlay`, identically in both arms,
so the causal difference remains exactly the Toolchain bundle.

Toolchain usage is **measured behaviour, not a success condition**. Arm C is never instructed to
call a Toolchain tool, and no H2-only intelligence API exists.

## 3. Budget (frozen)

| Item | Count |
| --- | ---: |
| Hidden developer tasks | **18** |
| Arms per task | **2** |
| Scoring observations | **36** |
| Technical dry-run observations | **2** (one B, one C) |
| Hard maximum agent observations | **38** |

The budget is frozen in `scripts/eval/h2/h2-config.mjs` (`H2_POLICY`) and enforced by
`assertH2PolicyIntegrity()`, by the schedule builder, and by the CLI. It does not grow.

### Task strata (6 × 3)

| Stratum | Focus |
| --- | --- |
| `exact-target-api` | a wrong or non-existent DSH/Cordis API is replaced by the correct one |
| `cordis-service` | service registration, injection declaration, fibre-owned lifecycle |
| `agent-tool` | Agent Tool registration, schema strictness, naming, result rendering |
| `plugin-composition` | package manifest bundle patch and composition patch rows |
| `compatibility-debug` | peer range, engine range, forbidden host-runtime import |
| `runtime-verification` | service visibility, tool visibility, `apply` contract |

Every task requires a real change to a plugin workspace (an installable package with a
`cordis.patch.yml` bundle row), not a text answer.

## 4. Technical dry-run (non-scoring)

Before scoring, exactly **two** technical observations run on one **public calibration task**
(`docs/evaluation/h2/calibration/`) that is not part of H2 and never enters any statistic:

```text
Dry #1 = Arm B
Dry #2 = Arm C
```

They exercise the whole path — controller → fresh `DSH_HOME` → real DSH `acp` profile → official
DeepSeek provider → DeepSeek V4.1 Flash → Agent tools → workspace modification → independent
grader (static + build + real DSH compose/boot) → telemetry → cleanup — and they prove the
production Toolchain is actually reachable in Arm C.

Both receipts are permanently:

```text
TECHNICAL_ONLY
NON_SCORING
```

If a dry run discovers a harness, provider, DSH, model, or tool-wiring defect, **scoring does not
start**. A technical rerun is never automatic: it requires the explicit
`--confirm-technical-rerun` flag and produces a new sealed receipt. A harness-only fix made before
scoring requires a new preregistration receipt; it does not change the experiment's semantics.

## 5. Execution route: the real DSH `acp` profile

H2 does **not** simulate DSH and does not use a custom OpenAI client. Each observation drives a real
DeepSeek Harness agent:

```text
H2 controller (scripts/eval/h2)
    → real DSH launcher: pnpm --dir <harness checkout> dsh --profile acp
    → real DSH Agent/session runtime (Agent Client Protocol v1 over NDJSON stdio)
    → the frozen provider route (section 6)
    → model deepseek-v4.1-flash (DeepSeek V4.1 Flash)
```

The ACP stdio surface was chosen over the alternatives because it is DSH's documented
automation-only programmatic interface: it creates persistent sessions with an explicit absolute
workspace, exposes per-session `model` and `reasoning_effort` configuration options, streams
committed updates and tool lifecycle events, auto-answerable permission requests, and explicit
terminal stop reasons. It needs no browser UI, no in-process coupling to harness internals, and it
keeps the benchmark outside the product's own code paths. The `headless` one-shot profile and
in-process driver APIs were rejected: they offer no per-session configuration pinning, no update
stream for live budget enforcement, and no stable stop-reason contract.

No browser UI is used anywhere in H2.

## 6. Model identity (frozen)

```text
provider          = opencode-go             (OpenCode Zen relay)
model             = deepseek-v4.1-flash     (DeepSeek V4.1 Flash)
reasoningEffort   = high                    (pinned explicitly)
credentialRef     = OPENCODE_GO_API_KEY     (a reference, never a key)
session header    = x-opencode-session      (one opaque value per observation)
```

Both arms use exactly this configuration, pinned per session through
`session/set_config_option`. That option is a select whose value is the JSON pair
`["<provider>","<model>"]`, and the controller refuses to start an observation unless the target
itself advertises that exact pair. Telemetry records the requested provider/model/effort and the
response model observed in the session log, per completion. The route exposes no
`systemFingerprint`/`revision` field, so those receipt fields are explicit `null` rather than
invented values.

**Identity drift is fail-closed.** If any observation's observed model identity differs from the
frozen policy, or drifts mid-run, the run **STOPs** immediately with `MODEL_IDENTITY_DRIFT` and
spends no further budget; the observations already collected are retained but never analysed as
confirmatory evidence.

### 6.1 Amendment before any outcome (2026-09-16)

This route replaced the originally preregistered `deepseek-official` / `deepseek-flash` **before any
observation of any kind existed**, under the standing rule that a preregistration may be amended
while the record is still empty and never afterwards. The amendment was forced by evidence, not
preference:

- this machine holds **no** credential for the official adapter — neither in the environment nor in
  the operator credential document (`refs` contains `OPENCODE_GO_API_KEY` and `OPENCODE_API_KEY`
  only) — so the originally frozen route could not have produced a single observation, and no
  amount of harness correctness would have changed that;
- the environment's own DSH session runs DeepSeek V4.1 Flash through `opencode-go`, so the amended
  route is the same model the operator actually uses, not a substitute for it.

What the amendment does **not** touch is the comparison. The route is a controlled constant: the
same provider, model, effort, credential reference, and per-observation header value are written
into both arms' observation homes, so the causal boundary stays exactly "Arm C = Arm B + the
Toolchain bundle" (section 2).

Two consequences are recorded rather than hidden. First, the numeric results of this benchmark are
conditional on the OpenCode Zen relay's serving of `deepseek-v4.1-flash`, which is not the official
DeepSeek endpoint; the frozen receipt binds the exact route so no later reader has to guess what was
measured. Second, the relay rejects a request that carries no `x-opencode-session` routing header
with `400 MissingSessionID`. The operator's own DSH supplies that header through a third-party
plugin; for the benchmark it is written as **route configuration** in each observation home
instead, with one opaque value per observation, so no two observations share a relay backend and
neither arm can warm the other's prompt cache.

### 6.2 Where the route is written, and why it must be written at all

A fresh observation home starts from the shipped `acp` profile, which registers exactly one
provider route and contains no credential. The harness therefore writes, before the profile's first
boot, a profile patch layer (`profiles/acp/cordis.patch.yml` — DSH's documented per-profile
customization seam, applied after every bundle layer) carrying:

1. the session-persistence overlay that disables log compression, without which the frozen
   completion budget cannot be read from the append-only session log and is therefore
   unenforceable;
2. the `llm-pi-ai` row naming the frozen provider, its credential reference, and its routing
   header;
3. the `agent-default-model` row pinning provider, model, and effort.

The observation home is also given the operator's credential **document** (copied, never parsed and
never printed by the controller), because DSH resolves a credential reference from the inherited
environment first and from `$DSH_HOME/.credentials.yaml` second — and a fresh home inherits the
environment but not the operator home. The home is disposable: the scratch cleanup removes it after
the observation.

Both the patch entries and the credential material are identical in both arms, so neither is part
of the C-minus-B difference. The composition-parity probe composes both arms with this same patch,
so the empirical parity proof describes the composition that actually runs.

## 7. Exact DSH target

One exact target for the whole benchmark:

```text
@deepseek-ai/dsh@0.1.5-rc.2   (the train the local harness checkout is built from)
profile: acp
```

`h2:validate` resolves the actual runtime version and fails closed if it differs from the frozen
train; `h2:freeze` records the target fingerprint (train + root version + runtime version +
profile) in the preregistration receipt. DSH versions are never mixed inside one benchmark.
Historical H1/rc.2 evidence is not reused, and no later train is retro-fitted into this experiment.

## 8. Hidden dataset and public commitment

```text
private h2-dataset-v1                (never committed; default .artifacts/h2-dataset-v1)
    ├── prompts/<taskId>.md          hidden prompt
    ├── workspaces/<taskId>/         hidden initial (defective) workspace
    ├── reference-fixes/<taskId>/    hidden reference solution
    ├── graders/<taskId>.mjs         hidden deterministic grader descriptor
    └── manifest.json                per-artifact SHA-256
             ↓ SHA-256 (canonical, over task id + stratum + all four artifact hashes)
public docs/evaluation/h2/h2-commitment-v1.json
```

Public: schema version, task count (18), strata (6 × 3), per-task `[taskId, stratum, taskDigest]`,
the dataset SHA-256, and the calibration SHA-256. Never public: prompts, initial workspaces,
reference fixes, or grader bodies.

The loader fails closed on any mismatch: a tampered workspace, prompt, reference fix, or grader —
or a changed dataset commitment — aborts before any model token is spent. Task ids that appear in
any disclosed evaluation corpus are rejected outright, so no H1/development task can be recycled
as hidden H2 evidence.

## 9. Independent end-to-end oracle

Success is decided **after** the agent stops, from the modified workspace only:

```text
modified workspace
    ↓
static checks (task-specific, declarative)
    ↓
build checks (node --check, optional tsc)
    ↓
exact DSH composition (pnpm pack → dsh plugin add → dsh --dump-config)
    ↓
exact DSH boot + task-specific runtime assertions
       (H2-owned probe: declared Host Services resolvable, declared Agent Tools visible)
    ↓
PASS / FAIL
```

Graders guarantee:

- deterministic: no clock, no randomness, no network, no model, no LLM judging;
- independent: it never consults DSH Toolchain, so Arm C has no oracle advantage;
- not model-trusting: the agent's prose is never evidence;
- fail-closed: a declared check without an implementation throws instead of passing;
- per-subject: a graded subject is keyed by its content digest, and its packed tarball
  (`graded-subject-<key>.tgz`) and every disposable home (`compose-home-`, `runtime-home-`,
  `grader-probe-`, each suffixed `<key>-<attempt>`) are namespaced by that key. Installing a second
  subject into a home that already holds one leaves the first install in place, so without this a
  second grade would boot the first subject's code — which is what dataset admission is for;
- stabilized without weakening: each real-DSH check may retry once against a fresh disposable
  home (oracle infrastructure stabilization, never an agent retry — the agent resource policy
  stays one attempt, zero retries), and `h2:author-check --stability N` re-runs a task's grader N
  times and requires identical verdicts before admission;
- hidden graders are declarative descriptors; an independence guard rejects any grader source
  containing import/require syntax, `fetch`, process spawning, model references, or Toolchain
  references.

Two real-DSH proof levels are used, chosen per task by what the task actually changes:

| Level | Mechanism | Used by |
| --- | --- | --- |
| composition | `pnpm pack` → `dsh plugin --profile add` → `dsh --dump-config` row mount in a disposable home | plugin-composition, agent-tool, some exact-target-api / compatibility tasks |
| runtime | exact DSH boot of the disposable composition + H2-owned probe asserting declared Host Services are resolvable | cordis-service, runtime-verification, some exact-target-api tasks |

**Recorded harness limitation:** Agent-Tool *runtime* visibility assertions are not used. On the
installed DSH train a verifier-owned Agent cannot be created from a probe fibre on the `web`
profile — `@deepseek-ai/dsh-agent-loop` `prepare()` asserts an active owner fibre
(`ownerCtx.fiber.assertActive()`) and rejects the call during boot settlement; the repository's own
M4.3.2 record documents the same seam constraint for the current trains. Agent-Tool tasks are
therefore graded by real composition mount plus static assertions on the DSH-native tool
definition (name, `parameters` strictness, `output.render`, `execute` result contract). This is
recorded rather than papered over: it is a limitation of the oracle, not a claim that tool
visibility was proven at runtime.

Dataset admission (implemented as `h2:author-check`, run before freeze):

```text
initial workspace  → FAIL
reference solution → PASS
```

Any task that does not satisfy both is inadmissible and cannot enter H2.

## 10. Isolation

Each observation gets a completely fresh environment:

```text
.artifacts/h2/<run>/<task>/<arm>/
    dsh-home/     fresh DSH_HOME (never the operator's ~/.dsh)
    workspace/    fresh initial workspace, digest-verified against the commitment
    scratch/      disposable composition/boot homes (removed by the cleanup policy)
    receipts/     sanitized observation receipt
```

Fresh session, no memory carry-over, no user plugins, no previous conversations, no shared mutable
Toolchain state, identical network permissions in both arms. The controller refuses any DSH home
that aliases real user state, and the heavyweight DSH home/scratch are deleted after telemetry is
extracted, while the workspace and receipts are retained for audit.

The target train's filesystem sandbox fences writes but **not reads**: any path an agent can name,
it can read. Isolation therefore rests on the absence of reachable plaintext, not on a boundary,
and the following are preconditions of a scored observation:

- the private corpus root (`H2_DATASET_DIR`, or `--dataset`) must lie outside the checkout,
  outside every ancestor of it, and outside the operator home and the temp directory, and no
  in-repo copy of the corpus may exist. `h2:run` fails closed otherwise, because the hidden task
  id is part of the agent's own working path;
- every `H2_*` variable is stripped from the agent's environment and from every DSH subprocess, so
  the corpus path is never disclosed to the agent;
- the frozen permission policy is `reject`, so the write fence cannot be escaped through a
  `sandbox_permissions` escalation request, and `DSH_PERMISSION_MODE` is pinned to
  `workspace-write` rather than inherited from the operator shell. Denying costs a task nothing
  (in-workspace work needs no permission) and is identical in both arms.

**Recorded blocker.** Scoring is currently refused by `assertObservationIsolation()`. With
`cleanup: 'scratch'` the first arm's graded workspace and its receipt survive on disk, one
directory above the second arm's working directory, and `ledger.json` is written incrementally
with per-observation success flags; the schedule is recomputable from public data, so those
readable bytes couple the paired arms and the McNemar test would consume that coupling. Removing
the leak requires deferred retention (capture in memory, delete the live tree at the end of each
observation, flush retained evidence only when the run reaches a terminal state). The two
technical dry runs are unaffected: they use the public calibration task, and no hidden material
exists for them to leak. Until that work lands, `h2:run` exits before spending anything.

## 11. Resource policy (frozen)

```text
attempts per observation        = 1
quality retries                 = 0
infrastructure retries          = 0
reasoningEffort                 = high
provider completions per run    ≤ 6
wall clock per observation      ≤ 180 s
```

`providerCompletions` is counted from the authoritative append-only session log
(`$DSH_HOME/sessions/...`), whose per-completion usage records are also the token source; the ACP
update stream is used as the live early-warning signal. Identical limits apply to both arms and are
frozen before scoring.

**Budget exhaustion is a product outcome, not an infrastructure failure:** the observation is
graded, terminal reason is `RESOURCE_EXHAUSTED`, and task success is **0**. The completion budget
was provisionally fixed at 6 before the dry runs (inside the approved 6–8 range); if a dry run
shows it is unusable it may be re-frozen **before** scoring, and the preregistration receipt
records the frozen value. It is never raised after scoring outcomes exist.

## 12. Schedule (frozen)

18 task pairs, one observation per arm per task, one repetition. Task order is pseudo-randomized
from the frozen seed `h2-product-benchmark-v1-schedule`; the first nine tasks run **B → C** and the
last nine **C → B**. The schedule hash is part of the preregistration receipt, is written before
the first scoring outcome, and is never re-rolled or reordered afterwards.

## 13. Statistics (frozen)

Analysis unit = task pair. For each task, `B success ∈ {0,1}` and `C success ∈ {0,1}`.

Primary effect: `Δ = SuccessRate(C) − SuccessRate(B)`.

Confirmatory test: **exact paired McNemar, one-sided, α = 0.05**, computed exactly from the
discordant counts `cOnly`/`bOnly` as the upper tail of `Bin(cOnly + bOnly, 0.5)` with exact integer
arithmetic (no floating-point fuzz; `5/0 → p = 0.03125`, `4/0 → p = 0.0625`).

Practical minimum effect (MCID): **≥ 2/18 = 11.11 percentage points**.

```text
CONFIRMED_BENEFIT  ⇔  C success > B success
                      AND Δ ≥ 2/18
                      AND one-sided exact McNemar p ≤ 0.05
```

With 18 pairs this is deliberately conservative: a moderate positive effect (for example four
C-only wins against zero B-only wins, `p = 0.0625`) lands in `INCONCLUSIVE`. That is the
preregistered outcome, and a non-significant result is **never** reported as proof that the
Toolchain is useless.

Secondary endpoints are reported jointly with success and are never collapsed into a composite
score: input/output/total/cached tokens, provider completions, wall time, agent steps, total tool
calls, ordinary search/read calls, Toolchain calls, per-tool counts, and budget exhaustion per arm.

## 14. Cost telemetry per observation

```text
taskId, arm, stratum, attempt
success, terminalReason, budgetExhausted, identityDrift
grader: status + per-check status
model identity: provider, requestModel, responseModel, reasoningEffort,
                systemFingerprint (null), revision (null)
usage: inputTokens, outputTokens, totalTokens, cachedInputTokens,
       cacheWriteTokens, reasoningTokens, providerCompletions
timing: wallTimeMs, agentSteps, turns
tools: totalToolCalls, ordinaryToolCalls, toolchainToolCalls, perTool, acpObservedToolCalls
workspace: digestBefore, digestAfter
acp: stopReason, usageUpdates
```

Never stored: chain-of-thought, hidden reasoning, raw prompts, model prose, raw tool
arguments/results, workspace contents in receipts, credentials, API keys, or provider secrets.
Every receipt passes a structural sanitizer that rejects forbidden fields, secret-shaped values,
and oversized strings before it can be written. Chain-of-thought never leaves the DSH session log,
which stays inside the observation's disposable home.

## 15. Outcome states and stopping policy

| State | Meaning |
| --- | --- |
| `CONFIRMED_BENEFIT` | all 36 observations resolved and the preregistered rule is met |
| `INCONCLUSIVE` | all 36 resolved; the confirmatory threshold is not met |
| `STOPPED_INVALID` | any observation unresolved (infrastructure failure, cancellation, identity drift, missing pair) — **no confirmatory estimate is computed** |

A `STOPPED_INVALID` run stops spending immediately and is not "continued later" with a different
rule. The canonical result is the first valid committed scoring run.

## 16. Operator surface

```bash
pnpm h2:validate            # 0 model tokens: environment, target, dataset, grader independence,
                            #               B/C parity, model config, schedule, commitment
pnpm h2:validate --public-only   # 0 tokens, corpus-free (used by CI)
pnpm h2:corpus-build        # authoring: build the private corpus manifest (0 tokens)
pnpm h2:commitment          # authoring: publish the public commitment record (0 tokens)
pnpm h2:author-check        # 0 tokens: initial FAIL / reference PASS for every task
pnpm h2:freeze              # 0 tokens: immutable preregistration receipt
pnpm h2:dry-run             # exactly 2 non-scoring technical observations
pnpm h2:run                 # exactly 36 scoring observations (requires --confirm-scoring)
pnpm h2:finalize            # 0 tokens: statistics and product report
```

`h2:run` refuses to start without a valid frozen preregistration receipt, a passing technical
dry-run receipt for the same candidate/dataset/target, and an exact candidate match — and it stops
immediately on infrastructure failure or model identity drift.

## 17. Candidate freeze

The preregistration receipt binds, before any scoring outcome: the Git commit SHA, the packed npm
artifact SHA-256, the Toolchain package identity, the exact DSH train and target fingerprint, the
dataset commitment, the provider/model configuration, the resource policy, the schedule hash, and
the statistical policy hash.

After the first scoring observation the candidate is frozen: a product fix becomes a new
experiment version, not a continuation of this one. Benchmark overfitting is explicitly forbidden —
no manual Toolchain runs on scoring tasks, no ranking/search tuning on them, no product change
after partial results, no peeking at intermediate B/C aggregates, and no stopping because the
result is liked or disliked.

## 18. CI boundary

GitHub CI performs **deterministic validation only**: unit tests, corpus-commitment validation,
schedule immutability, B/C parity, resource policy, statistics, grader mechanics, receipt
sanitization, and package/build/lint/typecheck. There is no cron for H2 and no DeepSeek API call on
push or pull request. Scoring runs only manually, locally, on the operator's machine.

## 19. Implementation map

```text
scripts/eval/h2/
    h2-config.mjs        frozen policy constants and integrity gate
    h2-util.mjs          canonical JSON, SHA-256, directory digests
    h2-commitment.mjs    task digests, dataset commitment, public record
    h2-corpus.mjs        private corpus loader (fail-closed) and manifest builder
    h2-schedule.mjs      seeded 36-entry schedule, arm-order balance
    h2-composition.mjs   arm compositions, structural + dump-config parity
    h2-workspace.mjs     per-observation isolation, workspace materialization, cleanup
    h2-dsh.mjs           ACP v1 control plane, budget guard, terminal classification
    h2-dsh-env.mjs       real DSH runtime IO, disposable profiles, grader boot probe
    h2-telemetry.mjs     session-log metrics, sanitized receipts, identity drift
    h2-grader.mjs        deterministic grader engine and admission check
    h2-statistics.mjs    exact paired McNemar and the decision rule
    h2-receipts.mjs      preregistration and technical dry-run receipts
    h2-report.mjs        terminal product report (primary + secondary + measurement)
    h2-runner.mjs        one real observation end to end
    h2-cli.mjs           operator surface
```

Tests live in `tests/evaluation/h2-*.spec.ts`; the public calibration task lives in
`docs/evaluation/h2/calibration/`.

## 20. Pre-freeze harness notes

No H2 provider outcome exists, so nothing below changes an experimental result: these are harness
and corpus corrections made while the benchmark was still being commissioned, recorded here so a
future reader does not have to reconstruct them from the Git history. The design (budget, strata,
schedule, statistics, model identity, resource policy, outcome rule) is untouched.

**Defects found and fixed before any scoring observation:**

1. **A grade could be decided against the wrong subject.** The grader's packed subject tarball was
   cached per grader-IO instance, and the corpus admission check grades the initial workspace and
   then the reference fix through one instance and one directory. The reference grade therefore
   installed the *initial* subject's tarball, and because re-installing the same `file:`
   dependency into an already-populated home is a no-op, it booted the initial workspace's code.
   Both false FAILs and false PASSes resulted. Fixed by content-keying the subject and every
   disposable home (section 9); a regression test fails on the old behaviour.
2. **The telemetry plane could not be read, silently.** The frozen train writes
   `session.v3.jsonl.zstd` (one zstd frame per append) and Node returns only the first frame from
   a single decode, so the completion budget would never have been enforced and scoring would have
   stopped after its first observation with a *model-identity drift* label. Fixed by disabling log
   compression through an identical profile-layer setting in both arms, anchoring log discovery to
   the session id parsed from the header (a subagent child's log names its parent, so a substring
   match could report a child's usage as the parent's), and making an unreadable telemetry plane a
   loud `INFRASTRUCTURE_FAILURE` instead of a drift finding.
3. **The empirical half of the causal-boundary proof was dead code.** `assertDumpParity` had no
   caller, so only the structural, self-referential parity check ran. It is now executed against
   two real compositions before the dry run spends anything, and the verified row delta is sealed
   into the dry-run receipt, which scoring re-checks.
4. **Dataset admission was a log, not a gate.** A `--tasks` subset run could overwrite the
   admission artifact with `allAdmissible: true` for one task. The artifact now records the dataset
   commitment and the checked task ids, and `h2:validate`/`h2:freeze` refuse to proceed unless it
   covers all 18 tasks of the current commitment.
5. **Budget and stopping edges.** The frozen completion limit is now reconciled against the
   authoritative log after the agent stops (an observation that consumed more than the limit is
   budget-exhausted, never a success), the wall-clock limit is a hard bound that cancels and then
   abandons a stuck turn rather than a request only, and each scoring run gets a unique run id so
   `finalize` cannot assemble one report from two runs.
6. **Composition rows were matched by substring.** A row `subject-extra` could satisfy an expected
   row `subject`. Rows are now matched structurally as exact id/name pairs.
7. **The model-backed path had never actually been executed, and could not have run.** A first real
   attempt to drive one ACP observation on this machine exposed four independent defects, every one
   of them on the path that only a *paid* observation exercises — which is why 600 green unit tests
   and a green CI did not see them:
   - **The launcher could not be spawned on Windows.** `spawn('pnpm', …)` fails with `ENOENT`
     because `pnpm` is a `.cmd` shim there, and `spawn('pnpm.cmd', …)` fails with `EINVAL` because
     Node refuses to spawn a batch file without a shell. The transport now goes through the
     platform shell on Windows and quotes arguments itself, since `shell: true` concatenates them
     unescaped.
   - **A launcher that died left the controller waiting forever.** The transport's `send` could
     write into a process that had already exited, and nothing rejected the pending JSON-RPC
     request, so a spawn failure presented as an indefinite hang instead of an error. The control
     plane now rejects every pending request when the transport exits.
   - **The model was pinned in the wrong shape.** The ACP `model` option is a select whose value is
     the JSON pair `["<provider>","<model>"]`; the controller sent the bare model id and the target
     answered `unknown model option`, with no fallback to its default model. The controller now
     derives that value from the frozen policy and refuses to spend anything unless the target
     advertises the exact pair.
   - **The observation home had no route and no credential.** A fresh home boots the shipped `acp`
     profile, which registers one provider route and reads no credential; a `settings.yaml` section
     does not register routes there (verified twice, against a control case). The route is now
     written into the profile patch layer and the credential document is copied into the home — see
     sections 6.1 and 6.2.
8. **Request identity was read from the wrong field, so every real observation would have been
   reported as model-identity drift.** In the frozen train the log record is
   `request/header { header: { config: { provider, model, reasoningEffort } } }`, and the parser read
   `data.config`. It therefore collected no request identity at all, and `assertModelIdentityMatches`
   — correctly failing closed on an empty identity set — would have labelled the first paid
   observation `MODEL_IDENTITY_DRIFT`, blaming the model for a harness bug and stopping the run.
   Verified against a real session log on this machine and fixed, with a regression test that keeps
   the old wrong nesting invisible rather than tolerated.
9. **The readiness gate asserted a variable name instead of a capability.** `h2:validate` reported
   `ready: false` whenever `DEEPSEEK_API_KEY` was absent — a hard-coded deployment assumption about
   one provider route, which said nothing about whether the frozen route could actually run. It now
   reports the frozen route and *which authority* can resolve its credential reference
   (environment or operator credential document), and the model-backed commands resolve the same
   way instead of requiring one specific variable.

**Corpus re-authoring (before the commitment was published).** Dataset admission rejected two of
the original 18 tasks, and its own record was right: their reference solutions declared
`inject = ['logger']`, but in this train `ctx.logger` is a context capability of the Cordis
runtime and not an injectable service, so the declaration could never be satisfied — the plugin
stayed pending and the composition failed to activate (`pending (waiting for service: logger)`).
The initial workspaces were equally unsound, since the code they were supposed to fix already
worked. `h2-cordis-service-01` was re-authored so the defect *is* the unsatisfiable declaration
and the fix is to stop declaring a capability that no service provides; `h2-cordis-service-03` had
a sound effect-owned-timer defect but a reference solution carrying the same bogus injection, plus
a grader marker (`timer = setInterval(`) that its own correct fix contains — the marker now forbids
the module-level timer holder and requires the returned disposer, which is stricter, not weaker.
The public calibration task was also a near-clone of `h2-cordis-service-01` (its grader differed
only in the service name), which would have published a hidden task's requirement and solution; it
was replaced with a defect family no hidden task uses, and two guards now enforce that boundary:
the calibration task and the unit-test fixture seed are disclosed roots for the corpus loader, and
full validation rejects a calibration grader that shares any task-specific fragment with a hidden
grader. Fixture task ids moved to a reserved 90-series ordinal so they can never collide with a
hidden id.

**Open work before scoring** is listed in section 10: deferred retention, then the remaining
hardening (opaque observation paths, authoring material moved out of the scoring artifact root, the
isolation policy bound into the preregistration receipt). Nothing in this list changes the
confirmatory contract; the dry run must be (re)run after the harness settles, and `h2:run` refuses
to start until the isolation blocker is cleared.
