import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

import { createDshContractFilesystemAcquisition } from '../../acquisition/dsh-contract-filesystem.js'
import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import {
  createApplicationKernel,
  inspectContractResponse,
  resolveTargetResponse,
  searchContractsResponse,
  type ApplicationKernel,
} from '../../kernel/index.js'
import type {
  ContractInspectRequest,
  ContractKind,
  ContractSearchRequest,
  TargetResolveRequest,
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

const CONTRACT_KINDS = new Set<ContractKind>([
  'service',
  'method',
  'event',
  'tool',
  'client-slot',
  'config',
  'package',
])

const HELP = `DSH Toolchain

Usage:
  dsh-toolchain [--help] [--version]
  dsh-toolchain mcp
  dsh-toolchain target resolve --profile <name> [--dsh-home <path>] [--dsh-package-root <path>] [--patch <path> ...]
  dsh-toolchain contract search --profile <name> --query <text> [--kind <kind> ...] [--limit <1-25>] [target hints]
  dsh-toolchain contract inspect --profile <name> --contract-index <fingerprint> --contract-id <id> [target hints]

Commands:
  mcp                Serve DSH Toolchain over MCP stdio
  target resolve     Resolve one exact installed DSH target as Protocol v1 JSON
  contract search    Search deterministic contracts for one exact installed target
  contract inspect   Inspect one contract against an exact contract-index fingerprint

Options:
  -h, --help                 Show help
  -v, --version              Show version
      --profile <name>       DSH profile to resolve
      --dsh-home <path>      Override DSH_HOME for this read-only resolution
      --dsh-package-root <path>
                             Override the @deepseek-ai/dsh package root
      --patch <path>         Include an ordered DSH --patch overlay; repeatable
      --query <text>         Contract search text
      --kind <kind>          Filter contract search by kind; repeatable
      --limit <1-25>         Maximum contract search matches
      --contract-index <fingerprint>
                             Contract index fingerprint required by inspect
      --contract-id <id>     Contract id required by inspect
`

function createNodeKernel(): ApplicationKernel {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    contractAcquisition: createDshContractFilesystemAcquisition({ digest }),
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

type CliOptionValues = ReturnType<typeof parseArgs>['values']

function targetRequest(values: CliOptionValues): TargetResolveRequest | undefined {
  const profile = values.profile
  if (typeof profile !== 'string' || profile.length === 0) return undefined
  const patches = Array.isArray(values.patch)
    ? values.patch.filter((value): value is string => typeof value === 'string')
    : []

  return {
    profile,
    ...(typeof values['dsh-home'] === 'string' ? { dshHome: values['dsh-home'] } : {}),
    ...(typeof values['dsh-package-root'] === 'string'
      ? { dshPackageRoot: values['dsh-package-root'] }
      : {}),
    ...(patches.length === 0 ? {} : { patches: [...patches] }),
  }
}

function hasTargetHint(values: CliOptionValues): boolean {
  return values.profile !== undefined
    || values['dsh-home'] !== undefined
    || values['dsh-package-root'] !== undefined
    || values.patch !== undefined
}

function hasSearchOption(values: CliOptionValues): boolean {
  return values.query !== undefined || values.kind !== undefined || values.limit !== undefined
}

function hasInspectOption(values: CliOptionValues): boolean {
  return values['contract-index'] !== undefined || values['contract-id'] !== undefined
}

function hasOperationOption(values: CliOptionValues): boolean {
  return hasTargetHint(values) || hasSearchOption(values) || hasInspectOption(values)
}

function contractKinds(values: CliOptionValues): readonly ContractKind[] | undefined {
  if (values.kind === undefined) return undefined
  const raw = Array.isArray(values.kind) ? values.kind : [values.kind]
  const kinds: ContractKind[] = []
  for (const value of raw) {
    if (typeof value !== 'string' || !CONTRACT_KINDS.has(value as ContractKind)) return undefined
    kinds.push(value as ContractKind)
  }
  return kinds
}

function contractLimit(values: CliOptionValues): number | undefined | null {
  if (values.limit === undefined) return undefined
  if (typeof values.limit !== 'string' || !/^\d+$/u.test(values.limit)) return null
  const parsed = Number(values.limit)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 25 ? parsed : null
}

function contractSearchRequest(values: CliOptionValues): ContractSearchRequest | undefined {
  const target = targetRequest(values)
  const query = values.query
  if (target === undefined || typeof query !== 'string' || query.trim().length === 0) return undefined
  const kinds = contractKinds(values)
  if (values.kind !== undefined && kinds === undefined) return undefined
  const limit = contractLimit(values)
  if (limit === null) return undefined
  return {
    target,
    query,
    ...(kinds === undefined ? {} : { kinds: [...kinds] }),
    ...(limit === undefined ? {} : { limit }),
  }
}

function contractInspectRequest(values: CliOptionValues): ContractInspectRequest | undefined {
  const target = targetRequest(values)
  const contractIndexFingerprint = values['contract-index']
  const contractId = values['contract-id']
  if (
    target === undefined
    || typeof contractIndexFingerprint !== 'string'
    || contractIndexFingerprint.length === 0
    || typeof contractId !== 'string'
    || contractId.length === 0
  ) return undefined
  return { target, contractIndexFingerprint, contractId }
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
        patch: { type: 'string', multiple: true },
        query: { type: 'string' },
        kind: { type: 'string', multiple: true },
        limit: { type: 'string' },
        'contract-index': { type: 'string' },
        'contract-id': { type: 'string' },
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
    if (hasTargetHint(parsed.values) && !hasSearchOption(parsed.values) && !hasInspectOption(parsed.values)) {
      io.stderr.write('Error: target options require the target resolve command\n')
      return 2
    }
    if (hasOperationOption(parsed.values)) {
      io.stderr.write('Error: operation options require a target or contract command\n')
      return 2
    }
    io.stdout.write(`${(dependencies.kernel ?? createNodeKernel()).describe().version}\n`)
    return 0
  }

  if (parsed.positionals.length === 1 && parsed.positionals[0] === 'mcp') {
    if (parsed.values.version || hasOperationOption(parsed.values)) {
      io.stderr.write('Error: mcp cannot be combined with --version or operation options\n')
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
    if (parsed.values.version || hasSearchOption(parsed.values) || hasInspectOption(parsed.values)) {
      io.stderr.write('Error: target resolve cannot be combined with contract options\n')
      return 2
    }

    const request = targetRequest(parsed.values)
    if (request === undefined) {
      io.stderr.write('Error: --profile is required for target resolve\n')
      return 2
    }

    const requestId = (dependencies.requestId ?? randomUUID)()
    const kernel = dependencies.kernel ?? createNodeKernel()
    const response = await resolveTargetResponse(kernel, request, requestId)
    writeJson(io, response)
    return response.status === 'ok' ? 0 : 1
  }

  if (
    parsed.positionals.length === 2
    && parsed.positionals[0] === 'contract'
    && parsed.positionals[1] === 'search'
  ) {
    if (parsed.values.version || hasInspectOption(parsed.values)) {
      io.stderr.write('Error: contract search cannot be combined with --version or inspect options\n')
      return 2
    }
    if (targetRequest(parsed.values) === undefined) {
      io.stderr.write('Error: --profile is required for contract search\n')
      return 2
    }
    if (typeof parsed.values.query !== 'string' || parsed.values.query.trim().length === 0) {
      io.stderr.write('Error: --query is required for contract search\n')
      return 2
    }
    if (parsed.values.kind !== undefined && contractKinds(parsed.values) === undefined) {
      io.stderr.write('Error: --kind must be a supported contract kind\n')
      return 2
    }
    if (contractLimit(parsed.values) === null) {
      io.stderr.write('Error: --limit must be an integer from 1 to 25\n')
      return 2
    }

    const request = contractSearchRequest(parsed.values)
    if (request === undefined) throw new Error('validated contract search request could not be constructed')
    const requestId = (dependencies.requestId ?? randomUUID)()
    const kernel = dependencies.kernel ?? createNodeKernel()
    const response = await searchContractsResponse(kernel, request, requestId)
    writeJson(io, response)
    return response.status === 'ok' ? 0 : 1
  }

  if (
    parsed.positionals.length === 2
    && parsed.positionals[0] === 'contract'
    && parsed.positionals[1] === 'inspect'
  ) {
    if (parsed.values.version || hasSearchOption(parsed.values)) {
      io.stderr.write('Error: contract inspect cannot be combined with --version or search options\n')
      return 2
    }
    if (targetRequest(parsed.values) === undefined) {
      io.stderr.write('Error: --profile is required for contract inspect\n')
      return 2
    }
    if (typeof parsed.values['contract-index'] !== 'string' || parsed.values['contract-index'].length === 0) {
      io.stderr.write('Error: --contract-index is required for contract inspect\n')
      return 2
    }
    if (typeof parsed.values['contract-id'] !== 'string' || parsed.values['contract-id'].length === 0) {
      io.stderr.write('Error: --contract-id is required for contract inspect\n')
      return 2
    }

    const request = contractInspectRequest(parsed.values)
    if (request === undefined) throw new Error('validated contract inspect request could not be constructed')
    const requestId = (dependencies.requestId ?? randomUUID)()
    const kernel = dependencies.kernel ?? createNodeKernel()
    const response = await inspectContractResponse(kernel, request, requestId)
    writeJson(io, response)
    return response.status === 'ok' ? 0 : 1
  }

  const command = parsed.positionals.join(' ') || ''
  io.stderr.write(`Unknown command: ${command}\n`)
  return 2
}
