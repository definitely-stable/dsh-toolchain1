# M4.3.3 Explicit Agent Tool Behavior Implementation Plan

Issue: #220
Baseline: `main@8c0e0260cb31afce57a2c1d7d211977b54cae409`
Branch: `feat/m4-behavior-result`

## Scope guard

Implement only explicit deterministic Agent Tool success-value assertions in the existing isolated verification path. Do not change M2 evaluation/retrieval, M3 compatibility semantics, target/artifact identity, operation lifecycle, Client visibility, execution policy, dependencies, or unrelated PRs.

## Task 1 — Protocol and parser RED

Files:
- `tests/protocol/plugin-verify-behavior.spec.ts`
- `tests/protocol/plugin-verify-request-validation.spec.ts` only if base-shape coverage needs extension

Add failing tests proving:
- valid ordered `agent-tool-result` assertions are accepted and preserved;
- object key order does not change semantic JSON validity;
- empty/>8 lists, unknown kind, blank/oversized name, extra fields, exact duplicate assertions are rejected;
- direct parser rejects undefined/functions/symbols/bigint/non-finite/cyclic JSON values.

Run focused Protocol tests and retain the RED evidence.

## Task 2 — Reducer and stage-machine RED

Files:
- `tests/model/plugin-verify.spec.ts`
- `tests/verification/packed-worker.spec.ts`
- optional focused `tests/verification/stages.spec.ts` if current coverage is insufficient

Add failing tests proving:
- no assertions -> `behavior: skipped / no-behavior-assertions` remains verified-capable;
- requested PASS -> behavior passed;
- requested FAIL -> behavior failed + `VERIFY_BEHAVIOR_FAILED`;
- requested but no marker -> behavior skipped + reducer partial / `VERIFY_BEHAVIOR_UNPROVEN`;
- package/install/compose/boot failure skips behavior;
- requested visibility failure prevents behavior execution.

## Task 3 — Probe RED

File:
- `tests/verification/boot-probe.spec.ts`

Add failing tests proving:
- deterministic PASS/FAIL behavior markers;
- async apply only when behavior assertions exist;
- one Agent epoch is shared with Agent Tool visibility;
- calls use `tools.execute`, Agent scope, sequential ordering and fixed timeout;
- structured deep equality is used; no rendered-content comparison;
- generated source does not log names/arguments/expected/returned values.

Commit the RED test state and run CI/focused workflow before production implementation.

## Task 4 — Protocol implementation

Files:
- `spec/schemas/v1/toolchain-protocol.schema.json`
- `spec/protocol.md`
- `spec/verification.md`
- `src/protocol/request-validation.ts`
- generated `src/protocol/generated.ts`
- canonical example if protocol checks require one

Implement closed recursive JSON value schema, `PluginBehaviorAssertion`, bounded `behaviorAssertions`, robust runtime JSON validation and semantic duplicate detection. Regenerate generated DTOs using the repository generator; do not hand-maintain generated types as independent authority.

## Task 5 — Verification implementation

Files:
- `src/verification/boot-probe.ts`
- `src/verification/packed-worker.ts`
- `src/verification/stages.ts`
- `src/verification/execution-port.ts`
- `src/model/plugin-verify.ts`
- kernel/application call site(s) that thread `behaviorAssertions`

Implement marker generation, one-Agent probe execution, bounded Tool calls, structural result equality, stage propagation and reducer status/diagnostics. Keep boot process success distinct from semantic behavior failure.

## Task 6 — Frontend parity audit

Inspect CLI, native DSH and MCP `plugin.verify` projections. Because request parsing is shared, change only adapters that explicitly reconstruct/whitelist request fields. Add parity regressions where a frontend would otherwise drop `behaviorAssertions`.

Do not add a new frontend-specific behavior model.

## Task 7 — GREEN verification

Run focused tests first, then complete repository gates:

```text
pnpm check:generated
pnpm check:protocol
pnpm typecheck
pnpm test
pnpm check
```

On GitHub verify exact branch head across the normal Node 22.19/24.19/26 matrix, Windows/macOS boundary jobs, packed/public real-DSH verification paths, Performance Validation and Real Plugin Corpus smoke where PR workflows trigger them.

Record exact final HEAD, workflow/run ids, changed-file audit and any deliberate non-goals in PR #220 implementation evidence. Do not merge without explicit user authorization.
