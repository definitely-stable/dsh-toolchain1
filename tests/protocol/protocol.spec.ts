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
  }
}

async function readProtocolSchema(): Promise<ProtocolSchema> {
  const path = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  return JSON.parse(await readFile(path, 'utf8')) as ProtocolSchema
}

describe('Protocol v1 generated contract', () => {
  it('derives the runtime protocol version from the canonical schema', async () => {
    const schema = await readProtocolSchema()

    expect(TOOLCHAIN_PROTOCOL_VERSION).toBe(
      schema.$defs.responseEnvelope.properties.protocolVersion.const,
    )
  })
})
