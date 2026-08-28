import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
let phase = 'start'

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
      id: 'call-1',
      name: 'fixture_lookup',
      input: { query: 'ctx.inject' },
    })}\n`)
    phase = 'tool-result'
    continue
  }

  if (phase === 'tool-result') {
    if (message.type !== 'tool_result' || message.id !== 'call-1') {
      process.stderr.write(`expected matching tool_result, got ${message.type}\n`)
      process.exitCode = 3
      break
    }
    process.stdout.write(`${JSON.stringify({
      type: 'final',
      finalAnswer: `tool result: ${message.result.matches[0]}`,
      providerMetadata: {
        completionId: 'fixture-completion-tool-1',
        finishReason: 'stop',
      },
    })}\n`)
    break
  }
}
