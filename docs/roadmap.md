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

**Goal:** make the design executable enough that implementation cannot silently redefine the product, while proving the canonical distribution really is a DSH bundle and repository/release policy is ready for real code.

Capabilities:
- Toolchain Protocol v1 baseline, schemas, and examples;
- architecture/security/verification specifications and ADRs;
- contribution policy shared by humans and AI plus PR/Issue templates;
- technical development/release/publication policy;
- one-package TypeScript workspace with explicit kernel/DSH Host/CLI/MCP build faces;
- installable DSH bundle skeleton and `ToolchainService` capability boundary;
- CLI/MCP entrypoint skeletons that route through the same application layer;
- exact Node/pnpm baseline and dependency-ownership policy;
- schema/type generation and generated-file freshness checks;
- closed-world architecture dependency fitness checks;
- contract/schema conformance CI;
- least-privilege GitHub Actions policy with reviewed SHA-pinned third-party actions where required;
- Dependabot configuration introduced together with real manifests/workflows, not before them.

Exit criteria:
- no unresolved normative placeholders;
- every example validates against Protocol v1 schemas;
- contribution/security/development policies do not contradict architecture/spec/ADR sources;
- the package can be installed by DSH as the canonical product shell without requiring a daemon;
- DSH Host, CLI, and MCP build faces depend on the kernel and not vice versa;
- DSH/Cordis identity-sensitive host packages are enforced as peer + dev dependencies rather than nested runtime copies;
- schema/generated-type freshness is CI-enforced;
- prohibited dependency directions fail CI;
- CI workflows declare explicit least-privilege permissions;
- the exact packed artifact is manifest-checked, installed by a throwaway consumer, and composed in minimal + shipped Web DSH profiles.

Non-goals: DSH contract search, candidate runtime verification, DSH Web UI, npm publication from the private incubator, public branch rulesets before their required checks exist.

## M1 — Target Intelligence

**Goal:** identify the exact installed DSH target reproducibly and give later operations one stable identity to bind to.

Capabilities:
- canonical `TargetResolveRequest` / `TargetResolveResult` rather than speculative future request models;
- installed DSH/profile/package discovery with no active-profile mutation;
- normalized `TargetSnapshot` and explicit evidence;
- `TargetSemanticProjectionV1` + `dsh-target-v1:<sha256>` fingerprint from ADR-0006;
- first real acquisition port in the internal application kernel;
- initial CLI `target resolve` projection, followed by DSH/MCP parity once the vertical slice is proven;
- fixture coverage across path-independent copies, bundle/profile changes, runtime changes, and more than one DSH layout/train;
- early packaged DSH real-boot/`ctx.toolchain` visibility smoke as a runtime integration hardening gate.

Exit criteria:
- compatibility-relevant fixture changes alter the fingerprint;
- irrelevant absolute paths/timestamps do not;
- bundle order and profile patch changes are fingerprint-sensitive;
- discovery resolves exact package versions rather than declared ranges;
- read-only discovery performs no active-profile mutation;
- one real current DSH target and one older supported fixture/layout resolve through the same normalized model;
- the first target-resolution contract is closed/typed without pre-designing M2–M4 payloads;
- real packaged Toolchain boot proves the service is visible through a live DSH seam.

## M2 — Contract Intelligence

**Goal:** let an agent discover exact DSH capabilities without loading the complete catalog or guessing from model memory.

Capabilities:
- official DSH `cordis_inspect_*`/runtime evidence provider where the target exposes it;
- generated Tool/Cordis catalog, types/config/package/source providers as fallback/companion evidence;
- normalized contract model that separates declared capability from live availability;
- deterministic contract index;
- `contract.search` and `contract.inspect`;
- provenance for every returned contract fact;
- AI evaluation against frozen real DSH development tasks.

Exit criteria:
- Toolchain does not reimplement DSH reflection when official inspect evidence is available;
- retrieved contracts are source/evidence backed;
- opt-in/live Inspect absence does not make offline target intelligence unusable;
- stale target handling is correct;
- evaluation shows materially fewer invalid API guesses than static-doc/model-memory baseline.

### First usable alpha gate — Exact Target Plugin Check

After M2, ship the smallest source/artifact check path that proves the product loop before expanding architecture further:

```text
plugin subject + exact TargetSnapshot
        ↓
used contracts / availability / evidence-backed incompatibilities
```

This gate may expose a narrow `check` surface before the full M3 rule catalog is complete. It MUST reuse M1/M2 semantics rather than introducing a parallel Doctor-style implementation.

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
- allowlisted environment, timeouts, process-tree cleanup and bounded output;
- cleanup/crash/cancel handling.

Exit criteria:
- active profile is untouched under the default isolation policy;
- source-valid/package-broken and boot/visibility-broken fixtures are detected;
- stale target cannot yield `verified`;
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
