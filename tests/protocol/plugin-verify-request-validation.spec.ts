import { describe, expect, it } from 'vitest'

import * as protocol from '../../src/protocol/index.js'

function parser(): (value: unknown) => unknown {
  const candidate = Reflect.get(protocol, 'parsePluginVerifyRequest')
  expect(candidate).toBeTypeOf('function')
  if (typeof candidate !== 'function') throw new TypeError('parsePluginVerifyRequest is not implemented')
  return candidate as (value: unknown) => unknown
}

describe('plugin.verify request validation', () => {
  it('accepts one exact packed subject under the safe execution policy', () => {
    expect(parser()({
      target: {
        profile: 'web',
        dshHome: '/tmp/dsh-home',
        patches: ['/tmp/first.patch.yml'],
      },
      subject: {
        kind: 'packed',
        path: '/tmp/example-plugin.tgz',
      },
      executionPolicy: 'safe',
    })).toEqual({
      target: {
        profile: 'web',
        dshHome: '/tmp/dsh-home',
        patches: ['/tmp/first.patch.yml'],
      },
      subject: {
        kind: 'packed',
        path: '/tmp/example-plugin.tgz',
      },
      executionPolicy: 'safe',
    })
  })

  it.each([
    {},
    { target: { profile: 'web' } },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '/tmp/plugin.tgz' } },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '' }, executionPolicy: 'safe' },
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '/tmp/plugin' }, executionPolicy: 'safe' },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '/tmp/plugin.tgz' }, executionPolicy: 'trusted' },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '/tmp/plugin.tgz', extra: true }, executionPolicy: 'safe' },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '/tmp/plugin.tgz' }, executionPolicy: 'safe', extra: true },
  ])('rejects unsupported or open-ended request shape %#', value => {
    expect(() => parser()(value)).toThrow('Invalid plugin.verify arguments')
  })
})
