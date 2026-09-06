# Security Model

Status: **Baseline**

DSH Toolchain analyzes and may execute third-party plugin code during verification. Security claims therefore distinguish data/configuration isolation from malicious-code isolation.

## Trust boundaries

The product has four relevant trust zones:

1. the user's active DSH profile and credentials;
2. the Toolchain Host/kernel;
3. the temporary verification environment;
4. the candidate plugin and its build/install/runtime processes.

The candidate plugin is untrusted by default.

## Non-negotiable rules

- Read-only discovery and static analysis MUST NOT mutate the user's active DSH profile.
- Default verification MUST use a separate temporary DSH home and temporary workspace state.
- Candidate subprocesses MUST NOT receive the caller's complete environment by default.
- Secrets, tokens, provider credentials, and session contents MUST NOT be copied into a verification environment unless a future explicit trusted policy defines the transfer.
- Toolchain MUST NOT describe a temporary DSH home as a security sandbox.
- Destructive installation/publishing behavior is outside the default verification policy.
- Reports intended for export SHOULD redact host-specific paths and secrets.

## Execution policies

### `safe`

Default. It minimizes inherited environment, never intentionally uses the active DSH profile, avoids publishing, and executes only the steps declared by the verification plan. Where the operating system cannot enforce network/filesystem isolation, the report MUST NOT imply that those resources were sandboxed.

M4.1 implements only `safe`. It creates a unique disposable runner plus temporary `DSH_HOME`, HOME/USERPROFILE and temporary-directory coordinates. Candidate and Toolchain-owned probe installation use `--ignore-scripts`, so package lifecycle scripts are not part of the M4.1 install boundary. Candidate runtime code is nevertheless executed during the boot stage and retains filesystem/network capabilities granted by the operating system account running Toolchain.

### `trusted`

Reserved for a future explicit opt-in policy for plugins that require broader host access. M4.1 does not implement `trusted`; no receipt from this slice may claim trusted execution semantics.

A future `sandboxed` policy may be introduced only after Toolchain has a real OS/container isolation backend with tested guarantees. The name is reserved until that exists.

## Environment policy

Verification workers build an allowlisted base environment sufficient for the selected DSH/package-manager target. M4.1 inherits only bootstrap path/system coordinates required to start the package manager and DSH, then forces Toolchain-owned temporary `HOME`, `USERPROFILE`, `DSH_HOME`, `TMPDIR`, `TMP`, and `TEMP` values together with non-interactive CI settings.

Credentials are not silently inherited. Credential-dependent checks report a structured skip/input requirement unless a later selected policy explicitly supplies the credential.

Environment allowlisting is credential/configuration isolation, not confinement. Candidate code can still discover or access resources made available through other operating-system mechanisms.

## Filesystem policy

Candidate package paths are canonicalized before use. Package-relative inputs must remain inside their declared root. This containment prevents accidental/path-traversal access through Toolchain configuration; it does not constrain arbitrary paths opened by candidate runtime code.

The active DSH profile is considered read-only from the verifier's perspective. M4.1 never intentionally passes that profile as the worker's writable `DSH_HOME`; exact real-DSH CI also keeps a sentinel outside the worker root and verifies Toolchain-owned execution leaves it unchanged. This proves Toolchain path usage, not malicious-plugin filesystem isolation.

## Process policy

Verification subprocesses are started without shell interpolation. Stdout and stderr are independently bounded. Timeout, cancellation, and output-limit termination target the process tree: Unix uses the detached process group when available, while Windows uses a Toolchain-owned `taskkill /PID ... /T /F` invocation before best-effort direct child termination.

These controls bound Toolchain-owned lifecycle and resource leakage; they do not turn the process into a security sandbox.

## Failure isolation

A failure in one independently checkable plugin component SHOULD preserve diagnostics/results for other components whenever doing so does not violate a fatal package-level boundary.

Worker crashes MUST be converted into an infrastructure diagnostic and MUST NOT crash the active DSH Host.

Cleanup is attempted after success, failure, cancellation and process/worker failure. Cleanup failure is retained independently and cannot rewrite an earlier verification failure into success.

## Evidence and disclosure

Every public runtime verification report records:

- execution policy;
- target snapshot fingerprint;
- candidate artifact fingerprint;
- checks actually executed;
- skipped checks and reasons;
- cleanup result;
- whether target freshness was revalidated.

M4.1 worker observations are internal execution evidence. They bind to the starting target fingerprint but do not yet re-resolve the caller's active target, so `terminal: completed` must not be presented as a public `verified` claim. Final freshness/status reduction belongs to M4.2 application orchestration.

Security wording in UI/CLI/MCP MUST match these facts.

## Reference

Agent Plugins 1.0 uses filesystem containment for package paths while explicitly noting that containment is not subprocess sandboxing: https://agent-plugins.org/specification
