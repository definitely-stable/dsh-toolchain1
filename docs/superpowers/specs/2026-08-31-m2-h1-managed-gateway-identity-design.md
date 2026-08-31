# M2 H1 Managed-Gateway Identity Design

## Decision

H1 measures DSH Toolchain under the managed OpenCode Go route actually available to the operator. The experiment remains frozen to `https://opencode.ai/zen/go/v1` with request and response model `deepseek-v4-flash`, thinking enabled, reasoning effort high, verified function-tool calling, verified reasoning continuation, and provider token accounting.

A hidden upstream checkpoint is not part of the H1 identity because OpenCode Go does not expose an immutable revision or `system_fingerprint`. The provider-only candidate scan on main confirmed that this signal is unavailable across the current text/chat Go pool. H1 must not manufacture or infer a backend fingerprint from a model slug.

## Provider commitment

The preregistration input remains the canonical provider probe receipt. Finalization accepts it only when all frozen managed-gateway observations are exact:

- schema `dsh-toolchain-m2-opencode-go-probe-v1`;
- provider `opencode-go`;
- base URL `https://opencode.ai/zen/go/v1`;
- request model `deepseek-v4-flash`;
- response model `deepseek-v4-flash`;
- thinking `enabled`;
- reasoning effort `high`;
- function tool call `verified`;
- reasoning continuation `verified`;
- token measurement `verified`;
- non-negative integer input/output token evidence.

The committed H1 identity records `identityMode: managed-gateway` plus the SHA-256 of that exact probe receipt. Raw probe facts may state `backendIdentityStrength: response-model-only` and may omit a system fingerprint. Those facts are evidence of the provider's observable boundary, not a reason to invent a stronger identity.

## Runtime boundary

Every H1 attempt remains bound to the same provider receipt, endpoint, request model, expected response model, adapter settings, and frozen resource policy. The child process must still fail closed if OpenCode Go returns a response model other than `deepseek-v4-flash` or if required provider configuration drifts.

`system_fingerprint` is observational metadata only. It is neither required in the child environment nor used as a ledger acceptance condition. If OpenCode starts returning it, evidence may retain it without changing the preregistered experimental identity.

## Experiment claim

A terminal H1 result may support claims only about the preregistered managed environment: OpenCode Go serving `deepseek-v4-flash` with the frozen H1 harness during the execution window. It does not claim a specific hidden checkpoint, host, or physical backend.

This preserves the causal comparison between arms because all arms use the same sequential schedule, provider route, model slug, settings, resource envelope, and execution harness. Provider-internal routing that is neither exposed nor controllable is treated as part of the managed service, not as a falsely measurable covariate.

## Frozen H1 invariants not changed

This change does not alter the hidden task set contract, the 96-task count, A/B/C arms, three trials per task/arm, the 864-entry seeded schedule, concurrency 1, target `@deepseek-ai/dsh@0.1.1-rc.2` Web composition, Truth v2, task adjudicator, MCID 0.10, task-success non-inferiority margin 0.05, bootstrap method, confidence level, seeds, resource caps, or retry semantics.

## Operational simplification

The operating provider workflow returns to one provider-only `deepseek-v4-flash` probe. The 14-model discovery matrix is removed so routine H1 preparation cannot consume quota on unrelated models. The probe CLI may retain explicit model selection for diagnostics, but H1 does not use it.

No route-attestation subsystem, repeated pre/post witness protocol, hidden checkpoint heuristic, or additional network service is introduced.

## Security and disclosure

Provider credentials remain environment-only and are never committed to receipts. Provider probes never receive hidden H1 task bytes. The public preregistration receipt continues to disclose only commitments, frozen execution identity, and provider configuration/evidence hashes; hidden prompts, success rules, credentials, and outcome material remain excluded.