import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exit(2)
  process.stdout.write(`${JSON.stringify({
    type: 'final',
    finalAnswer: `${process.env.DSH_VISIBLE ?? 'missing'}|${process.env.DSH_PARENT_SECRET ?? 'absent'}`,
    providerMetadata: {
      completionId: 'fixture-environment-1',
      finishReason: 'stop',
    },
  })}\n`)
  break
}
