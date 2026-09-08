# DSH Toolchain Verification Specification

Status: **Baseline specification**

This document defines what `plugin.verify` means. Passing static analysis or a TypeScript build is not equivalent to verified DSH behavior.

## Verification subject

The subject is a concrete candidate artifact plus a concrete DSH target snapshot.

Before runtime installation, Toolchain SHOULD verify the package artifact that would be installed by a user (for an npm-style plugin, the packed tarball/pack preview), not only the working tree.

Static plugin identity and executable artifact identity are deliberately separate:

- `dsh-plugin-subject-v1:<sha256>` identifies normalized static subject semantics used by `plugin.check`;
- `dsh-plugin-artifact-v1:<sha256>` identifies the exact packed artifact bytes executed by verification, as frozen by ADR-0009.

A packed-artifact fingerprint MUST NOT depend on path, mtime, user name, or other machine coordinates. The runtime worker MUST bind execution to the authoritative content hash supplied by packed acquisition and fail closed before candidate execution if the bytes no longer match.

The report records:
- candidate artifact fingerprint;
- starting target snapshot fingerprint;
- starting profile lifecycle fingerprint when the target is lifecycle-aware;
- execution policy;
- checks requested and checks executed;
- diagnostics;
- cleanup outcome;
- final freshness status.

## Verification stages

Protocol v1 recognizes the following stage identities:

1. `structure` — required files/layout that can be checked without execution;
2. `manifest` — package/bundle/composition metadata;
3. `dependency` — dependency/peer/core-identity compatibility;
4. `contract` — statically inferable use of DSH contracts;
5. `build` — configured build/type/test commands when policy permits;
6. `package` — inspect the actual distributable package;
7. `install` — install into the temporary target profile;
8. `compose` — run the official DSH composition/configuration path (for example the applicable `--dump-config` route);
9. `boot` — start the selected DSH target/profile;
10. `visibility` — prove declared service/tool/client capability is visible through the relevant live DSH seam;
11. `behavior` — explicitly declared safe fixture behavior.

Implementations MAY skip stages that do not apply, but MUST record the skip and reason. They MUST NOT imply an unexecuted stage passed.

## M4.1 packed worker boundary

M4.1 implements the first production execution slice for caller-supplied packed `.tgz` artifacts under policy `safe`. It is an internal worker evidence boundary, not yet the public `plugin.verify` application operation.

For this slice:

- packed acquisition remains the archive-validation authority and exposes an executable handoff only for a complete subject;
- acquisition and verification share one bounded, non-extracting archive-index primitive for TAR/PAX/GNU-long-name interpretation; PAX record lengths are byte counts, path bytes are decoded only after record boundaries are validated, and path data is not altered with whitespace trimming;
- the worker revalidates the exact artifact content hash before staging it into a disposable workspace and establishes `dsh-plugin-artifact-v1` before semantic package checks;
- after exact artifact identity is established and before any candidate installation, the `package` stage inspects the same packed bytes for an unambiguous declared root runtime entrypoint (`main` or a simple root `exports` string); when that file is absent, verification fails closed with `VERIFY_PACKAGE_ENTRYPOINT_MISSING`, preserves the exact artifact fingerprint in the receipt, bounds user-controlled entrypoint text in the diagnostic presentation, and skips downstream runtime stages;
- `not-checkable` is reserved for intentional bounded deferral such as conditional exports, URL-suffixed or percent-bearing exports targets, extension/directory resolution, and other Node-resolution semantics the inspector does not claim to implement; malformed TAR/PAX data, malformed package JSON, or equivalent internal package-inspection faults MUST instead fail the `package` stage closed with `VERIFY_PACKAGE_INSPECTION_FAILED`, retain the exact artifact fingerprint, and skip downstream runtime stages;
- conditional exports, extension/directory resolution and transitive module-graph resolution are not guessed by this bounded package-integrity check; they remain runtime concerns for applicable later stages;
- DSH and candidate installation use package-manager/DSH install paths with lifecycle scripts disabled through `--ignore-scripts`;
- candidate-only composition is proven through the official DSH `--dump-config` route before boot instrumentation is added;
- Toolchain then installs a generated private boot-probe package into the same disposable profile;
- `boot` passes only when the normal profile launcher exits successfully **and** stdout contains the exact Toolchain-owned probe marker emitted after the probe's apply point; process exit alone is not boot evidence;
- absent visibility assertions remain explicitly skipped; M4.1 does not synthesize visibility or behavior success;
- the worker returns internal stage observations, runtime coordinates, diagnostics, target fingerprint binding, lifecycle fingerprint binding when present, terminal classification, and cleanup outcome for later application-level reduction.

The generated boot probe is verification instrumentation. Its marker is derived without host paths or credentials and does not redefine the candidate artifact, target, or lifecycle identities.

## M4.3.1 Host Service visibility assertion

M4.3.1 adds the first explicit live visibility assertion to the public `plugin.verify` path while preserving the M4.2 no-assertion behavior.

The only supported assertion vocabulary in this slice is:

```json
{ "kind": "host-service", "name": "<service-name>" }
```

When one or more Host Service assertions are requested:

- the canonical Protocol request carries them unchanged through kernel and execution-port boundaries;
- the same disposable DSH runtime that composed and booted the candidate runs Toolchain-owned verification instrumentation;
- the probe emits the normal boot marker first and then evaluates each requested service through the live Cordis context using `ctx.get(name)`;
- the `visibility` stage passes only when every requested Host Service resolves to a non-`undefined` value after candidate boot;
- a clean boot without the exact visibility marker is a semantic visibility failure and yields `VERIFY_VISIBILITY_FAILED`;
- requested visibility that is not executed cannot yield `verified`;
- the no-assertion baseline remains exactly `visibility: skipped / no-visibility-assertions` and does not block the M4.2 verification claim.

A Host Service declaration in package metadata or TypeScript declarations is not visibility evidence. M4.3.1 visibility is runtime evidence from the isolated composed target.

## M4.3.2 Agent Tool visibility assertion

M4.3.2 extends the same `visibilityAssertions` array with a second closed assertion shape while preserving the M4.3.1 Host Service behavior and the M4.2 no-assertion baseline:

```json
{ "kind": "agent-tool", "name": "<tool-name>" }
```

Tool visibility is Agent-scoped: the authoritative predicate is membership of the requested name in the capability catalog of one real Toolchain-owned Agent (`ctx.tools.schemas(handle.agent)`), evaluated after candidate composition and boot in the same disposable DSH runtime. A global/root Tool lookup is not equivalent evidence. This proves callable-schema visibility only; it is distinct from model presentation form and from Tool execution.

When one or more Agent Tool assertions are requested:

- the generated boot probe declares `export const inject = ['tools', 'agentLoop']` and performs exactly one owned Agent epoch in the same boot: it creates one Agent through the synchronous `agentLoop.create` seam with a deterministic verifier-owned id, materializes `tools.schemas(agent)` once for the assertion batch, and requires every requested name to be present;
- `agents.create` is not used: current DSH trains register no agent factory in verification boots, while `agentLoop.create` returns a registered Agent on agent-capable compositions and is the same seam backing the M2.2 live DSH smoke;
- Host Service assertions in the same request are evaluated in the same boot epoch through the live Cordis context; mixed batches use one boot epoch and one Agent epoch;
- Host Service-only requests declare no inject export, create no Agent, and preserve the M4.3.1 runtime behavior;
- Agent creation failure, an unavailable agent seam, or an unreadable Tool catalog fails `visibility` with the shared `VERIFY_VISIBILITY_FAILED` diagnostic; no new report status or diagnostic code is introduced;
- the created Agent exposes no exact-handle disposal on this seam; it lives only in the disposable boot process, so worker process teardown owns Agent lifetime, matching the M2.2 live smoke precedent;
- the visibility marker namespace is `DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2` so an older Host-Service-only marker cannot be misread as Agent Tool evidence.

Agent Tool assertions require an agent-capable target composition: the minimal headless profile registers no agent loop, so such assertions against it fail closed instead of producing a visibility claim. The public acceptance exercises them against the web profile.

Client/page visibility remains deferred until Toolchain can bind observations to a deterministic page identity/lifetime. Behavior assertions are also outside M4.3.2. Verification MUST NOT reuse a caller Agent and MUST NOT retain the owned Agent or session beyond the visibility probe.

## Isolation

Default verification uses policy `safe` and MUST NOT intentionally mutate the user's active DSH profile.

Runtime candidate execution occurs in a separate process using a temporary DSH home/workspace. The verifier MUST NOT describe this as a security sandbox.

The worker receives an allowlisted environment chosen by Toolchain. Credentials are not silently copied from the user's active profile.

M4.1 verifies Toolchain-owned configuration/path isolation by using a unique temporary DSH home, temporary user home and temporary directory for the worker. This does not prevent candidate runtime code from accessing filesystem or network resources that the operating system itself allows.

## Freshness

The verifier captures the starting target snapshot. `dsh-target-v2` remains the startup-composition identity. On lifecycle-aware DSH trains the snapshot additionally carries `dsh-profile-lifecycle-v1:<sha256>` for the effective `dsh.profile.patchReload` policy. Before producing `verified`, Toolchain MUST determine whether either bound epoch changed during the operation.

The worker MUST echo the initial lifecycle fingerprint whenever the supplied snapshot carries one. A missing or different worker lifecycle binding on a lifecycle-aware target fails closed with `VERIFY_LIFECYCLE_BINDING_MISMATCH`; it MUST NOT be treated as an old-train omission.

After execution, the application kernel re-resolves the target. If the final `dsh-target-v2` differs, final status is `stale` with `VERIFY_TARGET_STALE`. If the target-v2 remains equal but the lifecycle fingerprint is added, removed, or changed, final status is also `stale`, with `VERIFY_LIFECYCLE_STALE`. This prevents a runtime receipt obtained under one reload policy from being claimed for another lifecycle epoch while preserving the static target namespace.

M4.1 binds worker observations to the immutable starting target fingerprint and, when present, the starting lifecycle fingerprint, but does not independently re-read the caller's active target after execution. Final target/lifecycle re-resolution and `verified` / `stale` reduction belong to the application orchestration layer introduced with the public `plugin.verify` slice (M4.2). Therefore an M4.1 worker `terminal: completed` result is execution evidence, not a public `verified` claim.

Live DSH Host enrichment follows the same epoch rule: on lifecycle-aware targets it may join a resolved snapshot only when both the immutable startup target fingerprint and startup lifecycle fingerprint match. Old trains that legitimately have no lifecycle metadata retain their historical target-v2-only binding.

## Status

Baseline verification report statuses:

- `verified` — all required requested checks passed against a fresh target and lifecycle epoch when present;
- `failed` — one or more required checks or identity bindings failed;
- `partial` — some requested checks could not be executed and the caller's policy does not allow a verified claim;
- `stale` — target or lifecycle state invalidated the evidence;
- `cancelled` — operation was cancelled before a terminal verification conclusion.

Infrastructure failure is represented by diagnostics and `failed`/`partial` according to whether semantic checks could be concluded.

## Failure isolation

Where components/checks are independent, failure in one SHOULD NOT discard successful evidence from others. Fatal package-level defects may prevent all downstream execution.

## Cleanup

The verifier MUST attempt cleanup after success, failure, cancellation, and worker errors.

Cleanup failure MUST be reported. A cleanup error MUST NOT rewrite a prior verification failure into success.

## Evidence receipt

A verification report is intended to be portable evidence, not a guarantee for all machines/versions. It MUST name the candidate and target fingerprints and the exact checks executed. When the starting target is lifecycle-aware, it MUST also name the starting lifecycle fingerprint so the receipt is bound to the exact post-boot reload policy it observed.

Future CI badges/compatibility databases MUST derive claims from receipts rather than from package version alone.
