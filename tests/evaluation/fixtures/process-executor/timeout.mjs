import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exitCode = 2
  setTimeout(() => {
    process.stdout.write(`${JSON.stringify({
      type: 'final',
      finalAnswer: 'late answer that runner must not accept',
      providerMetadata: {
        completionId: 'fixture-timeout-late',
        finishReason: 'stop',
      },
    })}\n`)
  }, 250)
  break
}
