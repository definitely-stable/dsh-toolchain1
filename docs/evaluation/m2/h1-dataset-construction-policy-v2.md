# H1 dataset construction policy v2

Status: **FROZEN BEFORE H1 TASK AUTHORING**  
Policy identity: `dsh-toolchain-m2-h1-dataset-construction-v2`

This document freezes how the private H1 task set is constructed and when it is revealed. It supplements the strict `dsh-toolchain-m2-agent-dataset-v2` schema; it does not change the frozen target, measurement, thresholds, analysis plan, provider identity requirements, or production Contract Intelligence behavior.

## Purpose

A 96-task hash is not sufficient evidence of a useful holdout. Without construction constraints, the set could contain one domain, repeated paraphrases of one fact, treatment-cued prompts, or an outcome-friendly positive/negative mix while still satisfying the structural dataset contract.

H1 therefore has two gates:

1. the existing strict dataset contract establishes identity, target binding, schema, task count, success-rule syntax, outcome-material exclusion and canonical SHA-256;
2. this construction policy establishes minimum diversity and anti-contamination invariants before that dataset may be finalized.

## Sampling frame

H1 candidates must be authored from the frozen `@deepseek-ai/dsh@0.1.1-rc.2` public contract universe and realistic plugin-development questions that can be adjudicated against the independently frozen API Truth v2.

Allowed candidate classes are:

- positive exact-target API questions grounded in authoritative rc.2 public declarations;
- realistic plugin implementation questions whose answer requires identifying target-valid public packages, symbols or members;
- negative compatibility questions about plausible but absent APIs;
- version-drift negatives where later/upstream knowledge must not be imported into the frozen rc.2 target.

Tasks requiring private/internal APIs, unfrozen network state, subjective product quality, or truth that cannot fail closed to `UNKNOWN` are outside the H1 sampling frame.

P0 and R1 may inform broad task taxonomy and reveal evaluator defects. They must not be used to select, remove or reword individual H1 tasks because observed B/C behavior suggests that doing so would improve a desired endpoint. No H1 model outcome may be observed before the task set is committed.

## Machine-enforced construction invariants

The finalization boundary MUST reject the hidden dataset unless all of the following hold:

- task count is exactly **96**;
- the set contains **8..16** represented domains;
- every represented domain contains **4..16** tasks;
- exactly **72** tasks use `api-exists-any` and exactly **24** use `api-absent`;
- prompts are unique after Unicode NFKC normalization, lowercasing, and punctuation/whitespace-insensitive Unicode letter/number tokenization;
- one canonical success-rule proposition appears at most **2** times;
- one atomic API claim appears at most **2** times, where an atom is `exists:<package>:<symbol>` or `absent:<scope>:<symbol>`;
- prompts do not name `contract.search`, `contract.inspect`, `DSH Toolchain`, `successRule`, or an evaluation `arm A/B/C` label.

These checks are deterministic and deliberately narrow. They prevent obvious concentration, duplication and treatment cueing without pretending that a lexical algorithm can prove semantic diversity.

## Human construction audit

Before the real private bytes are committed, the author must additionally review all 96 tasks for:

- semantic near-duplicates and paraphrases of the same factual proposition;
- realistic plugin-development phrasing rather than benchmark-shaped prompts;
- provenance to authoritative exact-target evidence or a documented negative/version-drift source;
- domain labels that describe genuinely distinct problem areas rather than artificial relabeling used to satisfy the numeric domain gate;
- no task chosen or edited because observed model outcomes make Arm C look better or Arm B look worse.

The provenance/audit material remains private with the task bytes before H1 because revealing it can disclose the hidden set. It must be retained for the post-run reveal.

## What remains private before H1

Before the first H1 model call, the exact task prompts, success rules and provenance/audit material remain private. Public evidence contains the frozen construction policy plus the committed dataset SHA-256 and task count in the finalized H1 commitment/definition. The public BLOCKED commitment file is not rewritten in place.

## Mandatory reveal after terminal H1

The first terminal H1 state is one of:

- `PASS`;
- `NEEDS-IMPROVEMENT`;
- `INCONCLUSIVE`.

After that terminal state is frozen, the exact canonical H1 dataset bytes and retained construction/provenance audit material MUST be published. The revealed canonical dataset MUST hash to the pre-run dataset SHA-256. A mismatch is an integrity failure, not a dataset correction.

Once H1 has produced model outcomes it is a burned holdout. Its prompts, success rules or construction cannot be rewritten and rescored as H1. Any corrected or later scoring set receives a new holdout identity (for example H2) and a new preregistration.

## Non-goals

This policy does not:

- tune production retrieval or Contract Index normalization;
- add embeddings, reranking or new product behavior;
- prescribe an exhaustive semantic taxonomy for all DSH APIs;
- claim that domain counts prove representativeness;
- authorize another provider-backed P0;
- authorize H1 execution before the remaining execution/definition/identity gates are frozen.

## Related frozen evidence

- `agent-comparison.md` — controlled agent-comparison protocol;
- `agent-comparison-amendment-2026-08-30.md` — post-P0 governance and no outcome-driven rerun rule;
- `h1-prospective-design-v2.json` — selected 96-task prospective design and inference plan;
- `agent-holdout-h1-v2.commitment.json` — public BLOCKED commitment awaiting private dataset/provider finalization.
