import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = await readFile(
  fileURLToPath(new URL('../../src/verification/packed-worker.ts', import.meta.url)),
  'utf8',
)

describe('packed verification package-manager network policy', () => {
  it('does not let pnpm default fetch timeout undercut the bounded install stage', () => {
    expect(source).toContain('const INSTALL_TIMEOUT_MS = 300_000')
    expect(source).toContain('`--fetch-timeout=${INSTALL_TIMEOUT_MS}`')
    expect(source).toContain("['add', '--save-exact', '--ignore-scripts', `--fetch-timeout=${INSTALL_TIMEOUT_MS}`, `@deepseek-ai/dsh@${input.target.dsh.version}`]")
  })
})
