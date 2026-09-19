# H2 canonical terminal outcome

Status: **INCONCLUSIVE / NO_POSITIVE_DELTA / CLOSED — CANONICAL FIRST VALID SCORING RUN**

H2 is complete. The result below is the canonical outcome of the preregistered confirmatory product
benchmark ([design and preregistration](h2-design-preregistration.md)) and MUST NOT be re-rolled,
extended, or relabelled. No frozen limit, identity, or decision rule may change retroactively.

## Execution chain

- GitHub Actions run: `35302366966` (workflow `h2-scoring.yml`, `workflow_dispatch` from `main`)
- Candidate commit: `e64cd8a5dfee5615560c766fd93db707cb61ac82`
- Packed candidate artifact SHA-256: `1158c0602ec307a839669c1679e16d8e095dab6e26ce83c61910ab24d58476a4`
- Run id: `scoring-1158c0602ec3-e64cd8a5-mu6e2b2c`
- Job span: 2026-09-18 03:13:08Z → 04:11:35Z; scoring loop 03:18:10Z → 04:11:34Z
- Technical dry run (non-scoring, gating): passed, 03:13:40Z → 03:18:10Z
- Scoring run step: **success**
- `h2:finalize --out` step: **failed**, and that failure is a harness defect, not a measurement
  result — see "Publication gate defect" below

## Frozen identities

| Identity | Value |
| --- | --- |
| Target train | `@deepseek-ai/dsh@0.1.5-rc.2`, profile `acp`, package-mode acquisition |
| Target fingerprint | `183603fb8799bdaab9b5e19372f506190f6df6895ddde49ba58ce8c071c4fb48` |
| Model identity | `opencode-go` / `deepseek-v4.1-flash`, reasoning effort `high` |
| Dataset commitment | `214cc886461a5beccdc84a8984c51ec64a994281cc10fb0608430bafc225cfe3` |
| Schedule hash | `1364adfb162cbb03913e09510154fc85ea765180567442eb3c4b5935564f0856` |
| Policy hash (preregistration receipt) | `14157b1a454c9f0939cf1392cfbc088a58126341b03147c3788826cf37b08b54` |
| Report schema | `dsh-toolchain-h2-report-v1` |

## Measurement health

| Item | Value |
| --- | ---: |
| Expected scoring observations | 36 |
| Executed scoring observations | **36** |
| Resolved task pairs | **18 / 18** |
| Infrastructure failures | **0** |
| Model identity drift | **0** |
| Stopped early | no |
| Budget exhaustions | **23 / 36** (B 9, C 14) |

The run is **fully resolved**: every preregistered observation executed, every pair resolved, no
infrastructure failure, no identity drift. The confirmatory comparison therefore ran on all 18 pairs
— unlike H1, whose 227 unresolved observations left no estimate at all.

## Primary endpoint

Preregistered rule: exact paired McNemar, one-sided, α = 0.05, MCID ≥ 2/18 (11.11 pp), computed over
the 18 task pairs.

| Arm | Successes | Rate |
| --- | ---: | ---: |
| B (unmodified `acp` profile) | 9 / 18 | 50.0% |
| C (B + production DSH Toolchain bundle) | 2 / 18 | 11.1% |

```text
contingency   both success 2 | B only 7 | C only 0 | both fail 9   (18 pairs)
delta         -0.3889  (C - B = -38.89 percentage points)
outcome       INCONCLUSIVE
reason        NO_POSITIVE_DELTA
```

No confirmatory benefit was established. The preregistered rule is one-sided in the
C-greater-than-B direction, so a negative delta resolves to `INCONCLUSIVE` under
`NO_POSITIVE_DELTA`; that label is the preregistered verdict, **not** a claim that the two arms are
equivalent, and not a claim that the Toolchain is useless.

**The observed direction is against Arm C, and the discordance is one-sided.** All 7 discordant pairs
were B-only wins; C won no pair that B lost. The table below is published because the design already
publishes task ids, strata and digests in the public commitment, and because hiding a 7–0 discordance
behind the word "inconclusive" would misreport what the run measured.

| Pair | B | C |
| --- | --- | --- |
| `h2-agent-tool-01` | success | fail |
| `h2-agent-tool-02` | success | success |
| `h2-agent-tool-03` | success | fail |
| `h2-compatibility-debug-01` | fail | fail |
| `h2-compatibility-debug-02` | success | success |
| `h2-compatibility-debug-03` | success | fail |
| `h2-cordis-service-01` | fail | fail |
| `h2-cordis-service-02` | fail | fail |
| `h2-cordis-service-03` | success | fail |
| `h2-exact-target-api-01` | fail | fail |
| `h2-exact-target-api-02` | fail | fail |
| `h2-exact-target-api-03` | fail | fail |
| `h2-plugin-composition-01` | fail | fail |
| `h2-plugin-composition-02` | success | fail |
| `h2-plugin-composition-03` | fail | fail |
| `h2-runtime-verification-01` | success | fail |
| `h2-runtime-verification-02` | success | fail |
| `h2-runtime-verification-03` | fail | fail |

## Secondary endpoints

Reported jointly, never collapsed into a composite score.

| Metric | Arm B | Arm C |
| --- | ---: | ---: |
| Observations | 18 | 18 |
| Successes | 9 | 2 |
| Budget exhaustions | 9 | 14 |
| Observations that used a Toolchain tool | 0 | **11 / 18** |
| Toolchain tool calls | 0 | 35 |
| Ordinary tool calls | 547 | 645 |
| Total tool calls | 547 | 680 |
| Provider completions | 340 | 418 |
| Input tokens | 743,717 | 983,560 |
| Output tokens | 147,581 | 170,319 |
| Total tokens | 11,430,946 | 15,456,599 |
| Wall time | 1,257,144 ms | 1,690,663 ms |
| Mean wall time per observation | 69.8 s | 93.9 s |

### Independent grader, decomposed from resource completion

H2 defines product success as `terminal.gradeable && terminal.budgetExhausted === false &&
grader.status === 'pass'`. The headline `9 vs 2` therefore counts neither arm's correctness, and
reading it as "Arm C wrote worse code" is exactly the misreading the raw numbers invite. The
independent grader — which runs after the model stops, on the workspace as left — passed:

| Metric | Arm B | Arm C |
| --- | ---: | ---: |
| Grader PASS | **12 / 18** (66.7%) | **13 / 18** (72.2%) |
| Grader FAIL | 6 | 5 |
| Budget exhaustions | 9 | 14 |
| Grader PASS but budget-exhausted → scored a product failure | 3 | 11 |
| Terminal `COMPLETED` / `RESOURCE_EXHAUSTED` | 9 / 9 | 4 / 14 |

Correctness did not collapse in Arm C: on the independent oracle it was marginally *higher*. What
collapsed was Arm C's ability to reach a normal terminal completion inside the frozen budget. These
fields are secondary diagnostics: they cannot change the preregistered primary definition in any
direction, and the report states the primary result exactly as the rule computes it.

Arm C's usage of the Toolchain was real, not nominal: 35 calls across 11 observations
(`toolchain_target_resolve` 12, `toolchain_contract_search` 9, `toolchain_plugin_check` 8,
`toolchain_plugin_verify` 6). It also spent more of every resource it was measured on — 35% more
total tokens, 23% more provider completions, 34% more wall time, 24% more tool calls — and produced
fewer successes.

## Interpretation, and the limits of it

1. **The comparison is valid; the verdict is null.** Every gate the design owns passed: 36/36
   observations, 18/18 resolved pairs, zero infrastructure failures, zero identity drift, empirical
   B/C composition parity verified before the first model call. The confirmatory estimate therefore
   exists and is negative.

2. **Budget exhaustion dominates the failure mode, and that is a calibration limit of this run.**
   23 of 36 observations ended `RESOURCE_EXHAUSTED` at the frozen 24-completion ceiling (B 9, C 14).
   The budget was anchored on a **single** measurement — one public calibration task that finished
   naturally after 16 completions and 28 tool calls (§4.1) — and `24 = 1.5×16` did not hold across an
   18-task, six-stratum hidden corpus. For the 23 exhausted observations, what was measured is how
   far each arm got inside the budget, not whether it could have finished. This is the same defect
   class §4.1 already recorded for the frozen limit of 6, one calibration step later: a limit derived
   from one task does not generalise to a corpus.

3. **What must not be concluded.**
   - Not "the Toolchain has no effect": `INCONCLUSIVE` is the preregistered verdict for a rule that
     was not met, and §13 forbids reading it as absence of benefit.
   - Not "the Toolchain harms success": the direction is real and one-sided, but the run is not a
     preregistered test of that hypothesis. Turning it into one after seeing the data would be the
     post-hoc relabelling §17 forbids. Testing it needs a **new** experiment with its own
     preregistration, its own hidden corpus, and its own decision rule.
   - Not a token, wall-time or cost ranking: the secondary endpoints are descriptive and the two arms
     were not matched on work completed.

4. **No rerun, no extension, no amendment.** This is the first valid committed scoring run and
   therefore the canonical result (§15, §17). The 24-completion and 600 s limits, the MCID, the
   schedule, the model identity and the dataset stay frozen. A future improvement to the harness or
   the product is a new experiment version, never a continuation of this one, and the tasks used
   here do not become development material.

## Harness defects this run exposed (fixed; no measurement changed)

Both defects below were found by this run and are recorded here rather than in the frozen
preregistration, which stays untouched. Neither changed a measurement: they affected whether an
already-produced result could reach the committed location, and whether a later experiment would have
been authorized to spend its budget.

### A. The publication gate refused every report

The scoring step succeeded, but the following `h2:finalize --out` step failed with:

```text
H2 CLI error: refusing to publish a non-terminal H2 report (status INCONCLUSIVE);
the run did not resolve every observation
```

The gate compared the report status against `'COMPLETE'`, a value `buildH2Report` never produces: the
terminal statuses are `CONFIRMED_BENEFIT`, `INCONCLUSIVE` and `STOPPED_INVALID`. It therefore refused
**every** report, including a fully resolved one, and no test covered it, so only the first real
publication attempt could expose it. The gate now validates the measurement the design actually
requires — every preregistered observation executed, every pair resolved, zero infrastructure
failures, zero identity drift — and no longer depends on which verdict came out, because §13 requires
an `INCONCLUSIVE` verdict to be published rather than hidden.

This defect is why the machine report had never reached `docs/evaluation/h2/h2-report-v1.json`: the
step that writes it is the step that threw. The published artifact was regenerated from the run's own
36 retained receipts by the corrected generator. It is byte-identical to the run's own `report.json`
on every measurement field — run id, policy, status, outcome reason, measurement health, decision,
primary estimate, the whole `secondary` block and the per-pair table — and differs only by the added
diagnostic fields documented above, so no measured value was altered in transit.

### B. The dry run authorized scoring with an already-exhausted budget

The technical dry run that gated this run recorded Arm C as `ok` while its trajectory had been cut
short by the completion ceiling:

```text
Arm B  COMPLETED           grader PASS  19 completions
Arm C  RESOURCE_EXHAUSTED  grader PASS  25 completions  4 Toolchain calls
frozen providerCompletionsLimit: 24
```

`RESOURCE_EXHAUSTED` was mapped to `status: ok`, so a calibration observation that had already spent
its budget inside the frozen limit was accepted as evidence that the limit was fit for the corpus.
The exhaustion that dominated the scoring run was therefore visible before the first scoring
observation and gated nothing.

The dry run now separates transport readiness from resource fitness and requires both: telemetry
resolved, stable model identity, empirically verified composition parity, `grader.status === 'pass'`,
`terminalReason === 'COMPLETED'`, and `budgetExhausted === false`. `RESOURCE_EXHAUSTED` remains a
valid *product* outcome during scoring — that is why it still resolves there — but it can no longer
authorize spending a scoring budget.


## Disclosure boundary

Published: schema version, run id, candidate commit, packed-artifact SHA-256, target fingerprint,
dataset commitment, schedule hash, policy hash, the frozen model identity, measurement health, the
primary and secondary aggregates including the independent-grader decomposition, and the per-pair
success table (task ids are already public in the commitment record).

Never published, and not present in any receipt: prompt text, initial or modified workspace contents,
reference solutions, grader bodies, model prose, reasoning, raw tool arguments or results, and
credentials. Receipts are sanitized by the benchmark before they can be written (§14).

The result is conditional on everything this run froze: one model served by the OpenCode Zen relay,
one DSH train in package mode, one `acp` profile, one 18-task hidden corpus, and the resource policy
in §11. It supports no claim outside that boundary.
