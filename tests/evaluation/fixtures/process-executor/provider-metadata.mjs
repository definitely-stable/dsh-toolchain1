import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exit(2)
  process.stdout.write(`${JSON.stringify({
    type: 'provider_metadata',
    providerMetadata: {
      completionId: 'fixture-provider-metadata-1',
      finishReason: 'stop',
      inputTokens: 21,
      outputTokens: 9,
    },
  })}\n`)
  process.stdout.write(`${JSON.stringify({
    type: 'final',
    finalAnswer: 'metadata arrived before final',
  })}\n`)
  break
}
