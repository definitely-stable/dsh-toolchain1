import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Diagnostic, TargetSnapshot, VerificationReport } from '../protocol/index.js'
import {
  fingerprintPackedArtifact,
  VerificationArtifactError,
} from './artifact.js'
import { createVerificationBootProbe } from './boot-probe.js'
import {
  classifyVerificationProcessFailure,
  classifyVerificationWorkerFailure,
  verificationDiagnostic,
} from './diagnostics.js'
import { createSafeVerificationEnvironment } from './environment.js'
import {
  runVerificationProcess,
  type VerificationProcessOutcome,
  type VerificationProcessRequest,
} from './process.js'
import {
  createM41StageLedger,
  failVerificationStage,
  passVerificationStage,
  skipVerificationStage,
} from './stages.js'

type VerificationCheck = VerificationReport['checks'][number]
type VerificationStageId = VerificationCheck['id']
type VerificationProcessRunner = (
  request: VerificationProcessRequest,
  signal?: AbortSignal,
) => Promise<VerificationProcessOutcome>
type VerificationProcessStageFailureCode =
  | 'VERIFY_INSTALL_FAILED'
  | 'VERIFY_COMPOSE_FAILED'
  | 'VERIFY_BOOT_FAILED'

const OUTPUT_LIMIT_BYTES = 128 * 1024
const INSTALL_TIMEOUT_MS = 300_000
const COMPOSE_TIMEOUT_MS = 120_000
const BOOT_TIMEOUT_MS = 120_000

export interface PackedVerificationArtifactInput {
  readonly path: string
  readonly expectedContentHash: string
}

export interface PackedPluginVerificationInput {
  readonly artifact: PackedVerificationArtifactInput
  readonly target: TargetSnapshot
  readonly executionPolicy: 'safe'
  readonly visibilityAssertions?: readonly unknown[]
}

export interface PackedPluginVerificationExecution {
  readonly artifactFingerprint?: string
  readonly targetFingerprint: string
  readonly executionPolicy: 'safe'
  readonly runtime: {
    readonly nodeVersion: string
    readonly platform: string
    readonly arch: string
  }
  readonly checks: readonly VerificationCheck[]
  readonly diagnostics: readonly Diagnostic[]
  readonly cleanup: VerificationReport['cleanup']
  readonly terminal: 'completed' | 'failed' | 'cancelled'
}

export interface PackedPluginVerificationDependencies {
  readonly processRunner?: VerificationProcessRunner
  readonly parentEnv?: Readonly<NodeJS.ProcessEnv>
  readonly createTemporaryRoot?: () => Promise<string>
  readonly cleanupTemporaryRoot?: (root: string) => Promise<void>
}

function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function processRequest(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): VerificationProcessRequest {
  return Object.freeze({
    command: pnpmCommand(),
    args: Object.freeze([...args]),
    cwd,
    env,
    timeoutMs,
    maxStdoutBytes: OUTPUT_LIMIT_BYTES,
    maxStderrBytes: OUTPUT_LIMIT_BYTES,
  })
}

function bootLauncherArgs(profile: string): readonly string[] {
  return Object.freeze([
    'exec',
    'dsh',
    '--profile',
    profile,
    ...(profile === 'web' ? ['--no-open', '--port', '0'] : []),
  ])
}

function hasExactBootMarker(stdout: string, marker: string): boolean {
  return stdout.split(/\r?\n/u).some(line => line === marker)
}

async function defaultTemporaryRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'dsh-toolchain-verify-'))
}

async function defaultCleanupTemporaryRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}

function artifactDiagnostic(error: VerificationArtifactError): Diagnostic {
  return verificationDiagnostic(error.code, error.message)
}

function stageFailureReason(diagnostic: Diagnostic): string {
  return diagnostic.code.toLowerCase().replaceAll('_', '-')
}

function freezeExecution(
  input: PackedPluginVerificationInput,
  artifactFingerprint: string | undefined,
  checks: readonly VerificationCheck[],
  diagnostics: readonly Diagnostic[],
  cleanup: VerificationReport['cleanup'],
  terminal: PackedPluginVerificationExecution['terminal'],
): PackedPluginVerificationExecution {
  return Object.freeze({
    ...(artifactFingerprint === undefined ? {} : { artifactFingerprint }),
    targetFingerprint: input.target.fingerprint,
    executionPolicy: 'safe' as const,
    runtime: Object.freeze({
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    }),
    checks: Object.freeze([...checks]),
    diagnostics: Object.freeze([...diagnostics]),
    cleanup,
    terminal,
  })
}

async function runRequiredProcess(
  runner: VerificationProcessRunner,
  request: VerificationProcessRequest,
  signal: AbortSignal | undefined,
  failureCode: VerificationProcessStageFailureCode,
): Promise<{
  readonly passed: boolean
  readonly diagnostic?: Diagnostic
  readonly terminal?: 'failed' | 'cancelled'
}> {
  let outcome: VerificationProcessOutcome
  try {
    outcome = await runner(request, signal)
  } catch {
    const failure = classifyVerificationWorkerFailure()
    return Object.freeze({
      passed: false,
      diagnostic: failure.diagnostic,
      terminal: failure.terminal,
    })
  }

  const failure = classifyVerificationProcessFailure(outcome, failureCode)
  if (failure === undefined) return Object.freeze({ passed: true })
  return Object.freeze({
    passed: false,
    diagnostic: failure.diagnostic,
    terminal: failure.terminal,
  })
}

function failStage(
  checks: readonly VerificationCheck[],
  stage: VerificationStageId,
  diagnostic: Diagnostic,
): readonly VerificationCheck[] {
  return failVerificationStage(checks, stage, stageFailureReason(diagnostic))
}

function recordProcessFailure(
  result: {
    readonly diagnostic?: Diagnostic
    readonly terminal?: 'failed' | 'cancelled'
  },
  stage: 'install' | 'compose' | 'boot',
  checks: readonly VerificationCheck[],
  diagnostics: Diagnostic[],
): {
  readonly checks: readonly VerificationCheck[]
  readonly terminal: 'failed' | 'cancelled'
} {
  const diagnostic = result.diagnostic
  if (diagnostic === undefined) throw new Error(`${stage} process failed without a diagnostic.`)
  diagnostics.push(diagnostic)
  return Object.freeze({
    checks: failStage(checks, stage, diagnostic),
    terminal: result.terminal ?? 'failed',
  })
}

/**
 * Executes the M4.1 packed-artifact runtime boundary under the safe policy.
 *
 * The temporary DSH home isolates candidate configuration and credentials from
 * the user's active profile. It is not a malicious-code security sandbox.
 */
export async function runPackedPluginVerification(
  input: PackedPluginVerificationInput,
  dependencies: PackedPluginVerificationDependencies = {},
  signal?: AbortSignal,
): Promise<PackedPluginVerificationExecution> {
  if (input.executionPolicy !== 'safe') {
    throw new Error('M4.1 packed verification supports only the safe execution policy.')
  }

  const processRunner = dependencies.processRunner ?? runVerificationProcess
  const parentEnv = dependencies.parentEnv ?? process.env
  const createTemporaryRoot = dependencies.createTemporaryRoot ?? defaultTemporaryRoot
  const cleanupTemporaryRoot = dependencies.cleanupTemporaryRoot ?? defaultCleanupTemporaryRoot

  let checks = createM41StageLedger()
  const diagnostics: Diagnostic[] = []
  let artifactFingerprint: string | undefined
  let terminal: PackedPluginVerificationExecution['terminal'] = 'failed'
  let cleanup: VerificationReport['cleanup'] = 'not-required'
  let root: string | undefined
  let stopped = false

  try {
    root = await createTemporaryRoot()

    const runnerDir = path.join(root, 'runner')
    const dshHome = path.join(root, 'dsh-home')
    const userHome = path.join(root, 'home')
    const tempDir = path.join(root, 'tmp')
    const artifactDir = path.join(root, 'artifact')
    const candidateCopy = path.join(artifactDir, 'candidate.tgz')

    await Promise.all([
      mkdir(runnerDir, { recursive: true }),
      mkdir(dshHome, { recursive: true }),
      mkdir(userHome, { recursive: true }),
      mkdir(tempDir, { recursive: true }),
      mkdir(artifactDir, { recursive: true }),
    ])
    await writeFile(path.join(runnerDir, 'package.json'), '{"private":true}\n', { flag: 'wx' })

    try {
      const artifact = await fingerprintPackedArtifact(
        input.artifact.path,
        input.artifact.expectedContentHash,
      )
      artifactFingerprint = artifact.fingerprint
      await writeFile(candidateCopy, artifact.bytes, { flag: 'wx' })
      await fingerprintPackedArtifact(candidateCopy, artifact.contentHash)
      checks = passVerificationStage(checks, 'package')
    } catch (cause) {
      const error = cause instanceof VerificationArtifactError
        ? cause
        : new VerificationArtifactError(
          'VERIFY_ARTIFACT_READ_FAILED',
          'Packed verification artifact could not be staged for execution.',
          { cause },
        )
      const diagnostic = artifactDiagnostic(error)
      diagnostics.push(diagnostic)
      checks = failStage(checks, 'package', diagnostic)
      terminal = 'failed'
      stopped = true
    }

    const env = createSafeVerificationEnvironment(parentEnv, { dshHome, userHome, tempDir })

    if (!stopped) {
      const installDsh = await runRequiredProcess(
        processRunner,
        processRequest(
          ['add', '--save-exact', '--ignore-scripts', `@deepseek-ai/dsh@${input.target.dsh.version}`],
          runnerDir,
          env,
          INSTALL_TIMEOUT_MS,
        ),
        signal,
        'VERIFY_INSTALL_FAILED',
      )
      if (!installDsh.passed) {
        const failure = recordProcessFailure(installDsh, 'install', checks, diagnostics)
        checks = failure.checks
        terminal = failure.terminal
        stopped = true
      }
    }

    if (!stopped) {
      const installCandidate = await runRequiredProcess(
        processRunner,
        processRequest(
          ['exec', 'dsh', 'plugin', '--profile', input.target.profile.name, 'add', '--ignore-scripts', candidateCopy],
          runnerDir,
          env,
          INSTALL_TIMEOUT_MS,
        ),
        signal,
        'VERIFY_INSTALL_FAILED',
      )
      if (!installCandidate.passed) {
        const failure = recordProcessFailure(installCandidate, 'install', checks, diagnostics)
        checks = failure.checks
        terminal = failure.terminal
        stopped = true
      }
    }

    if (!stopped) checks = passVerificationStage(checks, 'install')

    if (!stopped) {
      const compose = await runRequiredProcess(
        processRunner,
        processRequest(
          ['exec', 'dsh', '--profile', input.target.profile.name, '--dump-config'],
          runnerDir,
          env,
          COMPOSE_TIMEOUT_MS,
        ),
        signal,
        'VERIFY_COMPOSE_FAILED',
      )
      if (!compose.passed) {
        const failure = recordProcessFailure(compose, 'compose', checks, diagnostics)
        checks = failure.checks
        terminal = failure.terminal
        stopped = true
      }
    }

    if (!stopped) checks = passVerificationStage(checks, 'compose')

    let bootProbe: Awaited<ReturnType<typeof createVerificationBootProbe>> | undefined
    if (!stopped) {
      try {
        bootProbe = await createVerificationBootProbe(root, input.target.profile.name)
      } catch {
        const diagnostic = verificationDiagnostic(
          'VERIFY_BOOT_FAILED',
          'Verification boot probe could not be prepared in the temporary environment.',
        )
        diagnostics.push(diagnostic)
        checks = failStage(checks, 'boot', diagnostic)
        terminal = 'failed'
        stopped = true
      }
    }

    if (!stopped && bootProbe !== undefined) {
      const installProbe = await runRequiredProcess(
        processRunner,
        processRequest(
          [
            'exec',
            'dsh',
            'plugin',
            '--profile',
            input.target.profile.name,
            'add',
            '--ignore-scripts',
            bootProbe.packagePath,
          ],
          runnerDir,
          env,
          INSTALL_TIMEOUT_MS,
        ),
        signal,
        'VERIFY_BOOT_FAILED',
      )
      if (!installProbe.passed) {
        const failure = recordProcessFailure(installProbe, 'boot', checks, diagnostics)
        checks = failure.checks
        terminal = failure.terminal
        stopped = true
      }
    }

    let bootOutcome: VerificationProcessOutcome | undefined
    if (!stopped && bootProbe !== undefined) {
      try {
        bootOutcome = await processRunner(
          processRequest(
            bootLauncherArgs(input.target.profile.name),
            runnerDir,
            env,
            BOOT_TIMEOUT_MS,
          ),
          signal,
        )
      } catch {
        const failure = recordProcessFailure(
          classifyVerificationWorkerFailure(),
          'boot',
          checks,
          diagnostics,
        )
        checks = failure.checks
        terminal = failure.terminal
        stopped = true
      }
    }

    if (!stopped && bootProbe !== undefined && bootOutcome !== undefined) {
      const bootFailure = classifyVerificationProcessFailure(bootOutcome, 'VERIFY_BOOT_FAILED')
      if (bootFailure !== undefined) {
        const failure = recordProcessFailure(bootFailure, 'boot', checks, diagnostics)
        checks = failure.checks
        terminal = failure.terminal
        stopped = true
      } else if (
        bootOutcome.kind !== 'exited'
        || bootOutcome.code !== 0
        || !hasExactBootMarker(bootOutcome.stdout, bootProbe.marker)
      ) {
        const diagnostic = verificationDiagnostic(
          'VERIFY_BOOT_FAILED',
          'DSH boot completed without the exact Toolchain verification probe marker.',
        )
        diagnostics.push(diagnostic)
        checks = failStage(checks, 'boot', diagnostic)
        terminal = 'failed'
        stopped = true
      }
    }

    if (!stopped) {
      checks = passVerificationStage(checks, 'boot')
      if ((input.visibilityAssertions?.length ?? 0) > 0) {
        checks = skipVerificationStage(checks, 'visibility', 'visibility-assertions-not-supported-in-m4.1')
      }
      terminal = 'completed'
    }
  } finally {
    if (root !== undefined) {
      try {
        await cleanupTemporaryRoot(root)
        cleanup = 'succeeded'
      } catch {
        cleanup = 'failed'
        diagnostics.push(verificationDiagnostic(
          'VERIFY_CLEANUP_FAILED',
          'Verification temporary environment cleanup failed.',
        ))
      }
    }
  }

  return freezeExecution(input, artifactFingerprint, checks, diagnostics, cleanup, terminal)
}
