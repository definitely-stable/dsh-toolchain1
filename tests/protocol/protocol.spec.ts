import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOOLCHAIN_PROTOCOL_VERSION } from '../../src/protocol/index.js'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default

interface ProtocolSchema {
  $defs: {
    responseEnvelope: {
      properties: {
        protocolVersion: {
          const: string
        }
      }
    }
    targetResolveRequest?: unknown
    targetResolveResult?: unknown
    targetResolveResponse?: {
      oneOf?: Array<{ $ref?: string }>
    }
    targetSnapshot?: unknown
    resolvedBundleIdentity?: unknown
    contractFact?: unknown
    contractSearchRequest?: unknown
    contractSearchResult?: {
      properties?: Record<string, unknown>
    }
    contractSearchResponse?: {
      oneOf?: Array<{ $ref?: string }>
    }
    contractInspectRequest?: unknown
    contractInspectResponse?: {
      oneOf?: Array<{ $ref?: string }>
    }
    [key: string]: unknown
  }
  $id: string
}

async function readProtocolSchema(): Promise<ProtocolSchema> {
  const path = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  return JSON.parse(await readFile(path, 'utf8')) as ProtocolSchema
}

async function readGeneratedProtocol(): Promise<string> {
  const path = fileURLToPath(new URL('../../src/protocol/generated.ts', import.meta.url))
  return readFile(path, 'utf8')
}

async function readExample(name: string): Promise<unknown> {
  const path = fileURLToPath(new URL(`../../spec/examples/v1/${name}`, import.meta.url))
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function validators() {
  const schema = await readProtocolSchema()
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(schema)
  const response = ajv.getSchema(`${schema.$id}#/$defs/targetResolveResponse`)
  const request = ajv.getSchema(`${schema.$id}#/$defs/targetResolveRequest`)
  if (!response || !request) throw new Error('Target protocol validators are not resolvable')
  return { ajv, request, response }
}

async function contractValidators() {
  const schema = await readProtocolSchema()
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(schema)
  const fact = ajv.getSchema(`${schema.$id}#/$defs/contractFact`)
  const searchRequest = ajv.getSchema(`${schema.$id}#/$defs/contractSearchRequest`)
  const searchResponse = ajv.getSchema(`${schema.$id}#/$defs/contractSearchResponse`)
  const inspectRequest = ajv.getSchema(`${schema.$id}#/$defs/contractInspectRequest`)
  const inspectResponse = ajv.getSchema(`${schema.$id}#/$defs/contractInspectResponse`)
  if (!fact || !searchRequest || !searchResponse || !inspectRequest || !inspectResponse) {
    throw new Error('Contract protocol validators are not resolvable')
  }
  return { ajv, fact, searchRequest, searchResponse, inspectRequest, inspectResponse }
}

describe('Protocol v1 generated contract', () => {
  it('derives the runtime protocol version from the canonical schema', async () => {
    const schema = await readProtocolSchema()

    expect(TOOLCHAIN_PROTOCOL_VERSION).toBe(
      schema.$defs.responseEnvelope.properties.protocolVersion.const,
    )
  })

  it('defines a closed target.resolve request/result response contract', async () => {
    const schema = await readProtocolSchema()

    expect(schema.$defs.targetResolveRequest).toBeDefined()
    expect(schema.$defs.targetResolveResult).toBeDefined()
    expect(schema.$defs.targetResolveResponse?.oneOf).toEqual([
      { $ref: '#/$defs/targetResolveSuccessResponse' },
      { $ref: '#/$defs/targetResolveFailureResponse' },
    ])
  })

  it('models ordered patch overlays and v2 bundle composition identity in the schema', async () => {
    const schema = await readProtocolSchema()
    const request = schema.$defs.targetResolveRequest as {
      properties?: Record<string, unknown>
    }
    const snapshot = schema.$defs.targetSnapshot as {
      properties?: Record<string, unknown>
    }
    const bundle = schema.$defs.resolvedBundleIdentity as {
      required?: string[]
    }

    expect(request.properties?.patches).toEqual({
      type: 'array',
      items: { type: 'string', minLength: 1 },
    })
    expect(bundle.required).toEqual(['name', 'version', 'patchHash'])
    expect(snapshot.properties?.fingerprint).toEqual({
      type: 'string',
      pattern: '^dsh-target-v2:[0-9a-f]{64}$',
    })
  })

  it('requires a complete success or a diagnostic failure, never a partial success shape', async () => {
    const { ajv, response } = await validators()
    const success = (await readExample('target-resolved.json')) as Record<string, unknown>
    const failure = (await readExample('target-failed.json')) as Record<string, unknown>

    expect(response(success), ajv.errorsText(response.errors)).toBe(true)
    expect(response(failure), ajv.errorsText(response.errors)).toBe(true)
    expect(response({ ...success, data: undefined }), ajv.errorsText(response.errors)).toBe(false)
    expect(response({ ...success, snapshotFingerprint: undefined }), ajv.errorsText(response.errors)).toBe(false)
    expect(response({ ...failure, diagnostics: [] }), ajv.errorsText(response.errors)).toBe(false)
    expect(response({ ...failure, data: success.data }), ajv.errorsText(response.errors)).toBe(false)
  })

  it.each(['.', '..', 'node_modules', '../web', 'nested/web', 'nested\\web'])(
    'rejects unsafe upstream-incompatible profile name %s',
    async profile => {
      const { ajv, request } = await validators()
      expect(request({ profile }), ajv.errorsText(request.errors)).toBe(false)
    },
  )

  it('accepts an ordinary profile with ordered patch acquisition hints', async () => {
    const { ajv, request } = await validators()
    expect(request({
      profile: 'web-dev_2',
      patches: ['/tmp/a.yml', '/tmp/b.yml'],
    }), ajv.errorsText(request.errors)).toBe(true)
  })

  it('generates target.resolve TypeScript types from the schema', async () => {
    const generated = await readGeneratedProtocol()

    expect(generated).toContain('export type TargetResolveRequest =')
    expect(generated).toContain('export type ResolvedBundleIdentity =')
    expect(generated).toContain('readonly "patches"?: Array<string>')
    expect(generated).toContain('export type TargetResolveResult =')
    expect(generated).toContain('export type TargetResolveSuccessResponse =')
    expect(generated).toContain('export type TargetResolveFailureResponse =')
    expect(generated).toContain('export type TargetResolveResponse =')
    expect(generated).toContain(
      'export type TargetResolveResponse = TargetResolveSuccessResponse | TargetResolveFailureResponse',
    )
    expect(generated).toMatch(
      /export type TargetResolveFailureResponse =[\s\S]*readonly "diagnostics": \[Diagnostic, \.\.\.Array<Diagnostic>\]/,
    )
  })

  it('defines closed contract.search and contract.inspect operation contracts', async () => {
    const schema = await readProtocolSchema()

    expect(schema.$defs.contractSearchRequest).toBeDefined()
    expect(schema.$defs.contractInspectRequest).toBeDefined()
    expect(schema.$defs.contractSearchResponse?.oneOf).toEqual([
      { $ref: '#/$defs/contractSearchSuccessResponse' },
      { $ref: '#/$defs/contractSearchFailureResponse' },
      { $ref: '#/$defs/contractSearchStaleResponse' },
    ])
    expect(schema.$defs.contractInspectResponse?.oneOf).toEqual([
      { $ref: '#/$defs/contractInspectSuccessResponse' },
      { $ref: '#/$defs/contractInspectFailureResponse' },
      { $ref: '#/$defs/contractInspectStaleResponse' },
    ])
    expect(schema.$defs.contractSearchResult?.properties?.contractIndexFingerprint).toEqual({
      type: 'string',
      pattern: '^dsh-contract-index-v1:[0-9a-f]{64}$',
    })
  })

  it('requires every normalized contract fact to reference supporting evidence', async () => {
    const { ajv, fact } = await contractValidators()

    expect(fact({
      key: 'version',
      value: '0.1.1-rc.2',
      evidenceIds: ['manifest:dsh'],
    }), ajv.errorsText(fact.errors)).toBe(true)
    expect(fact({
      key: 'unsupported',
      value: 'claim',
      evidenceIds: [],
    }), ajv.errorsText(fact.errors)).toBe(false)
  })

  it('validates bounded search requests and exact-index inspect requests', async () => {
    const { ajv, searchRequest, inspectRequest } = await contractValidators()
    const target = { profile: 'web-dev_2' }

    expect(searchRequest({ target, query: 'ToolDefinition' }), ajv.errorsText(searchRequest.errors)).toBe(true)
    expect(searchRequest({ target, query: '', limit: 10 }), ajv.errorsText(searchRequest.errors)).toBe(false)
    expect(searchRequest({ target, query: 'tool', limit: 0 }), ajv.errorsText(searchRequest.errors)).toBe(false)
    expect(searchRequest({ target, query: 'tool', limit: 26 }), ajv.errorsText(searchRequest.errors)).toBe(false)
    expect(searchRequest({ target, query: 'tool', kinds: ['type'] }), ajv.errorsText(searchRequest.errors)).toBe(false)

    expect(inspectRequest({
      target,
      contractIndexFingerprint: `dsh-contract-index-v1:${'a'.repeat(64)}`,
      contractId: 'package:@deepseek-ai/dsh-tools',
    }), ajv.errorsText(inspectRequest.errors)).toBe(true)
    expect(inspectRequest({ target, contractId: 'package:@deepseek-ai/dsh-tools' }), ajv.errorsText(inspectRequest.errors)).toBe(false)
  })

  it('validates canonical contract success, failure and stale examples', async () => {
    const { ajv, searchResponse, inspectResponse } = await contractValidators()
    const searchSuccess = await readExample('contract-search-resolved.json')
    const searchFailure = await readExample('contract-search-failed.json')
    const searchStale = await readExample('contract-search-stale.json')
    const inspectSuccess = await readExample('contract-inspect-resolved.json')
    const inspectFailure = await readExample('contract-inspect-failed.json')
    const inspectStale = await readExample('contract-inspect-stale.json')

    expect(searchResponse(searchSuccess), ajv.errorsText(searchResponse.errors)).toBe(true)
    expect(searchResponse(searchFailure), ajv.errorsText(searchResponse.errors)).toBe(true)
    expect(searchResponse(searchStale), ajv.errorsText(searchResponse.errors)).toBe(true)
    expect(inspectResponse(inspectSuccess), ajv.errorsText(inspectResponse.errors)).toBe(true)
    expect(inspectResponse(inspectFailure), ajv.errorsText(inspectResponse.errors)).toBe(true)
    expect(inspectResponse(inspectStale), ajv.errorsText(inspectResponse.errors)).toBe(true)

    expect(inspectResponse({
      ...(inspectStale as Record<string, unknown>),
      data: (inspectSuccess as Record<string, unknown>).data,
    }), ajv.errorsText(inspectResponse.errors)).toBe(false)
  })

  it('generates Contract Intelligence TypeScript types from the schema', async () => {
    const generated = await readGeneratedProtocol()

    for (const typeName of [
      'ContractFact',
      'ContractReference',
      'ContractDefinition',
      'ContractSearchRequest',
      'ContractSearchResult',
      'ContractSearchResponse',
      'ContractInspectRequest',
      'ContractInspectResult',
      'ContractInspectResponse',
    ]) {
      expect(generated).toContain(`export type ${typeName} =`)
    }
  })
})
