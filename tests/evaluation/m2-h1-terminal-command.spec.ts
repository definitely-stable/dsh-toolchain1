import { describe, expect, it } from 'vitest'

import { parseArguments } from '../../scripts/finalize-m2-h1.mjs'

describe('M2 H1 terminal finalizer command', () => {
  it('requires only dataset, completed run-store and output directory', () => {
    expect(parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
      '--output-dir', '/private/h1-terminal',
    ])).toEqual({
      dataset: '/private/h1.json',
      runStore: '/private/h1-run',
      outputDir: '/private/h1-terminal',
    })
  })

  it('rejects execution/provider controls and duplicate or missing paths', () => {
    expect(() => parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
      '--output-dir', '/private/h1-terminal',
      '--execute',
    ])).toThrow(/unknown|forbidden/u)
    expect(() => parseArguments([
      '--dataset', '/private/h1.json',
      '--dataset', '/other/h1.json',
      '--run-store', '/private/h1-run',
      '--output-dir', '/private/h1-terminal',
    ])).toThrow(/exactly one|duplicate/u)
    expect(() => parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
    ])).toThrow(/output-dir/u)
  })
})
