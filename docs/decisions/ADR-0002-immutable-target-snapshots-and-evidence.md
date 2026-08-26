# ADR-0002: Immutable target snapshots and evidence-backed facts

- Status: Accepted
- Date: 2026-08-26

## Context

DSH is in developer preview and profile/package/runtime state can change independently while an agent is working. Reading mutable host state throughout an operation can mix facts from different configurations and produce false compatibility/verification claims.

## Decision drivers

- reproducible analysis;
- compatibility/migration diffing;
- cache safety;
- explainable results;
- correct handling of live-vs-declared capability.

## Considered options

1. Query live DSH state on every analysis rule.
2. Cache ad-hoc raw files/API responses.
3. **Acquire evidence, normalize it into an immutable `TargetSnapshot`, and bind results to its semantic fingerprint.**

## Decision

Choose option 3.

A snapshot is immutable. Compatibility-relevant input is canonicalized into a semantic fingerprint. Host-specific paths, timestamps, secrets, and session contents do not contribute to the semantic identity.

Facts retain evidence provenance. Capability and current availability are modeled separately.

Strong verification rechecks target freshness before reporting success. If the relevant target changed, the result is `stale`.

## Consequences

The acquisition layer becomes explicit and some operations require a freshness check. In return, analysis becomes deterministic and later contract-diff/migration work has a natural foundation.

## Verification

Fixture tests will prove fingerprint stability/sensitivity. Verification tests will mutate a target between start and completion and assert that `verified` is not emitted.
