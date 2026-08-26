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

### `trusted`

Explicit opt-in for plugins that require broader host access. Evidence receipts record that trusted execution was used.

A future `sandboxed` policy may be introduced only after Toolchain has a real OS/container isolation backend with tested guarantees. The name is reserved until that exists.

## Environment policy

Verification workers build an allowlisted base environment sufficient for the selected DSH/package-manager target. Toolchain-owned values such as temporary HOME/DSH_HOME/TMP are set after plugin-supplied overlays where applicable.

Credentials are not silently inherited. Credential-dependent checks report a structured skip/input requirement unless the selected policy explicitly supplies the credential.

## Filesystem policy

Candidate package paths are canonicalized before use. Package-relative inputs must remain inside their declared root. This containment prevents accidental/path-traversal access through Toolchain configuration; it does not constrain arbitrary paths opened by candidate runtime code.

The active DSH profile is considered read-only from the verifier's perspective.

## Failure isolation

A failure in one independently checkable plugin component SHOULD preserve diagnostics/results for other components whenever doing so does not violate a fatal package-level boundary.

Worker crashes MUST be converted into an infrastructure diagnostic and MUST NOT crash the active DSH Host.

## Evidence and disclosure

Every runtime verification report records:

- execution policy;
- target snapshot fingerprint;
- candidate artifact fingerprint;
- checks actually executed;
- skipped checks and reasons;
- cleanup result;
- whether target freshness was revalidated.

Security wording in UI/CLI/MCP MUST match these facts.

## Reference

Agent Plugins 1.0 uses filesystem containment for package paths while explicitly noting that containment is not subprocess sandboxing: https://agent-plugins.org/specification
