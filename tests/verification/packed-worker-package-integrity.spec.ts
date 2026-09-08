import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

import type { TargetSnapshot } from '../../src/protocol/index.js'
import { runPackedPluginVerification } from '../../src/verification/packed-worker.js'
import type { VerificationProcessRequest } from '../../src/verification/process.js'

const roots: string[] = []

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-worker-package-integrity-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function writeTarString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii')
}

function tarEntry(name: string, source: string): Buffer {
  const content = Buffer.from(source, 'utf8')
  const header = Buffer.alloc(512)
  writeTarString(header, 0, 100, name)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, content.length)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1, 'ascii')
  writeTarString(header, 257, 6, 'ustar\0')
  writeTarString(header, 263, 2, '00')

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')

  return Buffer.concat([
    header,
    content,
    Buffer.alloc((512 - (content.length % 512)) % 512),
  ])
}

function brokenPackedCandidate(entrypoint = './plugin.mjs'): Buffer {
  return gzipSync(Buffer.concat([
    tarEntry('package/package.json', JSON.stringify({
      name: 'dsh-toolchain-worker-package-broken',
      version: '0.0.0',
      type: 'module',
      exports: entrypoint,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })),
    tarEntry('package/cordis.patch.yml', '- insert: []\n'),
    Buffer.alloc(1024),
  ]))
}

function target(): TargetSnapshot {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-09-08T00:00:00.000Z',
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
    profileLifecycle: {
      patchReload: 'startup',
      fingerprint: `dsh-profile-lifecycle-v1:${'d'.repeat(64)}`,
    },
    evidence: [],
    supportStatus: 'tested',
  }
}

async function runWithBytes(bytes: Buffer): Promise<{
  readonly execution: Awaited<ReturnType<typeof runPackedPluginVerification>>
  readonly calls: readonly VerificationProcessRequest[]
  readonly contentHash: string
}> {
  const root = await fixtureRoot()
  const workerRoot = path.join(root, 'worker')
  const packedPath = path.join(root, 'candidate.tgz')
  const contentHash = sha256(bytes)
  const calls: VerificationProcessRequest[] = []
  await writeFile(packedPath, bytes)

  const execution = await runPackedPluginVerification({
    artifact: { path: packedPath, expectedContentHash: contentHash },
    target: target(),
    executionPolicy: 'safe',
  }, {
    processRunner: async request => {
      calls.push(request)
      return { kind: 'exited', code: 0, stdout: '', stderr: '' }
    },
    parentEnv: { PATH: process.env.PATH },
    createTemporaryRoot: async () => {
      await mkdir(workerRoot, { recursive: true })
      return workerRoot
    },
    cleanupTemporaryRoot: async temporaryRoot => {
      await rm(temporaryRoot, { recursive: true, force: true })
    },
  })

  return { execution, calls, contentHash }
}

describe('packed worker package integrity boundary', () => {
  it('retains exact artifact identity while failing package before any subprocess when an explicit root entrypoint is absent', async () => {
    const { execution, calls, contentHash } = await runWithBytes(brokenPackedCandidate())

    expect(calls).toEqual([])
    expect(execution.artifactFingerprint).toBe(`dsh-plugin-artifact-v1:${contentHash}`)
    expect(execution.targetFingerprint).toBe(target().fingerprint)
    expect(execution.lifecycleFingerprint).toBe(target().profileLifecycle?.fingerprint)
    expect(execution.terminal).toBe('failed')
    expect(execution.cleanup).toBe('succeeded')
    expect(execution.diagnostics.map(item => item.code)).toEqual(['VERIFY_PACKAGE_ENTRYPOINT_MISSING'])
    expect(execution.checks.find(item => item.id === 'package')).toEqual({
      id: 'package',
      status: 'failed',
      reason: 'verify-package-entrypoint-missing',
    })
    for (const id of ['install', 'compose', 'boot', 'visibility']) {
      expect(execution.checks.find(item => item.id === id)).toEqual({
        id,
        status: 'skipped',
        reason: 'prerequisite-package-failed',
      })
    }
  })

  it('fails package closed before subprocesses when archive inspection itself fails', async () => {
    const bytes = gzipSync(Buffer.from('not a bounded tar archive', 'utf8'))
    const { execution, calls, contentHash } = await runWithBytes(bytes)

    expect(calls).toEqual([])
    expect(execution.artifactFingerprint).toBe(`dsh-plugin-artifact-v1:${contentHash}`)
    expect(execution.targetFingerprint).toBe(target().fingerprint)
    expect(execution.lifecycleFingerprint).toBe(target().profileLifecycle?.fingerprint)
    expect(execution.terminal).toBe('failed')
    expect(execution.cleanup).toBe('succeeded')
    expect(execution.diagnostics.map(item => item.code)).toEqual(['VERIFY_PACKAGE_INSPECTION_FAILED'])
    expect(execution.checks.find(item => item.id === 'package')).toEqual({
      id: 'package',
      status: 'failed',
      reason: 'verify-package-inspection-failed',
    })
  })

  it('bounds user-controlled entrypoint text in missing-entrypoint diagnostics', async () => {
    const declared = `./${'x'.repeat(1024)}.mjs`
    const { execution } = await runWithBytes(brokenPackedCandidate(declared))
    const diagnostic = execution.diagnostics.find(item => item.code === 'VERIFY_PACKAGE_ENTRYPOINT_MISSING')

    expect(diagnostic).toBeDefined()
    expect(diagnostic?.summary.length).toBeLessThanOrEqual(512)
    expect(diagnostic?.summary).not.toContain('x'.repeat(512))
  })
})
