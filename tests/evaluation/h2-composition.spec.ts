import { describe, expect, it } from 'vitest'

import {
  assertBcParity,
  assertDumpParity,
  bootArgs,
  buildArmComposition,
  dumpConfigArgs,
  extractCompositionFacts,
  pluginAddArgs,
} from '../../scripts/eval/h2/h2-composition.mjs'

const TARBALL = 'C:/artifacts/dsh-toolchain.tgz'

const DUMP_B = `# composed arm B
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
  config:
    personaPrefix: You are a coding agent powered by the {{model}} model.
- id: session-persistence-jsonl
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
- id: acp
  name: '@deepseek-ai/dsh-acp'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
`

const DUMP_C = `${DUMP_B}- id: dsh-toolchain
  name: 'dsh-toolchain/dsh'
  config:
    profile: acp
`

describe('H2 arm compositions', () => {
  it('builds Arm B as the bare acp profile and Arm C as B plus the Toolchain bundle', () => {
    const b = buildArmComposition({ arm: 'B' })
    const c = buildArmComposition({ arm: 'C', toolchainTarball: TARBALL })
    expect(b.profile).toBe('acp')
    expect(b.pluginInstalls).toHaveLength(0)
    expect(b.patchOverlays).toHaveLength(0)
    expect(c.pluginInstalls).toEqual([{ tarball: TARBALL, bundle: 'dsh-toolchain' }])
    expect(c.expectedExtraBundles).toEqual(['dsh-toolchain'])
    expect(Object.isFrozen(b)).toBe(true)
    expect(Object.isFrozen(c)).toBe(true)
  })

  it('requires the exact packed tarball for Arm C and rejects unknown arms', () => {
    expect(() => buildArmComposition({ arm: 'C' })).toThrow(/tarball/)
    expect(() => buildArmComposition({ arm: 'A' })).toThrow(/unknown H2 arm/)
  })

  it('proves C = B + Toolchain for the canonical pair', () => {
    const b = buildArmComposition({ arm: 'B' })
    const c = buildArmComposition({ arm: 'C', toolchainTarball: TARBALL })
    expect(assertBcParity({ b, c })).toBe(true)
  })

  it('rejects any additional difference between the arms', () => {
    const b = buildArmComposition({ arm: 'B' })
    const c = buildArmComposition({ arm: 'C', toolchainTarball: TARBALL })

    const extraPlugin = { ...c, pluginInstalls: [...c.pluginInstalls, { tarball: 'other.tgz', bundle: 'other' }] }
    expect(() => assertBcParity({ b, c: extraPlugin })).toThrow(/beyond the Toolchain/)

    const extraBundle = { ...c, expectedExtraBundles: [...c.expectedExtraBundles, 'sneaky'] }
    expect(() => assertBcParity({ b, c: extraBundle })).toThrow(/beyond the Toolchain/)

    const noToolchain = { ...c, pluginInstalls: [], expectedExtraBundles: [] }
    expect(() => assertBcParity({ b, c: noToolchain })).toThrow(/exactly once/)

    const bWithPlugin = { ...b, pluginInstalls: [{ tarball: 'x.tgz', bundle: 'x' }] }
    expect(() => assertBcParity({ b: bWithPlugin, c })).toThrow(/Arm B must install no profile plugin/)

    const otherProfile = { ...c, profile: 'web' }
    expect(() => assertBcParity({ b, c: otherProfile })).toThrow(/profiles differ/)

    const otherOverlay = { ...b, patchOverlays: ['/tmp/extra.yml'] }
    expect(() => assertBcParity({ b: otherOverlay, c })).toThrow(/patch overlays differ/)
  })
})

describe('H2 composition dump parity', () => {
  it('extracts id/name row pairs from a composed dump', () => {
    const facts = extractCompositionFacts(DUMP_B)
    expect(facts.rows).toEqual([
      { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
      { id: 'session-persistence-jsonl', name: '@deepseek-ai/dsh-session-persistence-jsonl' },
      { id: 'acp', name: '@deepseek-ai/dsh-acp' },
    ])
  })

  it('accepts a real diff of exactly the Toolchain row', () => {
    expect(assertDumpParity({ dumpB: DUMP_B, dumpC: DUMP_C }).addedRows).toEqual([
      { id: 'dsh-toolchain', name: 'dsh-toolchain/dsh' },
    ])
  })

  it('fails closed when Arm C adds anything besides the Toolchain row', () => {
    const sneaky = `${DUMP_C}- id: extra
  name: 'sneaky/plugin'
`
    expect(() => assertDumpParity({ dumpB: DUMP_B, dumpC: sneaky })).toThrow(/exactly one row/)
  })

  it('fails closed when Arm C is missing an Arm-B row or Arm B already has Toolchain rows', () => {
    const missing = DUMP_C.replace("- id: acp\n  name: '@deepseek-ai/dsh-acp'\n", '')
    expect(() => assertDumpParity({ dumpB: DUMP_B, dumpC: missing })).toThrow(/missing Arm-B row/)

    expect(() => assertDumpParity({ dumpB: DUMP_C, dumpC: DUMP_C })).toThrow(/already contains Toolchain rows/)
  })

  it('exposes the exact DSH argv for install, boot, and composition dump', () => {
    expect(pluginAddArgs({ profile: 'acp', tarball: TARBALL }))
      .toEqual(['plugin', '--profile', 'acp', 'add', '--ignore-scripts', TARBALL])
    expect(bootArgs({ profile: 'acp' })).toEqual(['--profile', 'acp'])
    expect(dumpConfigArgs({ profile: 'acp' })).toEqual(['--profile', 'acp', '--dump-config'])
  })
})