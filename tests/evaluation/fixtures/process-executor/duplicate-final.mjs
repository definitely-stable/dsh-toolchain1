import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exit(2)
  const first = JSON.stringify({
    type: 'final',
    finalAnswer: 'first terminal answer',
    providerMetadata: {
      completionId: 'fixture-duplicate-1',
      finishReason: 'stop',
    },
  })
  const second = JSON.stringify({
    type: 'final',
    finalAnswer: 'second terminal answer',
    providerMetadata: {
      completionId: 'fixture-duplicate-2',
      finishReason: 'stop',
    },
  })
  process.stdout.write(`${first}\n${second}\n`)
  break
}
