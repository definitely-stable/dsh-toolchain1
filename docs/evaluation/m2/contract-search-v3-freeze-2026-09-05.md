# Contract Search v3 development freeze — 2026-09-05

## Candidate

Contract Search v3 tuning is frozen at production commit:

- commit: `7ea5b095ec6730e279195f0d83c3d230e7085c68`
- ranker: `dsh-contract-search-v3-conservative-abstention`
- canonical target: `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`
- Contract Index: `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`
- R2-dev fingerprint: `dsh-contract-search-r2-dev-v1:f2ba02022f1567a3ab748d8182e113d63773556020ab70f3738299645ef4e1b4`

This receipt freezes development evidence only. R2-dev is not a holdout and does not support a confirmatory product claim.

## Frozen deterministic result

Final R2-dev behavior:

- 18 tasks: 12 answerable, 6 no-result;
- answerable Success@1: `9/12`;
- answerable Success@5: `9/12`;
- correct no-result: `5/6`;
- forbidden-hit@5 tasks: `0`;
- cumulative comparison vs frozen v2: `4 wins / 0 losses / 14 ties`.

The four preserved wins are:

- `r2-sibling-bash-sandbox`;
- `r2-sibling-compaction-pruner`;
- `r2-version-drift-tools-vnext-api`;
- `r2-version-drift-session-vnext-api`.

The only remaining incorrect no-result task is `r2-hard-negative-future-memory`.
The three remaining answerable misses are:

- `r2-natural-question-choice-flow`;
- `r2-indirect-scope-ancestry`;
- `r2-long-tools-schema-validation`.

R1 remains regression evidence only. At the frozen v3 candidate its metrics remain unchanged from the accepted v2 development gate: Success@1 `0.90625`, Success@5 `0.9375`, MRR `0.921875`, exact-symbol @5 `1.0`, package-api @5 `1.0`, no-result correctness `1.0`, forbidden-hit@5 `0.2`.

## Why coarse proximity is not justified

The deterministic support audit does not show one clean failure mode that coarse fact-local proximity can solve without colliding with currently correct or separately wrong tasks.

At the frozen candidate:

| task | role | known tokens | matched semantic terms | max query tokens in one fact |
| --- | --- | ---: | ---: | ---: |
| `r2-hard-negative-future-memory` | remaining false positive | 5 | 4 | 2 |
| `r2-indirect-child-final-message` | currently correct answerable | 8 | 5 | 2 |
| `r2-long-tools-schema-validation` | wrong answerable top-1 | 8 | 4 | 2 |
| `r2-indirect-scope-ancestry` | no-result answerable miss | 2 | 0 | 0 |

A coarse `sameFact >= N` or `sameFact < N` rule therefore cannot distinguish the remaining hard negative from the other classes. `scope-ancestry` is instead primarily a lexical-vocabulary gap: only two intent tokens are known to the current index.

The current derived search representation is also intentionally order-insensitive. `searchTokens()` normalizes each field/fact to sorted unique tokens, so token-distance or ordered phrase proximity is not represented. Adding true positional proximity would require a new derived-index semantic rather than a small score adjustment. Current development evidence does not justify that scope solely to force R2-dev from `5/6` to `6/6` no-result.

Therefore:

- no proximity production change is authorized by this freeze;
- no new rankerVersion is introduced;
- no score or abstention constant is selected from R1;
- R2-dev must not be repeatedly modified or tuned until all 18 tasks pass.

## Next evidence step

Before creating any fresh hidden H2 holdout, run one bounded **DEVELOPMENT_ONLY** B/C staged evaluation on the frozen final v3 candidate through the existing `M2 Staged Development Evaluation` workflow in `dev` mode.

The existing budget contract is:

- 20 development tasks;
- arms B/C only;
- one repetition;
- expected and hard-capped model calls: `40`;
- claim strength: `engineering-signal` only;
- canary-first measurement health remains fail-closed.

Interpretation:

1. Measurement `STOP` → diagnose the recorded transport/health evidence; do not rerun until preferred output.
2. Measurement `PASS` but no useful C-vs-B engineering signal → investigate agent/tool-use behavior before H2.
3. Measurement `PASS` with a useful C-vs-B signal and no task-success concern → freeze the product candidate and prepare a fresh preregistered H2 dataset/commitment.

The disclosed H1 corpus and R2-dev corpus are prohibited as H2 holdout material.

## Scope boundary

This freeze changes only evaluation/tests/documentation. It does not change:

- `src/` production ranking/search behavior;
- Protocol v1;
- Contract Index projection/fingerprint;
- dependencies;
- strict identifier lookup;
- evidence projection;
- target/runtime semantics.
