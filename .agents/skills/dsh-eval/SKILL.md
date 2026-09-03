---
name: dsh-eval
description: Plan and operate bounded DSH Toolchain evaluations. Use for regression checks, Contract Intelligence comparisons, evaluator calibration, release evaluation, or when deciding how much model evaluation to run.
---

# DSH Eval

Use this skill instead of manually dispatching H1-style chunks.

## Hard rules

- Never rerun H1 as confirmatory evidence. H1 is permanently `INCONCLUSIVE` and disclosed.
- Never describe `docs/evaluation/m2/h1-dev-corpus-v1/` as hidden, unseen, or H2 evidence. Its role is `DEVELOPMENT_ONLY`.
- Never weaken the deterministic budget or measurement-health scripts because a result is inconvenient.
- Never silently add arm A or extra repetitions.
- Do not run manual 12/24/48 continuation loops. Select one bounded mode.
- A green workflow means execution succeeded; it does not mean the product passed.
- Staged development results are not H2 and are not confirmatory evidence.

## Modes

Use the cheapest mode that answers the engineering question:

| mode | purpose | B/C tasks | repetitions | hard model-call cap |
| --- | --- | ---: | ---: | ---: |
| `deterministic` | evaluator/tests only | 0 | 0 | 0 |
| `canary` | measurement health | 8 | 1 | 16 |
| `dev` | default implementation comparison | 20 | 1 | 40 |
| `release` | pre-release regression confidence | 32 | 1 | 64 |
| `research` | explicit exploratory investigation | 48 | 1 | 96 |

`dev` is the default. `research` requires an explicit reason; never escalate to it automatically.

## Operator path

For model-backed development evaluation, the operator selects only the bounded mode. Do not expose chunk size, arms, repetitions, or a continuation count as operator knobs.

Preferred path: manually dispatch the GitHub Actions workflow **M2 Staged Development Evaluation** and choose `canary`, `dev`, `release`, or `research`. The workflow obtains a fresh managed-provider probe, binds the run to that receipt, then invokes the closed staged runner exactly once.

Authorized local/provider path:

```text
pnpm eval:run -- --mode <mode> --manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json --output <report.json>
```

The local path requires `OPENCODE_API_KEY` and `M2_STAGED_PROVIDER_PROBE` to point at a fresh verified OpenCode Go probe receipt. Do not substitute historical H1 provider evidence.

## Procedure

1. Read the repository change and classify it:
   - evaluator/output protocol/runner change -> `canary` first;
   - ordinary Contract Intelligence implementation change -> `dev`;
   - release candidate -> `release`;
   - exploratory investigation explicitly requesting larger coverage -> `research`;
   - no agent/model behavior changed -> `deterministic`.
2. Run deterministic repository tests before any model call. For `deterministic`, stop here; `eval:run` is model-backed only.
3. Print the exact budget with `pnpm eval:plan -- --mode <mode>`. Refuse work exceeding the returned hard cap.
4. For a model-backed mode, use **M2 Staged Development Evaluation** or the closed `pnpm eval:run --` command above. Task selection comes only from the verified development corpus; do not hand-pick convenient examples.
5. The runner always executes the first 8 B/C tasks as the 16-call canary before any remainder.
6. The runner evaluates the frozen measurement-health gate. If health is `STOP`, the authorized remainder is zero remainder: no additional model calls are permitted in that run.
7. If health is `PASS`, `dev`/`release`/`research` may consume only the pre-authorized remainder inside the original hard cap.
8. Do not increase repetitions unless a separate variance analysis demonstrates that one repetition is insufficient and a new explicit budget is approved.
9. Keep future H2 separate. H2 requires a fresh hidden dataset, new commitment and preregistered stopping/inference rules.

## Measurement health

The deterministic gate requires:

- format/schema compliance >= 98%;
- decision resolution >= 95%;
- unrecovered infrastructure missingness <= 2%;
- absolute B/C decision-resolution gap <= 5 percentage points.

Recovered retries are reported as cost/reliability data but do not invalidate an otherwise resolved observation.

## Required report

Every eval report must have exactly these conceptual sections:

1. **Measurement health** — PASS/STOP, rates and stop reasons.
2. **Product signal** — B/C differences only when health permits interpretation; label development results exploratory/engineering evidence.
3. **Cost** — model calls, retries, turns/wall time/tokens when available, and remaining budget.
4. **Next action** — fix measurement, continue within the selected budget, merge/release, or prepare a separately preregistered H2.

Do not bury a measurement failure underneath aggregate product metrics.
