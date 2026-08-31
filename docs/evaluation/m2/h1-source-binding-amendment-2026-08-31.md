# H1 execution-source binding amendment — 2026-08-31

Status: **ACTIVE FROM SCHEDULE INDEX 12**

H1 run `33383425232` executed the first 12 scheduled model outcomes from repository commit `269d11c8e970f94cec67bb11f7bcb3961e2b080a` before the exact execution-source binding from #123 was implemented. The run completed cleanly with `committedAttempts=12` and resume index `12`. No H1 model-answer/outcome contents were inspected to choose or alter this amendment.

The scientific H1 contract is unchanged: receipt `dc12ccf907f507b5f6da08c790a1a84563160e984879724e5c18283e0404219b`, definition `c07c9d91eee82101872cd106e8170ecebcbba4368039255118673382a956d717`, hidden dataset commitment `f81f97cfe3b7ccf615f6246ed6b355f730009c6fb66dc8cd170a90c9c9753095`, managed-gateway provider identity, schedule, arms, retry policy, thresholds and statistical analysis remain frozen. `H1LedgerBindingV2` and the durable run-store format are also unchanged, so the existing ledger resumes without migration.

Beginning with schedule index 12, every H1 launch must validate `h1-source-bound-preregistration-v2.json` and execute from source commit `76951152e9ccce28dd86469410cb67131f3a46b1`, Node `24.19.0`, child entrypoint `scripts/m2-opencode-go-p0-child.mjs`, protocol `closed-ndjson-v1`. The source-binding SHA is `c7308f7344146b670fb3a24a76a960f83660e31ce20279accef77959cc709afc`; the enclosing publication SHA is `2d39af8d83aefc459d509be114618b92784015a96a796c9eccf0f03e1cab57c4`.

This is an operational launch-integrity correction, not a change to treatment, task bytes, model, scoring or inference. The first 12 outcomes remain part of the same H1 ledger and are explicitly disclosed as pre-source-binding execution provenance.
