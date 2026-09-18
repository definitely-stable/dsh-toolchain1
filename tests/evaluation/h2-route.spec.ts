import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { H2_POLICY } from '../../scripts/eval/h2/h2-config.mjs'
import {
  H2_CREDENTIALS_FILENAME,
  credentialSources,
  routePatchEntries,
  seedRouteCredentials,
  sessionAffinityValue,
} from '../../scripts/eval/h2/h2-route.mjs'

const roots: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'h2-route-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('H2 route patch', () => {
  it('pins the frozen provider, credential reference, and routing header', () => {
    const entries = routePatchEntries({ sessionAffinity: 'B-run-1-task-1' })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      id: 'llm-pi-ai',
      config: {
        providers: {
          [H2_POLICY.model.provider]: {
            apiKeyEnv: H2_POLICY.model.credentialRef,
            api: 'openai-completions',
            baseURL: 'https://opencode.ai/zen/go/v1',
            headers: { [H2_POLICY.model.sessionAffinityHeader]: 'B-run-1-task-1' },
            models: [
              {
                id: H2_POLICY.model.model,
                name: 'DeepSeek V4.1 Flash',
                contextWindow: 1_000_000,
                maxTokens: 384_000,
                input: ['text', 'image'],
                reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
                compat: {
                  supportsStore: false,
                  supportsDeveloperRole: false,
                  maxTokensField: 'max_tokens',
                  requiresReasoningContentOnAssistantMessages: true,
                  thinkingFormat: 'deepseek',
                },
              },
            ],
          },
        },
      },
    })
    expect(entries[1]).toEqual({
      id: 'agent-default-model',
      config: {
        provider: H2_POLICY.model.provider,
        model: H2_POLICY.model.model,
        reasoningEffort: H2_POLICY.model.reasoningEffort,
      },
    })
  })

  it('carries the frozen model as the route\'s only catalog entry', () => {
    // The published target's pi-ai catalog does not ship `deepseek-v4.1-flash`,
    // so the route declares its own `models` list. A model missing there is a
    // model the target cannot advertise, and the controller refuses to pin an
    // unadvertised option — which is how the paid dry run died with a frozen
    // pair the target does not offer. It also has to stay the *only* entry:
    // nothing may reach a model the frozen identity does not name.
    const entries = routePatchEntries({ sessionAffinity: 'B-run-1-task-1' })
    const provider = entries[0]?.config?.providers?.[H2_POLICY.model.provider]
    const models = provider?.models ?? []
    expect(models).toHaveLength(1)
    expect(models[0]?.id).toBe(H2_POLICY.model.model)
    // Only `off` may declare no wire value, and the model's own level map has
    // no `off`; a level offered without a wire spelling would fail resolution.
    expect(Object.keys(models[0]?.reasoningEfforts ?? {})).not.toContain('off')
    expect(models[0]?.reasoningEfforts?.[H2_POLICY.model.reasoningEffort]).toBe(H2_POLICY.model.reasoningEffort)
  })

  it('refuses a route patch without a per-observation affinity value', () => {
    expect(() => routePatchEntries({ sessionAffinity: '' })).toThrow(/session affinity/)
  })

  it('derives one opaque affinity value per observation and never per arm alone', () => {
    const first = sessionAffinityValue({ runId: 'run-1', taskId: 'task-a', arm: 'B' })
    const second = sessionAffinityValue({ runId: 'run-1', taskId: 'task-a', arm: 'C' })
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(() => sessionAffinityValue({ runId: 'run 1', taskId: 'task-a', arm: 'B' })).toThrow(/opaque token/)
  })
})

describe('H2 route credentials', () => {
  it('reports which authority can resolve the frozen reference', () => {
    const home = tempDir()
    expect(credentialSources({ ref: 'H2_TEST_KEY', env: {}, home })).toMatchObject({
      ref: 'H2_TEST_KEY',
      environment: 'missing',
      document: null,
      resolvable: false,
    })
    expect(credentialSources({ ref: 'H2_TEST_KEY', env: { H2_TEST_KEY: 'x' }, home }).resolvable).toBe(true)
  })

  it('copies the operator credential document into the observation home', () => {
    const home = tempDir()
    const document = join(home, H2_CREDENTIALS_FILENAME)
    writeFileSync(document, 'version: 1\nrefs:\n  {\n    OPENCODE_GO_API_KEY: probe-value,\n  }\n', { mode: 0o600 })
    chmodSync(document, 0o600)
    const dshHome = tempDir()
    const result = seedRouteCredentials({ dshHome, home, env: {} })
    expect(result).toEqual({ seeded: true, from: 'document', ref: H2_POLICY.model.credentialRef })
    // The observation home has to be self-sufficient: it inherits the operator
    // environment but not the operator home, so without this copy a route whose
    // credential lives only in the store cannot make a single model call.
    expect(readFileSync(join(dshHome, H2_CREDENTIALS_FILENAME), 'utf8')).toBe(readFileSync(document, 'utf8'))
    if (process.platform !== 'win32') {
      // The credential provider refuses a document other OS users can read.
      expect(statSync(join(dshHome, H2_CREDENTIALS_FILENAME)).mode & 0o077).toBe(0)
    }
  })

  it('seeds nothing when the reference is already exported', () => {
    const dshHome = tempDir()
    const result = seedRouteCredentials({ dshHome, home: tempDir(), env: { [H2_POLICY.model.credentialRef]: 'from-shell' } })
    expect(result).toEqual({ seeded: false, from: 'environment', ref: H2_POLICY.model.credentialRef })
    expect(() => readFileSync(join(dshHome, H2_CREDENTIALS_FILENAME), 'utf8')).toThrow()
  })

  it('fails loudly, naming the reference, when no authority holds it', () => {
    expect(() => seedRouteCredentials({ dshHome: tempDir(), home: tempDir(), env: {} })).toThrow(
      new RegExp(`${H2_POLICY.model.credentialRef}.*neither exported.*nor stored`, 's'),
    )
  })
})
