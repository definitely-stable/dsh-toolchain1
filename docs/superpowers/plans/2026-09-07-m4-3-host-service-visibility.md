# M4.3.1 Host Service Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend public `plugin.verify` with an optional, closed Host Service visibility assertion that is proven in the existing isolated DSH runtime and is required only when explicitly requested.

**Architecture:** Preserve the existing single verification path: Protocol request -> shared kernel -> execution port -> packed worker -> Toolchain-owned probe -> shared reducer. The probe runs as verification instrumentation in the same disposable profile after candidate composition, emits the existing boot marker first, then emits one deterministic visibility marker only when every requested Host Service is visible from the probe Cordis context. No-assertion requests preserve M4.2 behavior exactly.

**Tech Stack:** TypeScript 6, Node 22/24/26, Vitest, JSON Schema 2020-12/Ajv, Cordis/DSH runtime, pnpm, GitHub Actions.

**Spec:** `spec/verification.md`, Issue #193.

## Global Constraints

- Protocol v1 remains pre-public; schema/spec/generated DTO/request parser/implementation must change atomically.
- Only `{"kind":"host-service","name":"<service>"}` is supported in M4.3.1.
- Tool visibility remains deferred because DSH `Tool.listTools` is Agent-scoped.
- Client/page visibility remains deferred until deterministic page identity exists.
- No behavior assertions, trusted policy, or `Operation` lifecycle in this slice.
- No changes to `dsh-target-v2`, `dsh-contract-index-v1`, `dsh-plugin-subject-v1`, `dsh-plugin-artifact-v1`, Contract Search/ranker, H1/H2, or evaluation semantics.
- `safe` remains an isolation policy, not a malicious-code sandbox.
- Existing `plugin.verify` without visibility assertions must remain `verified` when the M4.2 required checks pass and must retain `visibility: skipped / no-visibility-assertions`.

---

### Task 1: Close the Protocol request shape

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify: `src/protocol/generated.ts`
- Modify: `src/protocol/request-validation.ts`
- Modify: `spec/protocol.md`
- Test: `tests/protocol/plugin-verify-visibility.spec.ts`
- Test: `tests/protocol/plugin-verify-schema.spec.ts`

**Interfaces:**
- Produces: `PluginVisibilityAssertion = { kind: 'host-service'; name: string }`.
- Produces: optional `PluginVerifyRequest.visibilityAssertions: PluginVisibilityAssertion[]`.
- Validation: when present, array length `1..32`; each object is closed; `name` is non-blank and at most 256 UTF-16 code units; duplicate `(kind,name)` pairs are rejected.

- [ ] **Step 1: Write RED Protocol/request-parser tests**

Add tests proving one/multiple Host Service assertions are accepted and preserved, while empty arrays, blank/oversized names, unknown kinds/properties and duplicate assertions are rejected.

- [ ] **Step 2: Run targeted tests and record RED**

Run: `pnpm vitest run tests/protocol/plugin-verify-visibility.spec.ts tests/protocol/plugin-verify-schema.spec.ts`

Expected: FAIL because current closed request rejects `visibilityAssertions` and generated DTO lacks `PluginVisibilityAssertion`.

- [ ] **Step 3: Implement the minimal closed schema and parser**

Schema shape:

```json
"pluginVisibilityAssertion": {
  "type": "object",
  "additionalProperties": false,
  "required": ["kind", "name"],
  "properties": {
    "kind": { "const": "host-service" },
    "name": { "type": "string", "minLength": 1, "maxLength": 256, "pattern": "\\S" }
  }
}
```

`pluginVerifyRequest.visibilityAssertions` is optional with `minItems: 1`, `maxItems: 32`, items referencing that definition. `parsePluginVerifyRequest()` performs the same structural checks and explicit duplicate detection.

- [ ] **Step 4: Regenerate/verify Protocol DTOs**

Run: `node scripts/generate-protocol.mjs` then `node scripts/generate-protocol.mjs --check`.

Expected generated request:

```ts
export type PluginVisibilityAssertion = {
  readonly "kind": "host-service"
  readonly "name": string
}

export type PluginVerifyRequest = {
  readonly "target": TargetResolveRequest
  readonly "subject": PluginPackedSubjectRequest
  readonly "executionPolicy": "safe"
  readonly "visibilityAssertions"?: Array<PluginVisibilityAssertion>
}
```

- [ ] **Step 5: Run targeted tests GREEN and commit**

Run the two Protocol tests plus `pnpm run check:generated && pnpm run check:protocol`.

Commit: `feat(protocol): add host service visibility assertions`

---

### Task 2: Make requested visibility a reducer requirement

**Files:**
- Modify: `src/model/plugin-verify.ts`
- Test: `tests/model/plugin-verify.spec.ts`

**Interfaces:**
- Consumes worker `visibility` check.
- Produces unchanged M4.2 baseline when reason is `no-visibility-assertions`.
- A visibility check is required whenever it does not represent the explicit no-assertion baseline.

- [ ] **Step 1: Write RED reducer tests**

Add cases:

```ts
visibility: { id: 'visibility', status: 'failed', reason: 'verify-visibility-failed' }
```

with `terminal: 'completed'` must produce report `failed`, and:

```ts
visibility: { id: 'visibility', status: 'skipped', reason: 'visibility-assertions-not-executed' }
```

must produce `partial`. Existing `no-visibility-assertions` stays `verified`.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/model/plugin-verify.spec.ts`

Expected: requested visibility failure/incompleteness is incorrectly ignored by current fixed required-check set.

- [ ] **Step 3: Implement dynamic required visibility**

Keep the fixed M4.2 required IDs unchanged and add one predicate:

```ts
function visibilityRequested(checks: readonly VerificationCheck[]): boolean {
  const visibility = checks.find(check => check.id === 'visibility')
  return visibility !== undefined
    && !(visibility.status === 'skipped' && visibility.reason === 'no-visibility-assertions')
}
```

Use it so requested `visibility: failed` contributes to required failure and requested non-passed visibility contributes to required incompleteness.

- [ ] **Step 4: Run reducer tests GREEN and commit**

Commit: `feat(verify): require explicitly requested visibility`

---

### Task 3: Prove Host Service visibility in the packed worker

**Files:**
- Modify: `src/verification/boot-probe.ts`
- Modify: `src/verification/packed-worker.ts`
- Modify: `src/verification/diagnostics.ts`
- Test: `tests/verification/boot-probe.spec.ts`
- Test: `tests/verification/packed-worker.spec.ts`

**Interfaces:**
- `createVerificationBootProbe(root, profile, visibilityAssertions?)` returns existing `marker` plus optional `visibilityMarker`.
- Worker input uses typed `PluginVisibilityAssertion[]`.
- Stable missing-visibility diagnostic: `VERIFY_VISIBILITY_FAILED`.

- [ ] **Step 1: Write RED probe/worker tests**

Prove:
- no assertions preserve the exact old boot probe output and no visibility marker;
- assertions produce a deterministic marker independent of assertion order;
- successful boot stdout with both markers yields `boot: passed`, `visibility: passed`;
- successful boot stdout with boot marker but no visibility marker yields `boot: passed`, `visibility: failed`, diagnostic `VERIFY_VISIBILITY_FAILED`, terminal `failed`;
- visibility never passes before boot.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/verification/boot-probe.spec.ts tests/verification/packed-worker.spec.ts`.

- [ ] **Step 3: Extend the Toolchain-owned probe**

For each Host Service assertion, evaluate live visibility with Cordis `rootCtx.get(name)`. The generated probe emits the existing boot marker before visibility evaluation. Missing/throwing lookups are treated as not visible. Only if every assertion resolves to a non-`undefined` value does the probe emit the exact visibility marker. It then uses launcher-owned `appExit(0)` so a missing service remains a visibility-stage failure rather than a boot-process failure.

- [ ] **Step 4: Reduce worker stdout into distinct stages**

After a clean process and exact boot marker:
- pass `boot`;
- no assertions: retain skipped baseline;
- assertions + exact visibility marker: pass `visibility`;
- assertions + missing marker: fail `visibility` with `VERIFY_VISIBILITY_FAILED`.

- [ ] **Step 5: Run verification tests GREEN and commit**

Commit: `feat(verify): prove host service visibility`

---

### Task 4: Thread assertions through kernel and frontends

**Files:**
- Modify: `src/model/plugin-verify.ts`
- Modify: `src/kernel/index.ts`
- Modify: `src/verification/execution-port.ts`
- Modify: `src/frontends/cli/index.ts`
- Modify: `src/integrations/dsh/plugin-verify-tool.ts`
- Test: `tests/kernel/plugin-verify.spec.ts`
- Test: `tests/verification/execution-port.spec.ts`
- Test: `tests/cli/plugin-verify.spec.ts`
- Test: `tests/dsh/plugin-verify-tool.spec.ts`
- Test: `tests/mcp/plugin-verify.spec.ts`

**Interfaces:**
- Add `visibilityAssertions?: readonly PluginVisibilityAssertion[]` to `PluginVerificationExecutionInput`.
- Kernel copies canonical request assertions into the execution port unchanged.
- CLI flag: repeatable `--visibility-service <service>`; CLI converts only syntax to canonical Protocol assertions and calls `parsePluginVerifyRequest()`.
- Native DSH tool schema exposes optional `visibilityAssertions` matching Protocol.
- MCP automatically projects the canonical JSON Schema and parser; no MCP-local verifier logic.

- [ ] **Step 1: Write RED propagation/parity tests**

Assert the exact canonical assertion reaches the injected execution port from kernel, CLI parses repeated flags, DSH tool accepts canonical request shape, and MCP callback preserves the assertion.

- [ ] **Step 2: Run targeted RED tests**

- [ ] **Step 3: Implement minimal forwarding**

No frontend computes status or performs visibility checks.

- [ ] **Step 4: Run targeted frontend/kernel tests GREEN and commit**

Commit: `feat(frontends): project verification visibility assertions`

---

### Task 5: Real DSH public-path acceptance and documentation

**Files:**
- Modify: `scripts/smoke-plugin-verify.mjs`
- Modify: `tests/policy/plugin-verify-smoke-policy.spec.ts`
- Modify: `.github/workflows/ci.yml` only if the existing public verify step cannot exercise the new assertion through its current script.
- Modify: `spec/verification.md`
- Modify: `README.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Smoke candidate provides `dshToolchainVerifySmokeService` with Cordis `ctx.provide()` during candidate `apply`.
- Installed CLI invocation adds `--visibility-service dshToolchainVerifySmokeService`.
- Receipt must be `verified` and `visibility` must be exactly `{ id: 'visibility', status: 'passed' }`.

- [ ] **Step 1: Write/update RED smoke policy**

Require the public smoke script to request a Host Service assertion and prohibit direct packed-worker imports.

- [ ] **Step 2: Update the packed candidate and public CLI invocation**

Candidate source:

```js
export function apply(ctx) {
  ctx.provide('dshToolchainVerifySmokeService', Object.freeze({ ready: true }))
}
```

The smoke remains bound to `@deepseek-ai/dsh@0.1.1-rc.2`, exact candidate `.tgz` bytes, exact target fingerprint, disposable worker, and unchanged active profile.

- [ ] **Step 3: Update normative/product docs**

Document Host Service as the first supported explicit visibility assertion; keep Tool/Client/behavior/Operation explicitly deferred.

- [ ] **Step 4: Run full verification**

Run:
- `pnpm check`
- `pnpm build`
- package/installed-public smoke
- exact real-DSH public `plugin.verify` smoke

Then require GitHub Actions GREEN on Node 22.19/24.19/26, Windows 2025, macOS 15, packed artifact checks, exact DSH composition and target-resolution lanes.

- [ ] **Step 5: Review, update PR evidence, merge with expected-head guard**

No merge until exact PR-head CI is completely GREEN and there are no unresolved review threads.
