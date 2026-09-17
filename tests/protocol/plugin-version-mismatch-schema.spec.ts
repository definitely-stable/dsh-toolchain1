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

async function responseValidator() {
  const schemaPath = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as ProtocolSchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(schema)
  const response = ajv.getSchema(`${schema.$id}#/$defs/pluginCheckResponse`)
  if (!response) throw new Error('plugin.check response validator is not resolvable')
  return { ajv, response }
}

async function generatedProtocol(): Promise<string> {
  const path = fileURLToPath(new URL('../../src/protocol/generated.ts', import.meta.url))
  return readFile(path, 'utf8')
}

describe('M3.2 version mismatch Protocol contract', () => {
  it('accepts version-mismatch as a closed plugin requirement status', async () => {
    const { ajv, response } = await responseValidator()

    const value = {
      protocolVersion: '1',
      requestId: 'request-version-mismatch',
      snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      status: 'ok',
      data: {
        contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
        subjectCompleteness: 'complete',
        ruleset: 'plugin-static-alpha-v1',
        scopeComplete: false,
        verdict: 'incompatible',
        requirements: [{
          packageName: '@deepseek-ai/cordis',
          range: '^5.0.0',
          relationship: 'host-peer-required',
          status: 'version-mismatch',
          targetVersion: '4.0.2',
          evidenceIds: ['plugin:manifest', 'target:cordis'],
        }],
        evidence: [],
        candidateCodeExecuted: false,
      },
      diagnostics: [{
        code: 'PLUGIN_DSH_VERSION_MISMATCH',
        severity: 'error',
        domain: 'plugin',
        summary: 'Installed Host peer version is outside the declared npm range.',
      }],
    }

    expect(response(value), ajv.errorsText(response.errors)).toBe(true)
  })

  it('generates the new requirement status from the canonical schema', async () => {
    const generated = await generatedProtocol()

    expect(generated).toContain(
      'export type PluginRequirementStatus = "satisfied" | "not-required-from-host" | "missing" | "version-mismatch" | "unproven"',
    )
  })
})
