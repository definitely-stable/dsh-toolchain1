# M2.3 P0 Ordinary Exact-Target Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze a conventional exact-target read/search surface for arms B and C over the real `@deepseek-ai/dsh@0.1.1-rc.2` Web package closure, while keeping C's only causal addition the two production Toolchain contract tools.

**Architecture:** Add an evaluation-only canonical virtual workspace whose files are content-addressed and machine-path independent. Build two deterministic runner-owned ordinary tools (`read_file`, `search_text`) over that workspace, then compose B/C capability manifests from the same workspace/tool definitions; C appends the existing production Toolchain search/inspect definitions. Extend the existing explicit fixture generator to capture the real registry artifact bytes, but keep required CI fully offline and consume only the committed frozen fixture.

**Tech Stack:** TypeScript 6, Vitest 4, Node 22.19+/24.19+/26, existing SHA-256 port, existing M2 evaluation fixture generator, existing runner-owned trace/content evidence.

**Spec:** GitHub Issue #40; `docs/evaluation/m2/agent-comparison.md`; `docs/plans/2026-08-28-m2-3-p0-agent-execution-design.md`; `AGENTS.md`; `CONTRIBUTING.md`.

## Global Constraints

- Evaluation/repository tooling only; do not change `src/**`, public Toolchain Protocol, production retrieval ranking, dependencies, or required CI workflow unless a concrete blocker is proven first.
- Canonical target stays `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`, target `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`, Contract Index `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`.
- Required CI remains offline with respect to registry/model calls. Registry capture is an explicit fixture-regeneration operation only.
- Ordinary evidence must expose conventional published-package bytes, never `contract-facts.json`, normalized ContractIndex data, oracle hints/results, H1 commitments, or evaluator-only metadata.
- Stable virtual root is `/exact-target/node_modules/`; host absolute paths, pnpm store paths and `DSH_HOME` never enter semantic identity or model-visible output.
- B and C ordinary workspace/static context/tool schemas are byte-identical. C adds exactly `toolchain_contract_search` and `toolchain_contract_inspect`; A gets no exact-target evidence/tools.
- Every behavior change follows RED -> focused GREEN -> full `pnpm check` -> exact-head CI -> corrective review.

---

### Task 1: Canonical ordinary-workspace model and identity

**Files:**
- Create: `tests/evaluation/m2-agent-ordinary-workspace.ts`
- Create: `tests/evaluation/m2-agent-ordinary-workspace.spec.ts`

**Interfaces:**
- Produces `OrdinaryWorkspaceFile`, `OrdinaryWorkspace`, `validateOrdinaryWorkspace()`, `createOrdinaryWorkspace()`, and `ordinaryWorkspaceProjection()`.
- `OrdinaryWorkspace.schema` is `dsh-toolchain-m2-ordinary-workspace-v1`.
- `workspaceSnapshotSha256` is a lowercase SHA-256 over a canonical projection that includes target identity, inclusion-policy id, sorted package inventory, and sorted file metadata `{ path, sha256, byteLength, mediaType }`; retained `content` is re-hashed by validation but not duplicated into the identity projection.

- [ ] **Step 1: Write RED validation tests**

Cover one valid synthetic workspace plus failures for duplicate virtual paths, `..`, backslashes, paths outside `/exact-target/node_modules/`, host-looking absolute paths embedded in file metadata, hash mismatch, byte-length mismatch, unsupported media type, per-file overflow, aggregate overflow, and forbidden evaluator/Toolchain fixture paths such as `contract-facts.json`, `docs/evaluation/m2`, `api-oracle-v1.json`, and `agent-holdout-h1.commitment.json`.

- [ ] **Step 2: Run the focused spec and prove RED**

Run: `pnpm vitest run tests/evaluation/m2-agent-ordinary-workspace.spec.ts`

Expected: FAIL because the workspace module does not exist.

- [ ] **Step 3: Implement the minimal closed model**

Use these frozen baseline bounds unless a real rc.2 capture proves a smaller safe bound is required:

```ts
export const ORDINARY_WORKSPACE_MAX_FILES = 10_000
export const ORDINARY_WORKSPACE_MAX_FILE_BYTES = 512 * 1024
export const ORDINARY_WORKSPACE_MAX_TOTAL_BYTES = 16 * 1024 * 1024

export interface OrdinaryWorkspaceFile {
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
  readonly mediaType: 'application/json' | 'text/plain' | 'text/typescript'
  readonly content: string
}

export interface OrdinaryWorkspace {
  readonly schema: 'dsh-toolchain-m2-ordinary-workspace-v1'
  readonly fixtureVersion: 'rc2-web-v1'
  readonly target: {
    readonly package: '@deepseek-ai/dsh'
    readonly version: '0.1.1-rc.2'
    readonly profile: 'web'
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
  }
  readonly inclusionPolicy: 'published-package-conventional-evidence-v1'
  readonly packages: readonly { readonly name: string; readonly version: string }[]
  readonly files: readonly OrdinaryWorkspaceFile[]
  readonly documentationSha256: string
  readonly workspaceSnapshotSha256: string
}
```

`createOrdinaryWorkspace()` computes every file hash/byte length from retained UTF-8 content, sorts packages/files canonically, computes `documentationSha256` from the subset classified as README/CHANGELOG/docs text, and computes the final workspace identity. `validateOrdinaryWorkspace()` re-hashes all retained bytes and recomputes both identities.

- [ ] **Step 4: Run focused GREEN**

Run: `pnpm vitest run tests/evaluation/m2-agent-ordinary-workspace.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test(m2.3): define ordinary workspace identity`

---

### Task 2: Deterministic ordinary `read_file` and `search_text` tools

**Files:**
- Create: `tests/evaluation/m2-agent-ordinary-tools.ts`
- Create: `tests/evaluation/m2-agent-ordinary-tools.spec.ts`

**Interfaces:**
- Consumes validated `OrdinaryWorkspace`.
- Produces `createOrdinaryReadToolDefinition(workspace)` and `createOrdinarySearchToolDefinition(workspace)` returning `ModelVisibleTool`-compatible definitions plus runner-callable `execute()` functions.
- Frozen names: `read_file`, `search_text`.

- [ ] **Step 1: Write RED tests for closed request schemas and deterministic output**

`read_file` input:

```ts
{ path: string, startLine?: number, lineCount?: number }
```

Rules: path must resolve to an exact workspace entry; `startLine` defaults to 1; `lineCount` defaults to 120 and is `1..200`; output never exceeds the selected lines and reports `{ path, sha256, startLine, endLine, totalLines, content }`.

`search_text` input:

```ts
{ query: string, pathPrefix?: string, limit?: number }
```

Rules: non-empty query <= 128 UTF-8 bytes; optional prefix must stay under the virtual root; `limit` defaults to 20 and is `1..50`; matching is deterministic case-insensitive literal substring search over lines; result order is `(path, line, column)`; output rows are `{ path, line, column, text }`; result text is bounded to a fixed line excerpt and no hidden file content is returned.

Tests must prove request extra fields fail closed, path traversal fails, same semantic workspace in different input order yields byte-identical results, limit/truncation is stable, and no network/filesystem access is needed.

- [ ] **Step 2: Run focused RED**

Run: `pnpm vitest run tests/evaluation/m2-agent-ordinary-tools.spec.ts`

Expected: FAIL because tool definitions do not exist.

- [ ] **Step 3: Implement minimal local tool behavior**

Keep all lookup/search in memory over the validated committed workspace. Do not introduce fuzzy ranking, embeddings, glob engines, regex, filesystem fallback, or evaluator-aware shortcuts.

- [ ] **Step 4: Run focused GREEN**

Run: `pnpm vitest run tests/evaluation/m2-agent-ordinary-tools.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test(m2.3): add deterministic ordinary evidence tools`

---

### Task 3: Runner-owned ordinary broker and B/C manifest construction

**Files:**
- Create: `tests/evaluation/m2-agent-ordinary-broker.ts`
- Create: `tests/evaluation/m2-agent-ordinary-broker.spec.ts`
- Modify: `tests/evaluation/m2-agent-execution-evidence.ts`
- Modify: `tests/evaluation/m2-agent-execution-evidence.spec.ts`
- Modify: `tests/evaluation/m2-agent-process-runner.spec.ts`

**Interfaces:**
- `createFrozenOrdinaryBroker(runControlSha256, workspace)` exposes traced runner-owned `read_file` / `search_text`, `dispatchToolCall()`, and `traceReceipt()`.
- `createFrozenP0CapabilityManifests(workspace, toolchainDefinitions)` returns `{ A, B, C }` where A is empty, B is ordinary-only, and C is B plus exactly the two production Toolchain definitions.

- [ ] **Step 1: Write RED causal-boundary tests**

Prove:

```text
A = no ordinary evidence, no tools
B = exact workspace + [read_file, search_text]
C = exact same workspace + [read_file, search_text] + [toolchain_contract_search, toolchain_contract_inspect]
```

`OrdinaryEvidenceCapability` must use:

```ts
{
  workspaceSnapshotSha256: workspace.workspaceSnapshotSha256,
  roots: ['/exact-target'],
  readOnly: true,
  staticDocsSha256: workspace.documentationSha256,
  networkPolicy: 'provider-only',
  search: { backend: 'virtual-literal-search', version: '1', maxResults: 50 }
}
```

The provider process remains the only permitted network path; ordinary tools themselves are offline.

- [ ] **Step 2: Prove RED**

Run: `pnpm vitest run tests/evaluation/m2-agent-ordinary-broker.spec.ts tests/evaluation/m2-agent-execution-evidence.spec.ts tests/evaluation/m2-agent-process-runner.spec.ts`

Expected: FAIL until the real ordinary broker/manifests replace fixture-only `read_file` stubs.

- [ ] **Step 3: Implement traced ordinary broker**

Every ordinary request/response becomes runner-owned `ContentRef` evidence and `RunnerToolTraceEntry.family = 'ordinary'`. Do not let the child author trace entries. Compose ordinary and Toolchain dispatch explicitly rather than introducing a generic orchestration framework.

- [ ] **Step 4: Replace C integration fixture stubs**

Update the process-runner integration to obtain its C manifest from the shared manifest builder and dispatch both ordinary and Toolchain calls through runner-owned brokers. Keep the existing production Toolchain broker untouched except for the minimum composition seam if required.

- [ ] **Step 5: Focused GREEN and commit**

Run the three focused specs above.

Commit: `test(m2.3): bind ordinary evidence to B and C`

---

### Task 4: Extend the explicit rc.2 fixture generator with a closed conventional-file capture policy

**Files:**
- Modify: `scripts/generate-m2-evaluation-fixture.mjs`
- Create: `tests/evaluation/m2-agent-ordinary-fixture-generator.spec.ts`
- Modify: `tests/evaluation/m2-retrieval-index.spec.ts` only if fixture-manifest structural assertions share ownership and the change remains evaluation-only.

**Interfaces:**
- Generator adds `ordinary-workspace.json` beside the existing `manifest.json`, `target-facts.json`, and `contract-facts.json`.
- Generation policy id: `published-package-conventional-evidence-v1`.

- [ ] **Step 1: Write RED policy tests around a synthetic package tree**

The capture helper must include only:

1. package-root `package.json`;
2. public `.d.ts` files reachable from package `types` / `typings` / declaration-bearing `exports` entrypoints plus relative declaration references already accepted by the public-declaration traversal policy;
3. package-root `README*`, `CHANGELOG*`, and UTF-8 text files under `docs/**` within the frozen bounds.

Reject/skip JavaScript runtime files, source maps, binaries, `.env`, credentials, hidden VCS data, evaluator files, normalized fixture files, absolute paths and symlink escapes. Stable output paths use `/exact-target/node_modules/<package>/<relative-path>`.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/evaluation/m2-agent-ordinary-fixture-generator.spec.ts`

Expected: FAIL until capture helpers exist.

- [ ] **Step 3: Implement generator-only capture helpers**

Reuse the existing declaration traversal/safety semantics rather than inventing a second public-declaration graph when practical. The explicit generator may read filesystem/package-manager state; required CI consumers may not.

Generator provenance must record exact package/version inventory, inclusion-policy id, generator commit/runtime, and workspace identities. Two equivalent `DSH_HOME` values and different absolute temporary roots must produce equal ordinary workspace bytes/identity.

- [ ] **Step 4: Focused GREEN and script typecheck**

Run:

```text
pnpm vitest run tests/evaluation/m2-agent-ordinary-fixture-generator.spec.ts
pnpm run check:scripts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `build(m2.3): capture conventional rc2 evidence`

---

### Task 5: Freeze and validate the real registry-derived rc.2 ordinary workspace

**Files:**
- Create/generated: `tests/evaluation/fixtures/m2/rc2-web-v1/ordinary-workspace.json`
- Modify/generated: `tests/evaluation/fixtures/m2/rc2-web-v1/manifest.json`
- Create: `tests/evaluation/m2-agent-ordinary-fixture.spec.ts`

**Interfaces:**
- Consumes explicit generator output from exact `@deepseek-ai/dsh@0.1.1-rc.2` registry install.
- Produces the immutable conventional evidence fixture consumed by required CI and later P0/H1 execution.

- [ ] **Step 1: Generate the fixture using the explicit network-enabled regeneration path**

Run outside required CI:

```text
pnpm build
M2_FIXTURE_GENERATED_AT=2026-08-28T00:00:00.000Z node scripts/generate-m2-evaluation-fixture.mjs
```

Do not hand-edit generated JSON.

- [ ] **Step 2: Add offline validation tests**

Tests load `ordinary-workspace.json`, call `validateOrdinaryWorkspace()`, bind its target/index identity to `M2_RETRIEVAL_TARGET`, prove package inventory matches the existing rc.2 fixture manifest, and assert no forbidden evaluator/normalized paths occur.

Also assert the frozen workspace contains at least the declaration/package routes needed to make the **conventional environment** plausible for P0 without testing P0 expected answers directly: package metadata exists for every captured package, declaration count is non-zero, docs subset identity is stable, and `read_file` / `search_text` operate on committed bytes.

- [ ] **Step 3: Run offline focused GREEN twice**

Run the fixture spec twice and verify identical workspace/tool outputs.

- [ ] **Step 4: Commit generated evidence and validation together**

Commit: `test(m2.3): freeze rc2 ordinary evidence workspace`

---

### Task 6: Full repository verification, causal-leakage review, and merge readiness

**Files:**
- Modify: `docs/evaluation/m2/agent-comparison.md` only to replace hypothetical ordinary evidence wording with the exact frozen workspace/tool identity and policy after Task 5 has real hashes.
- Modify: Issue #40 / PR description through GitHub metadata, not source files.

- [ ] **Step 1: Run full local/repository quality gate**

Run: `pnpm check`

Expected: PASS with no new errors. Existing unrelated lint warnings may remain but must not increase because of this PR.

- [ ] **Step 2: Corrective review the full diff**

Confirm:

- no `src/**`, dependency, workflow, public Protocol or production retrieval change;
- no normalized ContractIndex/`contract-facts` bytes reachable through ordinary tools;
- no oracle/P0/H1 expected-answer metadata reachable through ordinary workspace or static context;
- B/C ordinary identities/tool schemas are exactly equal;
- C's only additional model-visible tools are production Toolchain search/inspect;
- all ordinary tool traces are runner-owned;
- generator outputs are machine-path independent and no secrets/user paths were captured.

- [ ] **Step 3: Run exact-head CI**

Require all six jobs green: Node 22.19/24.19/26, Windows 2025, macOS 15, package/installed-package/exact DSH composition/cross-train target checks.

- [ ] **Step 4: Synchronize Issue #40 and PR metadata**

Mark only acceptance criteria actually proven. Record exact HEAD SHA and CI run number. Use `Closes #40`; keep #34/#28 open because no real P0 model outcome has happened.

- [ ] **Step 5: Squash merge only after exact-head verification**

After merge, require post-merge `main` CI green before starting the next P0 orchestration/provider slice.
