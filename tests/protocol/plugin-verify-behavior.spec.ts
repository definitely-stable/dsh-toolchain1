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
  const schemaPath = fileURLToPath(new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url))
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as ProtocolSchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(schema)
  const request = ajv.getSchema(`${schema.$id}#/$defs/pluginVerifyRequest`)
  if (!request) throw new Error('plugin.verify Protocol request validator is not resolvable')
  return request
}

const invalidBehaviorAssertions: readonly unknown[] = [
  [],
  [{ kind: 'agent-tool-result', name: '', arguments: {}, expectedValue: null }],
  [{ kind: 'agent-tool-result', name: '   ', arguments: {}, expectedValue: null }],
  [{ kind: 'agent-tool-result', name: 'a'.repeat(257), arguments: {}, expectedValue: null }],
  [{ kind: 'tool-result', name: 'candidate_tool', arguments: {}, expectedValue: null }],
  [{ kind: 'agent-tool-result', name: 'candidate_tool', arguments: {}, expectedValue: null, extra: true }],
  Array.from({ length: 9 }, (_, index) => ({
    kind: 'agent-tool-result',
    name: `candidate_tool_${index}`,
    arguments: { index },
    expectedValue: index,
  })),
  [
    { kind: 'agent-tool-result', name: 'candidate_tool', arguments: { value: 1 }, expectedValue: { ok: true } },
    { kind: 'agent-tool-result', name: 'candidate_tool', arguments: { value: 1 }, expectedValue: { ok: true } },
  ],
]

describe('plugin.verify behavior assertions', () => {
  it('accepts and preserves explicit Agent Tool structured result assertions', async () => {
    const candidate = {
      ...baseRequest(),
      behaviorAssertions: [
        {
          kind: 'agent-tool-result',
          name: 'candidate_tool',
          arguments: { value: 1, nested: ['a', true, null] },
          expectedValue: { ok: true, data: { count: 1 } },
        },
      ],
    }

    expect(parsePluginVerifyRequest(candidate)).toEqual(candidate)
    expect((await requestValidator())(candidate)).toBe(true)
  })

  invalidBehaviorAssertions.forEach((behaviorAssertions, index) => {
    it(`rejects invalid, unbounded or duplicate behavior assertions ${index}`, async () => {
      const candidate = { ...baseRequest(), behaviorAssertions }
      expect(() => parsePluginVerifyRequest(candidate)).toThrow('Invalid plugin.verify arguments')
      expect((await requestValidator())(candidate)).toBe(false)
    })
  })

  it.each([
    { arguments: undefined, expectedValue: null },
    { arguments: Number.NaN, expectedValue: null },
    { arguments: Number.POSITIVE_INFINITY, expectedValue: null },
    { arguments: 1n, expectedValue: null },
    { arguments: () => undefined, expectedValue: null },
    { arguments: {}, expectedValue: Symbol('not-json') },
  ])('rejects direct non-JSON values %#', ({ arguments: args, expectedValue }) => {
    const candidate = {
      ...baseRequest(),
      behaviorAssertions: [{
        kind: 'agent-tool-result',
        name: 'candidate_tool',
        arguments: args,
        expectedValue,
      }],
    }
    expect(() => parsePluginVerifyRequest(candidate)).toThrow('Invalid plugin.verify arguments')
  })

  it('rejects cyclic direct values without recursing forever', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const candidate = {
      ...baseRequest(),
      behaviorAssertions: [{
        kind: 'agent-tool-result',
        name: 'candidate_tool',
        arguments: cyclic,
        expectedValue: null,
      }],
    }
    expect(() => parsePluginVerifyRequest(candidate)).toThrow('Invalid plugin.verify arguments')
  })
})
