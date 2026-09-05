# M2 staged development evaluation v1 outcome — 2026-09-05

Status: **DEVELOPMENT_ONLY / measurement PASS / product comparison UNINFORMATIVE**

## Run identity

- GitHub Actions run: `33939213526`
- workflow: `M2 Staged Development Evaluation`
- event: `workflow_dispatch`
- mode: `dev`
- exact repository SHA: `8eba7eccba77bb3e047868dbad8ea9c9ced3b033`
- frozen production ranker: `dsh-contract-search-v3-conservative-abstention`
- target: frozen `@deepseek-ai/dsh@0.1.1-rc.2` Web evaluation fixture
- provider: OpenCode Go managed gateway / `deepseek-v4-flash`
- thinking: enabled
- reasoning effort: high

The provider probe verified the exact response model, named tool choice, function-tool continuation, strict final result schema, and token measurement before the staged run.

## Measurement result

The run completed all `40/40` authorized B/C observations after the 16-call canary passed the fail-closed measurement-health gate.

- measurement status: `PASS`
- infrastructure failures: `0`
- retries: `0`
- B resolved/API-valid: `20/20`
- C resolved/API-valid: `20/20`
- paired API-validity delta C-B: `0`
- aggregate input tokens: `2,473,780`
- aggregate output tokens: `120,594`
- aggregate product tool calls: `594`
- measured aggregate wall time: approximately `23.6 min`

The v1 report also displayed B/C `taskSuccess=20/20`, but this was not an independent guardrail: the development adjudicator set `taskSuccess` to the same boolean as API-claim validity. That duplicate field must not be interpreted as separate end-to-end task-success evidence.

## Selection defect

The product comparison is not negative evidence against Toolchain. The v1 selector grouped tasks only by domain, sorted task ids lexicographically inside each domain, and then selected round-robin by depth. In the disclosed H1-derived corpus each domain uses ids with negative `n01..n03` tasks before positive discovery `p01..p09` tasks.

With the 20-task `dev` budget this deterministically selected:

- `20` `api-absent` exact package/symbol checks;
- `0` `api-exists-any` discovery tasks.

The baseline B arm already receives conventional exact-target read/search tools. The selected negative prompts themselves contain the exact package and symbol being checked, so both B and C reached a 100% ceiling. The run therefore did not meaningfully test the primary Toolchain value proposition: discovering the correct installed-target API from natural intent when the exact symbol is not supplied.

Classification: **UNINFORMATIVE / CEILING-SATURATED DUE TO SELECTION BIAS**.

It is incorrect to report this result as `Toolchain has no benefit`, `C failed to beat B`, or equivalent product evidence.

## Repair boundary

The versioned staged-dev-v2 harness repair:

1. stratifies selection by `domain × successRule.kind` rather than task-id naming;
2. freezes an exact 20-task `12 api-exists-any / 8 api-absent` selection before any model outcome;
3. records actual per-arm and per-tool trace telemetry, including Contract Search/Inspect use;
4. removes duplicated `taskSuccess` as a false independent metric and explicitly marks the end-to-end task-success guardrail as unmeasured;
5. keeps the frozen Contract Search v3 ranker, DSH target, provider identity, and DEVELOPMENT_ONLY evidence boundary unchanged.

Do **not** rerun staged dev-v1. After the repaired harness is merged and post-merge CI is green, authorize exactly one new `dev-v2` workflow dispatch on merged `main`. It remains an engineering-signal experiment and cannot be used as H2 holdout evidence.
