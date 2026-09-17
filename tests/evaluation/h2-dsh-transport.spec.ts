import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'

import {
  assertModelOptionAdvertised,
  createAcpControlPlane,
  createProcessAcpTransport,
  modelConfigOptionValue,
} from '../../scripts/eval/h2/h2-dsh.mjs'

/**
 * Minimal stand-in for a spawned child. The transport only touches
 * `stdout`/`stderr` data events, `stdin` writes, and lifecycle events.
 */
function createFakeChild() {
  const writes: string[] = []
  const child: any = new EventEmitter()
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  child.stdin = {
    write: (text: string) => {
      writes.push(text)
      return true
    },
    end: () => {},
  }
  child.writes = writes
  return child
}

describe('H2 ACP model option', () => {
  it('sends the model option as the JSON provider/model pair the target advertises', async () => {
    // The acp `model` option is a select whose value is `["<provider>","<model>"]`.
    // Sending a bare model id is answered with `unknown model option` and the
    // target does not fall back to its default model, so a wrong shape fails
    // every observation at its first request rather than degrading quietly.
    expect(modelConfigOptionValue({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' })).toBe('["opencode-go","deepseek-v4.1-flash"]')
    expect(() => modelConfigOptionValue({ provider: '', model: 'x' })).toThrow(/provider/)
    expect(() => modelConfigOptionValue({ provider: 'x', model: '' })).toThrow(/model/)
  })

  it('proves the frozen route is offered before any token is spent', () => {
    const configOptions = [
      {
        id: 'model',
        options: [
          { group: 'deepseek-official', options: [{ value: '["deepseek-official","deepseek-flash"]' }] },
          { group: 'opencode-go', options: [{ value: '["opencode-go","deepseek-v4.1-flash"]' }] },
        ],
      },
    ]
    const frozen = modelConfigOptionValue({ provider: 'opencode-go', model: 'deepseek-v4.1-flash' })
    expect(assertModelOptionAdvertised({ configOptions, value: frozen })).toBe(true)
    expect(() => assertModelOptionAdvertised({ configOptions, value: '["opencode-go","glm-5.3"]' })).toThrow(/does not offer/)
    expect(() => assertModelOptionAdvertised({ configOptions: [{ id: 'reasoning_effort', options: [] }], value: frozen })).toThrow(/model config option/)
  })
})

describe('H2 ACP process transport', () => {
  it('launches a Windows shim through the platform shell and quotes arguments', () => {
    let captured: { command: string; args: string[]; options: any } | undefined
    const transport = createProcessAcpTransport({
      command: 'pnpm',
      args: ['--dir', 'C:\\Program Files\\dsh', 'dsh', '--profile', 'acp'],
      cwd: 'C:\\checkout',
      env: {},
      spawnImpl: (command: string, args: string[], options: any) => {
        captured = { command, args, options }
        return createFakeChild()
      },
    })
    // Node resolves the launcher to a `.cmd` shim on Windows and refuses to
    // spawn a batch file without a shell; the arguments must then be quoted by
    // hand, because `shell: true` concatenates them without escaping. On a
    // platform without shims the same arguments are passed through verbatim,
    // which is what the Linux scoring runner sees.
    const expectedArgs = process.platform === 'win32'
      ? ['--dir', '"C:\\Program Files\\dsh"', 'dsh', '--profile', 'acp']
      : ['--dir', 'C:\\Program Files\\dsh', 'dsh', '--profile', 'acp']
    expect(captured?.command).toBe('pnpm')
    expect(captured?.options.shell).toBe(process.platform === 'win32')
    expect(captured?.args).toEqual(expectedArgs)
    expect(typeof transport.send).toBe('function')
  })

  it('fails a pending request when the child exits instead of waiting forever', async () => {
    const child = createFakeChild()
    const transport = createProcessAcpTransport({
      command: 'pnpm',
      args: ['--dir', 'C:\\checkout', 'dsh', '--profile', 'acp'],
      cwd: 'C:\\checkout',
      env: {},
      shell: false,
      spawnImpl: () => child,
    })
    const client = createAcpControlPlane({ transport })
    const pending = client.initialize()
    expect(child.writes).toHaveLength(1)
    child.emit('exit', 1, null)
    // A launcher that cannot even start used to leave the caller awaiting a
    // promise that could never settle; the exit must surface as a failure.
    await expect(pending).rejects.toThrow(/exited before "initialize"/)
  })
})
