import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('performance validation workflow policy', () => {
  it('keeps deterministic performance validation bounded, dependency-frozen, and provider-free', async () => {
    const workflow = await readFile('.github/workflows/performance-validation.yml', 'utf8')

    expect(workflow).toContain('pull_request:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('schedule:')
    expect(workflow).toContain("node-version: '24.19.0'")
    expect(workflow).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(workflow).toContain('pnpm build')
    expect(workflow).toContain('retention-days: 14')
    expect(workflow).toContain('.artifacts/perf/environment.json')
    expect(workflow).toContain('.artifacts/perf/samples.jsonl')
    expect(workflow).toContain('.artifacts/perf/summary.json')
    expect(workflow).toContain('.artifacts/perf/summary.md')
    expect(workflow).toContain('$GITHUB_STEP_SUMMARY')
    expect(workflow).not.toMatch(/actions\/cache@/u)
    expect(workflow).not.toMatch(/OPENCODE_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY/u)
    expect(workflow).not.toMatch(/node_modules|dsh-home|dsh-toolchain\.tgz/u)
  })

  it('runs only smoke on pull requests and exposes bounded manual profiles', async () => {
    const workflow = await readFile('.github/workflows/performance-validation.yml', 'utf8')

    expect(workflow).toMatch(/options:\s*\n\s*- smoke\s*\n\s*- benchmark\s*\n\s*- stress/u)
    expect(workflow).toMatch(/github\.event_name == 'pull_request'.*'smoke'/u)
    expect(workflow).toMatch(/github\.event_name == 'workflow_dispatch'.*inputs\.profile/u)
  })
})

describe('scheduled live evaluation quota policy', () => {
  it('maps scheduled staged evaluation strictly to the 16-call canary', async () => {
    const workflow = await readFile('.github/workflows/m2-staged-eval.yml', 'utf8')
    const budgetPlanner = await readFile('scripts/eval/budget-plan.mjs', 'utf8')

    expect(workflow).toContain("cron: '17 3 * * 3'")
    expect(workflow).toMatch(/github\.event_name == 'schedule'.*'canary'/u)
    expect(workflow).toMatch(/--mode \$\{\{.*github\.event_name == 'schedule'.*'canary'/u)
    expect(budgetPlanner).toMatch(/canary:[\s\S]*taskCount: 8[\s\S]*expectedModelCalls: 16[\s\S]*hardModelCallCap: 16/u)
  })
})
