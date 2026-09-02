import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

async function repositoryText(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

const LEGACY_PRE_H1_CLAIMS = [
  'These implementation artifacts do **not** mean that the real H1 is authorized or complete.',
  'H1 provider execution remains prohibited.',
  'If the single preregistered H1 resolves `PASS`',
] as const

describe('canonical post-H1 root documentation', () => {
  it.each(['README.md', 'docs/roadmap.md'])('%s cannot regress to the pre-H1 operational state', async relativePath => {
    const content = await repositoryText(relativePath)

    expect(content).toContain('864 / 864')
    expect(content).toContain('INCONCLUSIVE')
    for (const legacyClaim of LEGACY_PRE_H1_CLAIMS) {
      expect(content).not.toContain(legacyClaim)
    }
  })
})
