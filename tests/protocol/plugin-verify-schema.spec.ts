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

  const request = ajv.getSchema(`${schema.$id}#/$defs/pluginVerifyRequest`)
  const response = ajv.getSchema(`${schema.$id}#/$defs/pluginVerifyResponse`)
  if (!request || !response) throw new Error('plugin.verify Protocol validators are not resolvable')
  return { request, response }
}

async function generatedProtocol(): Promise<string> {
  const path = fileURLToPath(new URL('../../src/protocol/generated.ts', import.meta.url))
  return readFile(path, 'utf8')
}

describe('plugin.verify canonical Protocol contract', () => {
  it('accepts only packed safe verification requests', async () => {
    const { request } = await schemaAndValidators()

    expect(request({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/plugin.tgz' },
      executionPolicy: 'safe',
    })).toBe(true)
    expect(request({
      target: { profile: 'web' },
      subject: { kind: 'directory', path: '/plugin' },
      executionPolicy: 'safe',
    })).toBe(false)
    expect(request({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/plugin.tgz' },
      executionPolicy: 'trusted',
    })).toBe(false)
  })

  it('keeps target drift as semantic VerificationReport stale inside status ok', async () => {
    const { response } = await schemaAndValidators()
    const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`

    expect(response({
      protocolVersion: '1',
      requestId: 'verify-stale',
      snapshotFingerprint: targetFingerprint,
      status: 'ok',
      data: {
        status: 'stale',
        artifactFingerprint: `dsh-plugin-artifact-v1:${'9'.repeat(64)}`,
        targetFingerprint,
        executionPolicy: 'safe',
        checks: [],
        diagnostics: [{
          code: 'VERIFY_TARGET_STALE',
          severity: 'error',
          domain: 'verification',
          summary: 'target changed',
        }],
        cleanup: 'succeeded',
      },
      diagnostics: [],
    })).toBe(true)
  })

  it('defines a closed failure envelope only for failures that prevent a semantic report', async () => {
    const { response } = await schemaAndValidators()

    expect(response({
      protocolVersion: '1',
      requestId: 'verify-failed',
      status: 'failed',
      diagnostics: [{
        code: 'TARGET_PROFILE_NOT_FOUND',
        severity: 'error',
        domain: 'target',
        summary: 'target unavailable',
      }],
    })).toBe(true)
    expect(response({
      protocolVersion: '1',
      requestId: 'verify-transport-stale',
      snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      status: 'stale',
      diagnostics: [{
        code: 'VERIFY_TARGET_STALE',
        severity: 'error',
        domain: 'verification',
        summary: 'target changed',
      }],
    })).toBe(false)
  })

  it('generates plugin.verify DTOs from the canonical schema', async () => {
    const generated = await generatedProtocol()
    expect(generated).toContain('export type PluginVerifyRequest =')
    expect(generated).toContain('export type PluginVerifySuccessResponse =')
    expect(generated).toContain('export type PluginVerifyFailureResponse =')
    expect(generated).toContain('export type PluginVerifyResponse =')
  })
})
