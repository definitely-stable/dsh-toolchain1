import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default

async function protocolSchema(): Promise<Record<string, unknown>> {
  const location = fileURLToPath(
    new URL('../../spec/schemas/v1/toolchain-protocol.schema.json', import.meta.url),
  )
  return JSON.parse(await readFile(location, 'utf8')) as Record<string, unknown>
}

async function generatedProtocol(): Promise<string> {
  const location = fileURLToPath(new URL('../../src/protocol/generated.ts', import.meta.url))
  return readFile(location, 'utf8')
}

function snapshot(profileLifecycle?: unknown): Record<string, unknown> {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-09-07T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'headless',
      bundles: [],
      dependencies: [],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    ...(profileLifecycle === undefined ? {} : { profileLifecycle }),
    evidence: [],
  }
}

describe('Protocol v1 profile lifecycle metadata', () => {
  it('defines closed lifecycle metadata and verification receipt identity', async () => {
    const schema = await protocolSchema()
    const defs = schema.$defs as Record<string, Record<string, unknown> | undefined>
    const lifecycle = defs.profileLifecycle
    const target = defs.targetSnapshot
    const verification = defs.verificationReport
    if (target === undefined) throw new Error('targetSnapshot schema is unavailable')
    if (verification === undefined) throw new Error('verificationReport schema is unavailable')

    expect(lifecycle).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['patchReload', 'fingerprint'],
      properties: {
        patchReload: { enum: ['live', 'startup'] },
        fingerprint: {
          type: 'string',
          pattern: '^dsh-profile-lifecycle-v1:[0-9a-f]{64}$',
        },
      },
    })
    expect((target.properties as Record<string, unknown>).profileLifecycle).toEqual({
      $ref: '#/$defs/profileLifecycle',
    })
    expect((verification.properties as Record<string, unknown>).lifecycleFingerprint).toEqual({
      type: 'string',
      pattern: '^dsh-profile-lifecycle-v1:[0-9a-f]{64}$',
    })
  })

  it('accepts old snapshots without lifecycle and validates lifecycle-aware snapshots strictly', async () => {
    const schema = await protocolSchema()
    const id = schema.$id as string
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    ajv.addSchema(schema)
    const validate = ajv.getSchema(`${id}#/$defs/targetSnapshot`)
    if (validate === undefined) throw new Error('targetSnapshot validator is unavailable')

    expect(validate(snapshot()), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate(snapshot({
      patchReload: 'startup',
      fingerprint: `dsh-profile-lifecycle-v1:${'d'.repeat(64)}`,
    })), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate(snapshot({
      patchReload: 'sometimes',
      fingerprint: `dsh-profile-lifecycle-v1:${'d'.repeat(64)}`,
    })), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('generates additive lifecycle types without changing Protocol v1', async () => {
    const generated = await generatedProtocol()

    expect(generated).toContain('export type ProfileLifecycle =')
    expect(generated).toContain('readonly "profileLifecycle"?: ProfileLifecycle')
    expect(generated).toContain('readonly "lifecycleFingerprint"?: string')
  })
})
