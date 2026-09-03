import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('staged evaluation repository policy', () => {
  it('keeps the repository eval skill bounded and explicitly non-H1', async () => {
    const skill = await readFile('.agents/skills/dsh-eval/SKILL.md', 'utf8')
    expect(skill).toContain('Never rerun H1')
    expect(skill).toContain('DEVELOPMENT_ONLY')
    expect(skill).toContain('40')
    expect(skill).toContain('16')
    expect(skill).toContain('Do not run manual 12/24/48 continuation loops')
  })

  it('retires the hardcoded one-shot H1 finalization workflow', async () => {
    await expect(readFile('.github/workflows/m2-h1-finalize-once.yml', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains a durable canonical H1 outcome receipt', async () => {
    const receipt = await readFile('docs/evaluation/m2/h1-terminal-outcome-2026-09-02.md', 'utf8')
    expect(receipt).toContain('Status: **INCONCLUSIVE')
    expect(receipt).toContain('33533666686')
    expect(receipt).toContain('33541873817')
    expect(receipt).toContain('33541936135')
    expect(receipt).toContain('227 / 576')
  })
})
