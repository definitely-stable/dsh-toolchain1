import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

describe('DSH bundle manifest', () => {
  it('ships one namespaced patch that mounts the public DSH service entry point', async () => {
    const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as {
      exports?: Record<string, { default?: string } | string>
      dsh?: { bundle?: { patch?: string } }
    }

    expect(packageJson.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(packageJson.exports?.['./dsh']).toMatchObject({
      default: './lib/integrations/dsh/index.js',
    })

    const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
    expect(patch).toContain('- insert:')
    expect(patch).toMatch(/\n\s+- id: dsh-toolchain\n/)
    expect(patch).toMatch(/\n\s+name: ['"]?dsh-toolchain\/dsh['"]?\n/)
    expect(patch).not.toMatch(/\n\s+- id: toolchain\n/)
  })
})
