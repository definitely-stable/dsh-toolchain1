# Implicit runtime target binding — 2026-09-19

## Status

**COMPLETE / PROVIDER-FREE SURFACE MEASUREMENT**, pending the enclosing PR's full exact-head CI/merge
gate.

This result measures the advertised native DSH Agent surface after the target input stopped being a
repeated canonical request. It does not change canonical Toolchain Protocol v1 DTOs, the kernel,
acquisition, `dsh-target-v2`, `dsh-contract-index-v1`, search ranking, `plugin.check` semantics, the
verification reducer, or any CLI/MCP payload.

Design decision: [`ADR-0011`](../../decisions/ADR-0011-implicit-runtime-target-binding.md).
Normative rule: [`spec/protocol.md`](../../../spec/protocol.md) § Runtime target binding.
Canonical machine receipt: [`agent-surface-implicit-target-v1.json`](agent-surface-implicit-target-v1.json).

## Production boundary

Every target-bound operation keeps an explicit canonical `target` request. What changed is only the
native Agent surface: it advertises one optional flat `profile` and derives the canonical request at
the adapter boundary.

- `profile` omitted — the adapter binds the exact target this Host is running in: the profile of the
  official launcher invocation, the Host-provided DSH home, no ordered `--patch` overlay, and the
  immutable epoch captured when Toolchain mounted. Each call re-resolves that request read-only and
  requires the resolved `(dsh-target-v2, dsh-profile-lifecycle-v1?)` pair to equal the captured one.
- `profile` supplied — the profile is resolved inside the Host's own DSH home, read-only, exactly as
  before.
- Acquisition hints (`dshHome`, `dshPackageRoot`, `patches`) are no longer model-facing at all.

An omitted profile that cannot be bound is a request-formation failure with a stable code:
`TARGET_RUNTIME_BINDING_UNAVAILABLE` when no running target was proven, and
`TARGET_RUNTIME_BINDING_CHANGED` when the captured epoch no longer matches the current resolution.
Neither silently substitutes a target, and both name the recovery of passing an explicit profile.

## Measured result

The measurement harness is the same deterministic, zero-token one that produced the historical
baseline: `tests/evaluation/m2-model-surface-baseline.ts` over the canonical `spec/examples/v1`
fixtures. The new receipt is produced by `tests/evaluation/m2-implicit-target-surface.spec.ts`, which
also enforces that every advertised definition is *strictly* smaller than the recorded baseline and
that no advertised parameter schema carries a nested `target`.

| | Bytes |
| --- | ---: |
| Advertised before (five tools, historical baseline) | 5,900 |
| Advertised after (five tools) | 4,319 |
| Saved | **−1,581** |
| Withheld after (three tools) | 1,987 |

Per-tool advertised bytes after the change: `target.resolve` 450, `contract.search` 799,
`contract.inspect` 829, `plugin.check` 692, `plugin.verify` 1,549. Every one of them is smaller than
its recorded baseline value, because the nested canonical target schema was repeated in each.

The historical `docs/evaluation/m2/agent-surface-baseline-v1.json` is deliberately **not** rewritten:
it stays the pre-change snapshot the reduction is stated against, exactly as the compactness and
Inspect-compaction baselines do.

## What this measurement is not

The receipt records UTF-8 bytes of advertised `name`, `description` and `parameters`. It does not
measure provider tokens, billed cost, wall time, model quality, or end-to-end task success, and it
must not be read as any of those. Whether an Agent actually spends fewer calls because it no longer
has to discover a profile name before its first useful call is a provider-backed question that
requires its own preregistered measurement; the disclosed public ablation on this lane is separate
work.

## Verification boundary

- `tests/dsh/ambient-target-binding.spec.ts` proves the binding paths: explicit profile with and
  without a Host home, a proven mount-time epoch, every unavailable case, and drift on either
  fingerprint axis.
- `tests/dsh/target-tool.spec.ts` proves the native surface end to end against a materialized Host
  home, including that a nested canonical `target` is rejected and that an omitted profile binds the
  running target.
- `tests/frontends/contract-parity.spec.ts` and `tests/frontends/target-parity.spec.ts` prove CLI,
  native DSH and MCP still project the same semantics for the same target.
- Full CI remains the authoritative cross-Node/platform/package/composition gate.
