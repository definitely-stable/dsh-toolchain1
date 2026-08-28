import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exit(2)

  if (process.env.DSH_OVERFLOW_CHANNEL === 'stderr') {
    process.stderr.write(`${'e'.repeat(256)}\n`)
    process.stdout.write(`${JSON.stringify({
      type: 'final',
      finalAnswer: 'answer after oversized stderr',
      providerMetadata: {
        completionId: 'fixture-stderr-overflow',
        finishReason: 'stop',
      },
    })}\n`)
    break
  }

  process.stdout.write(`${JSON.stringify({
    type: 'final',
    finalAnswer: 'x'.repeat(256),
    providerMetadata: {
      completionId: 'fixture-stdout-overflow',
      finishReason: 'stop',
    },
  })}\n`)
  break
}
