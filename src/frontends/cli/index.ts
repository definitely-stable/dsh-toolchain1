import { parseArgs } from 'node:util'

import { createApplicationKernel } from '../../kernel/index.js'

export interface CliWriter {
  write(value: string): unknown
}

export interface CliIo {
  readonly stdout: CliWriter
  readonly stderr: CliWriter
}

export interface CliDependencies {
  readonly launchMcp: () => Promise<void>
}

const HELP = `DSH Toolchain

Usage:
  dsh-toolchain [--help] [--version]
  dsh-toolchain mcp

Commands:
  mcp              Serve DSH Toolchain over MCP stdio

Options:
  -h, --help       Show help
  -v, --version    Show version
`

async function launchMcp(): Promise<void> {
  const { launchMcpStdio } = await import('../mcp/index.js')
  await launchMcpStdio()
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
    io.stdout.write(`${createApplicationKernel().describe().version}\n`)
    return 0
  }

  if (parsed.positionals.length === 1 && parsed.positionals[0] === 'mcp') {
    if (parsed.values.version) {
      io.stderr.write('Error: --version cannot be combined with the mcp command\n')
      return 2
    }
    await dependencies.launchMcp()
    return 0
  }

  const command = parsed.positionals[0] ?? ''
  io.stderr.write(`Unknown command: ${command}\n`)
  return 2
}
