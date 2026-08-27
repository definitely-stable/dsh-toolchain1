# ADR-0008: Target-bound Contract Index fingerprint v1

- Status: Accepted
- Date: 2026-08-27

## Context

`dsh-target-v2` identifies the package/user-declared DSH composition required by M1. It deliberately does not hash every byte of generated catalogs, declaration files, source metadata, or live runtime observations. Contract Intelligence consumes those additional inputs, and same-version installed packages may contain locally changed declaration/catalog/source bytes without changing the M1 target fingerprint.

A contract cache keyed only by DSH/package version or `TargetFingerprint` could therefore return facts that were never derived from the current evidence.

Current DSH also exposes first-party read-only runtime reflection through `ctx.cordisInspect` and the model-facing `cordis_inspect_list` / `cordis_inspect_query` tools. Toolchain must preserve that evidence rather than invent a parallel live reflection protocol.

## Decision drivers

- prevent stale contract facts under same-version local drift;
- keep M1 target identity focused on target composition rather than every future evidence consumer;
- deterministic local search/inspection;
- explainable provenance;
- allow offline evidence now and official live Inspect enrichment later without changing the identity model.

## Considered options

1. Key contract state by DSH/package version.
2. Expand `dsh-target-v2` to hash every contract-related file and observation.
3. **Introduce a separate target-bound Contract Index fingerprint over the exact evidence and normalized contracts consumed.**

## Decision

Choose option 3.

M2 introduces `dsh-contract-index-v1:<sha256>`. The canonical projection contains:

1. the namespace/version marker;
2. the exact M1 `targetFingerprint`;
3. consumed evidence identities sorted by stable evidence id, projected as `{ id, kind, strength, source?, contentHash? }` with machine `location` excluded;
4. normalized contracts sorted by stable contract id, including kind, names, availability, summary, sorted facts, and sorted evidence references.

The normalized contract semantics are included deliberately. A future normalizer that changes the meaning of the same raw evidence must not silently reuse an older index identity.

Machine paths, timestamps, acquisition traversal order, request ids, and frontend transport metadata do not contribute.

`TargetFingerprint` and `ContractIndexFingerprint` are independent identity axes. Two equal target fingerprints may legitimately have different Contract Index fingerprints when declaration/catalog/source/runtime evidence differs. Conversely, moving an equivalent installation to another absolute path must not change the Contract Index fingerprint.

M2.1 uses installed package/manifests and public declaration evidence. Offline contracts have `availability: "unknown"`; declarations prove capability facts, not live provider mounting. M2.2 may add official `cordisInspect` observations to the same evidence/index model. Toolchain does not call private generated DSH source paths when the official runtime Inspect seam is available.

## Freshness

`contract.search` resolves a target and acquires the evidence for that snapshot. If evidence already represented by the snapshot changes before it can be consumed consistently, the result is `stale` rather than a mixed-epoch index.

`contract.inspect` accepts the caller's `contractIndexFingerprint`, rebuilds/reacquires the current target-bound index, and returns `CONTRACT_INDEX_STALE` when the identities differ. It must not silently inspect a different index. A missing contract id in the current index is a separate `CONTRACT_NOT_FOUND` failure.

## Consequences

Contract indexes are reproducible and cache-safe without bloating target identity. Persisted index caching remains unnecessary in M2.1; if introduced later, cache validity must include the Contract Index fingerprint/evidence identity rather than package versions or branch names.

The cost is reacquisition/reindexing for current operations, which is acceptable for the initial local deterministic index and keeps correctness observable before adding caching complexity.

## Verification

Tests must prove:

- evidence/contract input order and machine locations do not alter the fingerprint;
- target fingerprint, consumed content hashes, or normalized semantics do alter it;
- same-version declaration drift changes the Contract Index fingerprint while the M1 target fingerprint can remain unchanged;
- stale inspect never returns a successful contract payload;
- official live Inspect observations, when added, participate as evidence rather than replacing Toolchain's target/index identity semantics.
