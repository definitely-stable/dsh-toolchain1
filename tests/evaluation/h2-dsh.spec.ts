import { describe, expect, it } from 'vitest'

import {
  ACP_METHODS,
  H2_PERMISSION_POLICY,
  ACP_PROTOCOL_VERSION,
  choosePermissionOption,
  classifyTerminal,
  createAcpControlPlane,
  createBudgetGuard,
  validateConfigOption,
} from '../../scripts/eval/h2/h2-dsh.mjs'

type FakeConfigOption = {
  id: string
  name: string
  type: string
  currentValue: string
  options: Array<{ value: string }>
}

type FakeAgentOptions = {
  configOptions?: FakeConfigOption[]
  stopReason?: string
  autoRespond?: boolean
}

/** In-memory ACP agent used to drive the control plane without DSH or a model. */
function createFakeAgent({ configOptions, stopReason = 'end_turn', autoRespond = true }: FakeAgentOptions = {}) {
  const sent: any[] = []
  const handlers: Array<(frame: any) => void> = []
  // Declared before the transport because the transport's `send` dispatches
  // back into it; the object is filled in once the transport exists.
  const agent: any = {}
  const transport = {
    send(frame: any) {
      sent.push(frame)
      queueMicrotask(() => agent?.receive(frame))
    },
    onFrame(handler: (frame: any) => void) {
      handlers.push(handler)
    },
    close() {},
  }
  Object.assign(agent, {
    sent,
    transport,
    receive(frame: any) {
      if (frame.method === ACP_METHODS.initialize) {
        this.respond(frame.id, { protocolVersion: ACP_PROTOCOL_VERSION, authMethods: [{ id: 'none', name: 'None' }], agentCapabilities: {} })
        return
      }
      if (frame.method === ACP_METHODS.authenticate) {
        this.respond(frame.id, {})
        return
      }
      if (frame.method === ACP_METHODS.sessionNew) {
        this.respond(frame.id, {
          sessionId: 'session-1',
          configOptions: configOptions ?? [
            { id: 'model', name: 'Model', type: 'select', currentValue: 'deepseek-v4-flash', options: [{ value: 'deepseek-flash' }] },
            { id: 'reasoning_effort', name: 'Reasoning', type: 'select', currentValue: 'low', options: [{ value: 'high' }] },
          ],
        })
        return
      }
      if (frame.method === ACP_METHODS.sessionSetConfigOption) {
        this.respond(frame.id, { configOptions: [] })
        return
      }
      if (frame.method === ACP_METHODS.sessionPrompt) {
        if (autoRespond) this.respond(frame.id, { stopReason })
        return
      }
      if (frame.method === ACP_METHODS.sessionClose) {
        this.respond(frame.id, {})
      }
    },
    respond(id: number, result: any) {
      for (const handler of handlers) handler({ jsonrpc: '2.0', id, result })
    },
    notify(update: any) {
      for (const handler of handlers) handler({ jsonrpc: '2.0', method: ACP_METHODS.sessionUpdate, params: { sessionId: 'session-1', update } })
    },
    requestPermission(options: any[]) {
      for (const handler of handlers) {
        handler({ jsonrpc: '2.0', id: 9001, method: ACP_METHODS.requestPermission, params: { sessionId: 'session-1', toolCall: { toolCallId: 'c1', title: 'run' }, options } })
      }
    },
    error(id: number, code: number, message: string) {
      for (const handler of handlers) handler({ jsonrpc: '2.0', id, error: { code, message } })
    },
  })
  return agent
}

describe('H2 ACP control plane', () => {
  it('initializes with the pinned protocol version and client capabilities', async () => {
    const agent = createFakeAgent()
    const client = createAcpControlPlane({ transport: agent.transport })
    const result = await client.initialize()
    expect(result.protocolVersion).toBe(1)
    expect(agent.sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: false } },
      },
    })
  })

  it('opens a session with an absolute workspace and pins model plus reasoning effort', async () => {
    const agent = createFakeAgent()
    const client = createAcpControlPlane({ transport: agent.transport })
    await client.initialize()
    // The workspace must be absolute on the platform that runs the benchmark:
    // scoring runs on a Linux runner, where a Windows-style path is not absolute
    // and the control plane correctly refuses it.
    const workspace = process.platform === 'win32' ? 'C:/artifacts/h2/run/task/B/workspace' : '/artifacts/h2/run/task/B/workspace'
    const session = await client.newSession({ cwd: workspace })
    expect(session.sessionId).toBe('session-1')
    expect(agent.sent.find((frame: any) => frame.method === 'session/new').params).toEqual({
      cwd: workspace,
      mcpServers: [],
    })
    await client.setConfigOption({ sessionId: session.sessionId, configId: 'model', value: 'deepseek-flash' })
    await client.setConfigOption({ sessionId: session.sessionId, configId: 'reasoning_effort', value: 'high' })
    const configFrames = agent.sent.filter((frame: any) => frame.method === 'session/set_config_option')
    expect(configFrames).toHaveLength(2)
    expect(configFrames[0].params).toEqual({ sessionId: 'session-1', configId: 'model', value: 'deepseek-flash' })
    expect(configFrames[1].params).toEqual({ sessionId: 'session-1', configId: 'reasoning_effort', value: 'high' })
  })

  it('fails closed when the session does not advertise a required config option', async () => {
    const agent = createFakeAgent({ configOptions: [{ id: 'model', name: 'Model', type: 'select', currentValue: 'x', options: [] }] })
    const client = createAcpControlPlane({ transport: agent.transport })
    await client.initialize()
    const session = await client.newSession({ cwd: '/abs/workspace' })
    await expect(client.setConfigOption({ sessionId: session.sessionId, configId: 'reasoning_effort', value: 'high' }))
      .rejects.toThrow(/reasoning_effort/)
  })

  it('rejects relative workspaces and unsupported reasoning values', async () => {
    const agent = createFakeAgent()
    const client = createAcpControlPlane({ transport: agent.transport })
    await client.initialize()
    await expect(client.newSession({ cwd: 'relative/path' })).rejects.toThrow(/absolute/)
    expect(() => validateConfigOption({ configId: 'reasoning_effort', value: 'ultra' })).toThrow(/reasoning/)
    expect(() => validateConfigOption({ configId: 'model', value: 'deepseek-flash' })).not.toThrow()
  })

  it('accounts tool calls once per tool-call id and never double counts updates', async () => {
    const agent = createFakeAgent({ autoRespond: false })
    const client = createAcpControlPlane({ transport: agent.transport })
    await client.initialize()
    await client.newSession({ cwd: '/abs/workspace' })
    const prompt = client.prompt({ sessionId: 'session-1', text: 'do the task' })
    agent.notify({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', name: 'read_file', kind: 'read', status: 'pending' })
    agent.notify({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    agent.notify({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Search', name: 'toolchain_contract_search', kind: 'search', status: 'pending' })
    agent.notify({ sessionUpdate: 'usage_update', used: 100, size: 1000 })
    agent.notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'thinking out loud' } })
    agent.respond(agent.sent.find((frame: any) => frame.method === 'session/prompt').id, { stopReason: 'end_turn' })
    const result = await prompt
    expect(result.stopReason).toBe('end_turn')
    expect(client.updates.toolCalls).toEqual([
      { toolCallId: 't1', name: 'read_file', kind: 'read' },
      { toolCallId: 't2', name: 'toolchain_contract_search', kind: 'search' },
    ])
    expect(client.updates.usageUpdates).toBe(1)
    expect(client.updates.messageChunks).toBe(1)
  })

  it('answers permission requests with the frozen deny-by-default policy', async () => {
    const agent = createFakeAgent()
    const decisions: Array<{ requestedKinds: string[]; selectedKind: string | null }> = []
    const client = createAcpControlPlane({ transport: agent.transport, onPermissionDecision: decision => decisions.push(decision) })
    await client.initialize()
    agent.requestPermission([
      { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      { optionId: 'allow-always', name: 'Allow', kind: 'allow_always' },
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    ])
    await new Promise(resolve => setTimeout(resolve, 5))
    const answer = agent.sent.find((frame: any) => frame.id === 9001)
    // Escalating out of the workspace is never granted: the fence stays
    // authoritative and both arms answer identically.
    expect(answer.result).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    expect(decisions).toEqual([{ requestedKinds: ['reject_once', 'allow_always', 'allow_once'], selectedKind: 'reject_once' }])
    expect(H2_PERMISSION_POLICY).toBe('reject')
    expect(choosePermissionOption([{ optionId: 'r', kind: 'reject_once' }], 'allow')).toEqual({ outcome: { outcome: 'selected', optionId: 'r' } })
    expect(choosePermissionOption([{ optionId: 'a', kind: 'allow_once' }], 'reject')).toEqual({ outcome: { outcome: 'selected', optionId: 'a' } })
  })

  it('propagates JSON-RPC failures instead of hanging', async () => {
    const agent = createFakeAgent({ autoRespond: false })
    const client = createAcpControlPlane({ transport: agent.transport })
    await client.initialize()
    const prompt = client.prompt({ sessionId: 'session-1', text: 'x' })
    const id = agent.sent.find((frame: any) => frame.method === 'session/prompt').id
    agent.error(id, -32000, 'provider exploded')
    await expect(prompt).rejects.toThrow(/provider exploded/)
  })

  it('classifies terminal reasons exactly', () => {
    expect(classifyTerminal({ stopReason: 'end_turn', budgetReason: null })).toEqual({ terminalReason: 'COMPLETED', gradeable: true, budgetExhausted: false })
    expect(classifyTerminal({ stopReason: 'max_tokens', budgetReason: null })).toEqual({ terminalReason: 'RESOURCE_EXHAUSTED', gradeable: true, budgetExhausted: true })
    expect(classifyTerminal({ stopReason: 'max_turn_requests', budgetReason: null }).budgetExhausted).toBe(true)
    expect(classifyTerminal({ stopReason: 'cancelled', budgetReason: 'PROVIDER_COMPLETIONS' })).toEqual({ terminalReason: 'RESOURCE_EXHAUSTED', gradeable: true, budgetExhausted: true })
    expect(classifyTerminal({ stopReason: 'refusal', budgetReason: null })).toEqual({ terminalReason: 'REFUSAL', gradeable: true, budgetExhausted: false })
    expect(classifyTerminal({ stopReason: 'cancelled', budgetReason: null })).toEqual({ terminalReason: 'CANCELLED', gradeable: false, budgetExhausted: false })
    expect(classifyTerminal({ stopReason: 'something-new', budgetReason: null }).terminalReason).toBe('INFRASTRUCTURE_FAILURE')
  })
})

describe('H2 budget guard', () => {
  it('exhausts on the frozen provider-completion limit', () => {
    const clock = 0
    const guard = createBudgetGuard({ policy: { providerCompletionsLimit: 6, wallTimeLimitMs: 180_000 }, now: () => clock })
    for (let index = 0; index < 6; index += 1) {
      guard.recordCompletion()
      expect(guard.evaluate().exhausted).toBe(false)
    }
    guard.recordCompletion()
    expect(guard.evaluate()).toEqual({ exhausted: true, reason: 'PROVIDER_COMPLETIONS' })
  })

  it('exhausts on the frozen wall-time limit', () => {
    let clock = 0
    const guard = createBudgetGuard({ policy: { providerCompletionsLimit: 6, wallTimeLimitMs: 180_000 }, now: () => clock })
    clock = 179_999
    expect(guard.evaluate().exhausted).toBe(false)
    clock = 180_000
    expect(guard.evaluate()).toEqual({ exhausted: true, reason: 'WALL_TIME' })
  })
})