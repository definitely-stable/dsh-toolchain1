import { describe, expect, it } from 'vitest'

import * as protocol from '../../src/protocol/index.js'

function parser(): (value: unknown) => unknown {
  const candidate = Reflect.get(protocol, 'parsePluginCheckRequest')
  expect(candidate).toBeTypeOf('function')
  if (typeof candidate !== 'function') throw new TypeError('parsePluginCheckRequest is not implemented')
  return candidate as (value: unknown) => unknown
}

describe('plugin.check request validation', () => {
  it('accepts one explicit directory subject and the existing exact-target request', () => {
    expect(parser()({
      target: {
        profile: 'web',
        dshHome: '/tmp/dsh-home',
        patches: ['/tmp/first.patch.yml'],
      },
      subject: {
        kind: 'directory',
        path: '/tmp/example-plugin',
      },
    })).toEqual({
      target: {
        profile: 'web',
        dshHome: '/tmp/dsh-home',
        patches: ['/tmp/first.patch.yml'],
      },
      subject: {
        kind: 'directory',
        path: '/tmp/example-plugin',
      },
    })
  })

  it.each([
    {},
    { target: { profile: 'web' } },
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '' } },
    { target: { profile: 'web' }, subject: { kind: 'archive', path: '/tmp/plugin.tgz' } },
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '/tmp/plugin', extra: true } },
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '/tmp/plugin' }, extra: true },
    { target: { profile: '../web' }, subject: { kind: 'directory', path: '/tmp/plugin' } },
  ])('rejects malformed or open-ended request shape %#', value => {
    expect(() => parser()(value)).toThrow('Invalid plugin.check arguments')
  })
})
