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

The retrieval baseline, R1 corpus, API oracle, P0 calibration set and completed H1 commitment all refer to this exact target/index pair. Changing the target would create a different experiment rather than updating this one. H1 completed 864/864 with terminal `INCONCLUSIVE`; this compatibility work does not rerun, relabel, or reinterpret that result.

## Historical upstream drift signal

On 2026-08-28, upstream GitHub exposed immutable prerelease `dsh-v0.1.2-alpha.1`. The corresponding source package at commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` declared `@deepseek-ai/dsh@0.1.2-alpha.1` and introduced profile lifecycle semantics through `dsh.profile.patchReload: 'live' | 'startup'`.

That source-only signal created Issue #33 because `dsh-target-v2` intentionally identifies startup composition bytes/coordinates but not post-boot reload policy. Mutating the existing target-v2 namespace in place was rejected.

## Published lifecycle-aware train

By 2026-09-07, npm publishes `@deepseek-ai/dsh@0.1.2-rc.1`. The published lifecycle contract is therefore no longer only a source/master canary.

Issue #33 is resolved architecturally by ADR-0010: `dsh-target-v2` remains the startup-composition identity and lifecycle-aware targets additionally carry the orthogonal content-addressed identity `dsh-profile-lifecycle-v1:<sha256>` over effective `patchReload: live | startup`.

PR #198 proves the registry path rather than widening support from source inspection alone. CI run #1537 completed successfully with:

- real `@deepseek-ai/dsh@0.1.2-rc.1` `headless` target resolution, effective `patchReload: startup`, and lifecycle fingerprint;
- public packed-artifact `plugin.verify` on rc.1 producing a lifecycle-bound `verified` receipt with live Host Service visibility;
- read-only/path-stable/no-hint target resolution across `0.1.2-rc.1`, `0.1.1-rc.2`, and `0.1.0-rc.8`;
- no lifecycle metadata backfilled onto the older rc.2/rc.8 trains.

This is compatibility evidence for target resolution and verification. It is not a new M2 retrieval baseline and does not imply that every upstream rc.1 Web/runtime behavior is covered.

## Evaluation policy

- Do not regenerate the frozen rc.2 fixture from rc.1 or later source.
- Do not add rc.1 contracts or wording to R1, P0, the rc.2 API oracle, H1 tasks, or H1 adjudication after outcomes are known.
- Do not compare rc.1 retrieval scores to rc.2 scores as though they were the same experiment.
- Do not change the frozen production ranking or Contract Index identity as a side effect of lifecycle compatibility work.
- A future H2, if authorized, requires a fresh hidden dataset and separately frozen target/model/provider design; the disclosed H1 corpus remains development-only.

## Relationship to M2

The lifecycle compatibility decision does not invalidate or update the rc.2 M2.3 experiment. The exact rc.2 target and Contract Index identities above remain historical source of truth for that evaluation. `dsh-profile-lifecycle-v1` is an orthogonal runtime/freshness identity for lifecycle-aware DSH trains, not a replacement label for frozen M2 evidence.
