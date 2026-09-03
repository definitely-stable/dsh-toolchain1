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
    expect(skill).toContain('M2 Staged Development Evaluation')
    expect(skill).toContain('pnpm eval:run --')
    expect(skill).toContain('--mode <mode>')
    expect(skill).toMatch(/operator selects only the bounded mode/i)
    expect(skill).toMatch(/fresh managed-provider probe/i)
    expect(skill).toMatch(/zero remainder/i)
    expect(skill).toMatch(/not H2|not confirmatory/i)
  })

  it('documents the one-command and one-dispatch operator path without reopening H1', async () => {
    const guide = await readFile('docs/evaluation/m2/staged-evaluation.md', 'utf8')
    expect(guide).toContain('M2 Staged Development Evaluation')
    expect(guide).toContain('pnpm eval:run --')
    expect(guide).toContain('--manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')
    expect(guide).toContain('M2_STAGED_PROVIDER_PROBE')
    expect(guide).toMatch(/16-call B\/C canary/i)
    expect(guide).toMatch(/zero remainder/i)
    expect(guide).toMatch(/DEVELOPMENT_ONLY/i)
    expect(guide).toMatch(/H1.*immutable|immutable.*H1/i)
  })

  it('marks the implementation complete but the real canary acceptance as pending until evidence exists', async () => {
    const status = await readFile('docs/evaluation/m2/status.md', 'utf8')
    expect(status).toContain('| One-dispatch staged runner | **IMPLEMENTED / CANARY PENDING** |')
    expect(status).toMatch(/real 16-call provider canary/i)
    expect(status).toMatch(/H1.*MUST NOT.*rerun|MUST NOT.*rerun.*H1/i)
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
