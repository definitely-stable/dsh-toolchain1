import { describe, expect, it } from 'vitest'

import * as protocol from '../../src/protocol/index.js'

function parser(): (value: unknown) => unknown {
  const candidate = Reflect.get(protocol, 'parsePluginCheckRequest')
  expect(candidate).toBeTypeOf('function')
  if (typeof candidate !== 'function') throw new TypeError('parsePluginCheckRequest is not implemented')
  return candidate as (value: unknown) => unknown
}

describe('plugin.check request validation', () => {
  it.each(['directory', 'packed'] as const)(
    'accepts one explicit %s subject and the existing exact-target request',
    kind => {
      const subjectPath = kind === 'directory' ? '/tmp/example-plugin' : '/tmp/example-plugin.tgz'
      expect(parser()({
        target: {
          profile: 'web',
          dshHome: '/tmp/dsh-home',
          patches: ['/tmp/first.patch.yml'],
        },
        subject: {
          kind,
          path: subjectPath,
        },
      })).toEqual({
        target: {
          profile: 'web',
          dshHome: '/tmp/dsh-home',
          patches: ['/tmp/first.patch.yml'],
        },
        subject: {
          kind,
          path: subjectPath,
        },
      })
    },
  )

  it.each([
    {},
    { target: { profile: 'web' } },
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '' } },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '' } },
    { target: { profile: 'web' }, subject: { kind: 'archive', path: '/tmp/plugin.tgz' } },
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '/tmp/plugin', extra: true } },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '/tmp/plugin.tgz', extra: true } },
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '/tmp/plugin' }, extra: true },
    { target: { profile: '../web' }, subject: { kind: 'directory', path: '/tmp/plugin' } },
  ])('rejects malformed or open-ended request shape %#', value => {
    expect(() => parser()(value)).toThrow('Invalid plugin.check arguments')
  })
})
