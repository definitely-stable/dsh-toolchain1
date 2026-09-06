import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

import { createDshContractFilesystemAcquisition } from '../../acquisition/dsh-contract-filesystem.js'
import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import { createPluginSubjectAcquisition } from '../../acquisition/plugin-subject.js'
import {
  checkPluginResponse,
  createApplicationKernel,
  inspectContractResponse,
  resolveTargetResponse,
  searchContractsResponse,
  verifyPluginResponse,
  type ApplicationKernel,
  type VerificationApplicationKernel,
} from '../../kernel/index.js'
import {
  CONTRACT_INDEX_FINGERPRINT_PATTERN,
  CONTRACT_KINDS,
  parseContractInspectRequest,
  parseContractSearchRequest,
  parsePluginCheckRequest,
  parsePluginVerifyRequest,
  parseTargetResolveRequest,
  type ContractInspectRequest,
  type ContractKind,
  type ContractSearchRequest,
  type PluginCheckRequest,
  type PluginVerifyRequest,
  type TargetResolveRequest,
} from '../../protocol/index.js'
import { createPackedPluginVerificationExecutionPort } from '../../verification/execution-port.js'

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

const contractKindSet = new Set<ContractKind>(CONTRACT_KINDS)

const HELP = `DSH Toolchain

Usage:
  dsh-toolchain [--help] [--version]
  dsh-toolchain mcp
  dsh-toolchain target resolve --profile <name> [--dsh-home <path>] [--dsh-package-root <path>] [--patch <path> ...]
  dsh-toolchain contract search --profile <name> --query <text> [--kind <kind> ...] [--limit <1-25>] [target hints]
  dsh-toolchain contract inspect --profile <name> --contract-index <fingerprint> --contract-id <id> [target hints]
  dsh-toolchain plugin check --profile <name> --subject <directory-or-tgz> [target hints]
  dsh-toolchain plugin verify --profile <name> --subject <packed.tgz> [target hints]

Commands:
  mcp                Serve DSH Toolchain over MCP stdio
  target resolve     Resolve one exact installed DSH target as Protocol v1 JSON
  contract search    Search deterministic contracts for one exact installed target
  contract inspect   Inspect one contract against an exact contract-index fingerprint
  plugin check       Check one plugin directory or packed .tgz against an exact installed DSH target
  plugin verify      Execute one packed .tgz in an isolated temporary DSH environment and return a verification receipt

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
      --subject <path>       Plugin directory or packed .tgz; plugin verify requires packed .tgz
`

function createNodeKernel(): VerificationApplicationKernel {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    contractAcquisition: createDshContractFilesystemAcquisition({ digest }),
    pluginSubjectAcquisition: createPluginSubjectAcquisition(digest),
    pluginVerificationExecution: createPackedPluginVerificationExecutionPort(),
    digest,
  })
}

function verificationKernel(kernel: ApplicationKernel): VerificationApplicationKernel | undefined {
  return typeof kernel.verifyPlugin === 'function'
    ? kernel as VerificationApplicationKernel
    : undefined
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

  const candidate = {
    profile,
    ...(typeof values['dsh-home'] === 'string' ? { dshHome: values['dsh-home'] } : {}),
    ...(typeof values['dsh-package-root'] === 'string'
      ? { dshPackageRoot: values['dsh-package-root'] }
      : {}),
    ...(patches.length === 0 ? {} : { patches: [...patches] }),
  }
  try {
    return parseTargetResolveRequest(candidate)
  } catch {
    return undefined
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

function hasPluginOption(values: CliOptionValues): boolean {
  return values.subject !== undefined
}

function hasOperationOption(values: CliOptionValues): boolean {
  return hasTargetHint(values)
    || hasSearchOption(values)
    || hasInspectOption(values)
    || hasPluginOption(values)
}

function contractKinds(values: CliOptionValues): readonly ContractKind[] | undefined {
  if (values.kind === undefined) return undefined
  const raw = Array.isArray(values.kind) ? values.kind : [values.kind]
  const kinds: ContractKind[] = []
  for (const value of raw) {
    if (typeof value !== 'string' || !contractKindSet.has(value as ContractKind)) return undefined
    kinds.push(value as ContractKind)
  }
  return new Set(kinds).size === kinds.length ? kinds : undefined
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
  try {
    return parseContractSearchRequest({
      target,
      query,
      ...(kinds === undefined ? {} : { kinds: [...kinds] }),
      ...(limit === undefined ? {} : { limit }),
    })
  } catch {
    return undefined
  }
}

function contractInspectRequest(values: CliOptionValues): ContractInspectRequest | undefined {
  const target = targetRequest(values)
  const contractIndexFingerprint = values['contract-index']
  const contractId = values['contract-id']
  if (
    target === undefined
    || typeof contractIndexFingerprint !== 'string'
    || typeof contractId !== 'string'
  ) return undefined
  try {
    return parseContractInspectRequest({ target, contractIndexFingerprint, contractId })
  } catch {
    return undefined
  }
}

function pluginCheckRequest(values: CliOptionValues): PluginCheckRequest | undefined {
  const target = targetRequest(values)
  const subject = values.subject
  if (target === undefined || typeof subject !== 'string' || subject.trim().length === 0) return undefined
  const kind = subject.toLowerCase().endsWith('.tgz') ? 'packed' : 'directory'
  try {
    return parsePluginCheckRequest({
      target,
      subject: { kind, path: subject },
    })
  } catch {
    return undefined
  }
}

function pluginVerifyRequest(values: CliOptionValues): PluginVerifyRequest | undefined {
  const target = targetRequest(values)
  const subject = values.subject
  if (
    target === undefined
    || typeof subject !== 'string'
    || subject.trim().length === 0
    || !subject.toLowerCase().endsWith('.tgz')
  ) return undefined
  try {
    return parsePluginVerifyRequest({
      target,
      subject: { kind: 'packed', path: subject },
      executionPolicy: 'safe',
    })
  } catch {
    return undefined
  }
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
        subject: { type: 'string' },
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
    if (
      hasTargetHint(parsed.values)
      && !hasSearchOption(parsed.values)
      && !hasInspectOption(parsed.values)
      && !hasPluginOption(parsed.values)
    ) {
      io.stderr.write('Error: target options require the target resolve command\n')
      return 2
    }
    if (hasOperationOption(parsed.values)) {
      io.stderr.write('Error: operation options require a target, contract, or plugin command\n')
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
    if (
      parsed.values.version
      || hasSearchOption(parsed.values)
      || hasInspectOption(parsed.values)
      || hasPluginOption(parsed.values)
    ) {
      io.stderr.write('Error: target resolve cannot be combined with contract or plugin options\n')
      return 2
    }

    const request = targetRequest(parsed.values)
    if (request === undefined) {
      io.stderr.write('Error: --profile must be a valid profile for target resolve\n')
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
    if (parsed.values.version || hasInspectOption(parsed.values) || hasPluginOption(parsed.values)) {
      io.stderr.write('Error: contract search cannot be combined with --version, inspect, or plugin options\n')
      return 2
    }
    if (targetRequest(parsed.values) === undefined) {
      io.stderr.write('Error: --profile must be a valid profile for contract search\n')
      return 2
    }
    if (typeof parsed.values.query !== 'string' || parsed.values.query.trim().length === 0) {
      io.stderr.write('Error: --query is required for contract search\n')
      return 2
    }
    if (parsed.values.kind !== undefined && contractKinds(parsed.values) === undefined) {
      io.stderr.write('Error: --kind must be a supported, non-duplicate contract kind\n')
      return 2
    }
    if (contractLimit(parsed.values) === null) {
      io.stderr.write('Error: --limit must be an integer from 1 to 25\n')
      return 2
    }

    const request = contractSearchRequest(parsed.values)
    if (request === undefined) {
      io.stderr.write('Error: invalid contract search request\n')
      return 2
    }
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
    if (parsed.values.version || hasSearchOption(parsed.values) || hasPluginOption(parsed.values)) {
      io.stderr.write('Error: contract inspect cannot be combined with --version, search, or plugin options\n')
      return 2
    }
    if (targetRequest(parsed.values) === undefined) {
      io.stderr.write('Error: --profile must be a valid profile for contract inspect\n')
      return 2
    }
    if (typeof parsed.values['contract-index'] !== 'string' || parsed.values['contract-index'].length === 0) {
      io.stderr.write('Error: --contract-index is required for contract inspect\n')
      return 2
    }
    if (!CONTRACT_INDEX_FINGERPRINT_PATTERN.test(parsed.values['contract-index'])) {
      io.stderr.write('Error: --contract-index must be a valid dsh-contract-index-v1 fingerprint\n')
      return 2
    }
    if (typeof parsed.values['contract-id'] !== 'string' || parsed.values['contract-id'].length === 0) {
      io.stderr.write('Error: --contract-id is required for contract inspect\n')
      return 2
    }

    const request = contractInspectRequest(parsed.values)
    if (request === undefined) {
      io.stderr.write('Error: invalid contract inspect request\n')
      return 2
    }
    const requestId = (dependencies.requestId ?? randomUUID)()
    const kernel = dependencies.kernel ?? createNodeKernel()
    const response = await inspectContractResponse(kernel, request, requestId)
    writeJson(io, response)
    return response.status === 'ok' ? 0 : 1
  }

  if (
    parsed.positionals.length === 2
    && parsed.positionals[0] === 'plugin'
    && parsed.positionals[1] === 'check'
  ) {
    if (parsed.values.version || hasSearchOption(parsed.values) || hasInspectOption(parsed.values)) {
      io.stderr.write('Error: plugin check cannot be combined with --version or contract options\n')
      return 2
    }
    if (targetRequest(parsed.values) === undefined) {
      io.stderr.write('Error: --profile must be a valid profile for plugin check\n')
      return 2
    }
    if (typeof parsed.values.subject !== 'string' || parsed.values.subject.trim().length === 0) {
      io.stderr.write('Error: --subject is required for plugin check\n')
      return 2
    }

    const request = pluginCheckRequest(parsed.values)
    if (request === undefined) {
      io.stderr.write('Error: invalid plugin check request\n')
      return 2
    }
    const requestId = (dependencies.requestId ?? randomUUID)()
    const kernel = dependencies.kernel ?? createNodeKernel()
    const response = await checkPluginResponse(kernel, request, requestId)
    writeJson(io, response)
    return response.status === 'ok' && response.data.verdict === 'compatible-in-scope' ? 0 : 1
  }

  if (
    parsed.positionals.length === 2
    && parsed.positionals[0] === 'plugin'
    && parsed.positionals[1] === 'verify'
  ) {
    if (parsed.values.version || hasSearchOption(parsed.values) || hasInspectOption(parsed.values)) {
      io.stderr.write('Error: plugin verify cannot be combined with --version or contract options\n')
      return 2
    }
    if (targetRequest(parsed.values) === undefined) {
      io.stderr.write('Error: --profile must be a valid profile for plugin verify\n')
      return 2
    }
    if (typeof parsed.values.subject !== 'string' || parsed.values.subject.trim().length === 0) {
      io.stderr.write('Error: --subject is required for plugin verify\n')
      return 2
    }
    if (!parsed.values.subject.toLowerCase().endsWith('.tgz')) {
      io.stderr.write('Error: plugin verify requires a packed .tgz subject\n')
      return 2
    }

    const request = pluginVerifyRequest(parsed.values)
    if (request === undefined) {
      io.stderr.write('Error: invalid plugin verify request\n')
      return 2
    }
    const requestId = (dependencies.requestId ?? randomUUID)()
    const kernel = verificationKernel(dependencies.kernel ?? createNodeKernel())
    if (kernel === undefined) {
      io.stderr.write('Error: plugin verification execution is not configured\n')
      return 1
    }
    const response = await verifyPluginResponse(kernel, request, requestId)
    writeJson(io, response)
    return response.status === 'ok' && response.data.status === 'verified' ? 0 : 1
  }

  const command = parsed.positionals.join(' ') || ''
  io.stderr.write(`Unknown command: ${command}\n`)
  return 2
}
