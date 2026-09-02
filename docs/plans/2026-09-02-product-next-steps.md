# Post-H1 product sequence

## Objective

Move DSH Toolchain from low-level exact-target primitives to a useful agent-facing plugin development loop without repeating the H1 evaluation-cost failure.

The sequence is capability-gated, not date-gated:

```text
shipped model skill
    -> deterministic intent retrieval v2
    -> bounded development comparison
    -> Exact Target Plugin Check alpha
    -> M3 diagnostic expansion
    -> M4 isolated verification
    -> fresh preregistered H2
```

H1 remains immutable `INCONCLUSIVE`. Its disclosed tasks are development evidence only and are never reused as a hidden confirmatory holdout.

## Track A — user/model product

### A1. Ship the model-facing Agent Skill (#152)

Purpose: tool availability is insufficient if the coding model does not know the exact-target operating sequence.

Exit:
- `skills/dsh-toolchain/SKILL.md` ships in the exact npm tarball;
- the skill teaches `target.resolve -> contract.search -> contract.inspect`;
- contract IDs and provenance evidence IDs are explicitly distinct;
- declared capability and observed runtime availability are explicitly distinct;
- stale evidence causes reacquisition, never guessing;
- package policy makes silent skill removal a CI failure.

### A2. Improve Contract Intelligence retrieval (#153)

Problem proven by the frozen R1 baseline:
- exact-symbol: 100%;
- package/API: 100%;
- no-result: 100%;
- natural-language: 0%;
- indirect: 0%;
- Success@5: 56.25%;
- forbidden-hit rate@5: 20%.

Implement in two reviewable slices.

#### A2.1 Deterministic intent ranker

Do not change Protocol v1 in the first slice.

- preserve exact qualified/name matching as the strongest signal;
- normalize punctuation and identifier boundaries;
- remove a small domain-independent natural-language stopword set from long questions;
- score token evidence by field instead of requiring every query word to occur;
- allow partial high-signal coverage for intent questions while requiring enough evidence to prevent one-token noise from becoming a match;
- use only existing target-bound contract facts/summaries/evidence;
- keep canonical tie-breaking and integer scores;
- keep search output compact and inspect identity unchanged;
- no external model, embeddings, service, cache, or dependency.

Required regressions:
- exact-symbol ordering does not regress;
- multi-token identifier/package behavior does not regress;
- natural-language question with stopwords retrieves the intended contract;
- an indirect question with two strong contract tokens can retrieve the intended contract without task-specific aliases;
- unrelated/no-result query remains empty;
- equivalent contract/evidence ordering remains deterministic.

#### A2.2 Searchable public-member evidence

Only after A2.1 proves the ranker still lacks member-level authority:
- extend acquisition/normalization with bounded public member/signature facts from authoritative declarations;
- do not flatten private or non-exported members;
- member evidence retrieves the owning contract rather than inventing a new contract identity;
- Contract Index identity changes when consumed member evidence changes;
- keep public-contract changes explicit if Protocol output must expose match reasons.

### A3. Bounded product comparison

Use the staged eval control plane, not H1-style manual chunks.

- deterministic regression suite first;
- 16-call canary for measurement health;
- default B/C development comparison capped at 40 model calls;
- compare baseline Toolchain versus shipped skill + retrieval v2;
- report measurement health, invalid-API/task-success signal, Toolchain calls, search->inspect conversion, wall time and tokens separately;
- STOP automatically when measurement health fails.

This is development evidence, not H2.

### A4. Exact Target Plugin Check alpha (#154)

The first user-facing one-call workflow:

```text
plugin source/artifact + exact target
    -> normalized subject identity
    -> exact dependency/contract reasoning
    -> stable diagnostics + provenance
    -> compatible / incompatible / unproven report
```

Initial static rules only:
- malformed/missing plugin manifest/composition metadata;
- dependency/version mismatch against exact target;
- referenced DSH contract/package absent on target;
- required runtime availability unproven;
- stale target/index evidence;
- profile-specific mismatch that M1/M2 can prove.

Constraints:
- no candidate plugin execution;
- no speculative giant rule catalog;
- one kernel/application use case, projected by CLI/native DSH/MCP;
- partial results survive independent subject defects;
- skill switches to `plugin.check` as the default post-edit/static-review path once shipped.

### A5. M3 — grow validation from reproduced failures

Add diagnostic rules only when backed by a real ecosystem failure or a stable fixture. Maintain stable diagnostic codes and evidence. Avoid becoming a second Doctor/package manager.

### A6. M4 — isolated verification

Add real artifact proof in a disposable DSH home:
- pack/install;
- compose;
- boot;
- runtime visibility probes;
- bounded behavior checks;
- process-tree cleanup;
- receipt bound to artifact + exact target.

The active user profile remains untouched by default.

### A7. Fresh H2

Only after the candidate product is stable:
- fresh unseen holdout;
- measurement canary already proven on development data;
- B/C only unless another arm has a decision role;
- one trial by default; repetitions only if prospective variance evidence requires them;
- preregistered sequential/maximum sample rule;
- no tuning after unblinding.

## Track B — evaluation safety

#149/#150/#151 are support infrastructure, not the product roadmap.

They must provide:
- deterministic/canary/dev/release/research budgets;
- hard model-call caps;
- measurement health before expensive execution;
- one-dispatch canary -> STOP/continue behavior;
- structured measurement transport;
- no manual chunk loop.

This track may proceed in parallel but MUST NOT block A1-A4 unless a product change cannot be measured safely.

## Track C — compatibility maintenance

### `profile.patchReload` (#33)

Resolve before claiming support for a published DSH train that carries the lifecycle contract. Do not silently redefine `dsh-target-v2`. Decide whether lifecycle semantics require a new target identity version or an orthogonal runtime lifecycle capability.

## Cost/quality guardrails

Every development agent comparison reports:
- model calls and infrastructure retries;
- input/output tokens;
- turns and wall time;
- Toolchain search/inspect calls;
- search->inspect conversion;
- invalid API/task success only when measurement health permits interpretation.

A quality improvement that recreates the H1 context overhead without clear value is not accepted by default.

## Immediate implementation order

1. Merge #152 shipped skill after exact-head CI.
2. Implement A2.1 under #153 with RED -> GREEN model tests and full CI.
3. Run deterministic R1/development diagnostics and record the new retrieval baseline without rewriting the historical R1 baseline.
4. Complete #150/#151 enough to run one bounded 16/40-call development comparison.
5. If measurement is healthy, evaluate skill + retrieval v2 and use failure clusters for product work.
6. Implement #154 Plugin Check alpha.
7. Expand M3/M4 from reproduced plugin fixtures.
8. Create H2 only after A1-A6 are stable.
