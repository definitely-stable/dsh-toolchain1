import type {
  ContractInspectFailureResponse,
  ContractInspectRequest,
  ContractInspectResponse,
  ContractInspectResult,
  ContractInspectStaleResponse,
  ContractInspectSuccessResponse,
  ContractSearchFailureResponse,
  ContractSearchRequest,
  ContractSearchResponse,
  ContractSearchResult,
  ContractSearchStaleResponse,
  ContractSearchSuccessResponse,
  Diagnostic,
  Evidence,
  PluginCheckFailureResponse,
  PluginCheckRequest,
  PluginCheckResponse,
  PluginCheckResult,
  PluginCheckStaleResponse,
  PluginCheckSuccessResponse,
  ResolvedBundleIdentity,
  ResolvedPackageIdentity,
  TargetResolveFailureResponse,
  TargetResolveRequest,
  TargetResolveResponse,
  TargetResolveResult,
  TargetResolveSuccessResponse,
  TargetSnapshot,
  VerificationReport,
} from '../protocol/index.js'
import { TOOLCHAIN_PROTOCOL_VERSION } from '../protocol/index.js'
import { TOOLCHAIN_PRODUCT, TOOLCHAIN_VERSION } from '../product.js'
import type { Sha256Port } from '../model/digest.js'
import {
  ContractAcquisitionError,
  createContractIndex,
  inspectContractIndex,
  mergeAcquiredContractFacts,
  searchContractIndex,
  type ContractAcquisitionErrorCode,
  type ContractAcquisitionPort,
  type ContractEnrichmentPort,
  type ContractIndex,
} from '../model/contract.js'
import {
  CONTRACT_SEARCH_RANKER_VERSION,
  createContractSearchIndex,
  type ContractSearchIndex,
  type ContractSearchIndexSource,
} from '../model/contract-search-index.js'
import { analyzePluginCompatibility } from '../model/plugin-check.js'
import {
  bindPackedVerificationArtifact,
  reducePluginVerification,
  type PluginVerificationExecutionPort,
} from '../model/plugin-verify.js'
import {
  createPluginSubjectSemanticProjection,
  fingerprintPluginSubject,
  type AcquiredPluginSubject,
  type PluginSubjectAcquisitionPort,
} from '../model/plugin.js'
import {
  createTargetSemanticProjectionV2,
  fingerprintTarget,
  TargetAcquisitionError,
  type AcquiredTargetFacts,
  type TargetAcquisitionPort,
  type TargetSemanticProjectionV2,
} from '../model/target.js'

export interface KernelDescriptor {
  readonly product: typeof TOOLCHAIN_PRODUCT
  readonly version: typeof TOOLCHAIN_VERSION
  readonly protocolVersion: typeof TOOLCHAIN_PROTOCOL_VERSION
}

export interface ContractSearchOutcome {
  readonly snapshotFingerprint: string
  readonly data: ContractSearchResult
}

export interface ContractInspectOutcome {
  readonly snapshotFingerprint: string
  readonly data: ContractInspectResult
}

export interface PluginCheckOutcome {
  readonly snapshotFingerprint: string
  readonly data: PluginCheckResult
  readonly diagnostics: readonly Diagnostic[]
}

/** Pre-Protocol-v1-freeze application shape; replaced by generated PluginVerifyRequest in the protocol slice. */
export interface PluginVerifyApplicationRequest {
  readonly target: TargetResolveRequest
  readonly subject: {
    readonly kind: 'packed'
    readonly path: string
  }
  readonly executionPolicy: 'safe'
}

export interface PluginVerifyOutcome {
  readonly snapshotFingerprint: string
  readonly data: VerificationReport
}

export interface ApplicationKernel {
  describe(): KernelDescriptor
  resolveTarget(request: TargetResolveRequest): Promise<TargetResolveResult>
  searchContracts(request: ContractSearchRequest, enrichment?: ContractEnrichmentPort): Promise<ContractSearchOutcome>
  inspectContract(request: ContractInspectRequest, enrichment?: ContractEnrichmentPort): Promise<ContractInspectOutcome>
  checkPlugin(request: PluginCheckRequest): Promise<PluginCheckOutcome>
  verifyPlugin(request: PluginVerifyApplicationRequest, signal?: AbortSignal): Promise<PluginVerifyOutcome>
}

export interface ApplicationKernelOptions {
  readonly targetAcquisition: TargetAcquisitionPort
  readonly contractAcquisition?: ContractAcquisitionPort
  readonly pluginSubjectAcquisition?: PluginSubjectAcquisitionPort
  readonly pluginVerificationExecution?: PluginVerificationExecutionPort
  readonly digest: Sha256Port
  readonly now?: () => string
  /** Internal deterministic seam for search-index lifecycle tests. */
  readonly createContractSearchIndex?: (source: ContractSearchIndexSource) => ContractSearchIndex
}

type ContractOperationErrorCode =
  | ContractAcquisitionErrorCode
  | 'CONTRACT_INDEX_STALE'
  | 'CONTRACT_NOT_FOUND'

interface ContractOperationErrorOptions extends ErrorOptions {
  readonly repair?: Readonly<Record<string, unknown>>
}

class ContractOperationError extends Error {
  readonly code: ContractOperationErrorCode
  readonly snapshotFingerprint: string
  readonly locations: readonly string[]
  readonly repair?: Readonly<Record<string, unknown>>

  constructor(
    code: ContractOperationErrorCode,
    message: string,
    snapshotFingerprint: string,
    locations: readonly string[] = [],
    options?: ContractOperationErrorOptions,
  ) {
    super(message, options)
    this.name = 'ContractOperationError'
    this.code = code
    this.snapshotFingerprint = snapshotFingerprint
    this.locations = Object.freeze([...locations])
    if (options?.repair !== undefined) {
      this.repair = Object.freeze({ ...options.repair })
    }
  }
}

const descriptor: KernelDescriptor = Object.freeze({
  product: TOOLCHAIN_PRODUCT,
  version: TOOLCHAIN_VERSION,
  protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
})

const MAX_CONTRACT_REPAIR_IDS = 10
const MAX_CONTRACT_SEARCH_INDEX_CACHE = 8
const PLUGIN_STATIC_RULESET = 'plugin-static-alpha-v1' as const

function freezeBundleIdentity(identity: ResolvedBundleIdentity): ResolvedBundleIdentity {
  return Object.freeze({
    name: identity.name,
    version: identity.version,
    patchHash: identity.patchHash,
  })
}

function freezePackageIdentity(identity: ResolvedPackageIdentity): ResolvedPackageIdentity {
  return Object.freeze({ name: identity.name, version: identity.version })
}

function freezeEvidence(item: Evidence): Evidence {
  return Object.freeze({ ...item })
}

function createSnapshot(
  facts: AcquiredTargetFacts,
  projection: TargetSemanticProjectionV2,
  fingerprint: string,
  createdAt: string,
): TargetSnapshot {
  const bundles = projection.profile.bundles.map(freezeBundleIdentity)
  const dependencies = projection.profile.dependencies.map(freezePackageIdentity)
  const overlayPatchHashes = [...projection.profile.overlayPatchHashes]
  const evidence = facts.evidence.map(freezeEvidence)
  Object.freeze(bundles)
  Object.freeze(dependencies)
  Object.freeze(overlayPatchHashes)
  Object.freeze(evidence)

  return Object.freeze({
    fingerprint,
    createdAt,
    dsh: Object.freeze({ ...projection.dsh }),
    runtime: Object.freeze({ ...projection.runtime }),
    profile: Object.freeze({
      name: projection.profile.name,
      bundles,
      dependencies,
      profilePatchHash: projection.profile.profilePatchHash,
      homePatchHash: projection.profile.homePatchHash,
      overlayPatchHashes,
    }),
    ...(facts.supportStatus === undefined ? {} : { supportStatus: facts.supportStatus }),
    evidence,
  })
}

function targetDiagnostic(error: TargetAcquisitionError): Diagnostic {
  return {
    code: error.code,
    severity: 'error',
    domain: 'target',
    summary: error.message,
    ...(error.locations.length === 0 ? {} : { locations: [...error.locations] }),
  }
}

function contractDiagnostic(error: ContractOperationError): Diagnostic {
  return {
    code: error.code,
    severity: 'error',
    domain: 'contract',
    summary: error.message,
    ...(error.locations.length === 0 ? {} : { locations: [...error.locations] }),
    ...(error.repair === undefined ? {} : { repair: { ...error.repair } }),
  }
}

function wrapContractAcquisition(
  error: ContractAcquisitionError,
  snapshotFingerprint: string,
): ContractOperationError {
  return new ContractOperationError(
    error.code,
    error.message,
    snapshotFingerprint,
    error.locations,
    { cause: error },
  )
}

function isStaleContractError(error: ContractOperationError): boolean {
  return error.code === 'CONTRACT_EVIDENCE_STALE' || error.code === 'CONTRACT_INDEX_STALE'
}

function contractIdsForEvidence(index: ContractIndex, evidenceId: string): readonly string[] {
  const isEvidenceId = index.evidence.some(item => item.id === evidenceId)
  if (!isEvidenceId) return []

  return Object.freeze(index.contracts
    .filter(contract => contract.evidenceIds.includes(evidenceId)
      || contract.facts.some(fact => fact.evidenceIds.includes(evidenceId)))
    .map(contract => contract.id)
    .toSorted()
    .slice(0, MAX_CONTRACT_REPAIR_IDS))
}

function pluginCheckEvidence(
  subjectEvidence: readonly Evidence[],
  index: ContractIndex,
  requirementEvidenceIds: readonly (readonly string[])[],
): Evidence[] {
  const evidence = subjectEvidence.map(freezeEvidence)
  const included = new Set(evidence.map(item => item.id))
  const targetEvidence = new Map(index.evidence.map(item => [item.id, item] as const))

  for (const evidenceIds of requirementEvidenceIds) {
    for (const evidenceId of evidenceIds) {
      if (included.has(evidenceId)) continue
      const item = targetEvidence.get(evidenceId)
      if (item === undefined) {
        throw new Error(`Plugin compatibility analysis referenced unknown evidence id: ${evidenceId}`)
      }
      evidence.push(freezeEvidence(item))
      included.add(evidenceId)
    }
  }
  return evidence
}

export async function resolveTargetResponse(
  kernel: ApplicationKernel,
  request: TargetResolveRequest,
  requestId: string,
): Promise<TargetResolveResponse> {
  try {
    const data = await kernel.resolveTarget(request)
    const response: TargetResolveSuccessResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      snapshotFingerprint: data.snapshot.fingerprint,
      status: 'ok',
      data,
      diagnostics: [],
    }
    return response
  } catch (error) {
    if (!(error instanceof TargetAcquisitionError)) throw error
    const response: TargetResolveFailureResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      status: 'failed',
      diagnostics: [targetDiagnostic(error)],
    }
    return response
  }
}

export async function searchContractsResponse(
  kernel: ApplicationKernel,
  request: ContractSearchRequest,
  requestId: string,
  enrichment?: ContractEnrichmentPort,
): Promise<ContractSearchResponse> {
  try {
    const outcome = enrichment === undefined
      ? await kernel.searchContracts(request)
      : await kernel.searchContracts(request, enrichment)
    const response: ContractSearchSuccessResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      snapshotFingerprint: outcome.snapshotFingerprint,
      status: 'ok',
      data: outcome.data,
      diagnostics: [],
    }
    return response
  } catch (error) {
    if (error instanceof TargetAcquisitionError) {
      const response: ContractSearchFailureResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        status: 'failed',
        diagnostics: [targetDiagnostic(error)],
      }
      return response
    }
    if (!(error instanceof ContractOperationError)) throw error
    if (isStaleContractError(error)) {
      const response: ContractSearchStaleResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        snapshotFingerprint: error.snapshotFingerprint,
        status: 'stale',
        diagnostics: [contractDiagnostic(error)],
      }
      return response
    }
    const response: ContractSearchFailureResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      status: 'failed',
      diagnostics: [contractDiagnostic(error)],
    }
    return response
  }
}

export async function inspectContractResponse(
  kernel: ApplicationKernel,
  request: ContractInspectRequest,
  requestId: string,
  enrichment?: ContractEnrichmentPort,
): Promise<ContractInspectResponse> {
  try {
    const outcome = enrichment === undefined
      ? await kernel.inspectContract(request)
      : await kernel.inspectContract(request, enrichment)
    const response: ContractInspectSuccessResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      snapshotFingerprint: outcome.snapshotFingerprint,
      status: 'ok',
      data: outcome.data,
      diagnostics: [],
    }
    return response
  } catch (error) {
    if (error instanceof TargetAcquisitionError) {
      const response: ContractInspectFailureResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        status: 'failed',
        diagnostics: [targetDiagnostic(error)],
      }
      return response
    }
    if (!(error instanceof ContractOperationError)) throw error
    if (isStaleContractError(error)) {
      const response: ContractInspectStaleResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        snapshotFingerprint: error.snapshotFingerprint,
        status: 'stale',
        diagnostics: [contractDiagnostic(error)],
      }
      return response
    }
    const response: ContractInspectFailureResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      status: 'failed',
      diagnostics: [contractDiagnostic(error)],
    }
    return response
  }
}

export async function checkPluginResponse(
  kernel: ApplicationKernel,
  request: PluginCheckRequest,
  requestId: string,
): Promise<PluginCheckResponse> {
  try {
    const outcome = await kernel.checkPlugin(request)
    const response: PluginCheckSuccessResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      snapshotFingerprint: outcome.snapshotFingerprint,
      status: 'ok',
      data: outcome.data,
      diagnostics: [...outcome.diagnostics],
    }
    return response
  } catch (error) {
    if (error instanceof TargetAcquisitionError) {
      const response: PluginCheckFailureResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        status: 'failed',
        diagnostics: [targetDiagnostic(error)],
      }
      return response
    }
    if (!(error instanceof ContractOperationError)) throw error
    if (isStaleContractError(error)) {
      const response: PluginCheckStaleResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        snapshotFingerprint: error.snapshotFingerprint,
        status: 'stale',
        diagnostics: [contractDiagnostic(error)],
      }
      return response
    }
    const response: PluginCheckFailureResponse = {
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
      requestId,
      status: 'failed',
      diagnostics: [contractDiagnostic(error)],
    }
    return response
  }
}

export function createApplicationKernel(options: ApplicationKernelOptions): ApplicationKernel {
  const now = options.now ?? (() => new Date().toISOString())
  const searchIndexFactory = options.createContractSearchIndex ?? createContractSearchIndex
  const searchIndexes = new Map<string, ContractSearchIndex>()

  function cachedSearchIndex(index: ContractIndex): ContractSearchIndex {
    const key = `${CONTRACT_SEARCH_RANKER_VERSION}\u0000${index.fingerprint}`
    const cached = searchIndexes.get(key)
    if (cached !== undefined) return cached

    const created = searchIndexFactory(index)
    searchIndexes.set(key, created)
    if (searchIndexes.size > MAX_CONTRACT_SEARCH_INDEX_CACHE) {
      const oldest = searchIndexes.keys().next().value
      if (oldest !== undefined) searchIndexes.delete(oldest)
    }
    return created
  }

  async function resolveTarget(request: TargetResolveRequest): Promise<TargetResolveResult> {
    const facts = await options.targetAcquisition.acquire(request)
    const projection = createTargetSemanticProjectionV2(facts)
    const fingerprint = await fingerprintTarget(projection, options.digest)
    const snapshot = createSnapshot(facts, projection, fingerprint, now())
    return Object.freeze({ snapshot })
  }

  async function buildContractIndex(
    request: TargetResolveRequest,
    enrichment?: ContractEnrichmentPort,
  ): Promise<{ readonly snapshot: TargetSnapshot; readonly index: ContractIndex }> {
    if (options.contractAcquisition === undefined) {
      throw new Error('Contract acquisition is not configured for this application kernel')
    }
    const { snapshot } = await resolveTarget(request)
    let acquired
    try {
      acquired = await options.contractAcquisition.acquire(snapshot)
      if (enrichment !== undefined) {
        acquired = mergeAcquiredContractFacts(acquired, await enrichment.enrich(snapshot))
      }
    } catch (error) {
      if (error instanceof ContractAcquisitionError) {
        throw wrapContractAcquisition(error, snapshot.fingerprint)
      }
      throw error
    }
    const index = await createContractIndex(
      snapshot.fingerprint,
      acquired.evidence,
      acquired.contracts,
      options.digest,
    )
    return Object.freeze({ snapshot, index })
  }

  async function pluginCheckOutcome(
    snapshot: TargetSnapshot,
    index: ContractIndex,
    subject: AcquiredPluginSubject,
  ): Promise<PluginCheckOutcome> {
    const projection = createPluginSubjectSemanticProjection(subject)
    const subjectFingerprint = projection === undefined
      ? undefined
      : await fingerprintPluginSubject(projection, options.digest)
    const analysis = analyzePluginCompatibility(subject, index)
    const data: PluginCheckResult = {
      contractIndexFingerprint: index.fingerprint,
      ...(subjectFingerprint === undefined ? {} : { subjectFingerprint }),
      subjectCompleteness: subject.completeness,
      ruleset: PLUGIN_STATIC_RULESET,
      scopeComplete: false,
      verdict: analysis.verdict,
      requirements: analysis.requirements.map(requirement => ({
        ...requirement,
        evidenceIds: [...requirement.evidenceIds],
      })),
      evidence: pluginCheckEvidence(
        subject.evidence,
        index,
        analysis.requirements.map(requirement => requirement.evidenceIds),
      ),
      candidateCodeExecuted: false,
    }

    return Object.freeze({
      snapshotFingerprint: snapshot.fingerprint,
      data: Object.freeze(data),
      diagnostics: Object.freeze([...analysis.diagnostics]),
    })
  }

  return Object.freeze({
    describe: () => descriptor,
    resolveTarget,
    async searchContracts(
      request: ContractSearchRequest,
      enrichment?: ContractEnrichmentPort,
    ): Promise<ContractSearchOutcome> {
      const { snapshot, index } = await buildContractIndex(request.target, enrichment)
      const selection = searchContractIndex(
        index,
        request.query,
        request.kinds,
        request.limit ?? 10,
        cachedSearchIndex(index),
      )
      return Object.freeze({
        snapshotFingerprint: snapshot.fingerprint,
        data: Object.freeze({
          contractIndexFingerprint: index.fingerprint,
          matches: [...selection.matches],
          evidence: [...selection.evidence],
        }),
      })
    },
    async inspectContract(
      request: ContractInspectRequest,
      enrichment?: ContractEnrichmentPort,
    ): Promise<ContractInspectOutcome> {
      const { snapshot, index } = await buildContractIndex(request.target, enrichment)
      if (index.fingerprint !== request.contractIndexFingerprint) {
        throw new ContractOperationError(
          'CONTRACT_INDEX_STALE',
          'Requested contract index is stale for the current target evidence.',
          snapshot.fingerprint,
        )
      }
      const selection = inspectContractIndex(index, request.contractId)
      if (selection === undefined) {
        const contractIds = contractIdsForEvidence(index, request.contractId)
        if (index.evidence.some(item => item.id === request.contractId)) {
          throw new ContractOperationError(
            'CONTRACT_NOT_FOUND',
            `The supplied contractId ${request.contractId} is an evidence id, not an inspectable contract id. Copy contractId from contract.search data.matches[].id.`,
            snapshot.fingerprint,
            [],
            {
              repair: Object.freeze({
                action: 'use-contract-search-match-id',
                ...(contractIds.length === 0 ? {} : { contractIds }),
              }),
            },
          )
        }
        throw new ContractOperationError(
          'CONTRACT_NOT_FOUND',
          `Contract ${request.contractId} is not present in the current contract index.`,
          snapshot.fingerprint,
        )
      }
      return Object.freeze({
        snapshotFingerprint: snapshot.fingerprint,
        data: Object.freeze({
          contractIndexFingerprint: index.fingerprint,
          contract: selection.contract,
          evidence: [...selection.evidence],
        }),
      })
    },
    async checkPlugin(request: PluginCheckRequest): Promise<PluginCheckOutcome> {
      if (options.pluginSubjectAcquisition === undefined) {
        throw new Error('Plugin subject acquisition is not configured for this application kernel')
      }

      const { snapshot, index } = await buildContractIndex(request.target)
      const subject = await options.pluginSubjectAcquisition.acquire(request.subject)
      return pluginCheckOutcome(snapshot, index, subject)
    },
    async verifyPlugin(
      request: PluginVerifyApplicationRequest,
      signal?: AbortSignal,
    ): Promise<PluginVerifyOutcome> {
      if (options.pluginSubjectAcquisition === undefined) {
        throw new Error('Plugin subject acquisition is not configured for this application kernel')
      }
      if (options.pluginVerificationExecution === undefined) {
        throw new Error('Plugin verification execution is not configured for this application kernel')
      }

      const { snapshot, index } = await buildContractIndex(request.target)
      const subject = await options.pluginSubjectAcquisition.acquire(request.subject)
      const staticOutcome = await pluginCheckOutcome(snapshot, index, subject)
      const artifact = bindPackedVerificationArtifact(subject)
      const execution = await options.pluginVerificationExecution.verify({
        artifactPath: artifact.path,
        expectedContentHash: artifact.contentHash,
        target: snapshot,
        executionPolicy: request.executionPolicy,
      }, signal)
      const { snapshot: finalSnapshot } = await resolveTarget(request.target)
      const data = reducePluginVerification({
        artifactFingerprint: artifact.fingerprint,
        initialTargetFingerprint: snapshot.fingerprint,
        finalTargetFingerprint: finalSnapshot.fingerprint,
        staticResult: staticOutcome.data,
        staticDiagnostics: staticOutcome.diagnostics,
        execution,
      })

      return Object.freeze({
        snapshotFingerprint: snapshot.fingerprint,
        data,
      })
    },
  })
}
