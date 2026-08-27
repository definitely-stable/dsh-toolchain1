# M2.2 Agent-scoped Host Inspect — Implementation / Verification Record

> **Execution rule:** TDD for behavioral changes. Do not add a dummy Agent, global/current-Agent state, an Agent-keyed cache, Client-page race semantics, or a parallel live Contract Index.

**Issue:** #31  
**Parent:** #28  
**Base:** M2.1 squash merge `0c647dceb0af00b36ca28a91cb520bd697a33efb`  
**Published live-test baseline:** `dsh@0.1.1-rc.2`.  
**Older target-only compatibility train:** `dsh@0.1.0-rc.8`.  
**Upstream source watch:** `deepseek-ai/deepseek-harness@cd5ef814...` declares source `0.1.2-alpha.1` + `profile.patchReload`; npm does not currently publish that version. See #33.

## Goal

Enrich the existing M2.1 target-bound Contract Index with official bounded Host Inspect evidence only inside a real native DSH ToolExecution carrying a real Agent and AbortSignal. CLI, MCP and ordinary `ctx.toolchain` Service calls remain valid offline paths. Kernel/model own merge, fingerprint and Contract semantics; DSH runtime types stop at the integration boundary.

M2.2 is not M2 completion. M2.3 remains the separate frozen retrieval evaluation required before parent #28 can close.

## Final slice semantics

```text
explicit requested TargetSnapshot
        │
        ▼
runtime/profile/install eligibility
        +
frozen startup M1 target fingerprint
        │
        ├─ mismatch/absent/overlay/drift ──► offline M2.1 only
        │
        └─ match
             │
real ToolExecution { Agent, AbortSignal }
             │
             ▼
official Host cordisInspect
   ┌─────────┼─────────┐
Service     Event      Tool
catalog     catalog    Agent-scoped runtime
unknown     unknown    available
   └─────────┼─────────┘
             ▼
Toolchain-owned bounded evidence/contracts
             ▼
deterministic merge into dsh-contract-index-v1
```

### Indexed providers

- `host/Service/listService({})`: generated Harness API catalog, authoritative facts, `availability = unknown`.
- `host/Event/listEvents({})`: generated Harness API catalog, authoritative facts, `availability = unknown`.
- `host/Tool/listTools({})`: current Agent-visible Tool schemas, observed runtime evidence, `availability = available`.
- Builtin is not normalized without a concrete ContractKind/use case.
- Client providers are out of M2.2. Current mirrored-manifest / first-success Client routing lacks deterministic page identity/lifetime for a content-addressed index.

Exact Service/Event detail is not silently fetched during `contract.inspect`: search and inspect must rebuild the same indexed semantic surface or a valid search fingerprint would make itself stale.

## Runtime target guard

Path equality is only an eligibility check. Toolchain captures one M1 `dsh-target-v2` fingerprint when `ToolchainService` mounts and never refreshes it. Native live enrichment is allowed only if the later requested snapshot has the same fingerprint and profile/home/runtime/install eligibility still matches.

This rule rejects:
- another profile/home/install/runtime;
- explicit launcher/request overlays whose boot-time hashes are not attested;
- missing startup baseline;
- same-path profile/DSH/bundle manifest drift;
- same-path bundle/profile/home patch drift after Toolchain mount.

The guard is intentionally conservative: mismatch means no Inspect query and a valid offline index. It is not a launcher-owned boot attestation. Current published DSH exposes no immutable running composition generation, leaving a narrow compose→Toolchain-mount TOCTOU window. A future launcher composition/generation seam is the correct way to remove that limitation rather than adding more mutable post-fact filesystem guesses.

## Safety / determinism

Live acquisition fails explicitly when limits are exceeded. Current policy bounds:
- provider directory entries;
- advertised methods on a supported provider;
- provider-result serialized bytes;
- JSON depth and nodes;
- normalized contracts;
- facts per contract and total facts;
- Tool parameter schema bytes per Tool and total.

Unsupported providers are filtered by platform/id before Toolchain accesses their method manifests. Supported providers are queried in canonical `Service → Event → Tool` order. Semantic sorting is code-point based. Tool JSON object keys are recursively canonicalized; array order remains part of observed representation unless a future keyword-specific rule proves it set-like.

Provider text/schema descriptions are untrusted contract data, never Toolchain instructions. Expected provider races/failures become Toolchain acquisition diagnostics; actual abort remains cancellation. Provider promises are awaited rather than detached.

## Completed tasks

### 1 — Native execution boundary
- [x] RED proved whole ToolExecution capability leakage.
- [x] Runtime projection constructs/freeze a new `{ agent, signal }` object only.
- [x] Actual Agent and AbortSignal object identities are preserved.

### 2 — Structural Inspect adapter + live budgets
- [x] Structural Host-owned `list/query` adapter; no DSH Agent/runtime DTO imported into model/kernel.
- [x] Deterministic supported provider plan.
- [x] Raw and normalized live budgets, including supported-provider method count.
- [x] Cancellation forwarding and provider error normalization.

### 3 — Host normalization
- [x] Service compact catalog → service facts / unknown availability.
- [x] Event compact catalog → event facts / unknown availability.
- [x] Agent-scoped Tool schemas → available Tool contracts.
- [x] Evidence provenance/content hashes and deterministic canonicalization.
- [x] Client Slots explicitly removed from this slice after corrective review.

### 4 — Runtime-neutral merge / identity
- [x] `ContractEnrichmentPort` remains Toolchain-owned and runtime-neutral.
- [x] Offline facts survive merge.
- [x] `unknown + available → available`; unsupported negative claims are not manufactured.
- [x] Incompatible identity/availability/evidence collisions fail closed.
- [x] Equal semantics/order permutations retain fingerprint; consumed live semantic drift changes it.

### 5 — Per-call orchestration
- [x] Live only for native DSH ToolExecution with Agent + AbortSignal + Inspect + matching runtime-target guard.
- [x] CLI, MCP, ordinary Service remain offline.
- [x] Concurrent different Agents remain isolated without ambient state.
- [x] Agent identity itself does not enter fingerprint.
- [x] Abort settles through awaited provider work.

### 6 — Runtime/target corrective gate
- [x] Profile/home/runtime/install/launcher eligibility tests.
- [x] RED reproduced `same path + changed bytes` across profile manifest, DSH manifest, bundle manifest, bundle patch, profile patch and home patch.
- [x] Frozen startup M1 fingerprint rejects all post-mount drift before Inspect.
- [x] Missing baseline fails closed.
- [x] Explicit overlays fail closed because current published DSH exposes no immutable boot-time overlay identity.
- [x] Limitation documented: startup capture is not launcher-owned boot/generation attestation.

### 7 — Exact packed-artifact verification
- [x] Exact branch `.tgz` installed into real DSH minimal/Web profiles.
- [x] External probe creates a real Agent and verifies registration.
- [x] Native Host Tool search consumes real Agent-scoped runtime evidence.
- [x] Offline index lacks that runtime Tool; native live index differs.
- [x] Native inspect with search fingerprint preserves target/index continuity and runtime evidence.
- [x] Missing-Inspect real Agent probe preserves offline index.
- [x] Published rc.2 live smoke and rc.2/rc.8 read-only target train smoke remain primary-lane artifact gates.

### 8 — Governance / M2.3 handoff
- [x] README describes actual M2.2 Host-only semantics and conservative target guard.
- [x] Roadmap separates M2.2 implementation from M2.3 frozen evaluation.
- [x] This plan reconciled with actual implementation/corrective decisions.
- [ ] Issue #31 body/acceptance chronology reconciled.
- [ ] PR #32 body/review chronology reconciled.
- [ ] Exact final governance HEAD full CI green.
- [ ] PR #32 merged/Issue #31 closed only after final review gate.

## Accepted RED / GREEN chronology

- CI #354 — rejected RED: test harness did not compile; production unchanged.
- CI #356 — accepted execution-capability leak RED → `41498935...` narrow projection GREEN.
- CI #358 — accepted live Service vertical RED → `19e0c21...` initial Service enrichment.
- CI #359 — frontend calling-convention regression → `3a1d1f4...`; CI #360 full GREEN.
- CI #362 — accepted live resource-budget RED → `603b31c4...`; CI #363 full GREEN.
- CI #364 — accepted Event/Agent-Tool RED → `b684571d...`; CI #365 full GREEN.
- `aac16506...` — identity/order/concurrency/cancellation invariants passed without additional runtime state.
- Initial Client Slot exploration was later removed from indexed M2.2 after corrective review identified deterministic page/lifetime ambiguity.
- CI #372 — accepted corrective RED for Service/Event availability, Client querying, semantic order and raw Inspect failure → `727f37ef...` + assertion correction; CI #374 full GREEN.
- CI #375 — accepted unproven runtime-target binding RED → fail-closed target binding work.
- CI #387 — exact-head real Agent packed live smoke GREEN on the first complete corrective Host path.
- CI #388 — accepted same-path semantic-drift RED: 263 previous tests passed, exactly six new drift tests failed.
- `260f1725...` + `4c8ce399...` + `c609acb...` — startup semantic baseline guard; CI #391 full GREEN including real Agent `.tgz` smoke.
- CI #393 — registry evidence proved source-declared `0.1.2-alpha.1` is not an npm-published train; Issue #33 owns its `patchReload` target-identity follow-up.
- CI #396 — accepted provider-directory hardening RED: 270 previous tests passed, exactly two new tests failed.
- `a290f389...` — supported-provider method bound + irrelevant-provider short-circuit; CI #397 full GREEN.

## Final merge gate

- [x] Protocol/generated schema contract unchanged.
- [x] Architecture/package/CI-storage gates green on code-final HEAD.
- [x] Node 22.19/24.19/26 tests/lint/typechecks green on code-final HEAD.
- [x] Windows 2025/macOS 15 boundary smoke green on code-final HEAD.
- [x] Exact packed-artifact real DSH Agent live smoke green on code-final HEAD.
- [x] Published multi-train read-only target smoke green on code-final HEAD.
- [ ] Governance-final HEAD full CI green.
- [ ] PR review/comments/threads checked on governance-final HEAD.
- [ ] Issue #31 chronology and acceptance status current before merge.
- [ ] Parent #28 remains open for M2.3.
