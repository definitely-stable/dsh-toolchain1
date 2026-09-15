import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createVerificationBootProbe } from '../../src/verification/boot-probe.js'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-behavior-probe-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface BehaviorAssertion {
  readonly kind: 'agent-tool-result'
  readonly name: string
  readonly arguments: unknown
  readonly expectedValue: unknown
}

interface BehaviorProbe {
  readonly passedMarker: string
  readonly failedMarker: string
}

interface ProbeView {
  readonly packagePath: string
  readonly marker: string
  readonly behavior?: BehaviorProbe
}

const createProbe = createVerificationBootProbe as unknown as (
  root: string,
  profile: string,
  visibilityAssertions?: readonly unknown[],
  behaviorAssertions?: readonly BehaviorAssertion[],
) => Promise<ProbeView>

describe('verification behavior probe', () => {
  it('generates deterministic behavior markers and an async Agent-scoped structured Tool execution', async () => {
    const root = await fixtureRoot()
    const assertions: readonly BehaviorAssertion[] = [{
      kind: 'agent-tool-result',
      name: 'candidate_tool',
      arguments: { value: 1 },
      expectedValue: { ok: true },
    }]

    const probe = await createProbe(root, 'headless', [], assertions)
    const source = await readFile(path.join(probe.packagePath, 'probe.mjs'), 'utf8')

    expect(probe.behavior?.passedMarker).toMatch(/^DSH_TOOLCHAIN_VERIFY_BEHAVIOR_PROBE_V1:[0-9a-f]{64}:PASS$/u)
    expect(probe.behavior?.failedMarker).toMatch(/^DSH_TOOLCHAIN_VERIFY_BEHAVIOR_PROBE_V1:[0-9a-f]{64}:FAIL$/u)
    expect(source).toContain('export async function apply(rootCtx)')
    expect(source).toContain("export const inject = ['tools', 'agentLoop']")
    expect(source.match(/agentLoop\.create\(/gu)).toHaveLength(1)
    expect(source).toContain('agent = await agentLoop.create(')
    expect(source).toContain('await tools.execute(')
    expect(source).toContain('agent,')
    expect(source).toContain('AbortSignal.timeout(10000)')
    expect(source).toContain('isDeepStrictEqual(result.value, assertion.expectedValue)')
    expect(source).toContain(JSON.stringify(`${probe.behavior?.passedMarker}\n`))
    expect(source).toContain(JSON.stringify(`${probe.behavior?.failedMarker}\n`))
    expect(source.indexOf('await tools.execute(')).toBeGreaterThan(source.indexOf('agent = await agentLoop.create('))
  })

  it('uses one Agent epoch and switches only behavior dispatch to native presentation after visibility', async () => {
    const root = await fixtureRoot()
    const visibility = [{ kind: 'agent-tool', name: 'candidate_tool' }]
    const behavior: readonly BehaviorAssertion[] = [{
      kind: 'agent-tool-result',
      name: 'candidate_tool',
      arguments: { value: 1 },
      expectedValue: { ok: true },
    }]

    const probe = await createProbe(root, 'headless', visibility, behavior)
    const source = await readFile(path.join(probe.packagePath, 'probe.mjs'), 'utf8')

    expect(source.match(/agentLoop\.create\(/gu)).toHaveLength(1)
    expect(source.match(/tools\.schemas\(agent\)/gu)).toHaveLength(1)
    expect(source.match(/tools\.execute\(/gu)).toHaveLength(1)
    expect(source).toContain('let behaviorPassed = agent !== undefined && tools !== undefined && visibilityPassed')
    expect(source).toContain("agent.ctx.tools.presentAs('native')")
    const visibilityEvidenceIndex = source.indexOf('process.stdout.write(visibilityPassed')
    const nativePresentationIndex = source.indexOf("agent.ctx.tools.presentAs('native')")
    const behaviorExecutionIndex = source.indexOf('await tools.execute(')
    expect(nativePresentationIndex).toBeGreaterThan(visibilityEvidenceIndex)
    expect(behaviorExecutionIndex).toBeGreaterThan(nativePresentationIndex)
    expect(source.indexOf('let behaviorPassed =')).toBeGreaterThan(visibilityEvidenceIndex)
  })

  it('gates behavior execution on requested visibility success in the same Agent epoch', async () => {
    const root = await fixtureRoot()
    const visibility = [{ kind: 'agent-tool', name: 'missing_candidate_tool' }]
    const behavior: readonly BehaviorAssertion[] = [{
      kind: 'agent-tool-result',
      name: 'candidate_tool',
      arguments: { value: 1 },
      expectedValue: { ok: true },
    }]

    const probe = await createProbe(root, 'headless', visibility, behavior)
    const source = await readFile(path.join(probe.packagePath, 'probe.mjs'), 'utf8')

    expect(source).toContain('let behaviorPassed = agent !== undefined && tools !== undefined && visibilityPassed')
    expect(source).toContain('if (behaviorPassed) {')
    expect(source.indexOf('if (behaviorPassed) {')).toBeGreaterThan(source.indexOf('if (!visibleTools.has(assertion.name)) visibilityPassed = false'))
  })

  it('does not embed requested Tool names or JSON values in public marker identities', async () => {
    const root = await fixtureRoot()
    const behavior: readonly BehaviorAssertion[] = [{
      kind: 'agent-tool-result',
      name: 'sensitive_candidate_tool',
      arguments: { secretLikeValue: 'redact-me' },
      expectedValue: { privateExpected: 'also-redact-me' },
    }]

    const probe = await createProbe(root, 'headless', [], behavior)

    expect(probe.behavior?.passedMarker).not.toContain('sensitive_candidate_tool')
    expect(probe.behavior?.passedMarker).not.toContain('redact-me')
    expect(probe.behavior?.failedMarker).not.toContain('also-redact-me')
  })
})
