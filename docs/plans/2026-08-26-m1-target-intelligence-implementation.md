# M1 Target Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve one installed DSH profile into an immutable, evidence-backed `TargetSnapshot` with a deterministic `dsh-target-v1` fingerprint and expose the first useful `target resolve` CLI path.

**Architecture:** Node-specific filesystem/package discovery stays in `src/acquisition/`; canonical target semantics live in `src/model/`; the internal kernel composes the acquisition and digest ports and owns `resolveTarget()`. Protocol v1 is expanded only for the M1 target request/result. CLI is the first projection; DSH/MCP parity follows after this vertical slice proves the contract.

**Tech Stack:** TypeScript 6 / NodeNext ESM, Node 22.19+/24/26, pnpm 11.7, Vitest 4, JSON Schema Draft 2020-12, AJV 8, Node `crypto`/`fs`/`module` only in acquisition/frontend boundaries.

**Spec:** `docs/plans/2026-08-26-m1-target-intelligence-design.md`, `docs/decisions/ADR-0006-target-semantic-fingerprint-v1.md`

## Global Constraints

- Semantic core (`product`, `protocol`, `model`, `kernel`) MUST remain free of Node builtins, DSH runtime packages, arbitrary external runtime packages, `process`, `Buffer`, and `fetch`.
- Acquisition is read-only and MUST NOT initialize/mutate DSH profiles.
- Fingerprint namespace is exactly `dsh-target-v1` and changing projection semantics requires a new namespace.
- Absolute paths/timestamps/evidence locations MUST NOT affect semantic fingerprint.
- Bundle order MUST remain semantic; profile dependency identities MUST be sorted by package name.
- Only `target.resolve` request/result is closed in Protocol during this plan. Do not design M2–M4 operation DTOs.
- No new public root export for the application-kernel factory.
- No placeholder MCP/DSH tools before the target use case is implemented through those adapters.

---

### Task 1: Close the M1 target Protocol contract

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify: `spec/protocol.md`
- Modify: `scripts/check-protocol.mjs`
- Regenerate: `src/protocol/generated.ts`
- Modify: `tests/protocol/protocol.spec.ts`
- Create: `spec/examples/v1/target-resolved.json`

**Interfaces:**
- Produces: `TargetResolveRequest`, `ResolvedPackageIdentity`, M1 `TargetSnapshot`, `TargetResolveResult`, `TargetResolveResponse` generated types.
- `TargetResolveRequest`: `{ profile: string; dshHome?: string; dshPackageRoot?: string }`.
- `TargetResolveResponse.data` MUST be `TargetResolveResult`, not `unknown`.

- [ ] **Step 1: Write failing protocol tests**

Add assertions that generated exports include `TargetResolveRequest`/`TargetResolveResult`, that `target-resolved.json` validates, and that replacing its `data` with `{ "banana": 123 }` fails the operation-specific schema.

- [ ] **Step 2: Run focused protocol tests and observe RED**

Run: `pnpm vitest run tests/protocol/protocol.spec.ts`

Expected: FAIL because target request/result definitions and example do not exist.

- [ ] **Step 3: Extend only target-related schema definitions**

Add definitions for:

```ts
TargetResolveRequest
ResolvedPackageIdentity
TargetSnapshot
TargetResolveResult
TargetResolveResponse
```

M1 snapshot shape must expose exact DSH/runtime/profile package identities required by ADR-0006 while retaining `evidence` and `createdAt`.

- [ ] **Step 4: Update normative `target.resolve` text**

Specify that acquisition hints may contain absolute paths but those values are not semantic target identity; missing targets return diagnostics without profile initialization.

- [ ] **Step 5: Regenerate and validate**

Run:

```bash
pnpm generate
pnpm check:generated
pnpm check:protocol
pnpm vitest run tests/protocol/protocol.spec.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add spec src/protocol tests/protocol scripts/check-protocol.mjs
git commit -m "feat(protocol): define target resolve contract"
```

---

### Task 2: Implement deterministic target semantic projection and fingerprint

**Files:**
- Create: `src/model/target.ts`
- Create: `src/model/digest.ts`
- Create: `tests/model/target.spec.ts`
- Modify: `scripts/check-architecture.mjs` only if a new declared layer edge is actually required (expected: no change).

**Interfaces:**

```ts
export interface Sha256Port {
  sha256Utf8(value: string): Promise<string>
}

export interface AcquiredTargetFacts {
  readonly dsh: { readonly name: '@deepseek-ai/dsh'; readonly version: string }
  readonly runtime: { readonly nodeVersion: string; readonly platform: string; readonly arch: string }
  readonly profile: {
    readonly name: string
    readonly bundles: readonly ResolvedPackageIdentity[]
    readonly dependencies: readonly ResolvedPackageIdentity[]
    readonly patchHash: string
  }
  readonly evidence: readonly Evidence[]
}

export function createTargetSemanticProjectionV1(facts: AcquiredTargetFacts): TargetSemanticProjectionV1
export function canonicalizeTargetProjection(projection: TargetSemanticProjectionV1): string
export async function fingerprintTarget(projection: TargetSemanticProjectionV1, digest: Sha256Port): Promise<string>
```

- [ ] **Step 1: Write RED fingerprint fixtures**

Tests must prove:

```text
same facts / different evidence locations -> same
same dependencies / different declaration order -> same
bundle order change -> different
patchHash change -> different
bundle version change -> different
Node/platform/arch change -> different
```

Use an injected deterministic test digest or a test-only pure fake that records canonical input; do not import Node crypto from `src/model`.

- [ ] **Step 2: Run model tests and observe RED**

Run: `pnpm vitest run tests/model/target.spec.ts`

Expected: FAIL because model implementation is absent.

- [ ] **Step 3: Implement projection/canonicalization**

Canonical JSON rules:

- recursively sort object keys;
- preserve bundle array order;
- sort dependency identities by `name`, then `version`;
- do not include evidence/paths/timestamps in projection.

- [ ] **Step 4: Implement namespaced fingerprint**

`fingerprintTarget()` returns exactly:

```text
dsh-target-v1:<64 lowercase hex chars>
```

Reject a digest result that is not 64 lowercase hex characters so a broken adapter cannot create ambiguous identities.

- [ ] **Step 5: Run focused + architecture tests**

Run:

```bash
pnpm vitest run tests/model/target.spec.ts
pnpm check:architecture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model tests/model
git commit -m "feat(core): add target semantic fingerprint"
```

---

### Task 3: Implement the read-only Node target acquisition provider

**Files:**
- Create: `src/acquisition/node-sha256.ts`
- Create: `src/acquisition/dsh-filesystem.ts`
- Create: `tests/acquisition/dsh-filesystem.spec.ts`
- Create fixture trees under: `tests/fixtures/targets/`

**Interfaces:**

```ts
export interface TargetAcquisitionPort {
  acquire(request: TargetResolveRequest): Promise<AcquiredTargetFacts>
}

export function createNodeSha256Port(): Sha256Port

export function createDshFilesystemTargetAcquisition(options?: {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly runtime?: {
    readonly nodeVersion: string
    readonly platform: string
    readonly arch: string
  }
}): TargetAcquisitionPort
```

- [ ] **Step 1: Build minimal fixture profile trees**

Fixtures must contain explicit `dsh-package/package.json`, `$DSH_HOME/profiles/<name>/package.json`, `cordis.patch.yml`, installation bundle package manifests, and profile-local package manifests. Include two absolute-root variants with identical semantic contents.

- [ ] **Step 2: Write RED acquisition tests**

Tests cover:

- reads an existing initialized `web`-style profile without writes;
- resolves bundle packages installation-first then profile-local;
- resolves exact package versions rather than dependency ranges;
- records profile patch/evidence hashes;
- sorts top-level dependency identities only at semantic normalization, not by mutating source manifest;
- missing profile returns a structured acquisition error and does not create directories/files;
- invalid bundle target reports which bundle could not resolve.

- [ ] **Step 3: Run acquisition tests and observe RED**

Run: `pnpm vitest run tests/acquisition/dsh-filesystem.spec.ts`

Expected: FAIL because provider is absent.

- [ ] **Step 4: Implement Node digest adapter**

Use `node:crypto#createHash('sha256')` only in `src/acquisition/node-sha256.ts`.

- [ ] **Step 5: Implement read-only DSH profile acquisition**

Match current upstream semantics:

- profile dir = `<dshHome>/profiles/<profile>`;
- read `package.json` + `cordis.patch.yml` only;
- bundle names come from `dsh.profile.bundles` in declared order;
- bundle resolution checks DSH installation `node_modules`/package resolution before profile-local resolution;
- profile dependency identities resolve from the profile root;
- no call to DSH profile initialization helpers and no write API.

- [ ] **Step 6: Run focused tests + architecture policy**

Run:

```bash
pnpm vitest run tests/acquisition/dsh-filesystem.spec.ts
pnpm check:architecture
pnpm check:scripts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/acquisition tests/acquisition tests/fixtures/targets
git commit -m "feat(core): acquire DSH target evidence"
```

---

### Task 4: Give the internal application kernel its first real ports and use case

**Files:**
- Modify: `src/kernel/index.ts`
- Modify: `tests/kernel/kernel.spec.ts`
- Create: `tests/kernel/target-resolve.spec.ts`
- Modify: `src/integrations/dsh/index.ts` only to construct the new kernel dependencies without exposing a model-facing tool yet.
- Modify: `src/frontends/mcp/index.ts` only to construct the new kernel dependencies without registering a target tool yet.

**Interfaces:**

```ts
export interface ApplicationKernel {
  describe(): KernelDescriptor
  resolveTarget(request: TargetResolveRequest): Promise<TargetResolveResult>
}

export function createApplicationKernel(options: {
  readonly targetAcquisition: TargetAcquisitionPort
  readonly digest: Sha256Port
  readonly now?: () => string
}): ApplicationKernel
```

`now` is injected only so snapshot `createdAt` is deterministic in tests; it does not enter the fingerprint.

- [ ] **Step 1: Write RED kernel target-resolution test**

Use fake acquisition + fake digest to prove the kernel:

- calls the acquisition port exactly once;
- builds the semantic projection/fingerprint;
- returns an immutable `TargetResolveResult`/snapshot;
- sets `createdAt` from injected `now`;
- does not place acquisition hint paths into semantic fields.

- [ ] **Step 2: Run kernel tests and observe RED**

Run: `pnpm vitest run tests/kernel`

Expected: FAIL because `resolveTarget` and required options do not exist.

- [ ] **Step 3: Implement minimal kernel orchestration**

Keep the factory internal. Existing DSH/MCP/CLI composition must explicitly supply the Node acquisition/digest adapters where appropriate rather than making the kernel read runtime globals.

- [ ] **Step 4: Run kernel + existing frontend tests**

Run:

```bash
pnpm vitest run tests/kernel tests/dsh tests/mcp tests/cli
pnpm check:architecture
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel src/integrations/dsh src/frontends/mcp tests/kernel tests/dsh tests/mcp tests/cli
git commit -m "feat(core): resolve targets through application kernel"
```

---

### Task 5: Add the first useful CLI target-resolution projection

**Files:**
- Modify: `src/frontends/cli/index.ts`
- Modify: `src/frontends/cli/bin.ts` only if dependency construction needs to move there.
- Modify: `tests/cli/cli.spec.ts`
- Create: `tests/cli/target-resolve.spec.ts`

**Interfaces:**

CLI syntax:

```text
dsh-toolchain target resolve --profile <name> [--dsh-home <path>] [--dsh-package-root <path>]
```

Output for this first M1 slice is JSON only and conforms to `TargetResolveResponse`/Toolchain protocol version `1`.

- [ ] **Step 1: Write RED CLI tests**

Tests cover exact argument parsing, required `--profile`, forwarding optional path hints, JSON output, error-to-stderr/exit-2 for syntax errors, and no mutation side effects through an injected fake kernel.

- [ ] **Step 2: Run CLI tests and observe RED**

Run: `pnpm vitest run tests/cli`

Expected: FAIL because `target resolve` is unknown.

- [ ] **Step 3: Implement CLI command with dependency injection**

Do not duplicate acquisition logic in CLI. CLI constructs/injects the application kernel and serializes the returned protocol response.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run tests/cli
pnpm check:architecture
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/frontends/cli tests/cli
git commit -m "feat(cli): resolve exact DSH target"
```

---

### Task 6: Prove target resolution against real DSH trains/layouts

**Files:**
- Create: `scripts/smoke-target-resolve.mjs`
- Modify: `.github/workflows/ci.yml`
- Create: `tests/policy/target-smoke-policy.spec.ts`
- Modify: `docs/development.md`

**Interfaces:**

The smoke script creates disposable homes/install roots, installs exact DSH versions, initializes/uses a profile through official DSH CLI where initialization is required, then runs Toolchain `target resolve` read-only against the resulting target.

- [ ] **Step 1: Write RED policy test for two-train coverage**

Require the smoke script/config to name the current pinned train `0.1.1-rc.2` and one older supported fixture/train (`0.1.0-rc.8` unless upstream packaging makes that exact train unavailable).

- [ ] **Step 2: Observe RED**

Run: `pnpm vitest run tests/policy/target-smoke-policy.spec.ts`

Expected: FAIL because the smoke does not exist.

- [ ] **Step 3: Implement disposable target-resolution smoke**

Assert:

- returned fingerprint matches `^dsh-target-v1:[0-9a-f]{64}$`;
- same semantic target copied to another home gives the same fingerprint;
- no profile file changes during the Toolchain resolution step;
- current/older train layouts both produce valid snapshots.

- [ ] **Step 4: Wire CI after existing package smoke**

Keep the primary lane authoritative; do not multiply full DSH installation across every OS/Node lane.

- [ ] **Step 5: Run focused policy tests; let CI execute real registry smoke**

Run locally/runner where network is available:

```bash
pnpm vitest run tests/policy/target-smoke-policy.spec.ts
node scripts/smoke-target-resolve.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-target-resolve.mjs .github/workflows/ci.yml tests/policy/target-smoke-policy.spec.ts docs/development.md
git commit -m "test(m1): verify target resolution across DSH trains"
```

---

### Task 7: Add early real packaged DSH boot/service visibility hardening

**Files:**
- Modify: `scripts/smoke-dsh-package.mjs`
- Modify: `tests/dsh/smoke-policy.spec.ts`
- Modify: `docs/development.md`

**Interfaces:**

The existing exact-tarball smoke must advance beyond `--dump-config` for at least one canonical profile:

```text
install exact .tgz -> compose -> actual DSH host boot/probe -> ctx.toolchain visible -> describe() -> clean shutdown
```

Do not call an LLM.

- [ ] **Step 1: Write RED smoke-policy test**

Require an explicit boot/visibility probe stage in `smoke-dsh-package.mjs`, not just a string/comment.

- [ ] **Step 2: Observe RED**

Run: `pnpm vitest run tests/dsh/smoke-policy.spec.ts`

Expected: FAIL because current smoke ends at composition.

- [ ] **Step 3: Implement the narrowest real DSH boot/probe seam**

Prefer current official app-boot/Cordis APIs over creating a fake host. The probe must load the packed bundle through the real profile composition, observe `ctx.toolchain`, call `describe()`, and dispose cleanly.

- [ ] **Step 4: Run exact packaged smoke in CI**

Run: `node scripts/smoke-dsh-package.mjs .artifacts/dsh-toolchain.tgz`

Expected: minimal + Web composition still pass and the selected real boot/visibility probe passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-dsh-package.mjs tests/dsh/smoke-policy.spec.ts docs/development.md
git commit -m "test(dsh): prove packaged service visibility"
```

---

### Task 8: Final M1 slice review and evidence

**Files:**
- Modify: `README.md`
- Modify: `docs/roadmap.md` only if implementation evidence changes exit wording.
- Modify: PR body / M1 Issues in GitHub.

**Interfaces:** none; completion gate only.

- [ ] **Step 1: Run repository-wide static gates**

```bash
pnpm check
pnpm build
pnpm pack --out .artifacts/dsh-toolchain.tgz
node scripts/check-pack.mjs .artifacts/dsh-toolchain.tgz
node scripts/smoke-installed-package.mjs .artifacts/dsh-toolchain.tgz
```

Expected: PASS.

- [ ] **Step 2: Run/inspect authoritative CI**

Require GREEN for Node 22.19/24.19/26, Windows/macOS boundaries, exact package consumer, DSH composition/boot probe, and multi-train target resolution.

- [ ] **Step 3: Self-review final diff**

Verify specifically:

- no Node/DSH runtime dependency entered semantic layers;
- fingerprint contains no paths/timestamps/evidence locations;
- Protocol changes are only target-related;
- no placeholder Contract/Plugin/Verification operations were advertised;
- profile acquisition is read-only;
- all new diagnostics have stable codes and evidence where applicable.

- [ ] **Step 4: Update README status**

State exactly what `target resolve` now proves and what M2+ still does not exist.

- [ ] **Step 5: Prepare PR evidence**

Record exact final head SHA, CI run, test counts, DSH versions/profiles exercised, and RED→GREEN evidence. Do not merge on stale evidence.
