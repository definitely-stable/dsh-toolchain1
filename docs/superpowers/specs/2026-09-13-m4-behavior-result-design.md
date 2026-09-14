# M4.3.3 Explicit Agent Tool Behavior Design

Status: proposed implementation contract for issue #220.

## Goal

Add the smallest deterministic behavior contract justified by the exact supported DeepSeek Harness runtime: explicitly invoke an Agent-visible Tool in the existing disposable verification boot and compare its canonical structured JSON success value with a caller-supplied expected JSON value.

The public opt-in assertion is:

```json
{
  "kind": "agent-tool-result",
  "name": "candidate_tool",
  "arguments": {"value": 1},
  "expectedValue": {"ok": true}
}
```

No `behaviorAssertions` preserves the existing verification contract: `behavior` stays skipped and does not block `verified`.

## Runtime authority

The exact supported DSH train `dsh-v0.1.5-rc.2` exposes `ToolRuntime.execute(ToolExecutionInput)` and returns `ToolExecutionSuccess.value` as lossless JSON. That value, not rendered content, logs, Client UI, or model-facing text, is the behavior authority for this slice.

Behavior runs through the existing Toolchain-owned verification boot probe in the same disposable DSH process/profile as boot and visibility evidence. When Agent Tool visibility and behavior are both requested, they share one Toolchain-owned Agent epoch.

## Closed Protocol vocabulary

Protocol v1 remains pre-public. Add a closed `PluginBehaviorAssertion` with:

- `kind: 'agent-tool-result'`;
- nonblank `name`, maximum 256 characters;
- `arguments`: lossless JSON value;
- `expectedValue`: lossless JSON value.

`PluginVerifyRequest.behaviorAssertions` is optional, has 1..8 entries when present, rejects unknown fields/kinds, and rejects exact duplicate assertions. Request validation must reject non-JSON direct JavaScript values, cycles, non-finite numbers and other values that cannot cross canonical JSON transport.

Eight assertions with a 10-second per-call deadline keeps the assertion budget below the existing 120-second boot-process boundary while leaving headroom for DSH startup/probe work.

## Stage semantics

The canonical order remains:

```text
package -> install -> compose -> boot -> visibility -> behavior
```

`behavior` has `boot` as its structural prerequisite because visibility is optional. The worker enforces the stronger request-specific rule: if visibility assertions were requested and visibility is not proven passed, behavior is not executed.

Outcomes:

- no behavior assertions -> `behavior: skipped / no-behavior-assertions`;
- every requested call returns success and structurally equals `expectedValue` -> `behavior: passed`;
- any Tool error, timeout/cancellation, missing/invisible Tool, invalid arguments, thrown execution, or unequal value -> `behavior: failed / verify-behavior-failed` plus `VERIFY_BEHAVIOR_FAILED`;
- requested assertions with no unambiguous PASS/FAIL evidence -> `behavior: skipped / behavior-assertions-not-executed`; reducer returns `partial` and adds `VERIFY_BEHAVIOR_UNPROVEN`.

A behavior failure is semantic verification evidence and does not turn a successful DSH process exit into infrastructure failure. The probe emits its behavior marker and exits through launcher-owned `appExit(0)`.

## Probe contract

The boot probe gains a deterministic behavior marker pair bound to profile plus the ordered assertion set:

```text
DSH_TOOLCHAIN_VERIFY_BEHAVIOR_PROBE_V1:<sha256>:PASS
DSH_TOOLCHAIN_VERIFY_BEHAVIOR_PROBE_V1:<sha256>:FAIL
```

The generated probe becomes async only when behavior assertions are present. It injects `tools` and `agentLoop`, creates exactly one Agent for all Agent Tool visibility/behavior work, and executes assertions sequentially. Sequential execution avoids introducing concurrency semantics into a compatibility proof.

Each call uses a Toolchain-owned `AbortSignal.timeout(10_000)`, deterministic opaque call id derived from assertion index, the shared Agent, requested name and exact JSON arguments. Success comparison uses structured deep equality over lossless JSON; object key insertion order is irrelevant, array order is significant, and the Protocol parser normalizes direct `-0` to JSON-equivalent `0`.

The probe must not log Tool names, arguments, expected values, returned values or failures. Public evidence is only the content-addressed marker and the stable verification diagnostic.

## Safety boundary

`executionPolicy='safe'` continues to mean disposable Toolchain-owned DSH home/process isolation and bounded execution. It is not a malicious-code sandbox. Explicit Tool execution can exercise Tool-defined side effects inside the disposable runtime and any external capabilities the candidate/runtime itself can reach.

This slice therefore does not add implicit behavior discovery, arbitrary JavaScript expressions, Host service reflection, shell commands, filesystem/network assertion DSLs, Client/page automation, or generic scripting.

The deterministic PASS/FAIL markers are verifier control-flow/evidence synchronization tokens, not authentication against adversarial candidate code executing in the same process. The current `safe` boundary therefore makes no tamper-proof receipt claim; adversarial-process attestation would require a different isolation/trust boundary and is outside this slice.

## Reducer

The shared verification reducer remains authoritative. Frontends only carry the canonical request.

A failed `behavior` check forces report `failed`. A requested-but-unexecuted behavior check forces `partial` unless a stronger status (`cancelled`, `stale`, proven failure) already applies. The historical no-assertion skip reason remains non-blocking.

## Frontend projection

CLI/native DSH/MCP keep the same canonical request parser/kernel semantics. This slice does not require a convenience CLI flag for authoring JSON behavior assertions; structured frontends can pass the Protocol field, while CLI parity may use its existing JSON/request projection if present. No frontend gets an independent behavior reducer.

## Non-goals

- Client/page visibility or browser automation;
- arbitrary Host service method execution;
- expected-error/result matching;
- behavior discovery or fuzzing;
- shell/filesystem/network-specific assertion kinds;
- new execution policies or malicious-code sandbox claims;
- M2/H1/H2, retrieval, M3 SemVer or unrelated performance changes;
- merging #218 or #219.
