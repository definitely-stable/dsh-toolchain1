import type { Sha256Port } from '../../model/digest.js'
import {
  ContractAcquisitionError,
  type AcquiredContractFacts,
  type ContractEnrichmentPort,
} from '../../model/contract.js'
import type { ContractDefinition, ContractFact, Evidence } from '../../protocol/index.js'
import type { DshContractToolExecutionContext } from './contract-tool.js'

interface InspectMethodView {
  readonly name: string
}

interface InspectProviderView {
  readonly platform: 'host' | 'client'
  readonly id: string
  readonly methods: readonly InspectMethodView[]
}

export interface DshCordisInspectRegistryPort {
  list(): readonly unknown[]
  query(
    platform: 'host' | 'client',
    providerId: string,
    methodName: string,
    input: unknown,
    agent: unknown,
    signal: AbortSignal,
  ): Promise<unknown>
}

export interface DshLiveContractLimits {
  readonly maxProviderEntries: number
  readonly maxProviderResultBytes: number
  readonly maxJsonDepth: number
  readonly maxJsonNodes: number
  readonly maxContracts: number
  readonly maxFactsPerContract: number
  readonly maxFactsTotal: number
}

export interface DshLiveContractEnrichmentOptions {
  readonly registry: DshCordisInspectRegistryPort
  readonly execution: DshContractToolExecutionContext
  readonly digest: Sha256Port
  readonly limits?: Partial<DshLiveContractLimits>
}

const DEFAULT_LIVE_CONTRACT_LIMITS: DshLiveContractLimits = Object.freeze({
  maxProviderEntries: 256,
  maxProviderResultBytes: 4 * 1024 * 1024,
  maxJsonDepth: 64,
  maxJsonNodes: 100_000,
  maxContracts: 4096,
  maxFactsPerContract: 512,
  maxFactsTotal: 32_768,
})

interface ServiceCatalogRow {
  readonly key: string
  readonly description?: string
  readonly signatures: readonly string[]
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function invalidLiveEvidence(message: string): ContractAcquisitionError {
  return new ContractAcquisitionError('CONTRACT_LIVE_EVIDENCE_INVALID', message)
}

function liveLimitExceeded(message: string): ContractAcquisitionError {
  return new ContractAcquisitionError('CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED', message)
}

function resolveLimits(overrides: Partial<DshLiveContractLimits> | undefined): DshLiveContractLimits {
  const resolved = { ...DEFAULT_LIVE_CONTRACT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`DSH live Contract limit ${name} must be a positive safe integer.`)
    }
  }
  return Object.freeze(resolved)
}

function validateJsonValue(
  value: unknown,
  limits: DshLiveContractLimits,
): void {
  let nodes = 0
  const active = new WeakSet<object>()

  function visit(current: unknown, depth: number): void {
    nodes += 1
    if (nodes > limits.maxJsonNodes) {
      throw liveLimitExceeded(
        `Cordis Inspect provider result exceeds ${limits.maxJsonNodes} JSON nodes.`,
      )
    }
    if (depth > limits.maxJsonDepth) {
      throw liveLimitExceeded(
        `Cordis Inspect provider result exceeds JSON depth ${limits.maxJsonDepth}.`,
      )
    }

    if (
      current === null
      || typeof current === 'string'
      || typeof current === 'boolean'
      || (typeof current === 'number' && Number.isFinite(current))
    ) {
      return
    }
    if (typeof current !== 'object') {
      throw invalidLiveEvidence('Cordis Inspect provider result is not JSON-compatible.')
    }
    if (active.has(current)) {
      throw invalidLiveEvidence('Cordis Inspect provider result contains a cyclic value.')
    }

    active.add(current)
    try {
      if (Array.isArray(current)) {
        for (const child of current) visit(child, depth + 1)
      } else {
        for (const child of Object.values(current)) visit(child, depth + 1)
      }
    } finally {
      active.delete(current)
    }
  }

  visit(value, 1)

  let serialized: string
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) {
      throw invalidLiveEvidence('Cordis Inspect provider result is not JSON-serializable.')
    }
    serialized = encoded
  } catch (error) {
    if (error instanceof ContractAcquisitionError) throw error
    throw invalidLiveEvidence('Cordis Inspect provider result is not JSON-serializable.')
  }

  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes > limits.maxProviderResultBytes) {
    throw liveLimitExceeded(
      `Cordis Inspect provider result exceeds ${limits.maxProviderResultBytes} serialized bytes.`,
    )
  }
}

function providerView(value: unknown): InspectProviderView | undefined {
  const object = objectValue(value)
  if (object === undefined) return undefined
  if (object.platform !== 'host' && object.platform !== 'client') return undefined
  if (typeof object.id !== 'string' || !Array.isArray(object.methods)) return undefined
  const methods = object.methods.flatMap(method => {
    const candidate = objectValue(method)
    return candidate !== undefined && typeof candidate.name === 'string'
      ? [{ name: candidate.name }]
      : []
  })
  return { platform: object.platform, id: object.id, methods }
}

function serviceCatalog(
  value: unknown,
  limits: DshLiveContractLimits,
): readonly ServiceCatalogRow[] {
  const root = objectValue(value)
  if (root?.mode !== 'catalog' || !Array.isArray(root.services)) {
    throw invalidLiveEvidence('Host Service Inspect returned an invalid compact catalog.')
  }
  if (root.services.length > limits.maxContracts) {
    throw liveLimitExceeded(
      `Host Service Inspect exceeds ${limits.maxContracts} normalized contracts.`,
    )
  }

  let totalFacts = 0
  const rows = root.services.map((entry): ServiceCatalogRow => {
    const service = objectValue(entry)
    if (service === undefined || typeof service.key !== 'string' || !Array.isArray(service.methods)) {
      throw invalidLiveEvidence('Host Service Inspect returned an invalid service row.')
    }
    if (service.methods.length > limits.maxFactsPerContract) {
      throw liveLimitExceeded(
        `Host Service ${service.key} exceeds ${limits.maxFactsPerContract} normalized facts.`,
      )
    }
    totalFacts += service.methods.length
    if (totalFacts > limits.maxFactsTotal) {
      throw liveLimitExceeded(
        `Host Service Inspect exceeds ${limits.maxFactsTotal} normalized facts in total.`,
      )
    }

    const signatures = service.methods.map(method => {
      const methodRow = objectValue(method)
      if (methodRow === undefined || typeof methodRow.signature !== 'string') {
        throw invalidLiveEvidence(`Host Service Inspect returned an invalid method row for ${service.key}.`)
      }
      return methodRow.signature
    }).toSorted()
    return {
      key: service.key,
      ...(typeof service.description === 'string' ? { description: service.description } : {}),
      signatures,
    }
  })
  return Object.freeze(rows.toSorted((left, right) => left.key.localeCompare(right.key, 'en-US')))
}

function serviceQualifiedName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `ctx.${key}` : `ctx[${JSON.stringify(key)}]`
}

async function normalizeServices(
  value: unknown,
  digest: Sha256Port,
  limits: DshLiveContractLimits,
): Promise<AcquiredContractFacts> {
  validateJsonValue(value, limits)
  const rows = serviceCatalog(value, limits)
  const canonical = JSON.stringify(rows.map(row => ({
    key: row.key,
    ...(row.description === undefined ? {} : { description: row.description }),
    signatures: [...row.signatures],
  })))
  const contentHash = await digest.sha256Utf8(canonical)
  const evidenceId = 'runtime:cordis-inspect:host:Service:listService'
  const evidence: Evidence = Object.freeze({
    id: evidenceId,
    kind: 'runtime',
    strength: 'observed',
    source: 'cordis-inspect:host/Service/listService',
    contentHash,
  })
  const contracts = rows.map((row): ContractDefinition => {
    const facts: ContractFact[] = row.signatures.map(signature => ({
      key: 'method-signature',
      value: signature,
      evidenceIds: [evidenceId],
    }))
    return {
      id: `service:host:${row.key}`,
      kind: 'service',
      name: row.key,
      qualifiedName: serviceQualifiedName(row.key),
      availability: 'available',
      ...(row.description === undefined ? {} : { summary: row.description }),
      facts,
      evidenceIds: [evidenceId],
    }
  })
  return Object.freeze({ evidence: Object.freeze([evidence]), contracts: Object.freeze(contracts) })
}

function supportsServiceCatalog(provider: InspectProviderView): boolean {
  return provider.platform === 'host'
    && provider.id === 'Service'
    && provider.methods.some(method => method.name === 'listService')
}

/**
 * Build one invocation-scoped enrichment port. Missing Agent/signal means the
 * native operation intentionally falls back to the exact M2.1 offline path.
 */
export function createDshLiveContractEnrichment(
  options: DshLiveContractEnrichmentOptions,
): ContractEnrichmentPort | undefined {
  const { agent, signal } = options.execution
  if (agent === undefined || signal === undefined) return undefined
  const limits = resolveLimits(options.limits)

  return Object.freeze({
    async enrich(): Promise<AcquiredContractFacts> {
      const listed = options.registry.list()
      if (!Array.isArray(listed)) {
        throw invalidLiveEvidence('Cordis Inspect provider directory is not an array.')
      }
      if (listed.length > limits.maxProviderEntries) {
        throw liveLimitExceeded(
          `Cordis Inspect provider directory exceeds ${limits.maxProviderEntries} entries.`,
        )
      }
      const providers = listed
        .map(providerView)
        .filter((value): value is InspectProviderView => value !== undefined)
      const service = providers.find(supportsServiceCatalog)
      if (service === undefined) {
        return Object.freeze({ evidence: Object.freeze([]), contracts: Object.freeze([]) })
      }
      const value = await options.registry.query(
        'host',
        'Service',
        'listService',
        {},
        agent,
        signal,
      )
      return normalizeServices(value, options.digest, limits)
    },
  })
}
