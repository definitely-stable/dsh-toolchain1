// This file is generated from spec/schemas/v1/toolchain-protocol.schema.json.
// DO NOT EDIT BY HAND. Run `pnpm generate` after changing the canonical schema.

export const TOOLCHAIN_PROTOCOL_VERSION = "1" as const

export type Severity = "info" | "warning" | "error" | "fatal"

export type EvidenceStrength = "authoritative" | "observed" | "derived" | "heuristic"

export type EvidenceKind = "runtime" | "generated-catalog" | "composed-config" | "package" | "manifest" | "type-declaration" | "source" | "heuristic"

export type Evidence = {
  readonly "id": string
  readonly "kind": EvidenceKind
  readonly "strength": EvidenceStrength
  readonly "source"?: string
  readonly "contentHash"?: string
  readonly "location"?: string
}

export type Diagnostic = {
  readonly "code": string
  readonly "severity": Severity
  readonly "domain": string
  readonly "summary": string
  readonly "evidenceIds"?: Array<string>
  readonly "locations"?: Array<string>
  readonly "repair"?: {
  readonly [key: string]: unknown
} | null
}

export type ResolvedPackageIdentity = {
  readonly "name": string
  readonly "version": string
}

export type TargetResolveRequest = {
  readonly "profile": string
  readonly "dshHome"?: string
  readonly "dshPackageRoot"?: string
}

export type TargetSnapshot = {
  readonly "fingerprint": string
  readonly "createdAt": string
  readonly "dsh": {
  readonly "name": "@deepseek-ai/dsh"
  readonly "version": string
}
  readonly "runtime": {
  readonly "nodeVersion": string
  readonly "platform": string
  readonly "arch": string
}
  readonly "profile": {
  readonly "name": string
  readonly "bundles": Array<ResolvedPackageIdentity>
  readonly "dependencies": Array<ResolvedPackageIdentity>
  readonly "patchHash": string
}
  readonly "supportStatus"?: "tested" | "supported" | "experimental" | "unsupported"
  readonly "evidence": Array<Evidence>
}

export type TargetResolveResult = {
  readonly "snapshot": TargetSnapshot
}

export type Operation = {
  readonly "id": string
  readonly "state": "queued" | "running" | "input-required" | "succeeded" | "failed" | "cancelled"
  readonly "progress"?: number
  readonly "message"?: string
}

export type ValidationReport = {
  readonly "status": "passed" | "failed" | "partial"
  readonly "diagnostics": Array<Diagnostic>
  readonly "checks"?: Array<string>
}

export type VerificationReport = {
  readonly "status": "verified" | "failed" | "partial" | "stale" | "cancelled"
  readonly "artifactFingerprint": string
  readonly "targetFingerprint": string
  readonly "executionPolicy": "safe" | "trusted"
  readonly "checks": Array<{
  readonly "id": "structure" | "manifest" | "dependency" | "contract" | "build" | "package" | "install" | "compose" | "boot" | "visibility" | "behavior"
  readonly "status": "passed" | "failed" | "skipped"
  readonly "reason"?: string
}>
  readonly "diagnostics": Array<Diagnostic>
  readonly "cleanup": "succeeded" | "failed" | "not-required"
}

export type ResponseEnvelope = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint"?: string
  readonly "status": "ok" | "failed" | "partial" | "stale" | "cancelled"
  readonly "data"?: unknown
  readonly "diagnostics": Array<Diagnostic>
}

export type TargetResolveResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint"?: string
  readonly "status": "ok" | "failed" | "partial" | "stale" | "cancelled"
  readonly "data"?: TargetResolveResult
  readonly "diagnostics": Array<Diagnostic>
}

export type ToolchainProtocolResponse = ResponseEnvelope
