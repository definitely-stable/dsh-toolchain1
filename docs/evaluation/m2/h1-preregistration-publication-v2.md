# H1 preregistration publication v2

Status: **PREREGISTERED / SOURCE-BOUND FROM SCHEDULE INDEX 12**

The real H1 scientific receipt is published at `h1-preregistration-receipt-v2.json`. The exact execution source for continuation is published at `h1-source-bound-preregistration-v2.json`; the operational correction for the first 12 outcomes is recorded in `h1-source-binding-amendment-2026-08-31.md`.

## Frozen scientific identity

H1 remains bound to the existing scientific receipt `dc12ccf907f507b5f6da08c790a1a84563160e984879724e5c18283e0404219b`, execution definition `c07c9d91eee82101872cd106e8170ecebcbba4368039255118673382a956d717`, 96-task hidden dataset commitment `f81f97cfe3b7ccf615f6246ed6b355f730009c6fb66dc8cd170a90c9c9753095`, OpenCode Go `deepseek-v4-flash`, schedule length 864 and concurrency 1. Source binding does not modify the dataset, arms, retry policy, thresholds, scoring, statistical analysis, ledger identity or durable run-store format.

## Exact execution-source boundary

From schedule index 12 onward, H1 execution is allowed only when the source-bound envelope validates and identifies all of:

- repository `definitely-stable/dsh-toolchain1`;
- source commit `76951152e9ccce28dd86469410cb67131f3a46b1`;
- Node `24.19.0`;
- child `scripts/m2-opencode-go-p0-child.mjs`;
- protocol `closed-ndjson-v1`.

The source-binding SHA is `c7308f7344146b670fb3a24a76a960f83660e31ce20279accef77959cc709afc`; the enclosing source-bound preregistration SHA is `2d39af8d83aefc459d509be114618b92784015a96a796c9eccf0f03e1cab57c4`.

The H1 operator independently resolves `git rev-parse HEAD` and fails closed if the checkout, Node runtime, executable or child entrypoint differs. The GitHub Actions workflow first reads the publication envelope, extracts its bound source SHA, then performs a second checkout of that exact commit before preflight or provider execution.

## Continuation procedure

The existing H1 run store resumes at schedule index 12. Each continuation must restore the same durable ledger, validate the scientific receipt and source-bound envelope, pass exact-source preflight, and then execute only the requested bounded chunk under the frozen resource/retry contract. No production retrieval or experiment parameters may be changed in response to intermediate H1 behavior.

The first 12 outcomes were executed from `269d11c8e970f94cec67bb11f7bcb3961e2b080a` before #123 was closed; they are retained with explicit provenance rather than rewritten or replayed. After terminal `PASS`, `NEEDS-IMPROVEMENT` or `INCONCLUSIVE`, reveal the exact hidden dataset and verify its precommitted hashes.

Repository protection and an immutable publication tag/ref remain separate governance controls; execution-source binding does not replace them.
