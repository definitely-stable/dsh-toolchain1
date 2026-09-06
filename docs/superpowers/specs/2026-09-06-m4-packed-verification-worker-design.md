# M4.1 Packed Verification Worker Design

Status: **APPROVED FOR IMPLEMENTATION**

Related: #188, ADR-0004, ADR-0009, #154, #186, PR #187.

## Problem

`plugin.check` can prove static compatibility facts against an exact target but deliberately never executes candidate code. M4 must cross that boundary without loading unknown candidate code into the user's active DSH profile and without letting Node/process/package-manager concerns leak into the semantic kernel.

The repository already defines the public `VerificationReport`, the 11 verification stage identities, `safe | trusted` execution-policy vocabulary, and the requirement that a receipt bind a concrete artifact to a concrete `TargetSnapshot`. M4.1 therefore does not redesign the report. It establishes the first production worker that can generate trustworthy runtime-stage observations for a later kernel `plugin.verify` reducer.

## Goals

1. Verify a caller-supplied packed `.tgz` artifact under `safe` policy in a unique temporary DSH home/workspace.
2. Bind execution to exact artifact bytes with `dsh-plugin-artifact-v1:<sha256>` and to the supplied starting `TargetSnapshot`.
3. Reuse packed-subject acquisition as the archive-validation authority instead of creating a second tar parser in verification.
4. Execute real package/install/compose/boot work with bounded process/output/cancellation behavior.
5. Preserve an explicit stage ledger where unexecuted stages are `skipped`, never synthetic `passed`.
6. Attempt process and filesystem cleanup on every terminal path and retain cleanup failure separately from the primary result.
7. Provide a worker result that M4.2 can reduce with static `plugin.check` evidence and a post-run target re-resolution into the existing Protocol v1 `VerificationReport`.

## Non-goals

- no public CLI/MCP/native DSH `plugin.verify` projection in M4.1;
- no `operation.get` / `operation.cancel` public transport yet;
- no Web UI;
- no source-directory pack pipeline;
- no `trusted` execution policy;
- no container/VM/network/filesystem malicious-code sandbox;
- no arbitrary user shell commands or generic task runner;
- no Contract Search/ranker changes;
- no target/Contract Index identity changes;
- no H1/H2/provider evaluation;
- no later-train verification claim that bypasses #33 lifecycle governance.

## Architecture

The dependency direction remains:

```text
future plugin.verify reducer (kernel)
              |
              v
  runtime-neutral verification port/result
              ^
              |
      verification adapter/worker
              |
      Node fs/process/crypto + DSH CLI
```

M4.1 implements the lower execution boundary and the runtime-neutral observation shape required by its future caller. The semantic kernel does not import `src/verification/**`. A later M4.2 adapter will satisfy the kernel-owned port by delegating to the worker.

`src/verification/**` is already a declared architecture layer. It may import Node built-ins and runtime-neutral `model/product/protocol`; it does not need a new architecture edge.

## Artifact acquisition and TOCTOU boundary

The existing `src/acquisition/plugin-packed.ts` remains the sole bounded npm-style archive parser and static packed-subject authority. It already:

- resolves a regular file;
- enforces packed/unpacked/manifest/patch bounds;
- validates gzip/tar checksums, entry paths, duplicates and required regular files;
- emits authoritative `plugin:packed-artifact` evidence whose `contentHash` is SHA-256 of the exact `.tgz` bytes.

M4.1 does **not** copy that parser.

The worker input includes:

```ts
interface PackedVerificationArtifactInput {
  readonly path: string
  readonly expectedContentHash: string
}
```

`expectedContentHash` MUST come from the already-acquired authoritative packed-artifact evidence. The worker opens the artifact as a regular file with the same 16 MiB packed-byte ceiling, hashes the exact bytes, and fails before subprocess execution if the observed SHA-256 differs. It then writes/copies those exact bytes to a Toolchain-owned file inside the temporary workspace and all later install work uses only that temporary copy.

The artifact fingerprint is `dsh-plugin-artifact-v1:<observed-sha256>` per ADR-0009. Static `dsh-plugin-subject-v1` remains separate.

## Worker input

M4.1 exposes an internal production worker contract equivalent to:

```ts
interface PackedPluginVerificationInput {
  readonly artifact: PackedVerificationArtifactInput
  readonly target: TargetSnapshot
  readonly executionPolicy: 'safe'
  readonly visibilityAssertions?: readonly VerificationVisibilityAssertion[]
}
```

The first visibility assertion vocabulary is intentionally narrow. M4.1 may support only deterministic composed/live identity assertions that can be proven through the selected DSH profile without importing candidate-specific code. If no assertion is supplied, `visibility` is `skipped` with an explicit reason.

The starting `TargetSnapshot` is immutable input. M4.1 does not decide final target freshness; it returns the starting target fingerprint and actual execution runtime coordinates so M4.2 can re-resolve the original target request after execution.

## Worker result

The worker returns an internal execution receipt, not a competing public report:

```ts
interface PackedPluginVerificationExecution {
  readonly artifactFingerprint?: string
  readonly targetFingerprint: string
  readonly executionPolicy: 'safe'
  readonly runtime: {
    readonly nodeVersion: string
    readonly platform: string
    readonly arch: string
  }
  readonly checks: readonly VerificationCheckObservation[]
  readonly diagnostics: readonly Diagnostic[]
  readonly cleanup: 'succeeded' | 'failed' | 'not-required'
  readonly terminal: 'completed' | 'failed' | 'cancelled'
}
```

`VerificationCheckObservation` uses the Protocol v1 stage ids and statuses `passed | failed | skipped`. The worker result is deliberately richer in lifecycle provenance than a boolean, but M4.1 does not introduce a second public `VerificationReport` type.

If artifact bytes cannot be established, `artifactFingerprint` may be absent and every execution-dependent stage is skipped. Once bytes are established, the fingerprint remains present even when later stages fail.

## Stage machine

The result always contains all 11 Protocol v1 stage ids in canonical order:

1. `structure`
2. `manifest`
3. `dependency`
4. `contract`
5. `build`
6. `package`
7. `install`
8. `compose`
9. `boot`
10. `visibility`
11. `behavior`

M4.1 owns runtime execution only from `package` onward. `structure`, `manifest`, `dependency`, `contract`, and `build` are `skipped` with reasons identifying them as upstream/static or not requested in this slice.

Fatal ordering is:

```text
package -> install -> compose -> boot -> visibility
```

A failed prerequisite means every downstream execution stage is `skipped` with a deterministic prerequisite-failure reason. `behavior` is always skipped in M4.1. Cancellation marks the in-flight stage failed/skipped according to whether it produced a semantic result, marks all later stages skipped, and returns terminal `cancelled`. No unexecuted stage can be `passed`.

### package

Passes only after:

- source path resolves to a regular file;
- bounded bytes are read;
- exact SHA-256 matches `expectedContentHash`;
- exact bytes are copied into the temporary workspace;
- copied bytes hash to the same value.

This stage does not reparse tar metadata; packed acquisition already owns that proof.

### install

The worker creates a disposable runner package and DSH home. It installs exact `@deepseek-ai/dsh@target.dsh.version` and then installs the temporary candidate `.tgz` into `target.profile.name` through official DSH plugin management.

M4.1 `safe` policy uses package-manager/DSH ignore-script controls where available for dependency installation. Candidate runtime code is executed at DSH boot, not through uncontrolled npm lifecycle scripts. The receipt/diagnostics must not claim lifecycle-script behavior was verified.

### compose

Runs the official DSH profile composition path (`dsh --profile <profile> --dump-config`) inside the disposable home. Non-zero exit, timeout, cancellation or bounded-output overflow fails the stage.

### boot

Boot proof must establish that the selected disposable DSH profile reached Toolchain's bounded boot probe after candidate composition. It must not equate `--help`, a successful typecheck, or mere process spawn with boot success.

The production worker may install a Toolchain-owned temporary probe package **after** the candidate in the disposable profile. The probe exists only inside the temporary workspace, performs no network/credential access, and terminates the disposable DSH process through the launcher-owned exit capability once its apply point is reached. Reaching that probe proves DSH traversed the composed plugin lifecycle far enough to mount the probe after the candidate. Probe implementation is generated in the temporary workspace; no JavaScript production source is added under `src/`.

If upstream profile semantics make the probe unsupported, boot is failed/partial evidence rather than silently passed.

### visibility

No assertion => `skipped` with reason `no-visibility-assertions`.

Future assertions must be explicit and deterministic. M4.1 does not infer expected tools/services from names or model guesses.

### behavior

Always `skipped` with reason `not-supported-in-m4.1`.

## Safe environment

Each execution creates one unique root with separate runner, DSH home, HOME/user-home and temp directories.

Child environment is constructed from an allowlist required for Node/package-manager process startup, then Toolchain overwrites configuration coordinates. It MUST NOT inherit arbitrary parent variables. Credential-shaped variables, provider/API tokens, npm auth tokens, session variables and user `DSH_HOME` are excluded.

At minimum Toolchain owns:

- `CI=true`;
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`;
- `DSH_HOME=<temporary>`;
- `HOME` / `USERPROFILE=<temporary home>`;
- `TMPDIR` / `TMP` / `TEMP=<temporary temp>`;
- platform-specific non-secret process bootstrap values such as `PATH`, `SystemRoot`, `ComSpec`, `PATHEXT`, `WINDIR` when required.

This is configuration/credential isolation, not filesystem/network sandboxing.

## Process execution

One production process utility under `src/verification/**` owns subprocess behavior:

- argv arrays only; no shell interpolation;
- bounded stdout and stderr independently;
- configurable hard timeout with conservative M4.1 constants;
- cancellation via `AbortSignal` at the verification-layer API;
- Unix process group and Windows process-tree termination where supported;
- non-zero exit, signal exit, timeout, cancellation and output overflow are distinct internal outcomes;
- child-process errors are converted to verification diagnostics rather than crashing the Host.

The worker does not expose raw unbounded candidate output in portable receipts. Diagnostics summarize the failed stage and may retain bounded/redacted snippets only if a later reviewed contract explicitly requires them.

## Cleanup

Cleanup is a `finally` obligation after all terminal paths.

Order:

1. terminate any surviving child/process tree;
2. wait for/quiesce process resources within a bound;
3. remove temporary root recursively;
4. record cleanup result.

Cleanup failure never changes an earlier failed/cancelled execution into success. If execution otherwise completed but cleanup fails, M4.2 cannot reduce the result to public `verified` under `safe` policy.

## Diagnostics

M4.1 introduces stable verification-domain diagnostic codes only where machine distinction matters. Initial families:

- `VERIFY_ARTIFACT_READ_FAILED`
- `VERIFY_ARTIFACT_LIMIT_EXCEEDED`
- `VERIFY_ARTIFACT_STALE`
- `VERIFY_PROCESS_START_FAILED`
- `VERIFY_PROCESS_EXIT_FAILED`
- `VERIFY_PROCESS_TIMEOUT`
- `VERIFY_PROCESS_CANCELLED`
- `VERIFY_PROCESS_OUTPUT_LIMIT_EXCEEDED`
- `VERIFY_INSTALL_FAILED`
- `VERIFY_COMPOSE_FAILED`
- `VERIFY_BOOT_FAILED`
- `VERIFY_VISIBILITY_FAILED`
- `VERIFY_CLEANUP_FAILED`

Human summaries remain non-identity wording. Codes must not be reused later for different semantics.

## Determinism and identity

Deterministic fields:

- artifact fingerprint from exact bytes;
- target fingerprint copied from immutable input;
- canonical stage order;
- stage status/reason mapping for equal worker outcomes;
- diagnostic code/domain/severity classification.

Explicitly non-semantic/runtime observations:

- temporary paths;
- PIDs;
- timestamps;
- wall-clock duration;
- machine-specific copy paths.

M4.1 does not create a fingerprint of the whole execution receipt. A portable receipt identity can be designed only after M4.2 freezes the final public reduction/freshness semantics.

## Testing strategy

1. Artifact RED tests: exact-byte fingerprint, path independence, byte drift, expected-hash mismatch and size/read failures.
2. Stage-machine RED tests: canonical 11 stages, prerequisite skipping, cancellation, no synthetic pass.
3. Process RED tests: argv/no-shell, timeout, cancellation, non-zero exit, output bounds, process cleanup.
4. Environment RED tests: only allowlisted inherited keys, forced temporary DSH/home/temp coordinates, credential non-inheritance.
5. Worker fixture RED tests with a deterministic fake process port for install/compose/boot success/failure and cleanup failure.
6. Real-DSH smoke uses an exact packed candidate fixture and the production process runner in a temporary home. It snapshots/guards an external sentinel active profile path to prove the worker never writes there.
7. Full repository architecture/package/Node/platform CI is the final gate.

## Acceptance boundary

M4.1 is complete only when:

- ADR-0009 artifact identity is implemented exactly;
- packed acquisition remains the archive-validation authority;
- all 11 stage identities are explicit on every result;
- artifact mismatch/oversize fails before subprocess execution;
- safe environment and temporary DSH home are proven by tests;
- install/compose/boot use the exact target DSH version/profile in one disposable environment;
- timeout/cancel/crash/output-limit paths are fail-closed;
- cleanup is attempted for every path and independently reported;
- real packed DSH smoke proves boot without active-profile mutation;
- exact-head CI is GREEN.

## Follow-up gate

M4.2 may begin only after this worker is proven. It will define the kernel-owned `plugin.verify` application request/response and Operation lifecycle, run/reuse static `plugin.check` evidence, invoke the M4.1 worker through a runtime-neutral port, re-resolve target freshness, reduce to the existing public `VerificationReport`, and then add CLI/native DSH/MCP projections. M4.2 must not weaken M4.1 isolation or reinterpret skipped/unexecuted stages as passed.