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

export interface DshLiveContractEnrichmentOptions {
  readonly registry: DshCordisInspectRegistryPort
  readonly execution: DshContractToolExecutionContext
  readonly digest: Sha256Port
}

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

function serviceCatalog(value: unknown): readonly ServiceCatalogRow[] {
  const root = objectValue(value)
  if (root?.mode !== 'catalog' || !Array.isArray(root.services)) {
    throw new ContractAcquisitionError(
      'CONTRACT_LIVE_EVIDENCE_INVALID',
      'Host Service Inspect returned an invalid compact catalog.',
    )
  }
  const rows = root.services.map((entry): ServiceCatalogRow => {
    const service = objectValue(entry)
    if (service === undefined || typeof service.key !== 'string' || !Array.isArray(service.methods)) {
      throw new ContractAcquisitionError(
        'CONTRACT_LIVE_EVIDENCE_INVALID',
        'Host Service Inspect returned an invalid service row.',
      )
    }
    const signatures = service.methods.map(method => {
      const value = objectValue(method)
      if (value === undefined || typeof value.signature !== 'string') {
        throw new ContractAcquisitionError(
          'CONTRACT_LIVE_EVIDENCE_INVALID',
          `Host Service Inspect returned an invalid method row for ${service.key}.`,
        )
      }
      return value.signature
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
): Promise<AcquiredContractFacts> {
  const rows = serviceCatalog(value)
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

  return Object.freeze({
    async enrich(): Promise<AcquiredContractFacts> {
      const listed = options.registry.list()
      if (!Array.isArray(listed)) {
        throw new ContractAcquisitionError(
          'CONTRACT_LIVE_EVIDENCE_INVALID',
          'Cordis Inspect provider directory is not an array.',
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
      return normalizeServices(value, options.digest)
    },
  })
}
