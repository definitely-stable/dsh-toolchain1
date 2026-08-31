# M2 H1 OpenCode Go route attestation design

Status: **APPROVED FOR IMPLEMENTATION**  
Scope: H1 provider identity fallback only.  
Frozen H1 task count, arms, thresholds, schedule, inference and target remain unchanged.

## Problem

H1 originally required an immutable backend revision or a provider `system_fingerprint`. The production OpenCode Go route available for the experiment does not expose either signal.

Provider-only discovery run `33357952150` at repository head `a63b9aae72b2f0590a7f59e412b29e27f52bab30` probed the current non-vision OpenAI-compatible chat candidates available through OpenCode Go. All successful receipts reported `backendIdentityStrength=response-model-only`; none exposed a `systemFingerprint`. The provider secret, network path, function-tool transport and token accounting worked. This is an observability limitation of the route, not an H1 model outcome.

Requiring a hidden checkpoint fingerprint that the provider does not expose would make H1 impossible for the available subscription. Inventing a fingerprint from the model slug would be false evidence.

## Decision

H1 will support a third preregistration-grade provider identity mode:

`gateway-route-attestation`

This mode identifies the **observable OpenCode Go production route contract**, not the undisclosed model checkpoint behind that route.

The H1 estimand is therefore explicit:

> the causal effect of making frozen DSH Toolchain Contract Intelligence available to the agent when requests are served through the preregistered OpenCode Go `deepseek-v4-flash` production route under the frozen request/capability contract.

The claim is not checkpoint-specific. Internal gateway load balancing or backend selection that is invisible under the frozen route contract is part of the production service being evaluated.

`deepseek-v4-flash` remains the H1 model slug. Candidate discovery is identity research only; no candidate is selected because of quality or outcome behavior.

## Why this remains a controlled H1

Arms B and C keep the same provider, route, request model, reasoning settings, resource limits and randomized schedule. The only intended treatment difference remains Toolchain availability in Arm C.

A gateway may internally route requests differently. Because that mechanism is opaque and cannot be observed, H1 does not claim a fixed hidden checkpoint. Instead it evaluates the production route as a stochastic service. Observable route-contract drift is fail-closed.

This is preferable to either:

- fabricating a checkpoint identity from `deepseek-v4-flash`; or
- changing to a paid external provider solely to obtain a stronger fingerprint.

## Raw probe receipt

The existing `dsh-toolchain-m2-opencode-go-probe-v1` remains the network-facing provider-only receipt.

For the selected H1 route a valid witness MUST contain exactly the frozen observable settings:

- provider `opencode-go`;
- base URL `https://opencode.ai/zen/go/v1`;
- request model `deepseek-v4-flash`;
- response model `deepseek-v4-flash`;
- thinking `enabled`;
- reasoning effort `high`;
- function tool call `verified`;
- reasoning continuation `verified`;
- token measurement `verified`;
- backend identity strength `response-model-only`;
- no `systemFingerprint` key.

Input/output token counts are evidence that metering worked, but are not route-identity fields.

## Route attestation receipt

A new strict receipt is introduced:

`dsh-toolchain-m2-opencode-go-route-attestation-v1`

It is produced offline from **two sequential provider-only raw witness receipts**. The attestation contains no credentials and no H1 task bytes.

Required fields:

- `schema`;
- `provider`;
- `baseUrl`;
- `endpointFamily = chat-completions`;
- `requestModel`;
- `responseModel`;
- `adapterVersion = opencode-go-deepseek-chat-v1`;
- `thinking`;
- `reasoningEffort`;
- `functionToolCall`;
- `reasoningContinuation`;
- `tokenMeasurement`;
- `backendIdentityStrength = gateway-route-attestation`;
- `opaqueBackend = acknowledged`;
- two canonical raw-witness SHA-256 digests in observation order;
- `providerRouteFingerprint`;
- `attestationSha256`.

`providerRouteFingerprint` is SHA-256 over only the stable observable route projection:

```json
{
  "adapterVersion": "opencode-go-deepseek-chat-v1",
  "baseUrl": "https://opencode.ai/zen/go/v1",
  "endpointFamily": "chat-completions",
  "functionToolCall": "verified",
  "opaqueBackend": "acknowledged",
  "provider": "opencode-go",
  "reasoningContinuation": "verified",
  "reasoningEffort": "high",
  "requestModel": "deepseek-v4-flash",
  "responseModel": "deepseek-v4-flash",
  "thinking": "enabled",
  "tokenMeasurement": "verified"
}
```

The two raw witnesses MUST normalize to the same projection. A mismatch rejects attestation creation.

`attestationSha256` hashes the complete canonical attestation without the `attestationSha256` field, including both witness digests. This binds the actual pre-prereg observations while keeping the route fingerprint repeatable across later guard probes.

## H1 provider identity model

`H1ProviderIdentityV2` becomes discriminated by `backendIdentityStrength`:

### Backend-bound modes

For `system-fingerprint` or `immutable-revision`:

- `backendFingerprint` is a non-empty string;
- `providerRouteFingerprint` is `null`.

### Route-attested mode

For `gateway-route-attestation`:

- `backendFingerprint` is `null`;
- `providerRouteFingerprint` is a lowercase SHA-256 digest;
- `identityReceiptSha256` is the route-attestation receipt hash.

A plain `response-model-only` identity remains insufficient for H1 readiness.

## Execution binding

The frozen execution definition and ledger MUST bind:

- provider identity receipt SHA-256;
- provider identity strength;
- expected response model;
- expected backend fingerprint, nullable;
- expected provider-route fingerprint, nullable.

No synthetic `systemFingerprint` may be written for route-attested execution.

For a route-attested model outcome:

- `responseModel` MUST equal the frozen response model;
- provider metadata MUST contain `systemFingerprint: null` when the provider still omits it;
- the ledger records that null explicitly rather than substituting the route hash.

For backend-bound modes the existing non-empty fingerprint equality check remains unchanged.

## Pre/post route guards

Route-attested H1 requires a fresh two-witness route attestation:

1. immediately before the first H1 provider task is authorized;
2. immediately after the final scheduled attempt and before a PASS/NEEDS-IMPROVEMENT result can be accepted.

Both guard attestations MUST have the same `providerRouteFingerprint` as the preregistered identity.

Guard policy is frozen into the execution definition:

```json
{
  "mode": "pre-and-post",
  "requiredBeforeFirstProviderTask": true,
  "requiredBeforeTerminalScoring": true,
  "onObservableDrift": "INCONCLUSIVE"
}
```

Observable drift includes any change in the stable route projection, including model slug/response model, thinking/reasoning settings, required tool continuation, token measurement, or identity mode.

The implementation MUST expose a deterministic validator that returns MATCH or DRIFT for a fresh route attestation. Live H1 orchestration MUST call it at both boundaries before H1 execution can be considered complete.

## Limits of the guarantee

Route attestation cannot detect a hidden checkpoint swap that preserves every observable field in the route projection. The public preregistration receipt and final H1 report MUST state this limitation.

Accordingly H1 may support the product-level statement "Toolchain improves agent behavior through the OpenCode Go production route" but MUST NOT support a checkpoint-specific statement such as "Toolchain improves DeepSeek checkpoint X" unless a stronger backend identity becomes available.

## Public/private boundary

Public before H1:

- route-attestation receipt and its hashes;
- provider route identity mode;
- route guard policy;
- frozen H1 task count/schedule/thresholds already allowed by the preregistration protocol.

Private until terminal H1:

- task prompts;
- success rules;
- dataset construction/provenance audit;
- all credentials.

Raw provider witness receipts contain no credentials or H1 task bytes and may be retained as experiment evidence.

## Non-goals

This change does not:

- modify the 96-task holdout;
- change Arm A/B/C semantics;
- change H1 thresholds or inference;
- tune retrieval from R1/P0 outcomes;
- infer or name an undisclosed OpenCode backend checkpoint;
- choose a model based on candidate quality;
- authorize H1 before the public preregistration receipt and immutable ref exist.
