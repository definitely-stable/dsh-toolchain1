# ADR-0005: DSH Web is a native client projection through Service, Typert, and Slots

- Status: Accepted
- Date: 2026-08-26

## Context

DSH separates Host and Browser plugin planes. Current DSH architecture exposes business-service unary calls through Typert Remote and composes UI through Slots. Cross-plane/cross-plugin implementation imports would couple Toolchain to DSH Web internals and duplicate business behavior.

## Decision

The DSH Host exposes a `toolchain` Cordis service backed by the application kernel. Browser-safe declarations expose selected unary operations through the DSH Typert Remote mechanism. The Toolchain client contributes UI using DSH Slots.

Host and Client are separate build faces and must not import each other's concrete implementation.

Long verification work uses the Toolchain `Operation` model. Web initially uses start/status/cancel semantics rather than forcing progress streams through unary remote calls.

## Consequences

Web stays idiomatic to DSH and can be replaced without changing Toolchain semantics. UI implementation waits until core contracts are stable enough to render.

## Verification

Host/client dependency fitness checks plus Web-vs-kernel contract parity tests.
