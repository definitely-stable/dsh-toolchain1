import type { Sha256Port } from '../../model/digest.js'
import {
  ContractAcquisitionError,
  mergeAcquiredContractFacts,
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

interface ClientSlotCatalogRow {
  readonly name: string
  readonly kind: string
  readonly scope: string
  readonly parent?: string
  readonly purpose?: string
  readonly replaceRisk?: string
  readonly registration: readonly string[]
  readonly keyDomain?: string
  readonly allowedKeys: readonly string[]
}

interface InspectProviderPlan {
  readonly platform: 'host' | 'client'
  readonly id: string
  readonly method: string
  normalize(
    value: unknown,
    digest: Sha256Port,
    limits: DshLiveContractLimits,
  ): Promise<AcquiredContractFacts>
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
    throw invalidLiveEvidence('Cordis Inspect provider result is not JSON-serializable.')
  }

  const bytes = utf8Bytes(serialized)
  if (bytes > limits.maxProviderResultBytes) {
    throw liveLimitExceeded(
      `Cordis Inspect provider result exceeds ${limits.maxProviderResultBytes} serialized bytes.`,
    )
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  const object = objectValue(value)
  if (object === undefined) return value
  return Object.fromEntries(
    Object.keys(object)
      .toSorted()
      .map(key => [key, canonicalizeJson(object[key])]),
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
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

function supportsMethod(provider: InspectProviderView, plan: InspectProviderPlan): boolean {
  return provider.platform === plan.platform
    && provider.id === plan.id
    && provider.methods.some(candidate => candidate.name === plan.method)
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
    }).toSorted()
    return {
      key: service.key,
      ...(typeof service.description === 'string' ? { description: service.description } : {}),
      signatures,
    }
  })
  return Object.freeze(rows.toSorted((left, right) => left.key.localeCompare(right.key, 'en-US')))
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
  }).toSorted((left, right) => left.name.localeCompare(right.name, 'en-US')))
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
  return Object.freeze(rows.toSorted((left, right) => left.name.localeCompare(right.name, 'en-US')))
}

function optionalString(
  object: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalidLiveEvidence(`${label} must be a string when present.`)
  return value
}

function slotRegistration(value: unknown, slotName: string): readonly string[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) {
    throw invalidLiveEvidence(`Client Slot ${slotName} registration metadata is not an array.`)
  }
  const rows = value.map((entry) => {
    const option = objectValue(entry)
    if (
      option === undefined
      || typeof option.name !== 'string'
      || typeof option.type !== 'string'
      || typeof option.required !== 'boolean'
    ) {
      throw invalidLiveEvidence(`Client Slot ${slotName} has invalid registration metadata.`)
    }
    return canonicalJson({ name: option.name, type: option.type, required: option.required })
  }).toSorted()
  return Object.freeze(rows)
}

function slotAllowedKeys(value: unknown, slotName: string): readonly string[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) {
    throw invalidLiveEvidence(`Client Slot ${slotName} allowedKeys metadata is not an array.`)
  }
  const rows = value.map((entry) => {
    const allowed = objectValue(entry)
    if (allowed === undefined || typeof allowed.value !== 'string') {
      throw invalidLiveEvidence(`Client Slot ${slotName} has invalid allowedKeys metadata.`)
    }
    const description = optionalString(allowed, 'description', `Client Slot ${slotName} allowed-key description`)
    return canonicalJson({
      value: allowed.value,
      ...(description === undefined ? {} : { description }),
    })
  }).toSorted()
  return Object.freeze(rows)
}

function clientSlotCatalog(
  value: unknown,
  limits: DshLiveContractLimits,
): readonly ClientSlotCatalogRow[] {
  const root = objectValue(value)
  if (!Array.isArray(root?.trees)) {
    throw invalidLiveEvidence('Client Slots Inspect returned an invalid compact tree response.')
  }

  const rows: ClientSlotCatalogRow[] = []
  const seen = new Set<string>()
  const pending: Array<{ readonly value: unknown; readonly parent?: string }> = root.trees.map(entry => ({ value: entry }))

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    const slot = objectValue(current.value)
    if (
      slot === undefined
      || typeof slot.name !== 'string'
      || typeof slot.kind !== 'string'
      || typeof slot.scope !== 'string'
      || !Array.isArray(slot.children)
    ) {
      throw invalidLiveEvidence('Client Slots Inspect returned an invalid compact Slot node.')
    }
    if (seen.has(slot.name)) {
      throw invalidLiveEvidence(`Client Slots Inspect repeats Slot ${slot.name}.`)
    }
    seen.add(slot.name)
    if (seen.size > limits.maxContracts) {
      throw liveLimitExceeded(
        `Client Slots Inspect exceeds ${limits.maxContracts} normalized contracts.`,
      )
    }

    const purpose = optionalString(slot, 'purpose', `Client Slot ${slot.name} purpose`)
    const replaceRisk = optionalString(slot, 'replaceRisk', `Client Slot ${slot.name} replaceRisk`)
    const keyDomain = optionalString(slot, 'keyDomain', `Client Slot ${slot.name} keyDomain`)
    const registration = slotRegistration(slot.registration, slot.name)
    const allowedKeys = slotAllowedKeys(slot.allowedKeys, slot.name)
    rows.push({
      name: slot.name,
      kind: slot.kind,
      scope: slot.scope,
      ...(current.parent === undefined ? {} : { parent: current.parent }),
      ...(purpose === undefined ? {} : { purpose }),
      ...(replaceRisk === undefined ? {} : { replaceRisk }),
      registration,
      ...(keyDomain === undefined ? {} : { keyDomain }),
      allowedKeys,
    })

    for (const child of slot.children) pending.push({ value: child, parent: slot.name })
  }

  return Object.freeze(rows.toSorted((left, right) => left.name.localeCompare(right.name, 'en-US')))
}

function serviceQualifiedName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `ctx.${key}` : `ctx[${JSON.stringify(key)}]`
}

function runtimeEvidence(
  platform: 'host' | 'client',
  providerId: string,
  methodName: string,
  contentHash: string,
): Evidence {
  return Object.freeze({
    id: `runtime:cordis-inspect:${platform}:${providerId}:${methodName}`,
    kind: 'runtime',
    strength: 'observed',
    source: `cordis-inspect:${platform}/${providerId}/${methodName}`,
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
  const evidence = runtimeEvidence('host', 'Service', 'listService', contentHash)
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
      availability: 'available',
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
  const evidence = runtimeEvidence('host', 'Event', 'listEvents', contentHash)
  const evidenceId = evidence.id
  const contracts = rows.map((row): ContractDefinition => ({
    id: `event:host:${row.name}`,
    kind: 'event',
    name: row.name,
    qualifiedName: `event:${row.name}`,
    availability: 'available',
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
  const evidence = runtimeEvidence('host', 'Tool', 'listTools', contentHash)
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

async function normalizeClientSlots(
  value: unknown,
  digest: Sha256Port,
  limits: DshLiveContractLimits,
): Promise<AcquiredContractFacts> {
  validateJsonValue(value, limits)
  const rows = clientSlotCatalog(value, limits)
  const canonical = JSON.stringify(rows.map(row => ({
    name: row.name,
    kind: row.kind,
    scope: row.scope,
    ...(row.parent === undefined ? {} : { parent: row.parent }),
    ...(row.purpose === undefined ? {} : { purpose: row.purpose }),
    ...(row.replaceRisk === undefined ? {} : { replaceRisk: row.replaceRisk }),
    registration: [...row.registration],
    ...(row.keyDomain === undefined ? {} : { keyDomain: row.keyDomain }),
    allowedKeys: [...row.allowedKeys],
  })))
  const contentHash = await digest.sha256Utf8(canonical)
  const evidence = runtimeEvidence('client', 'Slots', 'listSubTree', contentHash)
  const evidenceId = evidence.id
  const contracts = rows.map((row): ContractDefinition => {
    const facts: ContractFact[] = [
      { key: 'slot-kind', value: row.kind, evidenceIds: [evidenceId] },
      { key: 'slot-scope', value: row.scope, evidenceIds: [evidenceId] },
    ]
    if (row.parent !== undefined) {
      facts.push({ key: 'parent-slot', value: row.parent, evidenceIds: [evidenceId] })
    }
    if (row.replaceRisk !== undefined) {
      facts.push({ key: 'replace-risk', value: row.replaceRisk, evidenceIds: [evidenceId] })
    }
    for (const option of row.registration) {
      facts.push({ key: 'registration-option', value: option, evidenceIds: [evidenceId] })
    }
    if (row.keyDomain !== undefined) {
      facts.push({ key: 'key-domain', value: row.keyDomain, evidenceIds: [evidenceId] })
    }
    for (const allowedKey of row.allowedKeys) {
      facts.push({ key: 'allowed-key', value: allowedKey, evidenceIds: [evidenceId] })
    }
    return {
      id: `client-slot:client:${row.name}`,
      kind: 'client-slot',
      name: row.name,
      qualifiedName: `slot:${row.name}`,
      availability: 'available',
      ...(row.purpose === undefined ? {} : { summary: row.purpose }),
      facts,
      evidenceIds: [evidenceId],
    }
  })
  return Object.freeze({ evidence: Object.freeze([evidence]), contracts: Object.freeze(contracts) })
}

const PROVIDER_PLAN: readonly InspectProviderPlan[] = Object.freeze([
  Object.freeze({ platform: 'host', id: 'Service', method: 'listService', normalize: normalizeServices }),
  Object.freeze({ platform: 'host', id: 'Event', method: 'listEvents', normalize: normalizeEvents }),
  Object.freeze({ platform: 'host', id: 'Tool', method: 'listTools', normalize: normalizeTools }),
  Object.freeze({ platform: 'client', id: 'Slots', method: 'listSubTree', normalize: normalizeClientSlots }),
])

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

      let acquired: AcquiredContractFacts = Object.freeze({
        evidence: Object.freeze([]),
        contracts: Object.freeze([]),
      })
      for (const plan of PROVIDER_PLAN) {
        const provider = providers.find(candidate => supportsMethod(candidate, plan))
        if (provider === undefined) continue

        const value = await options.registry.query(
          plan.platform,
          plan.id,
          plan.method,
          {},
          agent,
          signal,
        )
        const next = await plan.normalize(value, options.digest, limits)
        acquired = mergeAcquiredContractFacts(acquired, next)
        enforceNormalizedLimits(acquired, limits)
      }
      return acquired
    },
  })
}
