# M2.3 R1 Retrieval Baseline Report

## Scope

This report records the first deterministic production retrieval measurement for the frozen M2.3 R1 corpus. It is capability evidence, not a benchmark-driven change request and not an M2 PASS declaration.

The measurement uses the registry-installable `@deepseek-ai/dsh@0.1.1-rc.2` Web profile, exact target fingerprint `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`, and ContractIndex fingerprint `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`.

The complete artifact-derived contract universe was frozen before the corpus. R1 was then frozen and independently verified GREEN before the first production score. Production `searchContractIndex()` was not changed after observing results.

The immutable machine-readable receipt is `docs/evaluation/m2/retrieval-baseline-v1.json`.

## Method

R1 contains 36 tasks: 8 exact-symbol, 6 package-api, 7 natural-language, 6 indirect, 5 ambiguous, and 4 true no-result tasks. Positive tasks carry a route from the expected contract through an exact declaration export to authoritative declaration evidence. Negative tasks carry an absence oracle against the complete 184-contract frozen universe.

Every task was passed directly to:

```text
searchContractIndex(index, task.query, undefined, 5)
```

The evaluation records Success@1/3/5 over answerable tasks, mean reciprocal rank, no-result correctness, and forbidden-hit rate at 5 for explicitly confusable tasks. The scorer was executed repeatedly and with reversed task execution order to enforce deterministic, order-independent behavior. CI does not assert a desired capability score or freeze the complete ranking as a regression contract.

## First-run result

| Metric | Result |
| --- | ---: |
| Answerable tasks | 32 |
| True no-result tasks | 4 |
| Success@1 | 53.125% |
| Success@3 | 56.25% |
| Success@5 | 56.25% |
| MRR | 54.6875% |
| No-result correctness | 100% |
| Forbidden-hit rate@5 | 20% |

### By retrieval category

| Category | Tasks | Success@1 | Success@3 | Success@5 | MRR | No-result correctness | Forbidden-hit@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| exact-symbol | 8 | 100% | 100% | 100% | 100% | — | — |
| package-api | 6 | 100% | 100% | 100% | 100% | — | — |
| natural-language | 7 | 0% | 0% | 0% | 0% | — | — |
| indirect | 6 | 0% | 0% | 0% | 0% | — | — |
| ambiguous | 5 | 60% | 80% | 80% | 70% | — | 20% |
| no-result | 4 | — | — | — | — | 100% | — |

### By product domain

| Domain | Tasks | Success@5 / answerable | MRR | No-result correctness | Forbidden-hit@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| tools | 4 | 66.67% | 66.67% | 100% | — |
| system-prompt | 3 | 66.67% | 66.67% | — | — |
| approval | 4 | 50% | 50% | — | 0% |
| scope | 4 | 50% | 50% | — | — |
| subagent | 6 | 60% | 50% | 100% | 100% |
| compaction | 5 | 60% | 60% | — | 0% |
| session-query | 6 | 60% | 60% | 100% | 0% |
| user-questions | 3 | 33.33% | 33.33% | — | — |
| profile-lifecycle | 1 | — | — | 100% | — |

## Diagnosis

The result separates three very different behaviors.

**Exact contract knowledge is strong.** Exact-symbol and package-qualified API tasks are perfect in R1. The current deterministic lexical scorer reliably resolves explicit symbols and package/API combinations when the user or agent already knows roughly what to ask for.

**Negative knowledge is also strong on the frozen target.** All four absent-API probes return no result, including the `patchReload` drift canary that exists in later upstream source but not in the canonical rc.2 artifact universe. This supports the exact-target promise: the index does not silently import future-train knowledge.

**Natural discovery is the current retrieval weakness.** All seven natural-language and all six indirect tasks return no result. Evidence-sufficiency checks independently prove that the expected contracts, declaration exports, and authoritative evidence are present in the frozen index. These failures are therefore retrieval/formulation gaps, not acquisition gaps.

The ambiguity control also exposes a concrete precision problem. For `subagent in process run`, generic `@deepseek-ai/dsh-subagent` ranks before the intended `@deepseek-ai/dsh-subagent-in-process-driver`, producing the corpus's only forbidden hit. The correct implementation still appears at rank 2, so this is ranking precision rather than missing evidence.

## Decision impact

This baseline is a **NEEDS-IMPROVEMENT signal for the retrieval layer**, not yet a verdict on M2 as a product capability. M2's exit question is whether progressive Toolchain usage materially reduces invalid DSH API guesses for an agent versus an exact-target conventional workflow. That requires the preregistered A/B/C experiment and task-success guardrail.

No retrieval improvement is made in this PR after viewing the score. If later evidence confirms that the natural-language/indirect gap materially harms agent usefulness, the improvement must be scoped in a separate issue/PR and rerun against this immutable R1 baseline rather than rewriting the corpus.

## Provenance

- production base: `d3162bd72bcd84ec8c422108be1e7c529a1a59f6`
- R1 corpus freeze: `a5b9aef62b232654d46ea95a6e76e25fb518cb44`
- R1 full GREEN verification: `24d809bc313cde7f3c62133667d9892d2711def4`, CI #429
- first production capture: `841c0d3a2b5af1423150a5647fbd2fadace9b942`, CI #430, Node 24.19 job `98756971751`
- frozen receipt: `docs/evaluation/m2/retrieval-baseline-v1.json`
