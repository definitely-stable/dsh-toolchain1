import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default

interface ProtocolSchema {
  readonly $id: string
}

async function contractRequestValidators() {
  const path = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  const schema = JSON.parse(await readFile(path, 'utf8')) as ProtocolSchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(schema)

  const search = ajv.getSchema(`${schema.$id}#/$defs/contractSearchRequest`)
  const inspect = ajv.getSchema(`${schema.$id}#/$defs/contractInspectRequest`)
  if (!search || !inspect) throw new Error('Contract request validators are not resolvable')

  return { ajv, search, inspect }
}

const target = { profile: 'web' }
const exactFingerprint = `dsh-contract-index-v1:${'a'.repeat(64)}`

describe('Protocol v1 Contract Intelligence request validation', () => {
  it.each([
    ['whitespace-only query', { target, query: '   ' }],
    ['duplicate kinds', { target, query: 'tool', kinds: ['tool', 'tool'] }],
    ['unknown kind', { target, query: 'tool', kinds: ['type'] }],
    ['lower limit breach', { target, query: 'tool', limit: 0 }],
    ['upper limit breach', { target, query: 'tool', limit: 26 }],
    ['non-integer limit', { target, query: 'tool', limit: 1.5 }],
    ['unknown property', { target, query: 'tool', unexpected: true }],
    ['invalid target', { target: { profile: '..' }, query: 'tool' }],
  ] as const)('rejects invalid contract.search request: %s', async (_name, request) => {
    const { ajv, search } = await contractRequestValidators()
    expect(search(request), ajv.errorsText(search.errors)).toBe(false)
  })

  it.each([
    [
      'bad index prefix',
      { target, contractIndexFingerprint: `wrong:${'a'.repeat(64)}`, contractId: 'package:x' },
    ],
    [
      'short index hash',
      { target, contractIndexFingerprint: `dsh-contract-index-v1:${'a'.repeat(63)}`, contractId: 'package:x' },
    ],
    [
      'uppercase index hash',
      { target, contractIndexFingerprint: `dsh-contract-index-v1:${'A'.repeat(64)}`, contractId: 'package:x' },
    ],
    [
      'empty contract id',
      { target, contractIndexFingerprint: exactFingerprint, contractId: '' },
    ],
    [
      'unknown property',
      { target, contractIndexFingerprint: exactFingerprint, contractId: 'package:x', unexpected: true },
    ],
    [
      'invalid target',
      { target: { profile: '..' }, contractIndexFingerprint: exactFingerprint, contractId: 'package:x' },
    ],
  ] as const)('rejects invalid contract.inspect request: %s', async (_name, request) => {
    const { ajv, inspect } = await contractRequestValidators()
    expect(inspect(request), ajv.errorsText(inspect.errors)).toBe(false)
  })

  it('accepts canonical valid search and inspect requests', async () => {
    const { ajv, search, inspect } = await contractRequestValidators()

    expect(search({ target, query: 'ToolDefinition', kinds: ['package'], limit: 5 }), ajv.errorsText(search.errors)).toBe(true)
    expect(inspect({
      target,
      contractIndexFingerprint: exactFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    }), ajv.errorsText(inspect.errors)).toBe(true)
  })
})
