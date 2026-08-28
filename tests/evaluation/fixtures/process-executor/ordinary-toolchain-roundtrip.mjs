import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
let phase = 'start'
let contractIndexFingerprint

for await (const line of input) {
  const message = JSON.parse(line)

  if (phase === 'start') {
    if (message.type !== 'start') {
      process.stderr.write(`expected start, got ${message.type}\n`)
      process.exitCode = 2
      break
    }
    process.stdout.write(`${JSON.stringify({
      type: 'tool_call',
      id: 'read-1',
      name: 'read_file',
      input: {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
        startLine: 1,
        lineCount: 20,
      },
    })}\n`)
    phase = 'read-result'
    continue
  }

  if (phase === 'read-result') {
    if (message.type !== 'tool_result' || message.id !== 'read-1') {
      process.stderr.write(`expected read tool_result, got ${message.type}\n`)
      process.exitCode = 3
      break
    }
    if (!String(message.result?.content ?? '').includes('dsh-tools')) {
      process.stderr.write('ordinary read result did not expose expected published docs\n')
      process.exitCode = 4
      break
    }
    process.stdout.write(`${JSON.stringify({
      type: 'tool_call',
      id: 'search-1',
      name: 'toolchain_contract_search',
      input: {
        target: { profile: 'web' },
        query: 'ToolRuntimeScheduler',
        limit: 5,
      },
    })}\n`)
    phase = 'search-result'
    continue
  }

  if (phase === 'search-result') {
    if (message.type !== 'tool_result' || message.id !== 'search-1') {
      process.stderr.write(`expected search tool_result, got ${message.type}\n`)
      process.exitCode = 5
      break
    }
    contractIndexFingerprint = message.result?.data?.contractIndexFingerprint
    const matches = message.result?.data?.matches ?? []
    if (!matches.some(match => match.id === 'package:@deepseek-ai/dsh-tools') || typeof contractIndexFingerprint !== 'string') {
      process.stderr.write('search result did not expose expected tools contract\n')
      process.exitCode = 6
      break
    }
    process.stdout.write(`${JSON.stringify({
      type: 'tool_call',
      id: 'inspect-1',
      name: 'toolchain_contract_inspect',
      input: {
        target: { profile: 'web' },
        contractIndexFingerprint,
        contractId: 'package:@deepseek-ai/dsh-tools',
      },
    })}\n`)
    phase = 'inspect-result'
    continue
  }

  if (phase === 'inspect-result') {
    if (message.type !== 'tool_result' || message.id !== 'inspect-1') {
      process.stderr.write(`expected inspect tool_result, got ${message.type}\n`)
      process.exitCode = 7
      break
    }
    const contractId = message.result?.data?.contract?.id
    if (contractId !== 'package:@deepseek-ai/dsh-tools') {
      process.stderr.write(`unexpected inspected contract: ${String(contractId)}\n`)
      process.exitCode = 8
      break
    }
    process.stdout.write(`${JSON.stringify({
      type: 'final',
      finalAnswer: `Ordinary docs plus Toolchain verified ${contractId} against ${contractIndexFingerprint}.`,
      providerMetadata: {
        completionId: 'fixture-ordinary-toolchain-roundtrip-1',
        finishReason: 'stop',
        inputTokens: 140,
        outputTokens: 28,
      },
    })}\n`)
    break
  }
}
