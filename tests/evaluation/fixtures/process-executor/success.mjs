import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') {
    process.stderr.write(`unexpected message: ${message.type}\n`)
    process.exitCode = 2
    break
  }

  process.stdout.write(`${JSON.stringify({
    type: 'final',
    finalAnswer: 'Use ctx.inject() for required services.',
    providerMetadata: {
      completionId: 'fixture-completion-1',
      finishReason: 'stop',
      inputTokens: 11,
      outputTokens: 7,
    },
  })}\n`)
  break
}
