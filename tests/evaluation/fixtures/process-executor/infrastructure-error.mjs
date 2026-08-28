import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exit(2)
  process.stdout.write(`${JSON.stringify({
    type: 'provider_metadata',
    providerMetadata: {
      completionId: 'fixture-provider-transport-1',
      finishReason: 'transport-error',
      inputTokens: 13,
    },
  })}\n`)
  process.stdout.write(`${JSON.stringify({
    type: 'infrastructure_error',
    reason: 'provider-transport',
    detail: 'fixture provider transport unavailable',
  })}\n`)
  break
}
