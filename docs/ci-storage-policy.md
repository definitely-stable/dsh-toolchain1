# CI Storage Policy

DSH Toolchain treats GitHub-hosted compute and persistent Actions storage as different resources. Normal public-repository validation may recompute work freely, but cache and artifact persistence must stay deliberate and bounded.

## Dependency cache

Required CI may cache only pnpm's content-addressable store. The cache is an optimization, never an input authority:

- pnpm is bootstrapped by the SHA-pinned `pnpm/setup` action, which reads the exact version from `package.json#packageManager`;
- `actions/setup-node` owns the dependency cache with explicit `cache: pnpm`;
- `pnpm-lock.yaml` is the cache invalidation input via `cache-dependency-path`;
- automatic package-manager caching stays disabled with `package-manager-cache: false` so caching cannot expand silently;
- `pnpm install --frozen-lockfile --ignore-scripts` remains authoritative on every lane, whether the cache hits or misses.

Required CI must not use a second broad `actions/cache` layer for `node_modules`, build output, packed artifacts, temporary DSH installations, target evidence, or future contract evidence. Those states are regenerated from reviewed sources and the frozen dependency graph.

The cache key and GitHub's cache lifecycle are implementation details of the pinned setup action. Node-version matrix lanes on the same OS may share a lockfile-derived pnpm store because the store contains package content rather than an installed `node_modules` tree.

## Artifacts

The normal PR/main validation workflow keeps the exact Toolchain tarball, `lib/`, temporary DSH homes/profiles, and smoke receipts on the runner filesystem only. The runner is discarded after the job.

If a future required CI job genuinely needs a transient cross-job test report, `actions/upload-artifact` may be used only with `retention-days: 1` and must not persist product/package outputs such as `.artifacts/dsh-toolchain.tgz`, `node_modules`, or a disposable DSH home. Durable release packages belong to the release/publishing lineage rather than ordinary validation artifacts.

M2 contract indexes/evidence are not cacheable by default. Add such a cache only after measurement shows a material benefit and its key includes all semantic identities required to make stale reuse impossible.

## Enforcement

`scripts/check-ci-storage-policy.mjs` runs inside `pnpm check` and validates `.github/workflows/ci.yml`. It requires the explicit pnpm-store cache configuration, the pinned pnpm bootstrap, and the authoritative frozen install model while rejecting broad direct caches and persistent product artifacts.

Changing these rules is a reviewed CI/reproducibility decision, not a local workflow optimization.
