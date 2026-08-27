import { describe, expect, it, vi } from 'vitest'

import {
  CONTRACT_INSPECT_TOOL_NAME,
  CONTRACT_SEARCH_TOOL_NAME,
  createContractInspectToolDefinition,
  createContractSearchToolDefinition,
} from '../../src/integrations/dsh/contract-tool.js'
import type {
  ContractInspectResponse,
  ContractSearchResponse,
} from '../../src/protocol/index.js'

const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`

function searchResponse(): ContractSearchResponse {
  return {
    protocolVersion: '1',
    requestId: 'dsh-contract-search',
    snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      matches: [],
      evidence: [],
    },
    diagnostics: [],
  }
}

function inspectResponse(): ContractInspectResponse {
  return {
    protocolVersion: '1',
    requestId: 'dsh-contract-inspect',
    snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      contract: {
        id: 'package:@deepseek-ai/dsh-tools',
        kind: 'package',
        name: '@deepseek-ai/dsh-tools',
        qualifiedName: 'package:@deepseek-ai/dsh-tools',
        availability: 'unknown',
        facts: [],
        evidenceIds: [],
      },
      evidence: [],
    },
    diagnostics: [],
  }
}

describe('native DSH Contract Intelligence tools', () => {
  it('defines Protocol-shaped search/inspect parameters with shallow Protocol response output schemas', () => {
    const search = createContractSearchToolDefinition(async () => searchResponse())
    const inspect = createContractInspectToolDefinition(async () => inspectResponse())

    expect(search.name).toBe(CONTRACT_SEARCH_TOOL_NAME)
    expect(search.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['target', 'query'],
      properties: {
        target: expect.objectContaining({ type: 'object', required: ['profile'] }),
        query: { type: 'string', minLength: 1 },
        kinds: expect.objectContaining({ type: 'array' }),
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
    })
    expect(search.output.schema).toEqual({
      type: 'object',
      description: 'Protocol v1 ContractSearchResponse.',
    })

    expect(inspect.name).toBe(CONTRACT_INSPECT_TOOL_NAME)
    expect(inspect.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['target', 'contractIndexFingerprint', 'contractId'],
      properties: {
        target: expect.objectContaining({ type: 'object', required: ['profile'] }),
        contractIndexFingerprint: {
          type: 'string',
          pattern: '^dsh-contract-index-v1:[0-9a-f]{64}$',
        },
        contractId: { type: 'string', minLength: 1 },
      },
    })
    expect(inspect.output.schema).toEqual({
      type: 'object',
      description: 'Protocol v1 ContractInspectResponse.',
    })
  })

  it('delegates canonical Protocol requests and renders the exact returned response as JSON text', async () => {
    const searchResolver = vi.fn(async () => searchResponse())
    const inspectResolver = vi.fn(async () => inspectResponse())
    const search = createContractSearchToolDefinition(searchResolver)
    const inspect = createContractInspectToolDefinition(inspectResolver)

    const searchValue = await search.execute({
      target: { profile: 'web', dshHome: '/tmp/dsh', patches: ['/tmp/a.yml'] },
      query: 'ToolDefinition',
      kinds: ['package', 'tool'],
      limit: 5,
    })
    expect(searchResolver).toHaveBeenCalledWith({
      target: { profile: 'web', dshHome: '/tmp/dsh', patches: ['/tmp/a.yml'] },
      query: 'ToolDefinition',
      kinds: ['package', 'tool'],
      limit: 5,
    })
    expect(JSON.parse(search.output.render({}, searchValue)[0]?.text ?? 'null')).toEqual(searchValue)

    const inspectValue = await inspect.execute({
      target: { profile: 'web' },
      contractIndexFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    })
    expect(inspectResolver).toHaveBeenCalledWith({
      target: { profile: 'web' },
      contractIndexFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    })
    expect(JSON.parse(inspect.output.render({}, inspectValue)[0]?.text ?? 'null')).toEqual(inspectValue)
  })

  it('forwards the current DSH execution object per call instead of dropping Agent-scoped context', async () => {
    const searchResolver = vi.fn(async () => searchResponse())
    const inspectResolver = vi.fn(async () => inspectResponse())
    const search = createContractSearchToolDefinition(searchResolver)
    const inspect = createContractInspectToolDefinition(inspectResolver)
    const controller = new AbortController()
    const execution = Object.freeze({
      agent: Object.freeze({ id: 'agent-live-inspect' }),
      signal: controller.signal,
    })

    const searchRequest = {
      target: { profile: 'web' },
      query: 'ToolDefinition',
      kinds: ['package'] as const,
    }
    await search.execute(searchRequest, execution)
    expect(searchResolver).toHaveBeenCalledWith(searchRequest, execution)

    const inspectRequest = {
      target: { profile: 'web' },
      contractIndexFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    }
    await inspect.execute(inspectRequest, execution)
    expect(inspectResolver).toHaveBeenCalledWith(inspectRequest, execution)
  })

  it.each([
    null,
    {},
    { target: { profile: 'web' } },
    { target: { profile: '..' }, query: 'tool' },
    { target: { profile: 'web' }, query: '' },
    { target: { profile: 'web' }, query: 'tool', kinds: ['unknown'] },
    { target: { profile: 'web' }, query: 'tool', kinds: ['tool', 'tool'] },
    { target: { profile: 'web' }, query: 'tool', limit: 0 },
    { target: { profile: 'web' }, query: 'tool', limit: 26 },
    { target: { profile: 'web' }, query: 'tool', unexpected: true },
  ])('rejects malformed search arguments before delegation: %j', async (args) => {
    const resolver = vi.fn(async () => searchResponse())
    const definition = createContractSearchToolDefinition(resolver)

    await expect(Promise.resolve().then(() => definition.execute(args)))
      .rejects.toThrow(/invalid contract\.search arguments/i)
    expect(resolver).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { target: { profile: 'web' }, contractIndexFingerprint, contractId: '' },
    { target: { profile: 'web' }, contractIndexFingerprint: 'bad', contractId: 'package:x' },
    { target: { profile: '..' }, contractIndexFingerprint, contractId: 'package:x' },
    { target: { profile: 'web' }, contractIndexFingerprint, contractId: 'package:x', unexpected: true },
  ])('rejects malformed inspect arguments before delegation: %j', async (args) => {
    const resolver = vi.fn(async () => inspectResponse())
    const definition = createContractInspectToolDefinition(resolver)

    await expect(Promise.resolve().then(() => definition.execute(args)))
      .rejects.toThrow(/invalid contract\.inspect arguments/i)
    expect(resolver).not.toHaveBeenCalled()
  })
})
