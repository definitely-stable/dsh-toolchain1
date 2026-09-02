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

export type ResolvedBundleIdentity = {
  readonly "name": string
  readonly "version": string
  readonly "patchHash": string
}

export type TargetResolveRequest = {
  readonly "profile": string
  readonly "dshHome"?: string
  readonly "dshPackageRoot"?: string
  readonly "patches"?: Array<string>
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
  readonly "bundles": Array<ResolvedBundleIdentity>
  readonly "dependencies": Array<ResolvedPackageIdentity>
  readonly "profilePatchHash": string
  readonly "homePatchHash": string
  readonly "overlayPatchHashes": Array<string>
}
  readonly "supportStatus"?: "tested" | "supported" | "experimental" | "unsupported"
  readonly "evidence": Array<Evidence>
}

export type TargetResolveResult = {
  readonly "snapshot": TargetSnapshot
}

export type ContractKind = "service" | "method" | "event" | "tool" | "client-slot" | "config" | "package"

export type ContractAvailability = "available" | "unavailable" | "unknown"

export type ContractFact = {
  readonly "key": string
  readonly "value": string
  readonly "evidenceIds": [string, ...Array<string>]
}

export type ContractReference = {
  readonly "id": string
  readonly "kind": ContractKind
  readonly "name": string
  readonly "qualifiedName": string
  readonly "availability": ContractAvailability
  readonly "score": number
  readonly "summary"?: string
  readonly "evidenceIds": Array<string>
}

export type ContractDefinition = {
  readonly "id": string
  readonly "kind": ContractKind
  readonly "name": string
  readonly "qualifiedName": string
  readonly "availability": ContractAvailability
  readonly "summary"?: string
  readonly "facts": Array<ContractFact>
  readonly "evidenceIds": Array<string>
}

export type ContractSearchRequest = {
  readonly "target": TargetResolveRequest
  readonly "query": string
  readonly "kinds"?: Array<ContractKind>
  readonly "limit"?: number
}

export type ContractSearchResult = {
  readonly "contractIndexFingerprint": string
  readonly "matches": Array<ContractReference>
  readonly "evidence": Array<Evidence>
}

export type ContractInspectRequest = {
  readonly "target": TargetResolveRequest
  readonly "contractIndexFingerprint": string
  readonly "contractId": string
}

export type ContractInspectResult = {
  readonly "contractIndexFingerprint": string
  readonly "contract": ContractDefinition
  readonly "evidence": Array<Evidence>
}

export type PluginSubjectRequest = {
  readonly "kind": "directory" | "packed"
  readonly "path": string
}

export type PluginCheckRequest = {
  readonly "target": TargetResolveRequest
  readonly "subject": PluginSubjectRequest
}

export type PluginPackageRelationship = "host-peer-required" | "host-peer-optional" | "artifact-dependency"

export type PluginRequirementStatus = "satisfied" | "not-required-from-host" | "missing" | "unproven"

export type PluginRequirementAnalysis = {
  readonly "packageName": string
  readonly "range": string
  readonly "relationship": PluginPackageRelationship
  readonly "status": PluginRequirementStatus
  readonly "targetVersion"?: string
  readonly "evidenceIds": Array<string>
}

export type PluginCheckResult = {
  readonly "contractIndexFingerprint": string
  readonly "subjectFingerprint"?: string
  readonly "subjectCompleteness": "complete" | "partial" | "invalid"
  readonly "ruleset": "plugin-static-alpha-v1"
  readonly "scopeComplete": false
  readonly "verdict": "compatible-in-scope" | "incompatible" | "unproven"
  readonly "requirements": Array<PluginRequirementAnalysis>
  readonly "evidence": Array<Evidence>
  readonly "candidateCodeExecuted": false
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

export type TargetResolveSuccessResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint": string
  readonly "status": "ok"
  readonly "data": TargetResolveResult
  readonly "diagnostics": Array<Diagnostic>
}

export type TargetResolveFailureResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "status": "failed"
  readonly "diagnostics": [Diagnostic, ...Array<Diagnostic>]
}

export type TargetResolveResponse = TargetResolveSuccessResponse | TargetResolveFailureResponse

export type ContractSearchSuccessResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint": string
  readonly "status": "ok"
  readonly "data": ContractSearchResult
  readonly "diagnostics": Array<Diagnostic>
}

export type ContractSearchFailureResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "status": "failed"
  readonly "diagnostics": [Diagnostic, ...Array<Diagnostic>]
}

export type ContractSearchStaleResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint": string
  readonly "status": "stale"
  readonly "diagnostics": [Diagnostic, ...Array<Diagnostic>]
}

export type ContractSearchResponse = ContractSearchSuccessResponse | ContractSearchFailureResponse | ContractSearchStaleResponse

export type ContractInspectSuccessResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint": string
  readonly "status": "ok"
  readonly "data": ContractInspectResult
  readonly "diagnostics": Array<Diagnostic>
}

export type ContractInspectFailureResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "status": "failed"
  readonly "diagnostics": [Diagnostic, ...Array<Diagnostic>]
}

export type ContractInspectStaleResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint": string
  readonly "status": "stale"
  readonly "diagnostics": [Diagnostic, ...Array<Diagnostic>]
}

export type ContractInspectResponse = ContractInspectSuccessResponse | ContractInspectFailureResponse | ContractInspectStaleResponse

export type PluginCheckSuccessResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint": string
  readonly "status": "ok"
  readonly "data": PluginCheckResult
  readonly "diagnostics": Array<Diagnostic>
}

export type PluginCheckFailureResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "status": "failed"
  readonly "diagnostics": [Diagnostic, ...Array<Diagnostic>]
}

export type PluginCheckStaleResponse = {
  readonly "protocolVersion": "1"
  readonly "requestId": string
  readonly "snapshotFingerprint": string
  readonly "status": "stale"
  readonly "diagnostics": [Diagnostic, ...Array<Diagnostic>]
}

export type PluginCheckResponse = PluginCheckSuccessResponse | PluginCheckFailureResponse | PluginCheckStaleResponse

export type ToolchainProtocolResponse = ResponseEnvelope
