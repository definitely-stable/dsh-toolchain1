# Staged dev-v2 outcome — 2026-09-05

Status: **DEVELOPMENT_ONLY / ORIGINAL REPORT STOP / DESCRIPTIVE PRODUCT SIGNAL**

This receipt records the immutable result of workflow run `33948582894`. It does not rewrite the original report, convert the run into confirmatory evidence, or authorize a preferred-result rerun.

## Identity

- workflow: `M2 Staged Development Evaluation`;
- mode: `dev`;
- branch: `main`;
- exact repository SHA: `8e8df50df16018374808741f1a2073d3b3a5cd37`;
- frozen production candidate: Contract Search v3 `dsh-contract-search-v3-conservative-abstention` from `8eba7eccba77bb3e047868dbad8ea9c9ced3b033`;
- artifact id: `9964274329`;
- artifact name: `m2-staged-eval-33948582894-1`;
- artifact digest: `sha256:5c60033571ad23ed92b93810713eb0a068950aa8dba5e2026bc6dcabfb5e8cdf`;
- original report schema: `dsh-toolchain-staged-eval-report-v2`;
- provider: OpenCode Go;
- request/response model: `deepseek-v4-flash`;
- thinking: enabled;
- reasoning effort: high;
- provider probe verified function tool calls, reasoning continuation, token measurement, named staged tool choice, and strict staged-result schema.

The run used the preregistered/frozen dev-v2 selection contract in `staged-dev-v2-selection.json`. The 16-call canary contains eight B/C tasks covering all eight development domains with four `api-exists-any` and four `api-absent` tasks.

## Original result — preserve exactly

The original v2 report returned:

- measurement status: `STOP`;
- scheduled/model outcomes: `16 / 16`;
- format-valid: `14 / 16`;
- decision-resolved: `14 / 16`;
- infrastructure failures: `0`;
- attempts: `16`;
- retries: `0`;
- unrecovered infrastructure: `0`;
- remainder planned/authorized/executed: `24 / 0 / 0`.

Original STOP reasons:

1. `FORMAT_COMPLIANCE_BELOW_MINIMUM`;
2. `DECISION_RESOLUTION_BELOW_MINIMUM`;
3. `ARM_RESOLUTION_GAP_ABOVE_MAXIMUM`.

The original report therefore set `product.interpretable=false` and `blockedBy=measurement-health`. That historical output remains immutable.

## What the artifact actually shows

Terminal reasons separate the 16 observations into:

- `structured_measurement_finalized`: `14` total — B `6`, C `8`;
- `tool_call_limit`: `2` total — B `2`, C `0`.

Both `tool_call_limit` observations were classified by report-v2 as `STRUCTURED_TRANSPORT_UNSUPPORTED`. However, the child runner generated that terminal when product exploration exceeded the unchanged `MAX_PRODUCT_TOOL_CALLS = 31` budget before structured measurement finalization. No provider, process, tool-transport, or retry failure was recorded.

Therefore the two B outcomes are not evidence that the structured finalization transport itself was broken. They are bounded product-exploration terminals that the v2 measurement projection could not represent separately.

## Descriptive B/C signal

The following numbers are descriptive DEVELOPMENT_ONLY engineering evidence. They are **not a preregistered confirmatory effect estimate**.

### Completion / API claim

| Metric | B | C |
| --- | ---: | ---: |
| canary observations | 8 | 8 |
| reached deterministic API adjudication | 6 | 8 |
| API-valid among adjudicated observations | 6 / 6 | 8 / 8 |
| `tool_call_limit` terminals | 2 | 0 |
| observations using Toolchain | 0 / 8 | 8 / 8 |

The original complete-case paired API-validity comparison contains only the six pairs where both arms reached adjudication and therefore reports C−B delta `0`. It necessarily excludes the two pairs where B exhausted its product-tool budget and C completed. Consequently that complete-case zero must not be reported as evidence of product equivalence.

Conversely, the observed 6/8 versus 8/8 bounded completion pattern must not be promoted to a claimed `+25 pp` product effect: bounded completion was not a preregistered primary outcome for this run, the sample is only eight canary tasks, and the run stopped before the 24-call remainder.

### Tool trajectory

| Metric | B | C | C vs B |
| --- | ---: | ---: | ---: |
| product tool calls | 153 | 150 | -3 |
| ordinary tool calls | 153 | 98 | -55 |
| `read_file` | 49 | 22 | -27 |
| `search_text` | 104 | 76 | -28 |
| `toolchain_contract_search` | 0 | 45 | +45 |
| `toolchain_contract_inspect` | 0 | 7 | +7 |
| Toolchain-use rate | 0% | 100% | +100 pp |

C did not materially reduce total product-tool-call volume in this small canary, but it replaced a substantial amount of ordinary filesystem search/read exploration with Contract Search/Inspect. The two B-only tool-budget terminals are therefore a plausible long-tail exploration-efficiency signal worth measuring explicitly in future development evidence.

### Cost

| Metric | B | C | C vs B |
| --- | ---: | ---: | ---: |
| input tokens | 788,781 | 1,090,554 | +301,773 / +38.3% |
| output tokens | 31,333 | 33,504 | +2,171 / +6.9% |
| wall time | 420,189 ms | 473,852 ms | +53,663 ms / +12.8% |
| turns | 161 | 158 | -3 / -1.9% |
| provider completions | 92 | 88 | -4 / -4.3% |

The current Toolchain path therefore has a real context-cost concern even while it may reduce unbounded ordinary exploration. Future product evaluation must consider both bounded success and incremental cost; a success delta without token/time cost is insufficient.

## Evaluation defect exposed

The v2 pipeline conflated three distinct concepts:

1. measurement/provider/finalization health;
2. product completion under the same bounded execution budget;
3. deterministic correctness of the final API claim.

`tool_call_limit` was encoded as generic `unsupported`, projected to `STRUCTURED_TRANSPORT_UNSUPPORTED`, and then lowered both format compliance and decision resolution. Because the event occurred only in B, the B/C resolution-gap gate also treated the arm-dependent product terminal as measurement invalidity. The canary therefore censored the exact kind of arm-dependent bounded-completion behavior that an agent toolchain evaluation should retain as product evidence.

PR #183 repairs this methodology prospectively:

- `tool_budget_exhausted` becomes a closed product terminal;
- measurement health and product outcome are represented independently;
- product budget exhaustion does not masquerade as malformed structured measurement;
- decision-resolution and arm-resolution differences remain diagnostics rather than measurement STOP criteria;
- report v3 retains bounded completion/API-success denominators and safe per-observation receipts;
- raw prompts, model reasoning/chain-of-thought, raw tool arguments/results, and provider bodies are not persisted in the report.

## Scientific boundary

This receipt does **not** retroactively rerun report-v3 over the historical artifact as confirmatory evidence. The original report remains `STOP` under its frozen v2 semantics.

The run is useful for engineering decisions because it exposed:

- healthy provider infrastructure;
- reliable C adoption of Toolchain on all eight C canary observations;
- a B-only bounded-exploration failure pattern;
- substantial substitution away from ordinary read/search calls;
- increased C input-token and wall-time cost.

It does not independently measure end-to-end developer task success. `taskSuccessGuardrail.measured=false` remains the correct boundary.

## Next decision gate

Do not change or tune Contract Search v3 from this run. Do not increase the 31-call budget merely to remove B failures. Do not rerun H1/dev-v1.

First merge and verify the evaluation-methodology repair. After that, decide whether another DEVELOPMENT_ONLY run is worth its provider cost based on the corrected prospective metrics and the design of an independent end-to-end H2 task-success guardrail. No `release`, `research`, or H2 provider run is authorized by this receipt alone.
