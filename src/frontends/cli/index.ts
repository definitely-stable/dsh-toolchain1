import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import { createApplicationKernel, type ApplicationKernel } from '../../kernel/index.js'
import { TargetAcquisitionError } from '../../model/target.js'
import {
  TOOLCHAIN_PROTOCOL_VERSION,
  type TargetResolveFailureResponse,
  type TargetResolveRequest,
  type TargetResolveSuccessResponse,
} from '../../protocol/index.js'

export interface CliWriter {
  write(value: string): unknown
}

export interface CliIo {
  readonly stdout: CliWriter
  readonly stderr: CliWriter
}

export interface CliDependencies {
  readonly launchMcp: () => Promise<void>
  readonly kernel?: ApplicationKernel
  readonly requestId?: () => string
}

const HELP = `DSH Toolchain

Usage:
  dsh-toolchain [--help] [--version]
  dsh-toolchain mcp
  dsh-toolchain target resolve --profile <name> [--dsh-home <path>] [--dsh-package-root <path>]

Commands:
  mcp              Serve DSH Toolchain over MCP stdio
  target resolve   Resolve one exact installed DSH target as Protocol v1 JSON

Options:
  -h, --help                 Show help
  -v, --version              Show version
      --profile <name>       DSH profile to resolve
      --dsh-home <path>      Override DSH_HOME for this read-only resolution
      --dsh-package-root <path>
                             Override the @deepseek-ai/dsh package root
`

function createNodeKernel(): ApplicationKernel {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    digest,
  })
}

async function launchMcp(): Promise<void> {
  const { launchMcpStdio } = await import('../mcp/index.js')
  await launchMcpStdio()
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value)}\n`)
}

function targetRequest(values: Record<string, string | boolean | undefined>): TargetResolveRequest | undefined {
  const profile = values.profile
  if (typeof profile !== 'string' || profile.length === 0) return undefined

  return {
    profile,
    ...(typeof values['dsh-home'] === 'string' ? { dshHome: values['dsh-home'] } : {}),
    ...(typeof values['dsh-package-root'] === 'string'
      ? { dshPackageRoot: values['dsh-package-root'] }
      : {}),
  }
}

function hasTargetOnlyOption(values: Record<string, string | boolean | undefined>): boolean {
  return values.profile !== undefined
    || values['dsh-home'] !== undefined
    || values['dsh-package-root'] !== undefined
}

export async function runCli(
  args: readonly string[],
  io: CliIo,
  dependencies: CliDependencies = { launchMcp },
): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>

  try {
    parsed = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        profile: { type: 'string' },
        'dsh-home': { type: 'string' },
        'dsh-package-root': { type: 'string' },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr.write(`Error: ${message}\n`)
    return 2
  }

  if (parsed.values.help || (parsed.positionals.length === 0 && !parsed.values.version)) {
    io.stdout.write(HELP)
    return 0
  }

  if (parsed.values.version && parsed.positionals.length === 0) {
    if (hasTargetOnlyOption(parsed.values)) {
      io.stderr.write('Error: target options require the target resolve command\n')
      return 2
    }
    io.stdout.write(`${(dependencies.kernel ?? createNodeKernel()).describe().version}\n`)
    return 0
  }

  if (parsed.positionals.length === 1 && parsed.positionals[0] === 'mcp') {
    if (parsed.values.version || hasTargetOnlyOption(parsed.values)) {
      io.stderr.write('Error: mcp cannot be combined with --version or target options\n')
      return 2
    }
    await dependencies.launchMcp()
    return 0
  }

  if (
    parsed.positionals.length === 2
    && parsed.positionals[0] === 'target'
    && parsed.positionals[1] === 'resolve'
  ) {
    if (parsed.values.version) {
      io.stderr.write('Error: --version cannot be combined with target resolve\n')
      return 2
    }

    const request = targetRequest(parsed.values)
    if (request === undefined) {
      io.stderr.write('Error: --profile is required for target resolve\n')
      return 2
    }

    const requestId = (dependencies.requestId ?? randomUUID)()
    const kernel = dependencies.kernel ?? createNodeKernel()
    try {
      const data = await kernel.resolveTarget(request)
      const response: TargetResolveSuccessResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        snapshotFingerprint: data.snapshot.fingerprint,
        status: 'ok',
        data,
        diagnostics: [],
      }
      writeJson(io, response)
      return 0
    } catch (error) {
      if (!(error instanceof TargetAcquisitionError)) throw error

      const response: TargetResolveFailureResponse = {
        protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
        requestId,
        status: 'failed',
        diagnostics: [{
          code: error.code,
          severity: 'error',
          domain: 'target',
          summary: error.message,
          ...(error.locations.length === 0 ? {} : { locations: [...error.locations] }),
        }],
      }
      writeJson(io, response)
      return 1
    }
  }

  const command = parsed.positionals.join(' ') || ''
  io.stderr.write(`Unknown command: ${command}\n`)
  return 2
}
