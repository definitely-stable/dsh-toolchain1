import { describe, expect, it, vi } from 'vitest'

import { runCli } from '../../src/frontends/cli/index.js'

function captureIo() {
  let stdout = ''
  let stderr = ''
  return {
    io: {
      stdout: { write: (value: string) => { stdout += value } },
      stderr: { write: (value: string) => { stderr += value } },
    },
    output: () => ({ stdout, stderr }),
  }
}

describe('CLI', () => {
  it('prints deterministic help to stdout', async () => {
    const { io, output } = captureIo()
    const code = await runCli(['--help'], io)

    expect(code).toBe(0)
    expect(output().stderr).toBe('')
    expect(output().stdout).toContain('Usage:')
    expect(output().stdout).toContain('dsh-toolchain mcp')
    expect(output().stdout).not.toContain('target.resolve')
    expect(output().stdout).not.toContain('plugin.verify')
  })

  it('prints the shared product version to stdout', async () => {
    const { io, output } = captureIo()
    const code = await runCli(['--version'], io)

    expect(code).toBe(0)
    expect(output()).toEqual({ stdout: '0.0.0\n', stderr: '' })
  })

  it('fails unknown commands without contaminating stdout', async () => {
    const { io, output } = captureIo()
    const code = await runCli(['verify'], io)

    expect(code).toBe(2)
    expect(output().stdout).toBe('')
    expect(output().stderr).toContain('Unknown command: verify')
  })

  it('hands mcp off without reimplementing the server', async () => {
    const { io, output } = captureIo()
    const launchMcp = vi.fn(async () => undefined)
    const code = await runCli(['mcp'], io, { launchMcp })

    expect(code).toBe(0)
    expect(launchMcp).toHaveBeenCalledOnce()
    expect(output()).toEqual({ stdout: '', stderr: '' })
  })
})
