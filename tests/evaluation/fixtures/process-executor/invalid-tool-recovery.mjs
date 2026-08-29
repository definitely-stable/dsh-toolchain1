import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })

lines.on('line', line => {
  const message = JSON.parse(line)
  if (message.type === 'start') {
    process.stdout.write(`${JSON.stringify({
      type: 'tool_call',
      id: 'invalid-read-1',
      name: 'read_file',
      input: { path: '/etc/passwd' },
    })}\n`)
    return
  }

  if (message.type === 'tool_result' && message.id === 'invalid-read-1') {
    const code = message.result?.error?.code
    process.stdout.write(`${JSON.stringify({
      type: 'final',
      finalAnswer: code === 'MODEL_TOOL_CALL_INVALID'
        ? 'Recovered after bounded model tool error.'
        : 'Unexpected tool result.',
      providerMetadata: {
        completionId: 'fixture-invalid-tool-recovery-1',
        finishReason: 'stop',
        responseModel: 'fixture-model',
        inputTokens: 20,
        outputTokens: 5,
      },
    })}\n`)
  }
})
