import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

async function repositoryText(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), 'utf8')
}

describe('public plugin operation boundary', () => {
  it('keeps plugin.check as the static public operation in the normative Protocol', async () => {
    const protocol = await repositoryText('spec/protocol.md')

    expect(protocol).toContain('### `plugin.check`')
    expect(protocol).toContain('Normalize/analyze/validate are internal implementation passes')
    expect(protocol).not.toContain('`plugin.analyze` produces')
    expect(protocol).not.toContain('`plugin.validate` applies')
    expect(protocol).toContain('`plugin.verify` follows `spec/verification.md` and is a separate M4 execution boundary')
  })

  it('does not advertise analyze or validate as transport-neutral kernel use cases', async () => {
    const architecture = await repositoryText('docs/architecture.md')
    const kernelSection = architecture.split('### Application Kernel')[1]?.split('### Semantic model and analysis')[0]

    expect(kernelSection).toBeDefined()
    expect(kernelSection).toContain('- `plugin.check`')
    expect(kernelSection).toContain('- `plugin.verify`')
    expect(kernelSection).not.toContain('- `plugin.analyze`')
    expect(kernelSection).not.toContain('- `plugin.validate`')
  })
})
