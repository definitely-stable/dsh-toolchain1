import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

const claims = Object.freeze({
  'p0-01': 'API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=exists',
  'p0-02': 'API_CLAIM package=@deepseek-ai/dsh-user-approval symbol=ApprovalService assertion=exists',
  'p0-03': 'API_CLAIM package=@deepseek-ai/dsh-scope symbol=createScope assertion=exists',
  'p0-04': 'API_CLAIM package=@deepseek-ai/dsh-session-query symbol=compileSessionTextFilter assertion=exists',
  'p0-05': 'API_CLAIM package=@deepseek-ai/dsh-subagent symbol=assertSubagentMaxDepth assertion=exists',
  'p0-06': 'API_CLAIM package=@deepseek-ai/dsh-compaction symbol=compactCheckpointSource assertion=exists',
  'p0-07': 'API_CLAIM package=* symbol=patchReload assertion=absent',
  'p0-08': 'API_CLAIM package=* symbol=ToolAutopilot assertion=absent',
})

function finish(taskId, claim, mode) {
  process.stdout.write(`${JSON.stringify({
    type: 'final',
    finalAnswer: `${claim}\nFixture evidence mode=${mode}; answer is intentionally deterministic for P0 runner calibration.`,
    providerMetadata: {
      completionId: `fixture-p0-${taskId}-${mode}`,
      finishReason: 'stop',
      inputTokens: 100,
      outputTokens: 20,
    },
  })}\n`)
}

let state = 'start'
let taskId
let claim
let mode = 'memory'
let toolCallId

for await (const line of input) {
  const message = JSON.parse(line)

  if (state === 'start') {
    if (message.type !== 'start' || message.envelope?.schema !== 'dsh-toolchain-m2-model-envelope-v1') {
      process.stderr.write('expected canonical start ModelEnvelope\n')
      process.exitCode = 2
      break
    }
    taskId = message.envelope.task?.id
    claim = claims[taskId]
    if (typeof claim !== 'string') {
      process.stderr.write(`unknown P0 task ${String(taskId)}\n`)
      process.exitCode = 3
      break
    }

    const toolNames = new Set((message.envelope.tools ?? []).map(tool => tool.name))
    if (toolNames.has('toolchain_contract_search')) {
      mode = 'toolchain'
      toolCallId = 'fixture-toolchain-search'
      process.stdout.write(`${JSON.stringify({
        type: 'tool_call',
        id: toolCallId,
        name: 'toolchain_contract_search',
        input: {
          target: { profile: 'web' },
          query: taskId === 'p0-08' ? 'ToolAutopilot' : taskId === 'p0-07' ? 'patchReload' : claim.split(' symbol=')[1].split(' ')[0],
          limit: 5,
        },
      })}\n`)
      state = 'tool-result'
      continue
    }

    if (toolNames.has('search_text')) {
      mode = 'ordinary'
      toolCallId = 'fixture-ordinary-search'
      process.stdout.write(`${JSON.stringify({
        type: 'tool_call',
        id: toolCallId,
        name: 'search_text',
        input: {
          query: taskId === 'p0-08' ? 'ToolAutopilot' : taskId === 'p0-07' ? 'patchReload' : claim.split(' symbol=')[1].split(' ')[0],
          limit: 5,
        },
      })}\n`)
      state = 'tool-result'
      continue
    }

    finish(taskId, claim, mode)
    break
  }

  if (state === 'tool-result') {
    if (message.type !== 'tool_result' || message.id !== toolCallId) {
      process.stderr.write(`expected tool_result ${String(toolCallId)}\n`)
      process.exitCode = 4
      break
    }
    finish(taskId, claim, mode)
    break
  }
}
