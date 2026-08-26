# Security Policy

DSH Toolchain inspects local DSH installations and, in its verification path, may build/install/execute third-party plugin artifacts in a separate temporary DSH environment. Security reports are therefore treated as product issues, not ordinary support requests.

## What to report privately

Use a private security channel for vulnerabilities involving, for example:

- escape from the documented verification isolation boundary;
- unintended access to the user's active DSH profile, credentials, sessions, or workspace;
- secret/token disclosure in diagnostics, logs, receipts, caches, or exported reports;
- command/package-manager argument injection;
- path traversal or writes outside the declared temporary roots;
- bypass of an explicit verification execution policy;
- unsafe handling of untrusted package metadata or archives;
- supply-chain compromise of published Toolchain artifacts or release workflows.

Do **not** paste credentials, API keys, private source, session content, or exploit material into a public GitHub Issue.

## Reporting channel

This repository is a private incubator. Before the public repository launches, security reports are handled directly by project maintainers and are not accepted through public Issues.

The future public `definitely-stable/dsh-toolchain` repository MUST enable GitHub private vulnerability reporting before public release. Once enabled, that private reporting flow is the canonical channel.

If a public user discovers a suspected security issue before a private reporting flow is available, they should open only a minimal non-sensitive request asking maintainers for a secure reporting channel. They MUST NOT include exploit details or secrets in that request.

## Supported versions

Before the first public release there is no supported-version promise. After public release, only versions explicitly listed as supported/tested by the project's compatibility policy receive security fixes. Unsupported historical snapshots may be used for investigation, but support is not implied by repository availability.

## Disclosure expectations

Maintainers will first determine whether the report is a vulnerability, a documented trust-boundary limitation, or ordinary plugin failure. Reports should include the smallest reproducible evidence necessary to identify the affected Toolchain/DSH versions and operation.

Coordinated disclosure is expected: allow maintainers time to reproduce, prepare a fix, verify the fix against the affected boundary, and publish an advisory/release before public exploit details are shared.

## Trust-boundary reminder

A temporary `DSH_HOME`, temporary workspace, or separate process provides configuration/data separation from the user's active profile. It is **not** by itself a malicious-code sandbox. The project MUST NOT claim stronger isolation than the implementation actually provides. See `docs/security.md` and `spec/verification.md` for the normative execution model.
