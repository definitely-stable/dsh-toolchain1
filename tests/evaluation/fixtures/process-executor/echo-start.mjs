import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exit(2)
  process.stdout.write(`${JSON.stringify({
    type: 'final',
    finalAnswer: line,
    providerMetadata: {
      completionId: 'fixture-echo-start-1',
      finishReason: 'stop',
    },
  })}\n`)
  break
}
