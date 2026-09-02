import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default

interface ProtocolSchema {
  readonly $id: string
  readonly $defs: Record<string, unknown>
}

async function schemaAndValidators() {
  const schemaPath = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as ProtocolSchema
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addSchema(schema)

  const request = ajv.getSchema(`${schema.$id}#/$defs/pluginCheckRequest`)
  const response = ajv.getSchema(`${schema.$id}#/$defs/pluginCheckResponse`)
  if (!request || !response) throw new Error('plugin.check Protocol validators are not resolvable')
  return { request, response }
}

async function generatedProtocol(): Promise<string> {
  const path = fileURLToPath(new URL('../../src/protocol/generated.ts', import.meta.url))
  return readFile(path, 'utf8')
}

describe('plugin.check canonical Protocol contract', () => {
  it('defines a closed directory subject request in the canonical schema', async () => {
    const { request } = await schemaAndValidators()

    expect(request({
      target: { profile: 'web' },
      subject: { kind: 'directory', path: '/plugin' },
    })).toBe(true)
    expect(request({
      target: { profile: 'web' },
      subject: { kind: 'directory', path: '/plugin', extra: true },
    })).toBe(false)
    expect(request({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/plugin.tgz' },
    })).toBe(false)
  })

  it('models an incompatible plugin as a successful application response and keeps static scope explicit', async () => {
    const { response } = await schemaAndValidators()
    const snapshotFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
    const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`

    expect(response({
      protocolVersion: '1',
      requestId: 'request-1',
      snapshotFingerprint,
      status: 'ok',
      data: {
        contractIndexFingerprint,
        subjectCompleteness: 'complete',
        ruleset: 'plugin-static-alpha-v1',
        scopeComplete: false,
        verdict: 'incompatible',
        requirements: [{
          packageName: '@deepseek-ai/cordis',
          range: '^5.0.0',
          relationship: 'host-peer-required',
          status: 'missing',
          evidenceIds: ['plugin:manifest'],
        }],
        evidence: [{
          id: 'plugin:manifest',
          kind: 'manifest',
          strength: 'authoritative',
        }],
        candidateCodeExecuted: false,
      },
      diagnostics: [{
        code: 'PLUGIN_DSH_PACKAGE_MISSING',
        severity: 'error',
        domain: 'plugin',
        summary: 'Required Host peer is absent.',
      }],
    })).toBe(true)
  })

  it('rejects a requirement finding whose provenance field is omitted', async () => {
    const { response } = await schemaAndValidators()

    expect(response({
      protocolVersion: '1',
      requestId: 'request-no-evidence',
      snapshotFingerprint: `dsh-target-v2:${'e'.repeat(64)}`,
      status: 'ok',
      data: {
        contractIndexFingerprint: `dsh-contract-index-v1:${'f'.repeat(64)}`,
        subjectCompleteness: 'complete',
        ruleset: 'plugin-static-alpha-v1',
        scopeComplete: false,
        verdict: 'incompatible',
        requirements: [{
          packageName: '@deepseek-ai/cordis',
          range: '5.0.0',
          relationship: 'host-peer-required',
          status: 'missing',
        }],
        evidence: [],
        candidateCodeExecuted: false,
      },
      diagnostics: [],
    })).toBe(false)
  })

  it('permits an invalid subject result without inventing a subject fingerprint', async () => {
    const { response } = await schemaAndValidators()

    expect(response({
      protocolVersion: '1',
      requestId: 'request-2',
      snapshotFingerprint: `dsh-target-v2:${'c'.repeat(64)}`,
      status: 'ok',
      data: {
        contractIndexFingerprint: `dsh-contract-index-v1:${'d'.repeat(64)}`,
        subjectCompleteness: 'invalid',
        ruleset: 'plugin-static-alpha-v1',
        scopeComplete: false,
        verdict: 'unproven',
        requirements: [],
        evidence: [],
        candidateCodeExecuted: false,
      },
      diagnostics: [{
        code: 'PLUGIN_MANIFEST_READ_FAILED',
        severity: 'error',
        domain: 'plugin',
        summary: 'package.json could not be acquired.',
      }],
    })).toBe(true)
  })

  it('generates plugin.check DTOs from the canonical schema', async () => {
    const generated = await generatedProtocol()
    expect(generated).toContain('export type PluginSubjectRequest =')
    expect(generated).toContain('export type PluginCheckRequest =')
    expect(generated).toContain('export type PluginCheckResult =')
    expect(generated).toContain('readonly "evidenceIds": Array<string>')
    expect(generated).toContain('export type PluginCheckResponse =')
  })
})