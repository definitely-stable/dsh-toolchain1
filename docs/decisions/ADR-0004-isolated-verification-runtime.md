# ADR-0004: Candidate verification uses a separate temporary DSH runtime

- Status: Accepted
- Date: 2026-08-26

## Context

A plugin can typecheck while failing after packaging, profile composition, boot, or agent/tool visibility. Loading an unknown candidate into the user's active DSH process risks corrupting the environment being used to diagnose it.

## Decision

Runtime verification packages the candidate artifact and installs/tests it in a separate temporary DSH home/process by default. The verifier uses the exact selected DSH target, executes explicit verification stages, records evidence, and cleans up.

A temporary DSH home is isolation from user configuration/data, not a malicious-code sandbox.

## Consequences

Verification costs more than static checking and requires worker lifecycle/cleanup logic. In exchange it tests the artifact the user would install and keeps the active profile out of the candidate lifecycle.

## Verification

Fixtures must cover packaging-only failure, composition failure, boot failure, capability-visibility failure, worker crash, cleanup, and target-staleness.
