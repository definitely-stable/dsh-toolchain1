# M2.3 H1 canonical terminal outcome

Status: **INCONCLUSIVE / CLOSED AS HISTORICAL EVIDENCE**

H1 is complete and MUST NOT be rerun as a confirmatory holdout after disclosure. Its tasks may now be used only as disclosed development/calibration data.

## Canonical execution chain

- H1 execution run: `33533666686`
- Schedule completion: `864 / 864`
- Corrected terminal source revision: `a27e86e2174e782c438abd91881094492f423af3`
- Terminal adjudication run: `33541873817`
- Post-H1 analysis run: `33541936135`
- Terminal status: `INCONCLUSIVE`
- Unresolved B/C decision observations: `227 / 576`
- Infrastructure inconclusive flag: `true`

## Evidence identities

- H1 definition SHA-256: `c07c9d91eee82101872cd106e8170ecebcbba4368039255118673382a956d717`
- Truth fingerprint: `dsh-api-truth-v2:14ab2c32fa1307de300d09715b30a147a9ffe7884335ee0f19ebc5cb018871bb`
- Terminal result SHA-256: `cee3e20d2d8e522f434bc2ed545ced4eeccf5278633966828b2cf2dc1bf630e7`
- Terminal analysis SHA-256: `9e100044097dca00b4394fcd93fc1a3bd9a9173125c8f91d01736031c4c0a89a`
- Terminal artifact ZIP SHA-256: `bf009c59bbeabbd06cbd478632fa7821322f1342f8b027cc760144ba821a369c`
- Post-analysis artifact SHA-256: `24e6f5384667d9ac8a5c6c308058fbcaa0717fbf2f20421493d549d31b40a32b`

## Interpretation

The terminal workflow executed successfully and produced attested evidence. `INCONCLUSIVE` is the scientific status, not an Actions failure and not a `NEEDS-IMPROVEMENT` verdict for Contract Intelligence.

The dominant validity problem was measurement resolution: the frozen decision rule requires every B/C observation to have a resolved API/task-success adjudication before the paired bootstrap can run. H1 left 227 B/C observations unresolved, so confirmatory primary/guardrail estimates were intentionally not computed.

Historical prefix analysis also shows why future evaluation needs an early health gate: unresolved decision observations were already substantial in the first small execution prefixes. Continuing the full fixed schedule therefore consumed model budget after measurement health had already become questionable.

## Post-disclosure boundary

The disclosed 96 H1 tasks are no longer hidden evidence. They are useful for reproducing measurement failures, evaluator calibration, retrieval/tool-use development and regression testing, but MUST NOT be used as the future H2 confirmatory holdout or described as unseen evidence after tuning.

Future confirmatory work proceeds only through a separately preregistered H2 with a fresh hidden task set. H1 itself remains immutable historical evidence with status `INCONCLUSIVE`.
