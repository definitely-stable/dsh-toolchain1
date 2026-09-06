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
