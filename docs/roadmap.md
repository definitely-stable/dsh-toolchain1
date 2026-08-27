# DSH Toolchain Roadmap

The roadmap is capability-gated, not date-gated. GitHub Issues track implementation units; this document tracks product capabilities and exit criteria.

## Product axis

Toolchain's differentiated center is **exact-target development and compatibility intelligence**:

```text
exact DSH target + evidence + plugin source/artifact
        ↓
normalized machine model
        ↓
contract intelligence / diagnostics / verification receipts / compatibility diff
```

Specialized ecosystem tools such as Doctor, Testkit, Radar, Forge, managers, and bridges are not duplicated by default. Each milestone must state what Toolchain consumes, what it normalizes, and what semantics it uniquely owns.

The first intended user-facing product is **Exact Target Plugin Check**: one command/call that explains a plugin against the exact installed DSH target and later proves the packed artifact against that same target identity.

## M0 — Architecture, Governance and Contract Foundation

**Status:** implemented and merged.

**Goal:** make the design executable enough that implementation cannot silently redefine the product, while proving the canonical distribution really is a DSH bundle and repository/release policy is ready for real code.

Capabilities and exit criteria are implemented by the merged foundation slices: Protocol/schema generation and conformance, closed-world architecture fitness, package/manifest truth, exact `.tgz` consumer/composition proofs, least-privilege CI, and DSH/Cordis host-owned runtime identity policy.

## M1 — Target Intelligence

**Status:** implemented and merged.

**Goal:** identify the exact installed DSH target reproducibly and give later operations one stable identity to bind to.

`TargetSemanticProjectionV2` / `dsh-target-v2:<sha256>` binds exact DSH/runtime coordinates, ordered bundle identities + patch hashes, profile dependencies, profile/home patch hashes and invocation overlays while excluding machine paths/timestamps. Target acquisition is read-only and proves no-hint package-graph discovery plus published current/older DSH train compatibility.

### M1.1 — Target frontend parity

**Status:** implemented and merged via PR #24 / Issue #25.

CLI, installed `ctx.toolchain`, native `toolchain_target_resolve`, and MCP `target.resolve` share the same application semantics and Protocol DTOs. Exact packed-artifact CI proves native ToolRuntime execution without bundling a second identity-sensitive DSH tools runtime.

## M2 — Contract Intelligence

**Goal:** let an agent discover exact DSH capabilities progressively against the exact M1 target, with evidence and a content-addressed Contract Index rather than model-memory guesses.

Parent Issue #28 remains open until all three M2 slices meet their exit criteria.

### M2.1 — Offline target-bound Contract Index

**Status:** implemented and merged via PR #30 / Issue #29.

Capabilities:
- read-only installed package-manifest and public TypeScript declaration acquisition from the exact M1 target without executing package JavaScript;
- normalized contracts separating declared capability from live availability; offline availability is `unknown`;
- deterministic `dsh-contract-index-v1:<sha256>` from ADR-0008, separately bound to target fingerprint, consumed evidence/content hashes and normalized semantics;
- same-version evidence drift changes Contract Index identity without pretending `dsh-target-v2` changed;
- progressive deterministic `contract.search` and stale-safe `contract.inspect` with evidence/provenance;
- shared CLI / DSH Service/native / MCP application semantics;
- exact `.tgz` real-DSH ToolRuntime search→inspect proof.

### M2.2 — Agent-scoped Host Inspect enrichment

**Status:** implementation and corrective verification complete on PR #32; GitHub tracks review/merge state.

Capabilities:
- real native DSH ToolExecution is projected to a new immutable `{ agent, signal }` boundary; no complete ToolExecution, dummy/global Agent, or DSH runtime DTO enters model/kernel;
- official Host `cordisInspect` evidence joins the existing M2.1 index only in Agent-scoped native contract calls; CLI, MCP and ordinary Toolchain Service remain offline;
- `Service.listService({})` and `Event.listEvents({})` contribute bounded authoritative generated-catalog facts with `availability = unknown`;
- `Tool.listTools({})` contributes bounded Agent-scoped observed runtime Tool schemas with positive `availability = available`;
- Client providers are out of this slice until deterministic page identity/lifetime semantics exist;
- exact Service/Event detail is not fetched during inspect when that would change the index identity after search;
- live provider/result/JSON/contract/fact/schema/method budgets fail loudly rather than silently truncate;
- provider and semantic ordering use deterministic code-point/canonical JSON rules;
- Inspect provider failures are mapped to Toolchain acquisition diagnostics while genuine cancellation remains cancellation;
- per-call isolation, AbortSignal forwarding/quiescence, and Agent-identity-independent fingerprints are regression-tested;
- offline+live merge preserves offline facts, upgrades only proven availability, fails closed on incompatible identity/evidence collisions, and changes index identity on consumed live semantic drift.

Runtime-target guard:
- path/runtime/profile/home/install checks are eligibility only, not sufficient evidence by themselves;
- `ToolchainService` captures one immutable M1 startup target fingerprint when it mounts in the running Host;
- live evidence is permitted only when every later requested TargetSnapshot has the same fingerprint and the eligibility checks still match;
- explicit un-attested overlays, missing baseline, foreign target, or same-path post-mount semantic drift fall back to offline **before** the first Inspect query;
- this is a conservative drift guard, not a launcher-owned boot attestation. Current published DSH exposes no immutable running composition generation, so a narrow compose→Toolchain-mount TOCTOU window remains. A future authoritative launcher generation seam can strengthen this without weakening the fail-closed rule.

Verification:
- exact packed `dsh@0.1.1-rc.2` Web smoke creates a real registered Agent and proves Host Tool live evidence, offline/live Contract Index divergence, and native search→inspect continuity;
- a real missing-Inspect probe proves offline fallback;
- published `0.1.0-rc.8` remains an older target-resolution compatibility train;
- upstream source `cd5ef814...` declares source version `0.1.2-alpha.1` and new `profile.patchReload`, but npm does not publish that version; Issue #33 owns the target-identity compatibility decision before support claims change.

M2.2 exit criteria:
- [x] narrow Agent/AbortSignal boundary and no dummy/global Agent;
- [x] Host Service/Event/Tool normalization with correct provenance/availability semantics;
- [x] deterministic bounded offline+live merge and fingerprint sensitivity;
- [x] target mismatch/drift fails closed before Inspect;
- [x] cancellation and concurrent Agent isolation proven;
- [x] CLI/MCP/ordinary Service remain offline peers;
- [x] exact packed real-Agent positive and missing-Inspect negative smokes on published current train;
- [x] Node 22/24/26 plus Windows/macOS lanes green on corrective implementation HEADs;
- [ ] PR #32 merged after exact final governance HEAD verification.

### M2.3 — Frozen retrieval evaluation / milestone exit

**Status:** not yet implemented; required after M2.2 before parent M2 can close.

Goal:
- freeze a small corpus of real DSH development questions/tasks with expected contracts and known-invalid guesses;
- compare progressive Toolchain search→inspect against static-doc/model-memory baselines;
- record deterministic Recall@k/MRR/no-result correctness and product-level invalid-API-guess/first-correct-contract outcomes;
- add embeddings or more complex retrieval only if the frozen evaluation proves lexical progressive retrieval insufficient.

M2 exit criteria:
- M2.1 and M2.2 are merged and their exact artifact/native boundaries remain green;
- frozen M2.3 evaluation demonstrates materially fewer invalid DSH API guesses than the baseline;
- the evaluation evidence, not architectural optimism, decides whether further retrieval machinery is justified.

### First usable alpha gate — Exact Target Plugin Check

After M2, ship the smallest source/artifact check path that proves the product loop before expanding architecture further:

```text
plugin subject + exact TargetSnapshot + contract evidence/index
        ↓
used contracts / availability / evidence-backed incompatibilities
```

This gate may expose a narrow `check` surface before the full M3 rule catalog is complete. It MUST reuse M1/M1.1/M2 semantics rather than introducing a parallel Doctor-style implementation.

## M3 — Plugin Analysis and Validation

**Goal:** explain structural/dependency/contract defects before candidate execution.

Capabilities:
- plugin normalization for directory/packed subjects as real needs are proven;
- stable diagnostic taxonomy driven by frozen failure fixtures;
- structural, manifest, dependency, and contract validation passes;
- exact-target dependency/contract reasoning;
- partial results for independently valid components;
- broken-plugin corpus sourced from reproduced ecosystem failure classes.

Exit criteria:
- known fixture defects map to stable diagnostic codes and evidence;
- expected plugin defects do not crash analysis;
- no candidate code execution is required for static validation levels;
- Toolchain diagnostics explain why a failure matters on this target rather than merely repeating a package-manager error.

## M4 — Isolated Verification Alpha

**Goal:** prove whether the artifact users install composes and works in a real DSH target, producing portable evidence rather than a generic pass badge.

Capabilities:
- artifact fingerprint and package preview/pack;
- temporary DSH home;
- install, composition, actual boot and runtime probe;
- service/tool/client capability visibility assertions;
- explicitly declared deterministic behavior checks;
- transport-neutral `Operation` evolved from real worker needs;
- `VerificationReport` / receipt bound to artifact + TargetSnapshot;
- explicit executed-runtime evidence checked against runtime-sensitive target semantics;
- allowlisted environment, timeouts, process-tree cleanup and bounded output;
- cleanup/crash/cancel handling.

Exit criteria:
- active profile is untouched under the default isolation policy;
- source-valid/package-broken and boot/visibility-broken fixtures are detected;
- stale target or incompatible runtime cannot yield `verified`;
- worker crash leaves active DSH healthy and yields diagnostics;
- an unexecuted stage is never reported as passed;
- community lifecycle runners may be integrated as verifier backends only behind Toolchain-owned evidence semantics.

## CI adoption gate

After M4, expose the same exact-target/receipt semantics as a one-command CI/GitHub Actions path. Toolchain is the primitive; hosted compatibility monitoring remains outside core product scope.

## M5 — DSH Web

**Goal:** make Toolchain a first-class DSH developer experience without creating a second implementation.

Capabilities:
- native DSH client plugin;
- Typert Remote projection for unary Toolchain Service operations;
- Slot-based UI for target/contracts/diagnostics/verification;
- operation progress/status/cancel.

Exit criteria:
- Web has no exclusive business capability;
- Web parity is validated against kernel contracts;
- Host/Client build faces respect DSH boundary rules.

## M6 — PluginSpec Compiler

**Goal:** remove deterministic DSH boilerplate from agent work.

Capabilities:
- versioned PluginSpec;
- deterministic generation of manifest/composition/config/test plumbing;
- optional dynamic-Cordis preview when upstream semantics are a suitable fast proof backend;
- portable Agent Plugins output where semantics are portable;
- immediate validation/verification of generated artifact.

Exit criteria:
- generated boilerplate requires no model-authored DSH ceremony;
- compiler output passes Toolchain validation by construction and real verification in fixtures;
- the compiler does not become a prompt-centric scaffolder competing with Forge.

## M7 — Migration and Compatibility

**Goal:** turn DSH contract change into actionable plugin impact before users encounter breakage.

Capabilities:
- snapshot/contract diff;
- plugin impact analysis;
- deterministic codemods for mechanical changes;
- target-version verification;
- reusable compatibility receipt output for CI/Radar/marketplaces.

Exit criteria:
- mechanical migrations are repeatable/idempotent;
- semantic changes are surfaced to the coding agent rather than guessed;
- compatibility claims are backed by target-specific receipts;
- Toolchain provides compatibility primitives rather than becoming a hosted monitoring service.

## M8 — Integration Compiler

**Goal:** compile external capabilities into a compact, agent-oriented DSH integration.

Initial inputs: OpenAPI, CLI descriptions/completions/help, MCP catalogs. Output favors a small hot-path tool surface plus progressive long-tail discovery rather than one-endpoint-one-tool generation.

This milestone starts only after Toolchain's validation/verification and PluginSpec pipelines are stable.
