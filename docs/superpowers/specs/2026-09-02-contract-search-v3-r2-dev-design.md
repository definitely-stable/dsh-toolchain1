# Contract Search v3 R2 Development Design

Status: implementation source for issue #164.

Parent: #160. Foundation: PR #163 / merge `76b809c459040abd550df3f722b97cf737c535e1`.

## Purpose

R2-dev is the development/tuning corpus for Contract Search v3 natural-language ranking. It exists before any IDF, fact-coherence or abstention production change so ranking parameters are not selected against disclosed R1 regression results.

R1 remains immutable historical regression evidence. H1 hidden tasks/outcomes are not a source for selecting R2 examples. The future R2 holdout is outside this slice and must remain uncreated/unread during tuning.

## Corpus contract

R2-dev uses the same exact rc.2 ContractIndex fixture as R1 so the evidence universe is fixed while queries are newly authored from public declaration/package semantics. R2 tasks are not `M2RetrievalTask`; the types are separate to prevent R1 category/validation policy from becoming the v3 tuning contract.

Each task records:
- stable task id;
- one required R2 scenario;
- domain and query;
- expected contract ids for answerable tasks;
- optional forbidden contract ids for sibling/confusion checks;
- exact no-result expectation for negatives;
- declaration/package reference route and provenance.

Required scenarios:
1. `natural-paraphrase`
2. `indirect-intent`
3. `long-filler`
4. `sibling-package-confusion`
5. `fictional-identifier`
6. `natural-hard-negative`
7. `version-drift`
8. `rare-supporting-term`
9. `cross-fact-misleading`

The validator rejects duplicate ids, unknown expected/forbidden contracts, expected/forbidden overlap, empty evidence routes, contradictory no-result semantics, and missing required scenarios.

## Corpus identity

The committed corpus has schema `dsh-contract-search-r2-dev-v1` and is bound to the exact ContractIndex fingerprint. Canonicalization sorts tasks by task id and sorts set-like contract-id arrays; query text, scenario, domain, provenance and ordered reference routes remain semantic.

Fingerprint format:

```text
dsh-contract-search-r2-dev-v1:<sha256(canonical-json)>
```

A pinned literal fingerprint test is added after the first GREEN implementation. Any later semantic corpus mutation must intentionally update that lock in a corpus-only review, never inside a ranking-tuning PR.

## Comparison diagnostics

Ranking PRs compare one baseline result and one candidate result per exact R2 task. Diagnostics report:
- baseline/candidate ranked ids;
- expected rank (`null` when absent);
- forbidden-hit flags;
- no-result correctness;
- deterministic `win | loss | tie`.

Outcome ordering is transparent:
- answerable task: lower expected rank wins; `null` is worse than any observed rank; if equal, removing a forbidden top-5 hit wins and adding one loses;
- no-result task: empty result beats non-empty result; otherwise tie.

The comparison layer does not score or retrieve contracts. It only compares supplied ranked outputs, so production scorer variants can be evaluated without coupling the diagnostic semantics to an implementation.

## Guardrails

- no production scorer or ranker-version change in #164;
- no Protocol v1 or `dsh-contract-index-v1` change;
- no external dependency;
- R1 full regression remains required;
- aggregate metrics are supplemental; per-query diagnostics are the review gate for future ranking changes;
- no task is selected because it was an H1/R1 failure;
- future holdout content is not created here.
