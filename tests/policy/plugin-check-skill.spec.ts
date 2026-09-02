import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

async function shippedSkill(): Promise<string> {
  const location = fileURLToPath(new URL('../../skills/dsh-toolchain/SKILL.md', import.meta.url))
  return readFile(location, 'utf8')
}

describe('shipped Agent Skill plugin.check workflow', () => {
  it('uses Exact Target Plugin Check as the default post-edit and static-review workflow', async () => {
    const skill = await shippedSkill()

    expect(skill).toContain('plugin.check')
    expect(skill).toContain('toolchain_plugin_check')
    expect(skill).toContain('dsh-toolchain plugin check')
    expect(skill).toMatch(/after (editing|changing) a plugin/i)
    expect(skill).toMatch(/default/i)
    expect(skill).not.toMatch(/when a documented Exact Target Plugin Check[^\n]*later version/i)
  })

  it('keeps static compatibility, unknown evidence, and runtime verification semantically distinct', async () => {
    const skill = await shippedSkill()

    expect(skill).toContain('compatible-in-scope')
    expect(skill).toContain('unproven')
    expect(skill).toMatch(/does not execute candidate code/i)
    expect(skill).toMatch(/not.*runtime verification|runtime verification.*not/i)
    expect(skill).toMatch(/contract\.search|contract search/i)
    expect(skill).toMatch(/contract\.inspect|contract inspect/i)
  })
})
