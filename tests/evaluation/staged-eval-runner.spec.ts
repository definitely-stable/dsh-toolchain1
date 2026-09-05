import { describe, expect, it, vi } from 'vitest'

import { runStagedEvaluation } from '../../scripts/eval/staged-runner.mjs'

type ExistsRule = {
  kind: 'api-exists-any'
  package: string
  symbols: string[]
}

type AbsentRule = {
  kind: 'api-absent'
  symbols: string[]
  proofScope: {
    kind: 'package'
    package: string
  }
}

type TestTask = {
  id: string
  domain: string
  prompt: string
  successRule: ExistsRule | AbsentRule
}

const tasks: TestTask[] = Array.from({ length: 48 }, (_, index) => {
  const packageName = '@deepseek-ai/dsh-scope'
  const symbol = `Api${index + 1}`
  const kind = Math.floor(index / 6) % 2 === 0 ? 'api-exists-any' : 'api-absent'
  return {
    id: `task-${String(index + 1).padStart(2, '0')}`,
    domain: `domain-${index % 6}`,
    prompt: `Prompt ${index + 1}`,
    successRule: kind === 'api-exists-any'
      ? { kind, package: packageName, symbols: [symbol] }
      : { kind, symbols: [symbol], proofScope: { kind: 'package', package: packageName } },
  }
})

function expectedClaim(task: TestTask) {
  return task.successRule.kind === 'api-exists-any'
    ? {
        package: task.successRule.package,
        symbol: task.successRule.symbols[0],
        assertion: 'exists',
      }
    : {
        package: task.successRule.proofScope.package,
        symbol: task.successRule.symbols[0],
        assertion: 'absent',
      }
}

function healthyExecutor() {
  return vi.fn(async (call: { taskId: string }, task: TestTask) => ({
    transportStatus: 'ok' as const,
    structuredContent: {
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId: call.taskId,
      claims: [expectedClaim(task)],
    },
    attempts: 1,
    infrastructureFailures: 0,
    wallTimeMs: 10,
  }))
}

describe('one-dispatch staged evaluation runner', () => {
  it('executes exactly 16 calls and authorizes zero remainder after unhealthy canary', async () => {
    const execute = vi.fn(async (_call: { taskId: string }, _task: TestTask) => ({
      transportStatus: 'unsupported' as const,
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 10,
    }))

    const result = await runStagedEvaluation({ mode: 'dev', tasks, execute })

    expect(execute).toHaveBeenCalledTimes(16)
    expect(result.measurementStatus).toBe('STOP')
    expect(result.canaryResults).toHaveLength(16)
    expect(result.remainderResults).toHaveLength(0)
    expect(result.authorization).toEqual({
      plannedCalls: 40,
      canaryCalls: 16,
      remainderPlanned: 24,
      remainderAuthorized: 0,
      executedCalls: 16,
    })
    expect(result.health.reasons).toContain('FORMAT_COMPLIANCE_BELOW_MINIMUM')
  })

  it('passes the exact scheduled task and oracle to every executor call', async () => {
    const execute = healthyExecutor()

    const result = await runStagedEvaluation({ mode: 'canary', tasks, execute })

    expect(execute).toHaveBeenCalledTimes(16)
    for (const [index, invocation] of execute.mock.calls.entries()) {
      const [call, task] = invocation
      expect(task.id).toBe(call.taskId)
      expect(task).toBe(result.schedule.selectedTasks[index >> 1])
    }
  })

  it('executes only the pre-authorized remainder after a healthy dev canary', async () => {
    const execute = healthyExecutor()

    const result = await runStagedEvaluation({ mode: 'dev', tasks, execute })

    expect(execute).toHaveBeenCalledTimes(40)
    expect(result.measurementStatus).toBe('PASS')
    expect(result.canaryResults).toHaveLength(16)
    expect(result.remainderResults).toHaveLength(24)
    expect(result.authorization).toEqual({
      plannedCalls: 40,
      canaryCalls: 16,
      remainderPlanned: 24,
      remainderAuthorized: 24,
      executedCalls: 40,
    })
  })

  it('keeps canary mode bounded to 16 calls even when health passes', async () => {
    const execute = healthyExecutor()

    const result = await runStagedEvaluation({ mode: 'canary', tasks, execute })

    expect(execute).toHaveBeenCalledTimes(16)
    expect(result.measurementStatus).toBe('PASS')
    expect(result.remainderResults).toEqual([])
    expect(result.authorization.remainderAuthorized).toBe(0)
    expect(result.authorization.executedCalls).toBe(16)
  })

  it('executes calls sequentially in exact schedule order so continuation cannot race ahead of health', async () => {
    const order: number[] = []
    const execute = vi.fn(async (call: { ordinal: number; taskId: string }, task: TestTask) => {
      order.push(call.ordinal)
      return {
        transportStatus: 'ok' as const,
        structuredContent: {
          schema: 'dsh-toolchain-staged-eval-result-v1',
          taskId: call.taskId,
          claims: [expectedClaim(task)],
        },
        attempts: 1,
        infrastructureFailures: 0,
        wallTimeMs: 1,
      }
    })

    await runStagedEvaluation({ mode: 'dev', tasks, execute })
    expect(order).toEqual(Array.from({ length: 40 }, (_, index) => index + 1))
  })
})
