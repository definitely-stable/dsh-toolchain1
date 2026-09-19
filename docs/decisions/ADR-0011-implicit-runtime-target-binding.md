# ADR-0011: Implicit runtime target binding for the native DSH agent surface

- Status: Accepted
- Date: 2026-09-19
- Related: ADR-0002, ADR-0007, ADR-0010, post-H2 agent-surface lane (`docs/roadmap.md`)

## Context

Every target-bound Toolchain operation takes the closed `TargetResolveRequest` as its `target`
input, and the native DSH Agent Tools republish that request as a required nested object on every
advertised tool. H2 measured what that costs. An Agent Tool is paid for on every turn whether or not
the Agent calls it, so the nested `target` object — `profile` plus three acquisition hints — is
repeated in the parameter schema of five tools, and the Agent must additionally discover or guess
the profile name before it can ask any question at all.

Toolchain already knows the exact target of the Host it is mounted in. When the DSH Host is launched
through the official profile invocation, `src/integrations/dsh/index.ts` captures one immutable
startup epoch at mount (ADR-0007 `dsh-target-v2` plus the ADR-0010 lifecycle fingerprint when the
train carries one), and `createDshRuntimeTargetBinding` proves whether a freshly resolved snapshot is
that same running target. That proof currently gates live Inspect enrichment only.

The acquisition hints are a second problem. `dshHome`, `dshPackageRoot` and `patches` are machine
paths and ordered overlay paths. They belong to an operator, a CI job or a CLI invocation; exposing
them to a coding model invites the model to point acquisition at an unrelated installation and pays
model-visible bytes for a capability the model has no measured use for.

## Decision drivers

- model-facing cost: the advertised surface is paid on every turn, not per call;
- exactness: only the immutable startup epoch of the running Host may be bound implicitly, never a
  mutable `~/.dsh` re-read, a launch-profile guess, or a default fallback;
- fail-closed behavior: a binding that cannot be proven must be a loud, actionable failure rather
  than a silent substitution;
- layering: the kernel and the canonical Protocol stay transport-neutral and explicit-input; IO and
  Host identity belong to the DSH boundary;
- no second contract: CLI, MCP, Web and the `ctx.toolchain` service keep the canonical, explicitly
  target-bound requests they have today.

## Considered options

1. **Keep the explicit nested target on every native tool.** No new failure mode, but it keeps both
   halves of the measured cost: repeated schema bytes and profile discovery before the first useful
   call.
2. **Make `target` optional in the canonical Protocol request and resolve it inside the kernel.** A
   single rule for every frontend, but it pushes a Host/runtime concept into the transport-neutral
   contract, forces CLI and MCP to define a failure for a request shape they can never satisfy, and
   makes the kernel's input implicit — contrary to ADR-0002.
3. **Bind implicitly at the Host-scoped frontend boundary, and keep the canonical request explicit
   (chosen).** The native DSH adapter derives an explicit `TargetResolveRequest` from the proven
   running target when the Agent omits `profile`, and calls the same kernel use case with it.
4. **Remember a target per Agent session after the first explicit call.** Removes the argument from
   later calls without a Host proof, but introduces hidden mutable state, an invalidation problem and
   a second source of target truth next to the immutable startup epoch.

## Decision

Choose option 3.

The native DSH Agent Tools advertise one optional flat `profile` string instead of the nested
`target` object. Acquisition hints are no longer model-facing at all.

- `profile` supplied explicitly — the adapter resolves that profile inside the Host's own DSH home,
  read-only, exactly as today. Other hints stay unavailable to a model.
- `profile` omitted — the adapter binds the running Host target implicitly: the profile of the
  official launcher invocation, the Host-provided DSH home, no `--patch` overlays, and the immutable
  startup epoch captured when Toolchain mounted. The call re-resolves that request read-only and
  requires the resolved epoch to equal the captured one before the operation runs.

The operation that reaches the kernel is always a canonical, explicitly target-bound Protocol
request. The response is the unchanged Protocol v1 response, so a result produced from an implicit
binding still identifies the exact `snapshotFingerprint` it was produced against.

### Runtime binding evidence

An implicit binding exists only when all of the following hold at mount:

- the Host exposes the DSH home capability (`dshHomePath()`) and the root context base URL;
- the process was started through the official profile invocation, so the running profile is known
  without guessing;
- the invocation carries no `--patch` overlay, because upstream publishes no boot-time overlay
  attestation that could be compared later;
- one read-only startup resolution of that profile succeeds.

The binding is the pair `(dsh-target-v2 fingerprint, dsh-profile-lifecycle-v1 fingerprint?)` from
that startup resolution. A lifecycle-aware train must match both axes; a train without lifecycle
metadata must match the absence of the second axis. The binding is never refreshed from mutable
filesystem state during the life of the Host.

Each implicitly bound call re-resolves the request and fails closed unless the current epoch equals
the captured epoch. This is the same conservative rule the live-Inspect binding already applies, and
it deliberately does not depend on `patchReload`: under `startup` the running tree is the mount-time
composition, and under `live` a drifted profile means the Host has moved to an epoch Toolchain never
observed. Re-binding the new epoch silently would mix epochs; refusing is the correct answer, and an
explicit `profile` remains available to ask about current on-disk state.

### Failure semantics

An omitted `profile` that cannot be bound fails loudly with a stable machine-readable code, never a
fallback:

- `TARGET_RUNTIME_BINDING_UNAVAILABLE` — no proven running target was captured at mount;
- `TARGET_RUNTIME_BINDING_CHANGED` — a running target was captured, but the current resolution no
  longer equals that epoch.

Both are request-formation failures at the tool boundary, consistent with how invalid tool arguments
already fail, and both must name the recovery: pass an explicit `profile`. They are not Protocol
application responses, because no target-bound operation was ever formed.

### Model-facing surface

The five advertised tools keep their names and the operation-specific parameters. Only the target
input changes shape:

```text
parameters:
  profile?: string        # omit to bind this Host's running DSH target
  <operation-specific parameters, unchanged>
```

## What does not change

- Protocol v1 DTOs, JSON schemas, canonical examples and generated types: the canonical request
  remains explicitly target-bound and `target` stays required there.
- `ctx.toolchain`, CLI, MCP and Web: they keep passing canonical explicit target requests.
- The kernel, acquisition providers, Contract Index identity, search ranking, `plugin.check`
  semantics and the verification reducer are untouched.
- Staleness, freshness re-resolution and lifecycle binding inside `plugin.verify` are untouched; the
  implicit binding only decides which explicit target request an operation starts from.

## Consequences

- The advertised model surface loses the repeated nested target schema. The reduction is measured
  rather than asserted, and recorded as a new receipt; the historical
  `docs/evaluation/m2/agent-surface-baseline-v1.json` snapshot stays unrewritten.
- A coding Agent no longer has to discover the profile name before asking its first question, and
  cannot point acquisition at an unrelated DSH home or overlay set.
- Two new loud failure codes enter the diagnostic vocabulary. They are compatibility contracts from
  this point on and must not be reused for other semantics.
- A Host whose profile composition changes mid-session gets a refusal instead of an answer about an
  epoch it never observed. The Agent can retry with an explicit `profile`.

## Verification

- unit specs prove all three paths: implicit binding, explicit-profile override, and fail-closed
  unavailability/change, including the lifecycle-absent and lifecycle-changed cases;
- the deterministic zero-token surface measurement proves the advertised bytes strictly decrease and
  that no tool definition grows;
- the real packed-DSH composition smoke proves the native tool surface still answers from an actual
  Host, and that an implicitly bound call and an explicitly bound call agree on the same snapshot
  fingerprint.
