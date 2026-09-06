import { spawn, type ChildProcess } from 'node:child_process'

export interface VerificationProcessRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
}

export type VerificationProcessOutcome =
  | { readonly kind: 'exited'; readonly code: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'signalled'; readonly signal: string; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'timeout'; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'cancelled'; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'output-limit'; readonly stream: 'stdout' | 'stderr' }
  | { readonly kind: 'start-failed'; readonly message: string }

type ForcedOutcome = 'timeout' | 'cancelled' | { readonly kind: 'output-limit'; readonly stream: 'stdout' | 'stderr' }

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Verification process ${name} must be a positive integer.`)
  }
}

function capturedText(chunks: readonly Buffer[]): string {
  return chunks.length === 0 ? '' : Buffer.concat(chunks).toString('utf8')
}

function waitForChild(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('error', finish)
      child.off('close', finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    child.once('error', finish)
    child.once('close', finish)
  })
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    await waitForChild(killer, 5_000)
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        // The child may already have exited between the state check and kill.
      }
    }
    return
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // The process may already have exited; close/error will settle the runner.
    }
  }
}

export function runVerificationProcess(
  request: VerificationProcessRequest,
  signal?: AbortSignal,
): Promise<VerificationProcessOutcome> {
  assertPositiveInteger('timeoutMs', request.timeoutMs)
  assertPositiveInteger('maxStdoutBytes', request.maxStdoutBytes)
  assertPositiveInteger('maxStderrBytes', request.maxStderrBytes)

  if (signal?.aborted === true) {
    return Promise.resolve({ kind: 'cancelled', stdout: '', stderr: '' })
  }

  return new Promise(resolve => {
    let child: ChildProcess
    try {
      child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
    } catch (cause) {
      resolve({
        kind: 'start-failed',
        message: cause instanceof Error ? cause.message : String(cause),
      })
      return
    }

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let forced: ForcedOutcome | undefined
    let terminationStarted = false
    let settled = false

    const stdout = (): string => capturedText(stdoutChunks)
    const stderr = (): string => capturedText(stderrChunks)

    const cleanup = (): void => {
      clearTimeout(timeout)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    }

    const finish = (outcome: VerificationProcessOutcome): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(outcome)
    }

    const forceTermination = (outcome: ForcedOutcome): void => {
      if (forced !== undefined) return
      forced = outcome
      if (terminationStarted) return
      terminationStarted = true
      void terminateProcessTree(child).catch(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Close/error still owns final outcome classification.
        }
      })
    }

    const onAbort = (): void => forceTermination('cancelled')
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })

    const timeout = setTimeout(() => forceTermination('timeout'), request.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (forced !== undefined) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (stdoutBytes + bytes.length > request.maxStdoutBytes) {
        forceTermination({ kind: 'output-limit', stream: 'stdout' })
        return
      }
      stdoutBytes += bytes.length
      stdoutChunks.push(Buffer.from(bytes))
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (forced !== undefined) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (stderrBytes + bytes.length > request.maxStderrBytes) {
        forceTermination({ kind: 'output-limit', stream: 'stderr' })
        return
      }
      stderrBytes += bytes.length
      stderrChunks.push(Buffer.from(bytes))
    })

    child.once('error', error => {
      if (forced !== undefined) return
      finish({ kind: 'start-failed', message: error.message })
    })

    child.once('close', (code, closeSignal) => {
      if (forced !== undefined) {
        if (typeof forced === 'object') {
          finish(forced)
        } else {
          finish({ kind: forced, stdout: stdout(), stderr: stderr() })
        }
        return
      }

      if (code !== null) {
        finish({ kind: 'exited', code, stdout: stdout(), stderr: stderr() })
        return
      }
      if (closeSignal !== null) {
        finish({ kind: 'signalled', signal: closeSignal, stdout: stdout(), stderr: stderr() })
        return
      }
      finish({ kind: 'signalled', signal: 'unknown', stdout: stdout(), stderr: stderr() })
    })
  })
}
