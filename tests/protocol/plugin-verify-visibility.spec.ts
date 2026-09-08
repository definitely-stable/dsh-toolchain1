import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parsePluginVerifyRequest } from '../../src/protocol/index.js'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default

interface ProtocolSchema {
  readonly $id: string
  readonly $defs: Record<string, unknown>
}

function baseRequest() {
  return {
    target: { profile: 'headless' },
    subject: { kind: 'packed', path: '/tmp/candidate.tgz' },
    executionPolicy: 'safe',
  } as const
}

async function requestValidator() {
  const schemaPath = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as ProtocolSchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(schema)
  const request = ajv.getSchema(`${schema.$id}#/$defs/pluginVerifyRequest`)
  if (!request) throw new Error('plugin.verify Protocol request validator is not resolvable')
  return request
}

const invalidVisibilityAssertions: readonly unknown[] = [
  [],
  [{ kind: 'host-service', name: '' }],
  [{ kind: 'host-service', name: '   ' }],
  [{ kind: 'host-service', name: 'a'.repeat(257) }],
  [{ kind: 'agent-tool', name: '' }],
  [{ kind: 'agent-tool', name: '   ' }],
  [{ kind: 'agent-tool', name: 'a'.repeat(257) }],
  [{ kind: 'tool', name: 'alphaService' }],
  [{ kind: 'host-service', name: 'alphaService', extra: true }],
  [
    { kind: 'host-service', name: 'alphaService' },
    { kind: 'host-service', name: 'alphaService' },
  ],
  [
    { kind: 'agent-tool', name: 'alphaTool' },
    { kind: 'agent-tool', name: 'alphaTool' },
  ],
  Array.from({ length: 33 }, (_, index) => ({
    kind: index % 2 === 0 ? 'host-service' : 'agent-tool',
    name: `capability-${index}`,
  })),
]

describe('plugin.verify runtime visibility assertions', () => {
  it('accepts and preserves a bounded ordered set of Host Service assertions', async () => {
    const candidate = {
      ...baseRequest(),
      visibilityAssertions: [
        { kind: 'host-service', name: 'alphaService' },
        { kind: 'host-service', name: 'beta/service' },
      ],
    }

    expect(parsePluginVerifyRequest(candidate)).toEqual(candidate)
    expect((await requestValidator())(candidate)).toBe(true)
  })

  it('accepts and preserves Agent Tool assertions', async () => {
    const candidate = {
      ...baseRequest(),
      visibilityAssertions: [
        { kind: 'agent-tool', name: 'candidate_tool' },
        { kind: 'agent-tool', name: 'mcp__github__search' },
      ],
    }

    expect(parsePluginVerifyRequest(candidate)).toEqual(candidate)
    expect((await requestValidator())(candidate)).toBe(true)
  })

  it('preserves mixed assertion kinds and allows the same name in distinct namespaces', async () => {
    const candidate = {
      ...baseRequest(),
      visibilityAssertions: [
        { kind: 'host-service', name: 'shared-name' },
        { kind: 'agent-tool', name: 'shared-name' },
      ],
    }

    expect(parsePluginVerifyRequest(candidate)).toEqual(candidate)
    expect((await requestValidator())(candidate)).toBe(true)
  })

  invalidVisibilityAssertions.forEach((visibilityAssertions, index) => {
    it(`rejects invalid or duplicate visibility assertions ${index}`, async () => {
      const candidate = { ...baseRequest(), visibilityAssertions }
      expect(() => parsePluginVerifyRequest(candidate)).toThrow('Invalid plugin.verify arguments')
      expect((await requestValidator())(candidate)).toBe(false)
    })
  })
})
