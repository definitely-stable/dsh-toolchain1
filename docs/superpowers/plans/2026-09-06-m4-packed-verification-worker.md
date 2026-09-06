# M4.1 Packed Verification Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production packed-plugin verification execution boundary: exact artifact-byte binding, safe temporary DSH isolation, bounded install/compose/boot execution, explicit stage evidence, cancellation, and cleanup.

**Architecture:** `src/verification/**` is the Node/runtime execution layer already declared by architecture policy. It consumes runtime-neutral `TargetSnapshot`/diagnostic/stage identities but owns binary IO, environment construction and child processes. Existing packed acquisition remains the archive parser; the worker re-hashes and copies the already-validated exact `.tgz` bytes before any subprocess starts. M4.1 returns an internal execution receipt; M4.2 will reduce it in the kernel to public `plugin.verify`/`VerificationReport` semantics.

**Tech Stack:** TypeScript 6.0, Node 22.19+/24/26 built-ins (`node:crypto`, `node:fs/promises`, `node:child_process`, `node:os`, `node:path`), Vitest 4.1.8, pnpm 11.7, real `@deepseek-ai/dsh@0.1.1-rc.2` smoke.

**Spec:** `docs/superpowers/specs/2026-09-06-m4-packed-verification-worker-design.md`

## Global Constraints

- Follow `spec/verification.md`, `spec/protocol.md`, ADR-0004 and ADR-0009.
- M4.1 execution policy is exactly `safe`; do not implement `trusted` behavior.
- Verification uses a unique temporary DSH home/workspace and MUST NOT intentionally mutate the caller's active profile.
- A temporary DSH home is configuration/credential isolation, not a malicious-code sandbox.
- Existing `src/acquisition/plugin-packed.ts` remains the bounded tar/gzip/archive validator; do not duplicate its parser in verification.
- Artifact identity is `dsh-plugin-artifact-v1:<sha256>` over the exact `.tgz` byte stream used for installation.
- The worker receives the authoritative packed evidence content hash and MUST fail before subprocess execution if re-read bytes differ.
- Every worker result contains all 11 Protocol v1 verification stage ids in canonical order with only `passed | failed | skipped`.
- An unexecuted stage is never `passed`; a fatal prerequisite failure skips all downstream runtime stages with deterministic reasons.
- Child commands use argv arrays and `shell: false`; stdout/stderr are bounded independently.
- Parent credentials/environment are deny-by-default; only documented bootstrap variables are inherited and Toolchain-owned temp coordinates override them.
- Cleanup is attempted after success, failure, cancellation, timeout and process-start failure; cleanup failure never rewrites prior failure into success.
- No changes to Contract Search, `dsh-target-v2`, `dsh-contract-index-v1`, H1/H2, provider evaluation, Web, or public operation adapters.

---

### Task 1: Freeze worker receipt/stage and artifact identity behavior with RED tests

**Files:**
- Create: `tests/verification/artifact.spec.ts`
- Create: `tests/verification/stage-ledger.spec.ts`
- Create after RED: `src/verification/artifact.ts`
- Create after RED: `src/verification/stages.ts`

**Interfaces:**
- Produces `fingerprintPackedArtifact(path, expectedContentHash): Promise<PackedArtifactObservation>` where `PackedArtifactObservation` contains `fingerprint`, `contentHash`, `bytes`, and canonical source location only inside the verification layer.
- Produces `createInitialStageLedger()` and `failStageWithDownstreamSkips(...)` helpers that always retain the 11 Protocol stage ids in normative order.
- Packed byte ceiling is exactly `16 * 1024 * 1024`, matching packed acquisition.

- [ ] **Step 1: Write artifact RED tests**

Create tests that write the same small byte buffer at two different temporary paths and assert the resulting fingerprint is the same `dsh-plugin-artifact-v1:<sha256>`. Rewrite one byte and assert the fingerprint changes. Supply the old expected hash after rewrite and assert `VERIFY_ARTIFACT_STALE` is returned/thrown before any execution-facing result exists. Create a sparse/real file above 16 MiB and assert `VERIFY_ARTIFACT_LIMIT_EXCEEDED`; directory/missing input must classify as `VERIFY_ARTIFACT_READ_FAILED`.

- [ ] **Step 2: Run focused artifact test and verify RED**

Run in CI/available executor:

```bash
pnpm vitest run tests/verification/artifact.spec.ts
```

Expected: FAIL because `src/verification/artifact.ts` does not exist.

- [ ] **Step 3: Implement minimal artifact reader/fingerprint**

Use `realpath` + `open` + `stat` + bounded `readFile`, `createHash('sha256')`, and a second hash after writing the exact bytes to a caller-provided temporary destination. Never derive identity from path/mtime. Return/throw typed verification-layer errors carrying the stable diagnostic code.

- [ ] **Step 4: Run artifact test and verify GREEN**

```bash
pnpm vitest run tests/verification/artifact.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write stage-ledger RED tests**

Assert exact order:

```text
structure, manifest, dependency, contract, build, package,
install, compose, boot, visibility, behavior
```

Initial M4.1 static stages are skipped with explicit reasons. After `install` failure, `compose`, `boot`, `visibility`, and `behavior` cannot be passed. After cancellation during `boot`, later stages remain skipped. No helper may create `passed` for a stage without an explicit pass transition.

- [ ] **Step 6: Run stage test and verify RED**

```bash
pnpm vitest run tests/verification/stage-ledger.spec.ts
```

Expected: FAIL because stage-ledger implementation is missing.

- [ ] **Step 7: Implement minimal stage ledger**

Keep stage ids typed from `VerificationReport['checks'][number]['id']` so Protocol vocabulary remains the source. Freeze returned arrays/rows. Use deterministic reason strings such as `handled-by-static-check`, `not-requested-in-m4.1`, `prerequisite-package-failed`, and `no-visibility-assertions`.

- [ ] **Step 8: Run focused tests and commit**

```bash
pnpm vitest run tests/verification/artifact.spec.ts tests/verification/stage-ledger.spec.ts
pnpm run check:architecture
```

Commit message:

```text
feat(verify): add packed artifact and stage primitives
```

---

### Task 2: Add deny-by-default safe environment construction

**Files:**
- Create: `tests/verification/environment.spec.ts`
- Create after RED: `src/verification/environment.ts`

**Interfaces:**
- Produces `createSafeVerificationEnvironment(parentEnv, coordinates): NodeJS.ProcessEnv`.
- `coordinates` contains temporary `dshHome`, `userHome`, and `tempDir`.
- Inherited bootstrap allowlist: `PATH`, `Path`, `SystemRoot`, `SYSTEMROOT`, `ComSpec`, `COMSPEC`, `PATHEXT`, `WINDIR` only when present.
- Toolchain forces `CI=true`, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, `DSH_HOME`, `HOME`, `USERPROFILE`, `TMPDIR`, `TMP`, `TEMP`.

- [ ] **Step 1: Write environment RED tests**

Supply a synthetic parent env containing PATH/bootstrap variables plus `OPENAI_API_KEY`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `DSH_HOME`, `HOME`, `AWS_SECRET_ACCESS_KEY`, proxy credentials and arbitrary user variables. Assert only bootstrap keys survive and every Toolchain coordinate equals the supplied temporary path. Assert credential-shaped/unlisted values are absent even when non-empty.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/verification/environment.spec.ts
```

Expected: FAIL because environment builder does not exist.

- [ ] **Step 3: Implement allowlist builder**

Copy only exact allowlisted names, then assign Toolchain-owned values last. Do not use `{ ...process.env }` inside the builder. The production caller passes `process.env` explicitly from the verification layer.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm vitest run tests/verification/environment.spec.ts
pnpm run check:architecture
```

Commit:

```text
feat(verify): isolate safe worker environment
```

---

### Task 3: Implement bounded cross-platform process execution RED-first

**Files:**
- Create: `tests/verification/process.spec.ts`
- Create after RED: `src/verification/process.ts`
- Create: `scripts/fixtures/verification-child.mjs`

**Interfaces:**

```ts
interface VerificationProcessRequest {
  command: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
}

type VerificationProcessOutcome =
  | { kind: 'exited'; code: number; stdout: string; stderr: string }
  | { kind: 'signalled'; signal: string; stdout: string; stderr: string }
  | { kind: 'timeout'; stdout: string; stderr: string }
  | { kind: 'cancelled'; stdout: string; stderr: string }
  | { kind: 'output-limit'; stream: 'stdout' | 'stderr' }
  | { kind: 'start-failed'; message: string }
```

Production function accepts an optional `AbortSignal`. Defaults used by the worker: output limit 128 KiB per stream; install 300 s; compose 120 s; boot 120 s.

- [ ] **Step 1: Write child fixture**

Fixture accepts modes `exit`, `sleep`, `stdout`, `stderr`, and `spawn-grandchild`. It contains no secrets and lives under repository scripts/fixtures, outside production `src/`.

- [ ] **Step 2: Write process RED tests**

Use `process.execPath` + fixture argv, never shell snippets. Cover exit 0/non-zero, timeout, AbortController cancellation, stdout overflow, stderr overflow and child/grandchild termination. Assert the runner returns classified outcomes rather than throwing for expected child failures.

- [ ] **Step 3: Verify RED**

```bash
pnpm vitest run tests/verification/process.spec.ts
```

Expected: FAIL because process runner is missing.

- [ ] **Step 4: Implement minimal process runner**

Use `spawn(command, args, { shell: false, detached: process.platform !== 'win32', ... })`. Accumulate output only to the configured byte ceiling. On Unix terminate the process group when possible; on Windows invoke `taskkill /PID <pid> /T /F` as a Toolchain-owned termination command without a shell, then fall back to `child.kill()` if necessary. Resolve once, remove AbortSignal listeners, and quiesce handles.

- [ ] **Step 5: Verify GREEN on Ubuntu CI and platform boundary smoke later**

```bash
pnpm vitest run tests/verification/process.spec.ts
pnpm run check:architecture
```

Commit:

```text
feat(verify): add bounded verification process runner
```

---

### Task 4: Specify packed-worker orchestration with RED fixture tests

**Files:**
- Create: `tests/verification/packed-worker.spec.ts`
- Create after RED: `src/verification/packed-worker.ts`
- Create after RED: `src/verification/diagnostics.ts`

**Interfaces:**

```ts
interface PackedPluginVerificationInput {
  artifact: { path: string; expectedContentHash: string }
  target: TargetSnapshot
  executionPolicy: 'safe'
  visibilityAssertions?: readonly VerificationVisibilityAssertion[]
}

interface PackedPluginVerificationExecution {
  artifactFingerprint?: string
  targetFingerprint: string
  executionPolicy: 'safe'
  runtime: { nodeVersion: string; platform: string; arch: string }
  checks: readonly VerificationReport['checks'][number][]
  diagnostics: readonly Diagnostic[]
  cleanup: VerificationReport['cleanup']
  terminal: 'completed' | 'failed' | 'cancelled'
}
```

The worker accepts injected filesystem/temp/process seams only where required to deterministically test failures; production defaults use Node implementations from Tasks 1–3.

- [ ] **Step 1: Write RED success-path test**

Use a real temporary artifact file and a deterministic fake `VerificationProcessRunner` returning exit 0 for the exact expected command sequence. Assert:

- artifact fingerprint is exact-byte namespace;
- static stages are skipped;
- `package`, `install`, `compose`, `boot` pass only after corresponding successful outcomes;
- absent visibility assertions => skipped;
- behavior => skipped;
- target fingerprint equals immutable input;
- cleanup is succeeded;
- no active-profile path from the target acquisition request is used as DSH_HOME/workspace.

- [ ] **Step 2: Write RED failure table**

One case each for artifact mismatch, DSH install non-zero, candidate install non-zero, compose non-zero, boot probe non-zero, timeout, cancellation, process start failure, output overflow and cleanup failure. Assert stable `VERIFY_*` code, prerequisite skips, terminal classification and cleanup behavior.

- [ ] **Step 3: Verify RED**

```bash
pnpm vitest run tests/verification/packed-worker.spec.ts
```

Expected: FAIL because worker is missing.

- [ ] **Step 4: Implement worker skeleton and deterministic diagnostics**

Create unique directories:

```text
<root>/runner
<root>/dsh-home
<root>/home
<root>/tmp
<root>/artifact/candidate.tgz
```

Write `runner/package.json` as `{ "private": true }`. Build safe env via Task 2. Package stage copies verified bytes to `artifact/candidate.tgz`.

Install command sequence:

```text
pnpm add --save-exact --ignore-scripts @deepseek-ai/dsh@<target.dsh.version>
pnpm exec dsh plugin --profile <target.profile.name> add --ignore-scripts <temporary-candidate.tgz>
```

Compose:

```text
pnpm exec dsh --profile <target.profile.name> --dump-config
```

Do not concatenate user-controlled strings into a shell command.

- [ ] **Step 5: Verify focused GREEN and commit**

```bash
pnpm vitest run tests/verification/artifact.spec.ts tests/verification/environment.spec.ts tests/verification/process.spec.ts tests/verification/stage-ledger.spec.ts tests/verification/packed-worker.spec.ts
pnpm run check:architecture
```

Commit:

```text
feat(verify): orchestrate packed plugin verification
```

---

### Task 5: Add a Toolchain-owned real DSH boot probe

**Files:**
- Create: `tests/verification/boot-probe.spec.ts`
- Create after RED: `src/verification/boot-probe.ts`
- Modify after RED: `src/verification/packed-worker.ts`

**Interfaces:**
- `createVerificationBootProbe(root, profile): Promise<{ packagePath: string; marker: string }>` creates a temporary npm-style DSH plugin package under the worker root.
- Probe source is generated runtime data outside `src/`; production repository source remains TypeScript-only.
- Probe writes one bounded marker and invokes launcher-owned `appExit(0)` after its apply point.

- [ ] **Step 1: Write boot-probe RED tests**

Assert generated paths remain inside supplied temp root, package metadata is private and has a DSH bundle patch, patch insertion is deterministic, marker contains no host path/credential, and generated source has no network/fs/env access beyond stdout + launcher exit.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/verification/boot-probe.spec.ts
```

Expected: FAIL because boot probe creator is missing.

- [ ] **Step 3: Implement probe creator**

Generate the smallest package with `package.json`, `cordis.patch.yml`, and `probe.mjs`. Install it in the same disposable profile after the candidate using `dsh plugin ... add --ignore-scripts`. Boot the profile with normal launcher args required by the selected profile and require the marker + exit 0 within the boot timeout.

- [ ] **Step 4: Update worker tests**

Success now requires candidate install, probe install, compose and marker-backed boot. A process that merely stays alive or exits 0 without the marker does not pass `boot`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm vitest run tests/verification/boot-probe.spec.ts tests/verification/packed-worker.spec.ts
pnpm run check:architecture
```

Commit:

```text
feat(verify): prove DSH boot with disposable probe
```

---

### Task 6: Bind packed acquisition evidence to worker input

**Files:**
- Modify: `tests/acquisition/plugin-packed.spec.ts`
- Modify after RED: `src/acquisition/plugin-packed.ts`
- Create after RED if needed: `src/acquisition/plugin-packed-artifact.ts`

**Interfaces:**
- Packed acquisition exposes a typed authoritative artifact observation without changing `AcquiredPluginSubject` semantic identity:

```ts
interface AcquiredPackedArtifact {
  readonly location: string
  readonly contentHash: string
}
```

- The observation MUST be derived from the same bounded bytes that are already used for `plugin:packed-artifact` evidence.
- Existing `acquirePluginPacked()` behavior and evidence remain unchanged for `plugin.check` consumers.

- [ ] **Step 1: Write RED acquisition handoff test**

Assert the new acquisition helper returns the canonical location and exact SHA-256 that appears in `plugin:packed-artifact` evidence for the same bytes. Unsafe/malformed acquisition must not return an executable artifact observation.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/acquisition/plugin-packed.spec.ts
```

Expected: FAIL because typed artifact handoff is not exposed.

- [ ] **Step 3: Refactor without duplicating reads/parsing**

Extract the existing bounded read/hash result internally so both semantic packed acquisition and the new execution handoff consume one implementation. Do not move Node code into model/kernel.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm vitest run tests/acquisition/plugin-packed.spec.ts tests/verification/artifact.spec.ts
pnpm run check:architecture
```

Commit:

```text
refactor(verify): expose packed artifact handoff
```

---

### Task 7: Add exact real-DSH verification-worker smoke

**Files:**
- Create: `scripts/smoke-verification-worker.mjs`
- Create: `scripts/smoke-verification-process.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `tsconfig.scripts.json` only if the existing scripts checker requires explicit inclusion changes.

**Interfaces:**
- `smoke-verification-worker.mjs <candidate.tgz>` imports built internal verification/acquisition modules from `lib/**`, acquires the exact candidate packed evidence, builds the frozen rc2 Web `TargetSnapshot` through existing target acquisition rather than fabricating a fingerprint, runs the production worker, and asserts package/install/compose/boot passed with safe cleanup.
- `smoke-verification-process.mjs` is offline/platform-local and exercises production built process timeout/cancellation/tree cleanup on Windows/macOS without DSH/network.

- [ ] **Step 1: Write smoke scripts before CI wiring and run them as RED in PR CI**

Primary expected command after build/pack:

```bash
node scripts/smoke-verification-worker.mjs .artifacts/dsh-toolchain.tgz
```

Boundary command:

```bash
node scripts/smoke-verification-process.mjs
```

The first run should fail until built verification modules/boot semantics are complete.

- [ ] **Step 2: Guard active-profile non-mutation**

The smoke creates an external sentinel directory/file outside the worker root and passes no writable reference to it as worker DSH_HOME. Snapshot sentinel metadata/content before/after and assert unchanged. The assertion proves Toolchain's path usage; it does not claim candidate malicious-code filesystem sandboxing.

- [ ] **Step 3: Wire CI**

In primary, add after `Check exact packed Toolchain against real DSH` and before/adjacent to existing DSH composition smoke:

```yaml
- name: Verify exact packed Toolchain in isolated DSH worker
  run: node scripts/smoke-verification-worker.mjs .artifacts/dsh-toolchain.tgz
```

In Windows/macOS boundary lanes, after build add:

```yaml
- name: Smoke verification process boundary
  run: node scripts/smoke-verification-process.mjs
```

Do not add a second workflow or provider secret.

- [ ] **Step 4: Verify CI-specific static gates**

```bash
pnpm run check:scripts
pnpm run check:ci-storage
```

Commit:

```text
ci(verify): exercise isolated verification worker
```

---

### Task 8: Reconcile normative documentation without changing public Protocol schema

**Files:**
- Modify: `spec/verification.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/security.md` only if implementation facts need clarification.
- Do **not** edit `src/protocol/generated.ts` or `spec/schemas/v1/toolchain-protocol.schema.json` in M4.1 unless implementation reveals an actual mismatch with the existing `VerificationReport` contract.

**Interfaces:**
- `spec/verification.md` names `dsh-plugin-artifact-v1` and references ADR-0009.
- Document that M4.1 worker observations are internal execution evidence; public status/freshness reduction remains M4.2.
- Roadmap marks M4.1 worker slice implemented only after real smoke/CI is green; M4 overall remains in progress.

- [ ] **Step 1: Update normative text**

State exact-byte artifact identity, safe ignore-script boundary, boot-probe semantics, and that target freshness is finalized by the application orchestration layer after worker completion.

- [ ] **Step 2: Run protocol/architecture checks**

```bash
pnpm run check:generated
pnpm run check:protocol
pnpm run check:architecture
```

Expected: all GREEN and no generated diff because M4.1 does not change the existing public DTO shape.

- [ ] **Step 3: Commit**

```text
docs(verify): record M4.1 execution boundary
```

---

### Task 9: Final verification, PR reconciliation and merge gate

**Files:**
- Review every file changed by #188 branch; no new implementation file is expected in this task.

- [ ] **Step 1: Run aggregate checks on the exact branch head**

```bash
pnpm check
pnpm build
```

- [ ] **Step 2: Review diff for scope/contract drift**

Confirm:

- no kernel/frontend public `plugin.verify` operation accidentally landed;
- no Protocol generated/schema hand edit;
- no active-profile mutation path;
- no inherited full `process.env` in child execution;
- no shell interpolation;
- no second tar parser;
- no skipped stage reported as passed;
- no security-sandbox wording;
- no Search/H1/target/index changes.

- [ ] **Step 3: Require exact-head CI GREEN**

Required lanes:

- Node 22.19 aggregate gate;
- Node 24.19 aggregate gate;
- Node 26 aggregate gate;
- Windows 2025 verification-process boundary smoke;
- macOS 15 verification-process boundary smoke;
- pack/install/public API smoke;
- real DSH plugin-check smoke;
- new isolated verification-worker smoke;
- existing minimal + Web DSH composition smoke;
- read-only target-resolution compatibility smoke.

- [ ] **Step 4: Update PR evidence accurately**

Record exact run id/head SHA and only the checks actually observed. Keep PR Draft until every required exact-head lane is GREEN.

- [ ] **Step 5: Merge only after verification-before-completion gate**

Use squash merge with a Conventional Commit title such as:

```text
feat(verify): add isolated packed verification worker
```

After merge, confirm the main push CI is GREEN before marking #188 completed.