# M1 Corrective Closure Plan

> Status: **in execution in PR #16; RED evidence recorded on CI #182.**

**Goal:** close the remaining M1 identity and packaged-discovery gaps without pulling M2 contract-index semantics or M1.1 frontend parity into the milestone.

**Architecture:** M1 continues to model one exact DSH target as an immutable, evidence-backed snapshot. The semantic identity is corrected from `dsh-target-v1` to `dsh-target-v2` because current upstream DSH composition includes ordered bundle patch bytes, the profile patch, the home-level patch, and optional `--patch` overlays; paths remain acquisition evidence only. Broader same-version source/type drift is intentionally owned by the M2 contract evidence/index identity rather than by TargetSnapshot.

**Tech stack:** TypeScript 6 / NodeNext ESM, Node 22.19+/24/26, pnpm 11.7, Vitest 4, JSON Schema Draft 2020-12, AJV 8.

**Sources:** `spec/protocol.md`, `docs/architecture.md`, ADR-0002, ADR-0006 (superseded), ADR-0007, current upstream DeepSeek Harness architecture/profile-boot contract.

## Global constraints

- Target acquisition remains read-only and MUST NOT initialize or mutate the selected profile.
- Semantic core remains free of Node/DSH runtime imports and runtime globals.
- Absolute paths, timestamps, evidence locations, usernames and Toolchain observer version MUST NOT affect target identity.
- Ordered composition remains semantic.
- `dsh-toolchain` remains acquisition evidence but is excluded as the observer from target bundle/dependency identity.
- Protocol v1 is still pre-public; the correction must be atomic across schema, generated types, examples, tests, specs and implementation.
- No M2 contract index/provider implementation and no DSH/MCP target tool projection enters this corrective PR.

---

## Analysis and disposition of the review findings

### 1. Effective DSH composition is under-fingerprinted — blocking M1

The private `dsh-target-v1` projection captured bundle package name/version and only the profile patch hash. Current DSH boot applies, in order, bundle patch layers, `profiles/<name>/cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml`, then ordered `--patch` overlays. Two installations can therefore share a v1 fingerprint while booting different Cordis trees. A locally modified bundle patch with an unchanged package version is another false-sameness case.

**Correction:** supersede v1 with `dsh-target-v2`. Each non-observer bundle identity carries `{ name, version, patchHash }`; the profile carries `profilePatchHash`, `homePatchHash`, and ordered `overlayPatchHashes`. Optional request `patches: string[]` supplies overlay acquisition paths; only the ordered content hashes enter identity. Missing profile/home patch files use distinct v2 namespaced sentinels.

### 2. Default DSH package discovery is not proven end-to-end — blocking M1

The original registry smoke always supplied `--dsh-package-root`, while the public CLI documents it as optional.

A deeper upstream review corrected the initial proposed test design: DSH's profile fallback is for the application dependency closure and does not guarantee that the `@deepseek-ai/dsh` application package itself is linked into `$DSH_HOME/profiles/node_modules`. Creating such a link in the smoke would therefore prove a synthetic layout rather than the supported default path.

**Correction:** the authoritative no-hint smoke installs the exact Toolchain `.tgz` and the tested `@deepseek-ai/dsh` train into one disposable Node package graph, invokes that installed Toolchain CLI without `--dsh-package-root`, and requires Node package resolution to discover the co-installed DSH package. A second resolution uses an explicit root and a copied home; both must yield the same semantic fingerprint. Acquisition also accepts deterministic profile/home package-resolution anchors when a real installation exposes them, but it never creates/heals fallback links and never searches PATH/subprocesses to guess an unrelated DSH installation. Explicit `dshPackageRoot` remains highest priority for detached inspection.

Native DSH integration is different: M1.1 runs inside the DSH Host and can receive installation context from that Host rather than pretending a detached CLI has the same knowledge.

### 3. Same-version local source/type changes — defer the broad form to M2

Hashing the entire package/source tree in M1 would make TargetSnapshot expensive and couple target identity to files irrelevant to DSH composition. However bundle patch bytes are directly composition-semantic and are therefore fixed in v2 now.

**Correction in roadmap:** M2 contract intelligence defines a separate target-bound contract evidence/index identity over the actual catalog/type/source/runtime evidence it consumes. Contract caches may not be validated from package version alone.

### 4. Runtime coordinates are semantically ambiguous — clarify now, split later only if evidence requires it

M1 records the Node/platform/arch of the runtime performing target resolution. Those coordinates are compatibility-relevant for the environment in which Toolchain evaluates the target, but they are not proof that some separately launched DSH process used the same runtime.

**Correction:** Protocol/ADR define `runtime` as the resolution/compatibility runtime bound to this snapshot. Later live observations and M4 verification receipts record their executed runtime and reject/mark stale a claim when it does not match runtime-sensitive target semantics. No speculative multi-runtime DTO is introduced in M1.

### 5. DSH Service/MCP parity — next M1.1, not a merge blocker

The CLI proves the first external target-resolution vertical slice; native DSH and MCP currently share kernel composition but do not expose `target.resolve` as a callable Toolchain operation.

**Correction in roadmap:** immediately after M1 merge, implement one kernel-backed `target.resolve` projection through `ctx.toolchain`, a small native DSH agent tool, and MCP. Native DSH passes its known installation context into the shared acquisition request/composition; no frontend duplicates fingerprint logic.

### 6. Governance state — correct the workflow, not history

M1 implementation issues were closed before the milestone PR entered `main`. Rewriting that history adds little value.

**Correction:** this corrective plan is the merge gate for PR #16; future milestone issues remain open until their implementing PR is merged or explicitly closed as not planned. Final PR verification and merge SHA become the authoritative completion evidence.

---

## Execution tasks

### Task 1 — RED: encode v2 composition identity and protocol expectations

- [x] Add model tests proving bundle patch, home patch and ordered overlay changes alter the fingerprint while overlay paths do not.
- [x] Add acquisition tests for bundle patch evidence, distinct missing profile/home sentinels, ordered overlay hashes, and missing overlay failure.
- [x] Add protocol tests requiring `patches` to be an ordered string array and `dsh-target-v2` fingerprints.
- [x] Update fixtures only where a bundle patch file is required to represent the existing fixture manifest truth.
- [x] Observe authoritative RED before production implementation: CI #182 / run `33007153445` failed because v2 types/fields/codes did not yet exist.

### Task 2 — GREEN: implement v2 acquisition/model/protocol

- [x] Add schema-owned `ResolvedBundleIdentity`.
- [x] Replace v1 projection with `TargetSemanticProjectionV2` and `dsh-target-v2:<sha256>`.
- [x] Read/hash each bundle's declared patch bytes.
- [x] Read/hash optional profile and home patch layers with distinct absent sentinels.
- [x] Read/hash ordered request overlays; locations stay evidence only.
- [x] Preserve observer exclusion and dependency normalization.
- [x] Regenerate/synchronize Protocol types and canonical examples; generator freshness remains a CI gate.
- [x] Update kernel snapshot construction and CLI parsing for repeatable `--patch <path>`.

### Task 3 — prove no-hint packaged DSH discovery

- [x] Replace the synthetic profile-fallback idea with an exact packed co-install consumer smoke.
- [x] Invoke the installed Toolchain CLI without `--dsh-package-root` and require the exact installed DSH version.
- [x] Keep before/after profile-tree equality checks.
- [x] Compare no-hint and explicit-root discovery over equivalent homes and require one fingerprint.
- [ ] Obtain authoritative GREEN on the final head.

### Task 4 — synchronize normative docs and roadmap

- [x] Add ADR-0007 superseding ADR-0006 for v2 composition identity.
- [x] Update Protocol and roadmap with v2, runtime semantics, M2 evidence identity and immediate M1.1 DSH/MCP parity.
- [ ] Update architecture, README and M1 design/implementation evidence.

### Task 5 — final verification and merge

- [ ] Require final `pnpm check`, build, exact pack/consumer smoke, real DSH composition/boot, multi-train target smoke, Node 22.19/24.19/26 and Windows/macOS boundary lanes to pass on the final head.
- [ ] Review final diff and PR conversations for unresolved blockers.
- [ ] Update PR #16 description with final-head evidence and residual intentional limits.
- [ ] Squash merge PR #16 only after authoritative CI is green.
