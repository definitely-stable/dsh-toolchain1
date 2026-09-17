import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const protocol = await import('../../src/protocol/index.js') as Record<string, unknown>

interface ProtocolSchema {
  $defs: Record<string, unknown>
}

async function schema(): Promise<ProtocolSchema> {
  const path = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  return JSON.parse(await readFile(path, 'utf8')) as ProtocolSchema
}

async function generated(): Promise<string> {
  const path = fileURLToPath(new URL('../../src/protocol/generated.ts', import.meta.url))
  return readFile(path, 'utf8')
}

describe('M4.4 verification Operation Protocol contract', () => {
  it('defines closed start/get/cancel operation families and an explicit verification operation snapshot', async () => {
    const value = await schema()
    const operation = value.$defs.operation as {
      type?: unknown
      additionalProperties?: unknown
      required?: unknown
      properties?: Record<string, unknown>
    }

    expect(operation).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'kind', 'state', 'cancellationRequested', 'diagnostics'],
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 128 },
        kind: { const: 'plugin.verify' },
        cancellationRequested: { type: 'boolean' },
      },
    })

    for (const definition of [
      'operationRequest',
      'pluginVerifyStartResponse',
      'operationGetResponse',
      'operationCancelResponse',
    ]) {
      expect(value.$defs[definition], definition).toBeDefined()
    }
  })

  it('generates the concrete operation DTOs from the canonical schema', async () => {
    const source = await generated()

    for (const typeName of [
      'OperationRequest',
      'PluginVerifyStartResponse',
      'OperationGetResponse',
      'OperationCancelResponse',
    ]) {
      expect(source).toContain(`export type ${typeName} =`)
    }
    expect(source).toContain('readonly "kind": "plugin.verify"')
    expect(source).toContain('readonly "cancellationRequested": boolean')
    expect(source).toContain('readonly "diagnostics": Array<Diagnostic>')
    expect(source).toContain('readonly "result"?: PluginVerifyResponse')
  })

  it('exports one closed operation id parser with bounded non-whitespace ids', () => {
    const candidate = protocol.parseOperationRequest
    expect(typeof candidate).toBe('function')
    const parseOperationRequest = candidate as (value: unknown) => { readonly id: string }

    expect(parseOperationRequest({ id: 'operation-1' })).toEqual({ id: 'operation-1' })
    expect(() => parseOperationRequest({ id: '   ' })).toThrow(TypeError)
    expect(() => parseOperationRequest({ id: 'x'.repeat(129) })).toThrow(TypeError)
    expect(() => parseOperationRequest({ id: 'operation-1', extra: true })).toThrow(TypeError)
  })
})
