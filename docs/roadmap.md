# DSH Toolchain Roadmap

The roadmap is capability-gated, not date-gated. GitHub Issues track implementation units; this document tracks product capabilities and exit criteria.

## M0 — Architecture and Contract Foundation

**Goal:** make the design executable enough that implementation cannot silently redefine the product.

Capabilities:
- Toolchain Protocol v1 baseline, schemas, and examples;
- architecture/security/verification specifications and ADRs;
- TypeScript workspace and schema/type generation;
- architecture dependency fitness checks;
- contract/schema conformance CI.

Exit criteria:
- no unresolved normative placeholders;
- every example validates against Protocol v1 schemas;
- schema/generated-type freshness is CI-enforced;
- prohibited dependency directions fail CI.

Non-goals: DSH contract search, runtime verification, GUI.

## M1 — Target Intelligence

**Goal:** identify the exact installed DSH target reproducibly.

Capabilities:
- installed DSH/profile/package discovery;
- normalized `TargetSnapshot`;
- semantic fingerprint and freshness check;
- target resolution through application kernel, DSH Host, CLI, and MCP;
- fixture coverage for supported platforms/DSH layouts.

Exit criteria:
- compatibility-relevant changes alter the fingerprint;
- irrelevant machine-specific values do not;
- read-only discovery performs no active-profile mutation;
- frontend parity tests produce semantically equivalent results.

## M2 — Contract Intelligence

**Goal:** let an agent discover exact DSH capabilities without loading the complete catalog.

Capabilities:
- evidence providers for generated catalog/types/config and live runtime where available;
- deterministic contract index;
- `contract.search` and `contract.inspect`;
- provenance and capability-vs-availability representation;
- AI evaluation against frozen DSH development tasks.

Exit criteria:
- retrieved contracts are source/evidence backed;
- stale target handling is correct;
- evaluation shows materially fewer invalid API guesses than static-doc baseline.

## M3 — Plugin Analysis and Validation

**Goal:** explain structural/dependency/contract defects before candidate execution.

Capabilities:
- plugin normalization;
- stable diagnostic taxonomy;
- structural, manifest, dependency, and contract validation passes;
- partial results for independently valid components;
- broken-plugin fixture corpus.

Exit criteria:
- known fixture defects map to stable diagnostic codes;
- expected plugin defects do not crash analysis;
- no candidate code execution is required for static validation levels.

## M4 — Isolated Verification Alpha

**Goal:** prove whether the artifact users install composes and works in a real DSH target.

Capabilities:
- artifact fingerprint and package preview/pack;
- temporary DSH home;
- install, dump-config/composition, boot, runtime probe;
- capability visibility assertions;
- transport-neutral `Operation`;
- `VerificationReport` and evidence receipt;
- cleanup/crash handling.

Exit criteria:
- active profile is untouched under `safe`;
- source-valid/package-broken and boot/visibility-broken fixtures are detected;
- stale target cannot yield `verified`;
- worker crash leaves active DSH healthy and yields diagnostics.

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
- portable Agent Plugins output where semantics are portable;
- immediate validation/verification of generated artifact.

Exit criteria:
- generated boilerplate requires no model-authored DSH ceremony;
- compiler output passes Toolchain validation by construction and real verification in fixtures.

## M7 — Migration and Compatibility

**Goal:** turn DSH contract change into actionable plugin impact before users encounter breakage.

Capabilities:
- snapshot/contract diff;
- plugin impact analysis;
- deterministic codemods for mechanical changes;
- target-version verification;
- compatibility CI matrix.

Exit criteria:
- mechanical migrations are repeatable/idempotent;
- semantic changes are surfaced to the coding agent rather than guessed;
- compatibility claims are backed by target-specific receipts.

## M8 — Integration Compiler

**Goal:** compile external capabilities into a compact, agent-oriented DSH integration.

Initial inputs: OpenAPI, CLI descriptions/completions/help, MCP catalogs. Output favors a small hot-path tool surface plus progressive long-tail discovery rather than one-endpoint-one-tool generation.

This milestone starts only after Toolchain's validation/verification and PluginSpec pipelines are stable.
