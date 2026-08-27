import type { Sha256Port } from '../../model/digest.js'
import {
  ContractAcquisitionError,
  mergeAcquiredContractFacts,
  type AcquiredContractFacts,
  type ContractEnrichmentPort,
} from '../../model/contract.js'
import type { ContractDefinition, ContractFact, Evidence } from '../../protocol/index.js'
import type { DshContractToolExecutionContext } from './contract-tool.js'

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
  readonly maxMethodsPerRelevantProvider: number
  readonly maxProviderResultBytes: number
  readonly maxJsonDepth: number
  readonly maxJsonNodes: number
  readonly maxContracts: number
  readonly maxFactsPerContract: number
  readonly maxFactsTotal: number
  readonly maxToolSchemaBytesPerTool: number
  readonly maxToolSchemaBytesTotal: number
}

export interface DshLiveContractEnrichmentOptions {
  readonly registry: DshCordisInspectRegistryPort
  readonly execution: DshContractToolExecutionContext
  readonly digest: Sha256Port
  readonly limits?: Partial<DshLiveContractLimits>
}

const DEFAULT_LIVE_CONTRACT_LIMITS: DshLiveContractLimits = Object.freeze({
  maxProviderEntries: 256,
  maxMethodsPerRelevantProvider: 256,
  maxProviderResultBytes: 4 * 1024 * 1024,
  maxJsonDepth: 64,
  maxJsonNodes: 100_000,
  maxContracts: 4096,
  maxFactsPerContract: 512,
  maxFactsTotal: 32_768,
  maxToolSchemaBytesPerTool: 512 * 1024,
  maxToolSchemaBytesTotal: 3 * 1024 * 1024,
})

interface ServiceCatalogRow {
  readonly key: string
  readonly description?: string
  readonly signatures: readonly string[]
}

interface EventCatalogRow {
  readonly name: string
  readonly description?: string
  readonly mode: string
  readonly signature: string
}

interface ToolCatalogRow {
  readonly name: string
  readonly description: string
  readonly parametersSchema: string
}

interface InspectProviderPlan {
  readonly platform: 'host'
  readonly id: string
  readonly method: string
  normalize(
    value: unknown,
    digest: Sha256Port,
    limits: DshLiveContractLimits,
  ): Promise<AcquiredContractFacts>
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function invalidLiveEvidence(message: string, options?: ErrorOptions): ContractAcquisitionError {
  return new ContractAcquisitionError('CONTRACT_LIVE_EVIDENCE_INVALID', message, [], options)
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

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
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
    throw invalidLiveEvidence('Cordis Inspect provider result is not JSON-serializable.', { cause: error })
  }

  const bytes = utf8Bytes(serialized)
  if (bytes > limits.maxProviderResultBytes) {
    throw liveLimitExceeded(
      `Cordis Inspect provider result exceeds ${limits.maxProviderResultBytes} serialized bytes.`,
    )
  }
}

/**
 * Canonical JSON for observed schemas. Object key order is non-semantic here;
 * array order remains part of the observed representation unless a later
 * keyword-specific rule proves a particular array is set-like.
 */
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  const object = objectValue(value)
  if (object === undefined) return value
  return Object.fromEntries(
    Object.keys(object)
      .toSorted(compareCodePoints)
      .map(key => [key, canonicalizeJson(object[key])]),
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

function providerSupportsPlan(
  value: unknown,
  plan: InspectProviderPlan,
  limits: DshLiveContractLimits,
): boolean {
  const object = objectValue(value)
  if (object === undefined || object.platform !== plan.platform || object.id !== plan.id) return false
  const methods = object.methods
  if (!Array.isArray(methods)) return false
  if (methods.length > limits.maxMethodsPerRelevantProvider) {
    throw liveLimitExceeded(
      `Cordis Inspect ${plan.platform}/${plan.id} provider exceeds ${limits.maxMethodsPerRelevantProvider} advertised methods.`,
    )
  }
  return methods.some((method) => {
    const candidate = objectValue(method)
    return candidate !== undefined && candidate.name === plan.method
  })
}

function enforceNormalizedLimits(
  acquired: AcquiredContractFacts,
  limits: DshLiveContractLimits,
): void {
  if (acquired.contracts.length > limits.maxContracts) {
    throw liveLimitExceeded(
      `Live Inspect exceeds ${limits.maxContracts} normalized contracts in total.`,
    )
  }

  let totalFacts = 0
  for (const contract of acquired.contracts) {
    if (contract.facts.length > limits.maxFactsPerContract) {
      throw liveLimitExceeded(
        `Live contract ${contract.id} exceeds ${limits.maxFactsPerContract} normalized facts.`,
      )
    }
    totalFacts += contract.facts.length
    if (totalFacts > limits.maxFactsTotal) {
      throw liveLimitExceeded(
        `Live Inspect exceeds ${limits.maxFactsTotal} normalized facts in total.`,
      )
    }
  }
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
    }).toSorted(compareCodePoints)
    return {
      key: service.key,
      ...(typeof service.description === 'string' ? { description: service.description } : {}),
      signatures,
    }
  })
  return Object.freeze(rows.toSorted((left, right) => compareCodePoints(left.key, right.key)))
}

function eventCatalog(
  value: unknown,
  limits: DshLiveContractLimits,
): readonly EventCatalogRow[] {
  const root = objectValue(value)
  if (root?.mode !== 'catalog' || !Array.isArray(root.events)) {
    throw invalidLiveEvidence('Host Event Inspect returned an invalid compact catalog.')
  }
  if (root.events.length > limits.maxContracts) {
    throw liveLimitExceeded(
      `Host Event Inspect exceeds ${limits.maxContracts} normalized contracts.`,
    )
  }

  return Object.freeze(root.events.map((entry): EventCatalogRow => {
    const event = objectValue(entry)
    if (
      event === undefined
      || typeof event.name !== 'string'
      || typeof event.mode !== 'string'
      || typeof event.signature !== 'string'
    ) {
      throw invalidLiveEvidence('Host Event Inspect returned an invalid event row.')
    }
    return {
      name: event.name,
      ...(typeof event.description === 'string' ? { description: event.description } : {}),
      mode: event.mode,
      signature: event.signature,
    }
  }).toSorted((left, right) => compareCodePoints(left.name, right.name)))
}

function toolCatalog(
  value: unknown,
  limits: DshLiveContractLimits,
): readonly ToolCatalogRow[] {
  const root = objectValue(value)
  if (!Array.isArray(root?.tools)) {
    throw invalidLiveEvidence('Host Tool Inspect returned an invalid Agent-scoped Tool catalog.')
  }
  if (root.tools.length > limits.maxContracts) {
    throw liveLimitExceeded(
      `Host Tool Inspect exceeds ${limits.maxContracts} normalized contracts.`,
    )
  }

  let totalSchemaBytes = 0
  const rows = root.tools.map((entry): ToolCatalogRow => {
    const tool = objectValue(entry)
    const parameters = tool === undefined ? undefined : objectValue(tool.parameters)
    if (
      tool === undefined
      || typeof tool.name !== 'string'
      || typeof tool.description !== 'string'
      || parameters === undefined
    ) {
      throw invalidLiveEvidence('Host Tool Inspect returned an invalid Tool schema row.')
    }

    const parametersSchema = canonicalJson(parameters)
    const schemaBytes = utf8Bytes(parametersSchema)
    if (schemaBytes > limits.maxToolSchemaBytesPerTool) {
      throw liveLimitExceeded(
        `Host Tool ${tool.name} parameter schema exceeds ${limits.maxToolSchemaBytesPerTool} bytes.`,
      )
    }
    totalSchemaBytes += schemaBytes
    if (totalSchemaBytes > limits.maxToolSchemaBytesTotal) {
      throw liveLimitExceeded(
        `Host Tool parameter schemas exceed ${limits.maxToolSchemaBytesTotal} bytes in total.`,
      )
    }

    return {
      name: tool.name,
      description: tool.description,
      parametersSchema,
    }
  })
  return Object.freeze(rows.toSorted((left, right) => compareCodePoints(left.name, right.name)))
}

function serviceQualifiedName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `ctx.${key}` : `ctx[${JSON.stringify(key)}]`
}

function catalogEvidence(
  providerId: 'Service' | 'Event',
  methodName: string,
  contentHash: string,
): Evidence {
  return Object.freeze({
    id: `generated-catalog:cordis-inspect:host:${providerId}:${methodName}`,
    kind: 'generated-catalog',
    strength: 'authoritative',
    source: `cordis-inspect:host/${providerId}/${methodName}`,
    contentHash,
  })
}

function runtimeEvidence(
  providerId: string,
  methodName: string,
  contentHash: string,
): Evidence {
  return Object.freeze({
    id: `runtime:cordis-inspect:host:${providerId}:${methodName}`,
    kind: 'runtime',
    strength: 'observed',
    source: `cordis-inspect:host/${providerId}/${methodName}`,
    contentHash,
  })
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
  const evidence = catalogEvidence('Service', 'listService', contentHash)
  const evidenceId = evidence.id
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
      availability: 'unknown',
      ...(row.description === undefined ? {} : { summary: row.description }),
      facts,
      evidenceIds: [evidenceId],
    }
  })
  return Object.freeze({ evidence: Object.freeze([evidence]), contracts: Object.freeze(contracts) })
}

async function normalizeEvents(
  value: unknown,
  digest: Sha256Port,
  limits: DshLiveContractLimits,
): Promise<AcquiredContractFacts> {
  validateJsonValue(value, limits)
  const rows = eventCatalog(value, limits)
  const canonical = JSON.stringify(rows.map(row => ({
    name: row.name,
    ...(row.description === undefined ? {} : { description: row.description }),
    mode: row.mode,
    signature: row.signature,
  })))
  const contentHash = await digest.sha256Utf8(canonical)
  const evidence = catalogEvidence('Event', 'listEvents', contentHash)
  const evidenceId = evidence.id
  const contracts = rows.map((row): ContractDefinition => ({
    id: `event:host:${row.name}`,
    kind: 'event',
    name: row.name,
    qualifiedName: `event:${row.name}`,
    availability: 'unknown',
    ...(row.description === undefined ? {} : { summary: row.description }),
    facts: [
      { key: 'dispatch-mode', value: row.mode, evidenceIds: [evidenceId] },
      { key: 'listener-signature', value: row.signature, evidenceIds: [evidenceId] },
    ],
    evidenceIds: [evidenceId],
  }))
  return Object.freeze({ evidence: Object.freeze([evidence]), contracts: Object.freeze(contracts) })
}

async function normalizeTools(
  value: unknown,
  digest: Sha256Port,
  limits: DshLiveContractLimits,
): Promise<AcquiredContractFacts> {
  validateJsonValue(value, limits)
  const rows = toolCatalog(value, limits)
  const canonical = JSON.stringify(rows.map(row => ({
    name: row.name,
    description: row.description,
    parametersSchema: row.parametersSchema,
  })))
  const contentHash = await digest.sha256Utf8(canonical)
  const evidence = runtimeEvidence('Tool', 'listTools', contentHash)
  const evidenceId = evidence.id
  const contracts = rows.map((row): ContractDefinition => ({
    id: `tool:host:${row.name}`,
    kind: 'tool',
    name: row.name,
    qualifiedName: `tool:${row.name}`,
    availability: 'available',
    summary: row.description,
    facts: [{
      key: 'parameters-schema',
      value: row.parametersSchema,
      evidenceIds: [evidenceId],
    }],
    evidenceIds: [evidenceId],
  }))
  return Object.freeze({ evidence: Object.freeze([evidence]), contracts: Object.freeze(contracts) })
}

const PROVIDER_PLAN: readonly InspectProviderPlan[] = Object.freeze([
  Object.freeze({ platform: 'host', id: 'Service', method: 'listService', normalize: normalizeServices }),
  Object.freeze({ platform: 'host', id: 'Event', method: 'listEvents', normalize: normalizeEvents }),
  Object.freeze({ platform: 'host', id: 'Tool', method: 'listTools', normalize: normalizeTools }),
])

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : objectValue(error)?.name === 'AbortError'
}

async function queryProvider(
  options: DshLiveContractEnrichmentOptions,
  plan: InspectProviderPlan,
  agent: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await options.registry.query(
      plan.platform,
      plan.id,
      plan.method,
      {},
      agent,
      signal,
    )
  } catch (error) {
    if (error instanceof ContractAcquisitionError || isAbortError(error, signal)) throw error
    throw invalidLiveEvidence(
      `Cordis Inspect ${plan.platform}/${plan.id}/${plan.method} query failed: ${String(error)}`,
      { cause: error },
    )
  }
}

/**
 * Build one invocation-scoped enrichment port. Missing Agent/signal means the
 * native operation intentionally falls back to the exact M2.1 offline path.
 *
 * M2.2 intentionally indexes Host providers only. Client provider manifests
 * are page-mirrored and do not yet expose deterministic page identity/lifetime
 * semantics suitable for a content-addressed Contract Index.
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

      let acquired: AcquiredContractFacts = Object.freeze({
        evidence: Object.freeze([]),
        contracts: Object.freeze([]),
      })
      for (const plan of PROVIDER_PLAN) {
        const provider = listed.find(candidate => providerSupportsPlan(candidate, plan, limits))
        if (provider === undefined) continue

        const value = await queryProvider(options, plan, agent, signal)
        const next = await plan.normalize(value, options.digest, limits)
        acquired = mergeAcquiredContractFacts(acquired, next)
        enforceNormalizedLimits(acquired, limits)
      }
      return acquired
    },
  })
}
