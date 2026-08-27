# M2.1 Contract Index — Implementation Plan

**Goal:** deliver the first usable Contract Intelligence vertical slice: exact-target offline contract evidence -> deterministic `dsh-contract-index-v1` -> progressive `contract.search` / `contract.inspect` -> CLI, DSH and MCP projections.

**Tracking:** parent Issue #28; implementation Issue #29; implementing PR is created after the first RED commit.

**Sources:** `spec/protocol.md`, `docs/architecture.md`, ADR-0001/0002/0003/0007, `docs/roadmap.md` M2, upstream DeepSeek Harness `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

## Product outcome

After this slice an agent can ask an exact installed DSH target questions such as “which installed package declares `ToolDefinition`?” or “show me the exact declaration evidence for this package contract” without loading the entire DSH graph into model context and without trusting model memory. Search returns small ranked references; inspect returns one selected normalized contract with provenance.

M2.1 deliberately does **not** claim live Service/Event/Tool availability. Offline package/type evidence proves declared package/type facts only, so availability is `unknown`. M2.2 will enrich the same index model with official Agent-scoped `cordisInspect` observations.

## Upstream constraints established before coding

- Current DSH already owns runtime reflection through `ctx.cordisInspect`, `cordis_inspect_list` and `cordis_inspect_query`; M2 must not rebuild that live mechanism.
- `cordisInspect.query()` requires a real DSH `Agent`; ordinary CLI/MCP/Toolchain Service calls do not have one. M2.1 therefore stays offline and target-bound rather than inventing a dummy Agent.
- The published `@deepseek-ai/dsh-tool-cordis` package does not promise private generated `api-catalog.ts` source in its package `files`; offline acquisition must consume public installed package/manifests/declarations, not private source paths.
- M1 target evidence already records exact manifest locations and hashes. M2.1 may use those locations as IO coordinates but must exclude machine paths from semantic index identity.

## Semantic shape

### Contract index identity

New namespace: `dsh-contract-index-v1:<sha256>`.

Canonical projection hashes:

1. namespace marker/version;
2. exact M1 `targetFingerprint`;
3. consumed evidence identities sorted by stable evidence id, projected as `{ id, kind, strength, source?, contentHash? }` with `location` excluded;
4. normalized contracts sorted by stable contract id, including kind/name/qualified name/availability/summary, sorted facts, and sorted evidence references.

The normalized contract semantics are part of the hash so a future normalizer change cannot silently reuse an index produced under different meaning. Machine paths, timestamps, acquisition traversal order and response request ids never contribute.

### M2.1 offline normalized contracts

M2.1 emits conservative `package` contracts only; it does not infer Service/Event/Tool semantics from declaration syntax.

One package contract represents each exact DSH package participating in the M1 target: the DSH app itself, ordered profile bundles, non-observer profile dependencies, plus the deterministic DSH-owned installed dependency/peer-dependency authority closure discovered from those explicit DSH roots. Explicit third-party roots remain indexable but their arbitrary transitive npm graphs are not crawled. It contains evidence-backed facts for:

- exact package version;
- public declaration entrypoints resolved from `types` / `typings` and supported concrete `exports.*.types` shapes;
- syntax-proven public declaration exports discovered from those entrypoints as **search facts**, without upgrading them to runtime Service/method claims.

Wildcard package-export templates such as `./api/* -> ./lib/types/api/*.d.ts` are not literal declaration files and are not expanded by M2.1. Relative declaration specifiers ending in `.ts/.mts/.cts` are resolved to their declaration counterparts (`.d.ts/.d.mts/.d.cts`) rather than reading source TypeScript.

The declaration graph follows only relative declaration references/re-exports that remain inside the package root. It never imports/executes package JavaScript. Traversal is deterministic and bounded. Missing optional declarations leave a valid manifest-backed package contract; unreadable/corrupt concrete declared evidence fails loudly.

### Contract DTOs

Protocol v1 gains:

- `contractKind`: existing baseline kinds (`service`, `method`, `event`, `tool`, `client-slot`, `config`, `package`);
- `contractAvailability`: `available | unavailable | unknown`;
- `contractFact`: `{ key, value, evidenceIds[] }`;
- `contractReference`: compact search row `{ id, kind, name, qualifiedName, availability, score, summary?, evidenceIds[] }`;
- `contractDefinition`: exact selected contract with facts and evidence ids;
- `contractSearchRequest`: `{ target: TargetResolveRequest, query, kinds?, limit? }`, limit 1..25, default 10 in the kernel;
- `contractSearchResult`: `{ contractIndexFingerprint, matches, evidence }`;
- `contractInspectRequest`: `{ target, contractIndexFingerprint, contractId }`;
- `contractInspectResult`: `{ contractIndexFingerprint, contract, evidence }`.

Search/inspect success responses include the M1 `snapshotFingerprint` plus the M2 index fingerprint in `data`. Expected target/contract acquisition failures are Protocol diagnostics. Inspecting against a no-longer-current index yields `status: stale`, `CONTRACT_INDEX_STALE`, and no contract data.

## Deterministic lexical retrieval

Ranking is pure, local and integer-valued. Case-folded tiers are intentionally simple and testable:

1. exact qualified name;
2. exact simple name;
3. simple/qualified-name prefix;
4. all query tokens present across name/qualified name;
5. substring in name/qualified name;
6. matching evidence-backed fact value/summary.

Within a tier, deterministic secondary score may reward more query tokens. Final ties are `qualifiedName`, then `id`, both code-point lexical order. Input contract/evidence order must not change results. No embeddings or hidden model ranking.

## Error / freshness model

- Target acquisition retains existing `TARGET_*` diagnostics.
- New expected contract acquisition failures use `CONTRACT_EVIDENCE_*` codes in diagnostic domain `contract`; deterministic resource-budget breaches use `CONTRACT_DECLARATION_LIMIT_EXCEEDED`.
- If a manifest captured by the just-resolved TargetSnapshot changes before contract acquisition consumes it, return stale rather than mixing target evidence epochs.
- `contract.inspect` always reacquires/rebuilds the current index. If its fingerprint differs from the caller-supplied fingerprint, return `CONTRACT_INDEX_STALE`; do not silently inspect another index.
- Missing `contractId` in a current index is `CONTRACT_NOT_FOUND` / failed, distinct from stale fingerprint.

## TDD execution

Every behavior task follows RED -> verify intended failure -> minimal GREEN -> focused check. Repository-wide CI runs after coherent commits; exact package/DSH smoke is extended only when frontend work reaches that boundary.

### Task 1 — close Protocol v1 + ADR-0008

**Files:** `docs/decisions/ADR-0008-contract-index-fingerprint-v1.md`, `spec/protocol.md`, `spec/schemas/v1/toolchain-protocol.schema.json`, `spec/examples/v1/contract-*.json`, `src/protocol/generated.ts` via generator, `tests/protocol/protocol.spec.ts`.

- [x] RED: protocol tests require closed search/inspect DTOs, canonical examples, stale response and generated TS names.
- [x] GREEN: add schema/spec/ADR/examples atomically and regenerate with `pnpm generate`.
- [x] Prove response objects are closed and invalid limits/kinds/empty query are rejected.
- [x] Prove stale inspect cannot carry successful contract data.

### Task 2 — pure Contract Index / fingerprint / ranker

**Files:** `src/model/contract.ts`, `tests/model/contract.spec.ts`.

- [x] RED: canonical fingerprint stability under evidence/contract order permutations and machine-location changes.
- [x] RED: target fingerprint, evidence content hash or normalized semantic change changes `dsh-contract-index-v1`.
- [x] RED: deterministic ranking tiers, kind filter, limit, stable tie-breaks and compact result shape.
- [x] RED: inspect returns exact evidence subset only.
- [x] GREEN: runtime-neutral model using existing `Sha256Port`; no Node/DSH/external imports.

### Task 3 — read-only installed package/declaration acquisition

**Files:** `src/acquisition/dsh-contract-filesystem.ts`, focused acquisition fixtures/tests.

- [x] RED: exact target manifest locations lower into package contracts with authoritative manifest evidence.
- [x] RED: public `types`/`typings` and supported concrete exports-type entrypoints are hashed and represented as `type-declaration` evidence.
- [x] RED: same-version declaration byte drift changes acquired evidence/index while M1 target semantic identity can remain unchanged.
- [x] RED: equivalent trees under different absolute roots produce equivalent semantic inputs.
- [x] RED: relative declaration traversal cannot escape the package root and never imports/executes target JS.
- [x] RED: manifest hash drift relative to TargetSnapshot is reported stale, not mixed.
- [x] GREEN: deterministic, bounded filesystem traversal; no package-manager/subprocess/network calls.
- [x] Corrective RED→GREEN covers DSH-owned dependency closure, effective re-export semantics, parser diagnostics, normalized fact/package budgets, declaration-extension rewriting, and wildcard export templates.

### Task 4 — kernel application use cases and Protocol responses

**Files:** `src/kernel/index.ts`, kernel tests.

- [x] RED: `searchContracts()` resolves one exact target, acquires evidence, builds index, ranks and returns target/index-bound result.
- [x] RED: `inspectContract()` rebuilds current index, rejects stale fingerprint, distinguishes not-found from stale.
- [x] RED: shared response helpers map expected `TARGET_*` / `CONTRACT_*` errors once; infrastructure errors propagate.
- [x] GREEN: optional internal `contractAcquisition` port keeps existing target-only kernel construction/tests valid while default product frontends provide the real adapter.

### Task 5 — CLI and MCP projections

**Files:** `src/frontends/cli/index.ts`, `src/frontends/mcp/index.ts`, CLI/MCP tests.

CLI machine commands:

```text
dsh-toolchain contract search --profile <name> --query <text> [--kind <kind> ...] [--limit <n>] [target acquisition hints]
dsh-toolchain contract inspect --profile <name> --contract-index <fingerprint> --contract-id <id> [target acquisition hints]
```

MCP tools:

```text
contract.search
contract.inspect
```

- [x] RED: parsing/schema registration/delegation/success/failure/stale tests.
- [x] GREEN: both project Protocol `$defs` and shared kernel response helpers; no frontend-owned DTO/ranker/acquisition logic.
- [x] Tools are read-only/idempotent.

### Task 6 — DSH Service + native ToolRuntime projections

**Files:** `src/integrations/dsh/index.ts`, new narrowly-scoped `contract-tool.ts`, DSH unit tests.

Native tools:

```text
toolchain_contract_search
toolchain_contract_inspect
```

- [x] RED: Service methods and native registration/delegation/runtime argument validation.
- [x] GREEN: Service uses the same Node kernel; raw ToolDefinition arguments are validated before delegation just like M1.1.
- [x] No `@deepseek-ai/dsh-tools` runtime dependency is added; Host remains identity owner.
- [x] No use of `ctx.cordisInspect.query()` in M2.1; live Agent-scoped enrichment belongs to M2.2.

### Task 7 — cross-frontend parity + exact package smoke

**Files:** `tests/frontends/contract-parity.spec.ts`, `scripts/smoke-dsh-package.mjs`, smoke-policy tests as needed.

- [x] RED: CLI/native DSH/MCP responses for equivalent deterministic evidence differ only in request id/transport envelope.
- [x] RED: exact packed artifact must expose both native contract tools through real `ctx.tools.schemas()` and execute a representative offline search/inspect path through real ToolRuntime.
- [x] GREEN: package smoke preserves existing target Service/native parity and adds M2.1 visibility/execution without weakening any M1 gate.
- [x] Authoritative shipped-`web` smoke proves `ToolDefinition -> package:@deepseek-ai/dsh-tools -> inspect` with exact declaration evidence from the packed artifact.

### Task 8 — docs, diff audit and merge gate

**Files:** README, roadmap/development docs, this plan, Issue/PR metadata.

- [x] Document M2.1 as implemented while M2 remains open for live Inspect + evaluation.
- [x] Explicitly state offline availability semantics and why private DSH source/catalog imports are forbidden.
- [x] Review final functional diff for generated-file ownership, path leakage, accidental persistence/cache, unrelated M3/M4/Web work and new dependencies.
- [x] Check PR comments/reviews/threads at the functional GREEN checkpoint; none are present.
- [x] Functional exact-head CI #334 on `d74638d6bc3640ab9edfc91f739fb022a6708242` passes generated/protocol/architecture/package/storage/lint/type/tests, build, exact pack/consumer, real minimal/Web DSH Contract Intelligence smoke, multi-train target smoke, Node 22/24/26, Windows and macOS.
- [ ] Require one final exact-head CI after governance-only reconciliation before marking PR Ready.
- [ ] Squash merge only with expected-head SHA guard; closing Issue #29 must not close parent #28.

## Non-goals

No live `cordisInspect` querying, dummy Agent, Service/Event/Tool runtime availability claims, embeddings, persistent index cache, daemon, Web UI, generic evidence-provider framework, plugin validation rules, candidate execution, or verification receipts in this slice.
