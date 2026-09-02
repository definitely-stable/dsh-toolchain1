# Exact Target Plugin Check Alpha v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one deterministic `plugin.check` static operation that checks a source-directory plugin against an exact DSH target and returns evidence-backed `compatible-in-scope | incompatible | unproven` results without executing candidate code.

**Architecture:** Node-specific subject IO enters through a new acquisition adapter and lowers into a runtime-neutral plugin subject model. The application kernel reuses the existing `resolveTarget` + `buildContractIndex` path, then applies deterministic plugin checks. CLI, native DSH and MCP project the same operation; runtime verification stays outside this slice.

**Tech Stack:** TypeScript 6 / NodeNext, JSON Schema 2020-12 + generated Protocol types, Vitest, existing SHA-256 port, existing M1/M2 TargetSnapshot + ContractIndex semantics.

**Spec:** `docs/superpowers/specs/2026-09-02-exact-target-plugin-check-alpha-v2-design.md`

## Global Constraints

- No candidate JavaScript import/execution, `npm install`, `npm pack`, lifecycle scripts or subprocesses in static check.
- Semantic kernel/model code remains runtime-neutral and imports no Node builtins or unapproved bare dependencies.
- Initial subject kind is `directory` only.
- `dsh-plugin-subject-v1` excludes paths/timestamps/raw irrelevant manifest formatting.
- Only `host-peer-required` package relationships can prove target package absence incompatible in the initial slice.
- `peerDependenciesMeta[name].optional === true` produces `host-peer-optional`.
- Ordinary `dependencies` produce `artifact-dependency`, never an automatic Host-missing incompatibility.
- Exact version equality may be proved initially; unsupported range semantics return `PLUGIN_DSH_VERSION_UNPROVEN`.
- No change to `dsh-target-v2` or `dsh-contract-index-v1`.
- `compatible-in-scope` is static-ruleset compatibility, never runtime verification.
- Existing Node/platform CI matrix and five-second R1 retrieval regression remain unchanged.

---

### Task 1: Correct the normative public operation contract

**Files:**
- Modify: `spec/protocol.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md` only if wording still exposes separate alpha analyze/validate calls

**Interfaces:**
- Consumes: current pre-public Protocol v1 correction rule.
- Produces: normative `plugin.check` public use case; `plugin.verify` remains M4; normalization/analyze/validation are internal passes.

- [ ] **Step 1: Write the contract diff before implementation code**

Replace the baseline public-static operation wording with these semantics:

```text
plugin.check = public static composite operation
  normalize subject
  acquire exact target/index evidence
  run deterministic checks
  return ruleset + compatibility + diagnostics

compatibility = compatible-in-scope | incompatible | unproven
plugin.verify = separate M4 execution boundary
```

- [ ] **Step 2: Check architecture/protocol consistency**

Run:

```bash
pnpm run check:architecture
pnpm run check:protocol
```

Expected: PASS; no code/schema behavior changed yet.

- [ ] **Step 3: Commit the contract correction**

```bash
git add spec/protocol.md docs/architecture.md docs/roadmap.md
git commit -m "docs(plugin): define plugin.check as static alpha operation"
```

---

### Task 2: Define Protocol DTOs and strict request parsing

**Files:**
- Modify: `spec/schemas/v1/toolchain-protocol.schema.json`
- Modify: `src/protocol/request-validation.ts`
- Generated: `src/protocol/generated.ts`
- Test: `tests/protocol/plugin-check-request-validation.spec.ts`
- Test: `tests/protocol/protocol.spec.ts`
- Add/update canonical Protocol examples under the existing examples path used by `scripts/check-protocol.mjs`

**Interfaces:**
- Produces:

```ts
interface PluginSubjectRequest {
  readonly kind: 'directory'
  readonly path: string
}

interface PluginCheckRequest {
  readonly target: TargetResolveRequest
  readonly subject: PluginSubjectRequest
}

type PluginCheckCompatibility =
  | 'compatible-in-scope'
  | 'incompatible'
  | 'unproven'
```

- [ ] **Step 1: Write RED parser tests**

```ts
expect(parsePluginCheckRequest({
  target: { profile: 'web' },
  subject: { kind: 'directory', path: '/tmp/plugin' },
})).toEqual({
  target: { profile: 'web' },
  subject: { kind: 'directory', path: '/tmp/plugin' },
})

expect(() => parsePluginCheckRequest({
  target: { profile: 'web' },
  subject: { kind: 'directory', path: '/tmp/plugin', extra: true },
})).toThrow('Invalid plugin.check arguments')
```

Also reject empty path, unknown subject kind, unknown top-level key and invalid target request.

- [ ] **Step 2: Run the RED test**

```bash
pnpm vitest run tests/protocol/plugin-check-request-validation.spec.ts
```

Expected: FAIL because `PluginCheckRequest` / `parsePluginCheckRequest` do not exist.

- [ ] **Step 3: Add closed schema definitions and parser**

Add closed schema objects for subject request, package requirement, subject snapshot, check item, check result and operation response. In `request-validation.ts`, add exact-key sets and:

```ts
export function parsePluginCheckRequest(value: unknown): PluginCheckRequest {
  const message = 'Invalid plugin.check arguments'
  if (!isRecord(value)) invalid(message)
  if (Object.keys(value).some(key => !pluginCheckKeys.has(key as keyof PluginCheckRequest))) invalid(message)

  const { target, subject } = value
  const parsedTarget = parseTargetResolveRequestWithMessage(target, message)
  if (!isRecord(subject)) invalid(message)
  if (Object.keys(subject).some(key => !pluginSubjectKeys.has(key as keyof PluginSubjectRequest))) invalid(message)
  if (subject.kind !== 'directory' || !nonEmptyString(subject.path)) invalid(message)

  return { target: parsedTarget, subject: { kind: 'directory', path: subject.path } }
}
```

- [ ] **Step 4: Regenerate and verify Protocol**

```bash
pnpm run generate
pnpm run check:generated
pnpm run check:protocol
pnpm vitest run tests/protocol/plugin-check-request-validation.spec.ts tests/protocol/protocol.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add spec/schemas/v1 src/protocol tests/protocol
git commit -m "feat(protocol): define plugin.check alpha contract"
```

---

### Task 3: Add runtime-neutral plugin subject normalization and fingerprinting

**Files:**
- Create: `src/model/plugin.ts`
- Test: `tests/model/plugin.spec.ts`

**Interfaces:**
- Consumes raw normalized acquisition facts, never filesystem paths as semantic inputs.
- Produces:

```ts
export type PluginPackageRelationship =
  | 'host-peer-required'
  | 'host-peer-optional'
  | 'artifact-dependency'

export interface AcquiredPluginRequirement {
  readonly name: string
  readonly range: string
  readonly relationship: PluginPackageRelationship
  readonly evidenceIds: readonly string[]
}

export interface AcquiredPluginSubject {
  readonly packageName?: string
  readonly packageVersion?: string
  readonly bundlePatchHash?: string
  readonly requirements: readonly AcquiredPluginRequirement[]
  readonly evidence: readonly Evidence[]
}

export async function createPluginSubjectSnapshot(
  acquired: AcquiredPluginSubject,
  digest: Sha256Port,
): Promise<PluginSubjectSnapshot>
```

- [ ] **Step 1: Write RED determinism/identity tests**

Prove:

```ts
expect(a.fingerprint).toBe(b.fingerprint) // same semantics, different evidence locations
expect(descriptionOnlyChange.fingerprint).toBe(original.fingerprint)
expect(rangeChange.fingerprint).not.toBe(original.fingerprint)
expect(optionalPeer.fingerprint).not.toBe(requiredPeer.fingerprint)
```

Also prove requirement order is canonical and duplicate equivalent requirements deduplicate deterministically.

- [ ] **Step 2: Run RED test**

```bash
pnpm vitest run tests/model/plugin.spec.ts
```

Expected: FAIL because `src/model/plugin.ts` does not exist.

- [ ] **Step 3: Implement canonical semantic projection**

Use an explicit projection:

```ts
interface PluginSubjectSemanticProjectionV1 {
  readonly packageName?: string
  readonly packageVersion?: string
  readonly bundlePatchHash?: string
  readonly requirements: readonly {
    name: string
    range: string
    relationship: PluginPackageRelationship
  }[]
}
```

Sort by code-point tuple `(name, relationship, range)`, canonical-JSON encode through the repository's existing deterministic JSON convention, hash with the injected `Sha256Port`, and prefix `dsh-plugin-subject-v1:`.

Raw evidence hashes remain evidence fields and are not copied wholesale into the semantic projection.

- [ ] **Step 4: Run model + architecture tests**

```bash
pnpm vitest run tests/model/plugin.spec.ts
pnpm run check:architecture
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/plugin.ts tests/model/plugin.spec.ts
git commit -m "feat(model): normalize plugin subject identity"
```

---

### Task 4: Implement bounded read-only directory acquisition

**Files:**
- Create: `src/acquisition/plugin-directory.ts`
- Test: `tests/acquisition/plugin-directory.spec.ts`
- Test fixtures: `tests/fixtures/plugin-check/**`

**Interfaces:**
- Produces:

```ts
export interface PluginSubjectAcquisitionPort {
  acquire(subject: PluginSubjectRequest): Promise<AcquiredPluginSubject>
}

export class PluginSubjectAcquisitionError extends Error {
  readonly code:
    | 'PLUGIN_MANIFEST_READ_FAILED'
    | 'PLUGIN_MANIFEST_INVALID'
    | 'PLUGIN_SUBJECT_LIMIT_EXCEEDED'
    | 'PLUGIN_BUNDLE_PATCH_MISSING'
    | 'PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT'
    | 'PLUGIN_BUNDLE_PATCH_NOT_FILE'
}
```

- [ ] **Step 1: Write RED manifest/relationship tests**

Fixtures must prove:

```json
{
  "peerDependencies": {
    "@deepseek-ai/dsh-tools": "0.1.1-rc.2",
    "@deepseek-ai/dsh-scope": "^0.1.1-rc.2"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/dsh-scope": { "optional": true }
  },
  "dependencies": {
    "@deepseek-ai/dsh-session-query": "0.1.1-rc.2"
  }
}
```

Expected normalized relationships:

```ts
[
  ['@deepseek-ai/dsh-scope', '^0.1.1-rc.2', 'host-peer-optional'],
  ['@deepseek-ai/dsh-session-query', '0.1.1-rc.2', 'artifact-dependency'],
  ['@deepseek-ai/dsh-tools', '0.1.1-rc.2', 'host-peer-required'],
]
```

- [ ] **Step 2: Write RED containment/budget tests**

Cover:
- `../outside.patch` lexical escape;
- symlink target outside root;
- directory instead of patch file;
- manifest and patch beyond fixed byte budgets;
- equivalent copied directory produces same semantic snapshot after normalization;
- a candidate JS file that would throw on import is never imported during acquisition.

- [ ] **Step 3: Run RED acquisition tests**

```bash
pnpm vitest run tests/acquisition/plugin-directory.spec.ts
```

Expected: FAIL because adapter does not exist.

- [ ] **Step 4: Implement safe acquisition**

Use `node:fs/promises` only in acquisition layer. Resolve the root and candidate file with filesystem-real paths and compare via a platform-safe containment helper; reject outside-root resolution before reading the patch. Require regular files via the opened handle's stat result. Read under explicit byte limits using bounded reads rather than unbounded `readFile` for attacker-controlled content.

Parse only JSON data. Do not import/require candidate source.

- [ ] **Step 5: Run focused + policy tests**

```bash
pnpm vitest run tests/acquisition/plugin-directory.spec.ts
pnpm run check:architecture
pnpm run lint
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/acquisition/plugin-directory.ts tests/acquisition tests/fixtures/plugin-check
git commit -m "feat(acquisition): read plugin directory safely"
```

---

### Task 5: Implement shared kernel `checkPlugin`

**Files:**
- Modify: `src/kernel/index.ts`
- Create: `src/model/plugin-check.ts`
- Test: `tests/kernel/plugin-check.spec.ts`
- Test: `tests/model/plugin-check.spec.ts`

**Interfaces:**
- Kernel options gain `pluginSubjectAcquisition?: PluginSubjectAcquisitionPort`.
- Kernel produces:

```ts
async checkPlugin(
  request: PluginCheckRequest,
  enrichment?: ContractEnrichmentPort,
): Promise<PluginCheckOutcome>
```

- [ ] **Step 1: Write RED pure-check tests**

Use synthetic subject + ContractIndex fixtures to prove:

```text
required peer missing       -> incompatible / PLUGIN_DSH_PACKAGE_MISSING
optional peer missing       -> not incompatible for that reason
artifact dependency missing -> not incompatible for that reason
exact required peer version equal -> satisfied
non-exact peer range        -> unproven / PLUGIN_DSH_VERSION_UNPROVEN
```

Read target package version only from the package ContractDefinition fact `{ key: 'version', value: ... }` and require authoritative evidence references already present in the index.

- [ ] **Step 2: Run RED pure tests**

```bash
pnpm vitest run tests/model/plugin-check.spec.ts
```

Expected: FAIL because check model does not exist.

- [ ] **Step 3: Implement deterministic check reducer**

Ruleset reducer:

```ts
function summarizeCompatibility(items: readonly PluginCheckItem[]): PluginCheckCompatibility {
  if (items.some(item => item.status === 'incompatible')) return 'incompatible'
  if (items.some(item => item.status === 'unproven')) return 'unproven'
  return 'compatible-in-scope'
}
```

Each item has stable rule id/status/affected requirement/evidence ids. Sort output deterministically by rule then package identity.

- [ ] **Step 4: Write RED kernel end-to-end test**

Inject fake target acquisition, contract acquisition and plugin acquisition. Assert the result binds:

```ts
expect(result.snapshotFingerprint).toBe(targetFingerprint)
expect(result.data.contractIndexFingerprint).toBe(contractIndexFingerprint)
expect(result.data.ruleset).toBe('dsh-plugin-check-static-alpha-v1')
expect(result.data.subject.fingerprint).toMatch(/^dsh-plugin-subject-v1:[0-9a-f]{64}$/u)
```

- [ ] **Step 5: Implement kernel composition**

Kernel sequence is exactly:

```text
plugin acquisition
-> semantic subject snapshot
-> existing buildContractIndex(request.target, enrichment)
-> pure plugin checks
-> Protocol outcome
```

Do not call public `searchContracts` repeatedly; reason over the already-built exact `ContractIndex` directly inside the application use case.

- [ ] **Step 6: Run kernel/model tests**

```bash
pnpm vitest run tests/model/plugin-check.spec.ts tests/kernel/plugin-check.spec.ts
pnpm run typecheck
pnpm run check:architecture
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/model/plugin-check.ts src/kernel/index.ts tests/model/plugin-check.spec.ts tests/kernel/plugin-check.spec.ts
git commit -m "feat(kernel): add exact-target plugin check"
```

---

### Task 6: Add npm-compatible semver as a separately gated improvement

**Files:**
- Modify: architecture allowlist/policy file discovered by `scripts/check-architecture.mjs` only after proving a pure dependency is acceptable
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/model/version-range.ts` or a runtime-neutral port implementation at the allowed boundary chosen by the architecture review
- Test: `tests/model/version-range.spec.ts`
- Modify: `src/model/plugin-check.ts`

**Interfaces:**

```ts
export interface VersionRangePort {
  satisfies(version: string, range: string): 'yes' | 'no' | 'unsupported'
}
```

- [ ] **Step 1: Write RED strict-semver tests**

Cover exact, caret, tilde, comparator sets, prerelease and invalid/workspace inputs. Critically:

```ts
expect(port.satisfies('0.1.1-rc.2', '^0.1.1-rc.2')).toBe('yes')
expect(port.satisfies('0.1.2-alpha.1', '^0.1.1-rc.2')).toBe('no')
expect(port.satisfies('0.1.1-rc.2', 'workspace:*')).toBe('unsupported')
```

Use normal npm prerelease behavior; do not set `includePrerelease: true` globally.

- [ ] **Step 2: Decide architecture dependency placement explicitly**

If the pure `semver` package is allowlisted, pin it through normal lockfile policy and wrap only the strict APIs required by `VersionRangePort`. If architecture review rejects a semantic-layer bare dependency, place the implementation behind an injected port at a permitted boundary; do not write a partial home-grown parser.

- [ ] **Step 3: Upgrade check statuses**

`yes` -> satisfied; `no` -> `PLUGIN_DSH_VERSION_MISMATCH` / incompatible; `unsupported` -> `PLUGIN_DSH_VERSION_UNPROVEN` / unproven.

- [ ] **Step 4: Run focused and full policy checks**

```bash
pnpm vitest run tests/model/version-range.spec.ts tests/model/plugin-check.spec.ts
pnpm run check:architecture
pnpm run check:package
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/model tests/model scripts
git commit -m "feat(plugin): add strict target version reasoning"
```

---

### Task 7: Project the shared operation through CLI, native DSH and MCP

**Files:**
- Modify: `src/frontends/cli/index.ts`
- Modify: `src/frontends/mcp/**`
- Create: `src/integrations/dsh/plugin-check-tool.ts`
- Modify: `src/integrations/dsh/index.ts`
- Test: `tests/cli/plugin-check.spec.ts`
- Test: `tests/mcp/plugin-check.spec.ts`
- Test: `tests/dsh/plugin-check-tool.spec.ts`
- Test: frontend parity test under `tests/frontends/`

**Interfaces:**

```text
CLI:    dsh-toolchain plugin check --subject <directory> --profile <name>
DSH:    toolchain_plugin_check
MCP:    plugin.check
```

- [ ] **Step 1: Write RED parity tests**

Inject one fake shared kernel response and assert all frontends preserve the same `PluginCheckResult` fields, compatibility value, subject/target/index fingerprints and diagnostics.

- [ ] **Step 2: Run RED tests**

```bash
pnpm vitest run tests/cli/plugin-check.spec.ts tests/mcp/plugin-check.spec.ts tests/dsh/plugin-check-tool.spec.ts
```

Expected: FAIL because projections do not exist.

- [ ] **Step 3: Implement CLI syntax-only projection**

CLI parses subject/profile/target hints and calls `parsePluginCheckRequest` + shared application response path. It owns no compatibility logic.

- [ ] **Step 4: Implement MCP projection from Protocol schema**

Use the same JSON-Schema-to-MCP mechanism already used by target/contract operations. Return canonical structured result; do not define MCP-local DTOs.

- [ ] **Step 5: Implement native DSH tool**

Validate raw tool arguments before Service/kernel invocation. Agent-scoped Contract enrichment may be supplied through the existing DSH boundary, but candidate code is still static input only.

- [ ] **Step 6: Run parity suite**

```bash
pnpm vitest run tests/cli/plugin-check.spec.ts tests/mcp/plugin-check.spec.ts tests/dsh/plugin-check-tool.spec.ts tests/frontends
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/frontends src/integrations/dsh tests/cli tests/mcp tests/dsh tests/frontends
git commit -m "feat(frontends): expose plugin.check consistently"
```

---

### Task 8: Prove packed Toolchain + real DSH alpha and update Agent Skill

**Files:**
- Modify/create packed smoke script under `scripts/` following existing Toolchain `.tgz` smoke patterns
- Modify: `skills/dsh-toolchain/SKILL.md`
- Test: package/smoke policy tests as required
- Modify: `README.md` and `docs/roadmap.md` only after the proof is green

**Interfaces:**
- Consumes exact packed Toolchain `.tgz`, a deterministic static plugin fixture and supported published DSH target.
- Produces evidence that packaged Toolchain exposes the same `plugin.check` semantics as source tests.

- [ ] **Step 1: Write the smoke policy test before the smoke implementation**

Require the smoke to:

```text
pack exact Toolchain artifact
install into disposable DSH graph/profile
check deterministic plugin fixture
assert target/index/subject identities
assert expected compatibility + diagnostic
prove candidate side-effect marker was never created
```

- [ ] **Step 2: Implement the exact-artifact smoke**

Reuse existing install/composition helpers; do not add a second package installation strategy for Plugin Check.

- [ ] **Step 3: Update the model-facing skill**

The skill should prefer `plugin.check` for static review when available and must describe `compatible-in-scope` as static evidence, not runtime verification.

- [ ] **Step 4: Run full repository verification**

```bash
pnpm check
pnpm build
```

Then require GitHub Actions green on:
- primary Node 24 exact pack/composition/smoke;
- Node 22.19 / 24.19 / current 26 compatibility lanes;
- Windows/macOS boundary lanes.

- [ ] **Step 5: Update shipped-status documentation only after green evidence**

Document the exact directory alpha boundary, deferred packed candidate support and the separation from M4 runtime verification.

- [ ] **Step 6: Commit**

```bash
git add scripts skills README.md docs tests
git commit -m "feat(product): complete Exact Target Plugin Check directory alpha"
```

---

## Self-review notes

- Spec coverage: operation semantics, subject identity, dependency relationship taxonomy, containment, exact target/index binding, version uncertainty, partial results, frontends and packed Toolchain proof all have implementation tasks.
- Deliberate deferment: candidate `.tgz` acquisition is not implemented by this directory slice; when added it reuses the same subject model and gains a separate exact artifact fingerprint.
- Type consistency: `PluginCheckRequest`, `PluginSubjectRequest`, `PluginPackageRelationship`, `PluginCheckCompatibility`, `PluginSubjectAcquisitionPort` and `checkPlugin` are defined once above and reused by later tasks.
- No production ranking/retrieval tuning is coupled to Plugin Check. Current ContractIndex behavior is sufficient for this product slice.
