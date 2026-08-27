# M2.2 Corrective Review — Target Binding, Evidence Semantics, and Live Proof

**Issue:** #31  
**PR:** #32  
**Reviewed head:** `ff0c73ae18976dc9e7e2cc34ce737094b3fb50b5`  
**Upstream baseline:** `deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` / `dsh@0.1.1-rc.2`

> **Execution rule:** corrective work is TDD. A production change is accepted only after a focused test demonstrates the old behavior failing for the intended reason. PR #32 remains Draft until the exact packed artifact proves the Agent-backed live path on the final head.

## Review verdict

The M2.2 boundary architecture remains sound: current-call `{ agent, signal }`, a runtime-neutral `ContractEnrichmentPort`, deterministic Toolchain-owned merge/fingerprints, no dummy Agent, and bounded live JSON are retained.

The reviewed head is nevertheless not merge-ready. Three correctness findings are accepted as P1:

1. live Inspect is not yet bound to the requested `TargetSnapshot`;
2. Host `Service` / `Event` Inspect rows are generated API-catalog facts, not proof that those capabilities are mounted in the current composition;
3. Client Slots do not yet have a deterministic page/lifetime identity and can leave a mirrored Client query pending until caller cancellation.

A fourth merge-gate gap is verification: the current packed DSH probe invokes Contract Intelligence without an Agent, so it proves offline fallback but not M2.2 live behavior.

## Upstream facts that constrain the correction

At the pinned Harness revision:

- Host Inspect is explicitly described as operating over **generated Catalogs, evaluator declarations, and live Tool scope**.
- `Service.listService` delegates to generated `queryServiceApi(...)`.
- `Event.listEvents` delegates to generated `queryEventApi(...)`.
- `Tool.listTools` returns `ctx.tools.schemas(context.agent)` and therefore is a positive Agent-scoped liveness witness.
- the Host registry mirrors Client provider manifests; Client queries remain pending until a successful Client response or abort. The registry has no intrinsic deadline and the first valid Client response wins.
- the product launcher knows the selected profile and overlay list while booting, but the current public Cordis Context does not expose a ready-made complete `dsh-target-v2` runtime fingerprint.

Therefore the correction must not manufacture a binding from `profile === "web"`, an Agent id, a Client response race, or a flattened environment value.

## Corrected merge-scope semantics

```text
requested TargetSnapshot
        │
        ├── proven to describe this running Host? ── no/unknown ──> offline only
        │
        └── yes
             │
             ▼
      official Host Inspect
        ├─ Service catalog ──> API contract facts, availability unknown
        ├─ Event catalog   ──> API contract facts, availability unknown
        └─ Tool schemas    ──> Agent-visible live facts, availability available
             │
             ▼
      deterministic merge
             │
             ▼
      dsh-contract-index-v1
```

Client Slots are removed from the PR #32 indexed merge gate. They return in a dedicated follow-up only after page identity/selection, stale-manifest handling, and bounded quiescent cancellation are specified and tested.

## Task 1 — Correct Host evidence semantics and remove Client Slots from M2.2

**Tests first**
- `tests/dsh/live-inspect.spec.ts`
- replace `tests/dsh/live-inspect-client-slots.spec.ts` with an explicit Client exclusion regression or remove it once equivalent policy coverage exists.

**Production**
- `src/integrations/dsh/live-inspect.ts`

Acceptance:
- Service/Event compact rows preserve useful method/event facts but normalize `availability: unknown`;
- Tool rows remain `availability: available` because `ctx.tools.schemas(agent)` is the authoritative scope query;
- Service/Event evidence provenance identifies generated-catalog semantics even though acquisition travels through Inspect;
- `client/Slots/listSubTree` is not queried or indexed in PR #32;
- missing Client providers remain irrelevant to the Host-first live index.

## Task 2 — Canonical ordering and Inspect failure boundary

**Tests first**
- code-point ordering differs from locale collation for deliberately chosen identifiers and still produces canonical contract/evidence identity;
- an ordinary Inspect provider race/failure becomes a `ContractAcquisitionError` / Protocol diagnostic instead of escaping as a raw tool exception;
- an Abort/cancellation failure is not relabelled as malformed live evidence.

**Production**
- use the same code-point comparator as the semantic model instead of `localeCompare()` for content-addressed ordering;
- adapt expected provider query failures to a Toolchain-owned live-evidence error family, preserving actual cancellation.

JSON Schema canonicalization in this slice promises recursive object-key canonicalization only. Array order remains part of the observed representation unless a later frozen-evaluation decision proves a keyword-specific set normalization safe.

## Task 3 — Bind live evidence to the running DSH target, fail closed

**Tests first**
- running Host binding = target A, requested snapshot = target B -> no live provider query and no live evidence in the resulting index;
- profile mismatch, foreign DSH home/installation identity, or patch-stack mismatch must not be accepted by a weak profile-name comparison;
- exact match -> live Host enrichment is allowed.

**Production design constraint**
- keep binding in the DSH integration boundary; kernel/model continue to see only `TargetSnapshot` + normalized evidence;
- introduce the narrowest Toolchain-owned runtime-target binding seam required to answer whether one resolved snapshot is the exact running composition;
- if the current Harness baseline cannot authoritatively establish all identity dimensions, return **not bound** and preserve the offline index rather than mixing evidence from another runtime;
- no `process.env`-only, Agent-id, profile-name-only, or guessed Web/headless equivalence is accepted as authoritative.

This task is allowed to remain fail-closed until a concrete upstream/launcher seam is proven. It is not acceptable to enable live merge for arbitrary `TargetResolveRequest` merely because execution is inside DSH.

## Task 4 — Strengthen offline + live model/kernel invariants

Confirm or add regressions for:

- offline facts survive live enrichment;
- `unknown + available -> available` for a true liveness witness;
- `unknown + unknown -> unknown` for catalog-only evidence;
- conflicting positive/negative observations fail closed;
- equal normalized live semantics produce a stable index fingerprint;
- changed Agent-visible Tool semantics change only `dsh-contract-index-v1`, not `dsh-target-v2`.

No DSH runtime type enters model/kernel.

## Task 5 — Exact packed Agent-backed live smoke

**File:** `scripts/smoke-dsh-package.mjs`

The primary CI lane must install the exact `.tgz`, boot real DSH `0.1.1-rc.2`, and invoke native Contract Intelligence through a real Agent-scoped Tool execution.

Positive proof:

1. resolve the exact running target;
2. execute `toolchain_contract_search` with a real Agent + AbortSignal;
3. observe at least one `host/Tool/listTools` evidence item and Tool contract unavailable on the offline-only path;
4. prove live index fingerprint differs from the offline index when those live semantics are added;
5. inspect the returned contract with the search fingerprint and prove exact target/index continuity.

Negative proof:

- when Inspect is absent or runtime-target binding is not authoritative, native Contract Intelligence remains a valid offline operation and does not fabricate availability.

The expensive live proof stays in the primary lane only; Node compatibility and platform boundary lanes remain lightweight.

## Task 6 — Governance reconciliation

Before Ready for Review:

- update Issue #31 so compact Service/Event indexing is the stable indexed surface; exact detail no longer secretly mutates the index after search;
- move Client Slots to a follow-up issue with explicit page identity/selection + cancellation semantics;
- update the M2.2 implementation plan's availability rule: Service/Event catalog rows are `unknown`, Agent-scoped Tool rows may be `available`;
- record RED -> GREEN commit/run chronology in PR #32;
- keep parent M2 open for M2.3 frozen retrieval evaluation.

## Final gate

PR #32 may leave Draft only when all of the following are true on one exact final head:

- target/runtime mismatch cannot mix live evidence into another target;
- Service/Event no longer claim mounted availability;
- Client Slots are outside the indexed M2.2 merge scope;
- expected Inspect failures are protocolized and cancellation is preserved;
- semantic ordering uses code-point canonicalization;
- exact packed real DSH Agent-backed live search -> inspect is proven;
- full Node 22/24/26, Windows/macOS, package/install/composition CI is green;
- Issue #31 and the implementation plan match the implemented semantics.
