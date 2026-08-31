# M2 H1 OpenCode Go Route Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make H1 preregistrable and later executable through the user's existing OpenCode Go subscription without inventing a hidden checkpoint identity.

**Architecture:** Preserve the existing raw provider probe as network evidence, add an offline two-witness route-attestation layer, and extend the H1 provider identity/binding contracts with a discriminated `gateway-route-attestation` mode. Execution evidence records the real nullable provider fingerprint; a frozen pre/post route guard compares fresh attestation fingerprints and makes observable drift fail closed to `INCONCLUSIVE`.

**Tech Stack:** Node.js 24, TypeScript 6, Vitest 4, GitHub Actions, existing canonical JSON/SHA-256 ports.

**Spec:** `docs/superpowers/specs/2026-08-31-m2-h1-opencode-go-route-attestation-design.md`

## Global Constraints

- Keep `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`, target/index/workspace identities unchanged.
- Keep H1 at 96 tasks, 864 schedule entries, 3 trials/task/arm, concurrency 1, MCID 0.10 and non-inferiority margin 0.05.
- Keep H1 model slug `deepseek-v4-flash`; candidate discovery must not become model-quality selection.
- `response-model-only` alone remains insufficient for H1 readiness.
- Route-attested mode must never fabricate a `systemFingerprint`.
- Hidden task bytes and credentials never enter public receipts/workflows.
- No H1 provider task may run before public preregistration is on protected main and bound to an immutable ref.

---

### Task 1: Retain provider discovery evidence

**Files:**
- Create: `docs/evaluation/m2/h1-opencode-go-provider-discovery-v1.json`
- Test: `tests/evaluation/m2-h1-provider-discovery-evidence.spec.ts`

**Interfaces:**
- Consumes: provider-only run `33357952150` at `a63b9aae72b2f0590a7f59e412b29e27f52bab30`.
- Produces: immutable public summary establishing that all 14 tested chat candidates lacked a system fingerprint.

- [ ] **Step 1: Write the failing evidence test**

Require exact run/head identity, 14 unique candidates, all `functionToolCall=verified`, all `tokenMeasurement=verified`, all `backendIdentityStrength=response-model-only`, zero `systemFingerprint` fields, and conclusion `NO_STRONG_BACKEND_IDENTITY_AVAILABLE`.

- [ ] **Step 2: Run the exact spec and confirm RED because the evidence file is absent**

Run: `pnpm vitest run tests/evaluation/m2-h1-provider-discovery-evidence.spec.ts`

- [ ] **Step 3: Add the normalized non-secret discovery JSON**

Store only model slug plus observable capability/identity outcomes; omit credentials, raw completions and task material.

- [ ] **Step 4: Run the exact spec and confirm GREEN**

- [ ] **Step 5: Commit**

`docs(m2): retain OpenCode Go identity discovery evidence`

### Task 2: Add deterministic route-attestation core

**Files:**
- Create: `tests/evaluation/m2-h1-provider-route-attestation-v2.ts`
- Create: `tests/evaluation/m2-h1-provider-route-attestation-v2.spec.ts`

**Interfaces:**
- Produces:
  - `createH1ProviderRouteAttestationV2(firstReceipt, secondReceipt, sha256)`
  - `commitH1ProviderRouteAttestationV2(value, sha256)`
  - `validateH1ProviderRouteGuardV2(expectedRouteFingerprint, value, sha256)`
  - `H1_PROVIDER_ROUTE_GUARD_POLICY_V2`

Attestation output fields are exactly those frozen by the design spec, including `providerRouteFingerprint` and `attestationSha256`.

- [ ] **Step 1: Write RED tests**

Cover valid two-witness creation; token-count variation not changing route fingerprint; witness hash binding; missing reasoning continuation; response-model drift; unexpected system fingerprint; wrong provider/base URL/model; malformed SHA; attestation tamper; and guard MATCH/DRIFT.

- [ ] **Step 2: Run the new spec and confirm RED**

- [ ] **Step 3: Implement minimal canonical validation/hashing**

The route projection must contain only:

```ts
{
  adapterVersion: 'opencode-go-deepseek-chat-v1',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  endpointFamily: 'chat-completions',
  functionToolCall: 'verified',
  opaqueBackend: 'acknowledged',
  provider: 'opencode-go',
  reasoningContinuation: 'verified',
  reasoningEffort: 'high',
  requestModel: 'deepseek-v4-flash',
  responseModel: 'deepseek-v4-flash',
  thinking: 'enabled',
  tokenMeasurement: 'verified',
}
```

Raw witness token counts are validated but excluded from this projection.

- [ ] **Step 4: Run the new spec and confirm GREEN**

- [ ] **Step 5: Commit**

`verify(m2): add H1 provider route attestation`

### Task 3: Extend H1 provider identity/readiness/finalization

**Files:**
- Modify: `tests/evaluation/m2-h1-readiness-v2.ts`
- Modify: `tests/evaluation/m2-h1-provider-identity-v2.ts`
- Modify: `tests/evaluation/m2-h1-finalization-v2.ts`
- Modify: `tests/evaluation/m2-h1-provider-identity-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-readiness-v2.spec.ts`
- Modify: `tests/evaluation/m2-h1-finalization-v2.spec.ts`

**Interfaces:**
- `H1ProviderIdentityV2` adds `providerRouteFingerprint: string | null`.
- `backendIdentityStrength` adds `gateway-route-attestation`.
- Finalization accepts either legacy backend-bound identity evidence or the new route-attestation schema through one provider-evidence commit boundary.

- [ ] **Step 1: Write RED tests**

Require route-attested identities to be READY only when `backendFingerprint=null`, `providerRouteFingerprint=<sha256>` and identity receipt SHA is valid. Continue rejecting bare `response-model-only`. Preserve legacy strong fingerprint tests.

- [ ] **Step 2: Run focused specs and confirm RED**

- [ ] **Step 3: Implement the discriminated identity validator and generalized provider-evidence commit**

Do not weaken `system-fingerprint`/`immutable-revision` validation.

- [ ] **Step 4: Run focused specs and confirm GREEN**

- [ ] **Step 5: Commit**

`verify(m2): accept route-attested H1 provider identity`

### Task 4: Bind route identity through execution, preregistration and durable ledger

**Files:**
- Modify: `tests/evaluation/m2-h1-execution-definition-v2.ts`
- Modify: `tests/evaluation/m2-h1-preregistration-receipt-v2.ts`
- Modify: `tests/evaluation/m2-h1-run-ledger-v2.ts`
- Modify: `tests/evaluation/m2-h1-run-store-v2.ts`
- Modify: `tests/evaluation/m2-h1-attempt-coordinator-v2.ts`
- Update corresponding `*.spec.ts` files.

**Interfaces:**
- `H1LedgerBindingV2` adds:
  - `providerIdentityStrength`
  - `expectedBackendFingerprint: string | null`
  - `expectedProviderRouteFingerprint: string | null`
- model-outcome provider metadata keeps `responseModel` and stores real `systemFingerprint: string | null`.
- execution definition freezes the route guard policy and exposes its ContentRef in preregistration evidence.

- [ ] **Step 1: Write RED tests for route-attested execution binding**

Require executor identity and ledger header to carry the route fingerprint without a fake backend fingerprint. Require route mode model attempts to accept `systemFingerprint=null`, reject a forged route hash in that field, and keep exact response-model matching. Legacy fingerprint mode must still require exact non-null equality.

- [ ] **Step 2: Write RED tests for the frozen guard policy in execution/preregistration**

Require `pre-and-post`, `requiredBeforeFirstProviderTask=true`, `requiredBeforeTerminalScoring=true`, `onObservableDrift=INCONCLUSIVE` and a hash-bound ContentRef.

- [ ] **Step 3: Run focused specs and confirm RED**

- [ ] **Step 4: Implement the discriminated binding and nullable real fingerprint**

Update pending-attempt intent hashing/validation so crash recovery binds the same route identity fields.

- [ ] **Step 5: Implement guard-policy ContentRef and preregistration projection validation**

- [ ] **Step 6: Run all affected H1 execution/store/coordinator/preregistration specs and confirm GREEN**

- [ ] **Step 7: Commit**

`verify(m2): bind H1 execution to provider route attestation`

### Task 5: Add operator command and GitHub route-attestation workflow

**Files:**
- Create: `scripts/attest-m2-opencode-go-route.mjs`
- Create: `tests/evaluation/m2-opencode-go-route-attestation-command.spec.ts`
- Create: `.github/workflows/m2-h1-route-attestation.yml`
- Create: `tests/policy/m2-h1-route-attestation-workflow.spec.ts`
- Modify: `package.json`

**Interfaces:**
- CLI:
  `node scripts/attest-m2-opencode-go-route.mjs --receipt-a <json> --receipt-b <json> --output <new-json>`
- package script:
  `m2:h1:attest-route`
- workflow performs exactly two sequential `deepseek-v4-flash` provider-only probes, creates the attestation offline, and uploads the two witnesses plus attestation with short retention.

- [ ] **Step 1: Write RED command/workflow policy tests**

Require atomic no-overwrite output, strict arguments, no network inside the attestation command, exactly two probe invocations in workflow, `OPENCODE_API_KEY` only on probe steps, no H1 dataset/prereg/execution command, read-only permissions.

- [ ] **Step 2: Run focused specs and confirm RED**

- [ ] **Step 3: Implement command by compiling/importing the existing evaluation helper pattern without duplicating route-attestation rules**

- [ ] **Step 4: Implement dedicated provider-only workflow**

- [ ] **Step 5: Run focused specs and confirm GREEN**

- [ ] **Step 6: Commit**

`verify(m2): add OpenCode Go H1 route attestation workflow`

### Task 6: Update publication/status documentation and full verification

**Files:**
- Modify: `docs/evaluation/m2/h1-preregistration-publication-v2.md`
- Modify: `docs/evaluation/m2/status.md`
- Modify: `docs/roadmap.md` only if the operational status text currently claims fingerprint-only H1.

**Interfaces:**
- Public docs explicitly distinguish route identity from checkpoint identity.
- They state that hidden checkpoint drift preserving all observable route fields is not detectable.

- [ ] **Step 1: Add/update doc-integrity assertions if existing tests enforce these operational statements**

- [ ] **Step 2: Update docs with the exact command/workflow and guard semantics**

- [ ] **Step 3: Run focused H1 specs**

Run: `pnpm vitest run tests/evaluation/m2-h1-*.spec.ts tests/evaluation/m2-opencode-go-route-attestation-command.spec.ts tests/policy/m2-h1-route-attestation-workflow.spec.ts`

- [ ] **Step 4: Run aggregate repository gate**

Run: `pnpm run check`

- [ ] **Step 5: Run build**

Run: `pnpm run build`

- [ ] **Step 6: Push/open PR and require exact-head CI success on all repository jobs**

- [ ] **Step 7: After merge, require post-merge CI success and inspect the automatically generated real route-attestation artifact before proceeding to real H1 preregistration**
