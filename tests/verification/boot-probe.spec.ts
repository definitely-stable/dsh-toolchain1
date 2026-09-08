import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createVerificationBootProbe } from '../../src/verification/boot-probe.js'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-boot-probe-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function expectInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  expect(relative).not.toBe('')
  expect(relative.startsWith(`..${path.sep}`)).toBe(false)
  expect(path.isAbsolute(relative)).toBe(false)
}

describe('verification boot probe', () => {
  it('generates one deterministic private DSH plugin inside the supplied worker root', async () => {
    const root = await fixtureRoot()

    const probe = await createVerificationBootProbe(root, 'web')

    expectInside(root, probe.packagePath)
    expect(probe.marker).toMatch(/^DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:[0-9a-f]{64}$/u)
    expect(probe.marker).not.toContain(root)
    expect(probe.marker).not.toMatch(/(?:token|secret|key|credential)/iu)
    expect(probe.visibility).toBeUndefined()

    const manifest = JSON.parse(await readFile(path.join(probe.packagePath, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toEqual({
      name: '@dsh-toolchain/verification-boot-probe',
      version: '0.0.0',
      private: true,
      type: 'module',
      exports: './probe.mjs',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })

    expect(await readFile(path.join(probe.packagePath, 'cordis.patch.yml'), 'utf8')).toBe(
      "- insert:\n    - id: dsh-toolchain-verification-boot-probe\n      name: '@dsh-toolchain/verification-boot-probe'\n",
    )
  })

  it('generates a marker-backed source with only launcher exit and bounded stdout side effects', async () => {
    const root = await fixtureRoot()

    const probe = await createVerificationBootProbe(root, 'web')
    const source = await readFile(path.join(probe.packagePath, 'probe.mjs'), 'utf8')

    expect(source).toContain("rootCtx.get('appExit')")
    expect(source).toContain(`process.stdout.write(${JSON.stringify(`${probe.marker}\n`)})`)
    expect(source).toContain('appExit(0)')
    expect(source).not.toContain('process.env')
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('node:fs')
    expect(source).not.toContain('node:http')
    expect(source).not.toContain('node:https')
    expect(source).not.toContain('XMLHttpRequest')
  })

  it('adds deterministic PASS/FAIL markers for requested Host Service visibility without logging service names', async () => {
    const root = await fixtureRoot()
    const assertions = [
      { kind: 'host-service' as const, name: 'candidateService' },
      { kind: 'host-service' as const, name: 'another/service' },
    ]

    const probe = await createVerificationBootProbe(root, 'web', assertions)
    const source = await readFile(path.join(probe.packagePath, 'probe.mjs'), 'utf8')

    expect(probe.visibility).toBeDefined()
    expect(probe.visibility?.passedMarker).toMatch(/^DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2:[0-9a-f]{64}:PASS$/u)
    expect(probe.visibility?.failedMarker).toMatch(/^DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2:[0-9a-f]{64}:FAIL$/u)
    expect(probe.visibility?.passedMarker).not.toContain('candidateService')
    expect(probe.visibility?.failedMarker).not.toContain('another/service')
    expect(source).toContain(JSON.stringify(assertions))
    expect(source).toContain('rootCtx.get(assertion.name, false)')
    expect(source).toContain(JSON.stringify(`${probe.visibility?.passedMarker}\n`))
    expect(source).toContain(JSON.stringify(`${probe.visibility?.failedMarker}\n`))
    expect(source).toContain(`process.stdout.write(${JSON.stringify(`${probe.marker}\n`)})`)
    expect(source).toContain('appExit(0)')
    expect(source).not.toContain("rootCtx.get('agents')")
    expect(source).not.toContain("rootCtx.get('tools')")
  })

  it('creates one owned Agent capability epoch for Agent Tool assertions and disposes it before the visibility outcome', async () => {
    const root = await fixtureRoot()
    const assertions = [
      { kind: 'agent-tool' as const, name: 'candidate_tool' },
      { kind: 'agent-tool' as const, name: 'another_tool' },
    ]

    const probe = await createVerificationBootProbe(root, 'headless', assertions)
    const source = await readFile(path.join(probe.packagePath, 'probe.mjs'), 'utf8')

    expect(probe.visibility?.passedMarker).toMatch(/^DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2:[0-9a-f]{64}:PASS$/u)
    expect(probe.visibility?.failedMarker).toMatch(/^DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2:[0-9a-f]{64}:FAIL$/u)
    expect(source).toContain('export async function apply(rootCtx)')
    expect(source).toContain("rootCtx.get('agents')")
    expect(source).toContain("rootCtx.get('tools')")
    expect(source).toContain('randomUUID')
    expect(source.match(/agents\.create\(/gu)).toHaveLength(1)
    expect(source.match(/tools\.schemas\(handle\.agent\)/gu)).toHaveLength(1)
    expect(source).toContain('await handle.dispose()')

    const dispose = source.indexOf('await handle.dispose()')
    const passMarkerWrite = source.indexOf(JSON.stringify(`${probe.visibility?.passedMarker}\n`))
    const failedMarkerWrite = source.indexOf(JSON.stringify(`${probe.visibility?.failedMarker}\n`))
    expect(dispose).toBeGreaterThanOrEqual(0)
    expect(passMarkerWrite).toBeGreaterThan(dispose)
    expect(failedMarkerWrite).toBeGreaterThan(dispose)
  })

  it('uses one Agent epoch for a mixed Host Service and Agent Tool assertion batch', async () => {
    const root = await fixtureRoot()
    const assertions = [
      { kind: 'host-service' as const, name: 'candidateService' },
      { kind: 'agent-tool' as const, name: 'candidate_tool' },
      { kind: 'agent-tool' as const, name: 'another_tool' },
    ]

    const probe = await createVerificationBootProbe(root, 'headless', assertions)
    const source = await readFile(path.join(probe.packagePath, 'probe.mjs'), 'utf8')

    expect(source).toContain('rootCtx.get(assertion.name, false)')
    expect(source.match(/agents\.create\(/gu)).toHaveLength(1)
    expect(source.match(/tools\.schemas\(handle\.agent\)/gu)).toHaveLength(1)
    expect(source).toContain('await handle.dispose()')
  })

  it('binds visibility marker identity to the ordered assertion set', async () => {
    const firstRoot = await fixtureRoot()
    const secondRoot = await fixtureRoot()
    const reversedRoot = await fixtureRoot()

    const first = await createVerificationBootProbe(firstRoot, 'web', [
      { kind: 'host-service', name: 'alphaService' },
      { kind: 'host-service', name: 'betaService' },
    ])
    const second = await createVerificationBootProbe(secondRoot, 'web', [
      { kind: 'host-service', name: 'alphaService' },
      { kind: 'host-service', name: 'betaService' },
    ])
    const reversed = await createVerificationBootProbe(reversedRoot, 'web', [
      { kind: 'host-service', name: 'betaService' },
      { kind: 'host-service', name: 'alphaService' },
    ])

    expect(first.visibility?.passedMarker).toBe(second.visibility?.passedMarker)
    expect(first.visibility?.passedMarker).not.toBe(reversed.visibility?.passedMarker)
  })

  it('binds the marker to profile identity without embedding the profile string', async () => {
    const webRoot = await fixtureRoot()
    const headlessRoot = await fixtureRoot()

    const web = await createVerificationBootProbe(webRoot, 'web')
    const headless = await createVerificationBootProbe(headlessRoot, 'headless')

    expect(web.marker).not.toBe(headless.marker)
    expect(web.marker).not.toContain('web')
    expect(headless.marker).not.toContain('headless')
  })
})
