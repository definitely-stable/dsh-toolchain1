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
})
