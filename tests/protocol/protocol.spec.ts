import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOOLCHAIN_PROTOCOL_VERSION } from '../../src/protocol/index.js'

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
      properties?: {
        data?: {
          $ref?: string
        }
      }
    }
  }
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
    expect(schema.$defs.targetResolveResponse?.properties?.data?.$ref).toBe(
      '#/$defs/targetResolveResult',
    )
  })

  it('generates target.resolve TypeScript types from the schema', async () => {
    const generated = await readGeneratedProtocol()

    expect(generated).toContain('export type TargetResolveRequest =')
    expect(generated).toContain('export type TargetResolveResult =')
    expect(generated).toContain('export type TargetResolveResponse =')
  })
})
