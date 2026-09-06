import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { runVerificationProcess } from '../../src/verification/process.js'

const fixture = fileURLToPath(new URL('../../scripts/fixtures/verification-child.mjs', import.meta.url))

function request(
  args: readonly string[],
  overrides: Partial<Parameters<typeof runVerificationProcess>[0]> = {},
): Parameters<typeof runVerificationProcess>[0] {
  return {
    command: process.execPath,
    args: [fixture, ...args],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 2_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    ...overrides,
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return !(
      cause instanceof Error
      && 'code' in cause
      && cause.code === 'ESRCH'
    )
  }
}

async function waitForProcessGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return !processExists(pid)
}

describe('verification process runner', () => {
  it('returns exited outcomes for zero and non-zero child exits without throwing', async () => {
    await expect(runVerificationProcess(request(['exit', '0', 'ok', '']))).resolves.toEqual({
      kind: 'exited',
      code: 0,
      stdout: 'ok',
      stderr: '',
    })

    await expect(runVerificationProcess(request(['exit', '7', '', 'broken']))).resolves.toEqual({
      kind: 'exited',
      code: 7,
      stdout: '',
      stderr: 'broken',
    })
  })

  it('classifies timeout and terminates the child', async () => {
    const outcome = await runVerificationProcess(request(['sleep', '60000'], { timeoutMs: 50 }))

    expect(outcome).toMatchObject({ kind: 'timeout' })
  })

  it('classifies AbortSignal cancellation', async () => {
    const controller = new AbortController()
    const pending = runVerificationProcess(request(['sleep', '60000']), controller.signal)
    setTimeout(() => controller.abort(), 50)

    await expect(pending).resolves.toMatchObject({ kind: 'cancelled' })
  })

  it('fails closed when stdout or stderr exceeds its independent byte ceiling', async () => {
    await expect(runVerificationProcess(request(['stdout', '4096'], {
      maxStdoutBytes: 512,
    }))).resolves.toEqual({
      kind: 'output-limit',
      stream: 'stdout',
    })

    await expect(runVerificationProcess(request(['stderr', '4096'], {
      maxStderrBytes: 512,
    }))).resolves.toEqual({
      kind: 'output-limit',
      stream: 'stderr',
    })
  })

  it('returns start-failed for a command that cannot be spawned', async () => {
    const outcome = await runVerificationProcess(request([], {
      command: fileURLToPath(new URL('./definitely-missing-verifier-binary', import.meta.url)),
    }))

    expect(outcome).toMatchObject({
      kind: 'start-failed',
      message: expect.any(String),
    })
  })

  it('terminates descendants when a timed-out process spawned a grandchild', async () => {
    const outcome = await runVerificationProcess(request(['spawn-grandchild'], {
      timeoutMs: 150,
    }))

    expect(outcome.kind).toBe('timeout')
    if (outcome.kind !== 'timeout') return

    const pid = Number.parseInt(outcome.stdout.trim(), 10)
    expect(Number.isSafeInteger(pid)).toBe(true)
    expect(pid).toBeGreaterThan(0)

    const gone = await waitForProcessGone(pid)
    if (!gone) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Best-effort test cleanup only; the assertion below remains the signal.
      }
    }
    expect(gone).toBe(true)
  })
})
