# M2.3 upstream drift canary

Status: informational compatibility evidence. This file is deliberately outside the frozen rc.2 retrieval score and must not be mixed into the M2.3 baseline.

## Canonical M2.3 target

M2.3 remains bound to the registry-installable target used by the frozen artifact fixture and evaluation corpus:

- package: `@deepseek-ai/dsh`
- version: `0.1.1-rc.2`
- profile: `web`
- upstream source/docs provenance: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- target identity: `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`
- Contract Index identity: `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`

The retrieval baseline, R1 corpus, API oracle, P0 calibration set and future H1 commitment all refer to this exact target/index pair. Changing the target would create a different experiment rather than updating this one.

## Observed upstream prerelease

On 2026-08-28, upstream GitHub exposes immutable prerelease `dsh-v0.1.2-alpha.1`. The corresponding source package at commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` declares `@deepseek-ai/dsh@0.1.2-alpha.1`.

That source train introduced profile lifecycle semantics through `dsh.profile.patchReload: 'live' | 'startup'`. In the observed source profiles, Web uses `live` while headless/ACP/SDK-style profiles use `startup`; this can change how later profile/home patch mutations affect the running composition.

The current `dsh-target-v2` projection does not encode `patchReload`. Therefore two otherwise equal compositions can have different lifecycle behavior without changing the current target fingerprint. Issue #33 owns the compatibility decision. The field must **not** be silently appended to the `dsh-target-v2` semantic projection because doing so would mutate an already named content-addressed namespace.

## Registry distinction

The GitHub prerelease and registry support policy are intentionally separate signals. A GitHub release/tag does not by itself make a version part of Toolchain's registry-backed compatibility matrix.

At the 2026-08-28 M2.3 governance check, the public npm package page still reports `@deepseek-ai/dsh` version `0.1.1-rc.2`; earlier registry CI also rejected an install attempt for `0.1.2-alpha.1`. Until an installable registry train carrying the new lifecycle contract exists and Issue #33 is resolved, Toolchain must not claim target-identity support for that lifecycle semantic.

## Evaluation policy

- Do not regenerate the rc.2 frozen fixture from alpha.1 source.
- Do not add alpha.1 contracts or wording to R1, P0, the rc.2 API oracle or any H1 task/oracle after seeing outcomes.
- Do not compare alpha.1 retrieval scores to rc.2 scores as though they were the same experiment.
- Do not change production ranking in PR #35 to accommodate a later train.
- When an installable DSH train containing `patchReload` is published, resolve Issue #33 first, add a target-identity compatibility fixture/matrix entry, then create a separately identified evaluation baseline if needed.

## Relationship to M2

This drift does not invalidate the rc.2 M2.3 experiment. It does limit the scope of any compatibility claim: M2 evidence proves behavior for the exact pinned target/index, not for future DSH lifecycle semantics that the current target namespace cannot distinguish.
