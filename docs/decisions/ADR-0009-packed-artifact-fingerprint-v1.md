# ADR-0009: Verification receipts bind the exact packed artifact bytes

- Status: Accepted
- Date: 2026-09-06

## Context

Static `plugin.check` identifies normalized plugin semantics with `dsh-plugin-subject-v1`, but M4 verification must prove the concrete artifact that was actually installed. Two tarballs may normalize to the same package name/version/requirements while differing in executable bytes, generated output, bundled assets, archive metadata, or other installed content.

Reusing the static subject fingerprint for runtime verification would therefore permit a receipt to claim one artifact while a different byte stream was executed.

## Decision

Packed runtime verification uses `dsh-plugin-artifact-v1:<sha256>` where `<sha256>` is the lowercase SHA-256 digest of the exact bounded `.tgz` byte stream copied into the disposable verification workspace and subsequently supplied to DSH/package installation.

The source path, mtime, inode, machine identity, temporary copy path, request id, and verification timestamp are excluded. Repacking semantically equivalent contents into different bytes intentionally produces a different artifact fingerprint.

Before execution, the worker compares the exact-byte digest it observes with the authoritative packed-artifact `contentHash` produced by the existing bounded packed-subject acquisition path. A mismatch is a stale/TOCTOU-style artifact input failure and candidate execution does not start.

`dsh-plugin-subject-v1` remains the normalized static/source identity. `dsh-plugin-artifact-v1` is a separate installed-byte identity. Neither namespace changes `dsh-target-v2` or `dsh-contract-index-v1`.

## Consequences

Verification receipts can be tied to the exact bytes that crossed the execution boundary. Equivalent repacks may yield separate receipts, which is an intentional false-difference preference over false artifact sameness.

The verification layer may hash binary bytes with Node runtime facilities. Semantic kernel/model layers continue to receive only the resulting fingerprint/string evidence and remain runtime-neutral.

## Verification

Tests must prove same bytes at different paths have the same artifact fingerprint, one-byte drift changes it, an expected-content-hash mismatch prevents process execution, and the installed temporary artifact is the same byte stream that was fingerprinted.