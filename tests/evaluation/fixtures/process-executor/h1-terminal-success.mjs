import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exit(2)
  process.stdout.write(`${JSON.stringify({
    type: 'final',
    finalAnswer: 'fixture H1 terminal outcome',
    providerMetadata: {
      completionId: 'fixture-h1-terminal-1',
      finishReason: 'stop',
      responseModel: 'deepseek-v4-flash',
      systemFingerprint: 'fp_h1_coordinator_fixture',
      inputTokens: 34,
      outputTokens: 11,
    },
  })}\n`)
  break
}
