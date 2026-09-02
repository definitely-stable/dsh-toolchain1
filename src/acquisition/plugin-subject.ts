import type { Sha256Port } from '../model/digest.js'
import type { PluginSubjectAcquisitionPort } from '../model/plugin.js'
import type { PluginSubjectRequest } from '../protocol/index.js'
import { acquirePluginDirectory } from './plugin-directory.js'
import { acquirePluginPacked } from './plugin-packed.js'

export function createPluginSubjectAcquisition(
  digest: Sha256Port,
): PluginSubjectAcquisitionPort {
  return Object.freeze({
    acquire(subject: PluginSubjectRequest) {
      return subject.kind === 'packed'
        ? acquirePluginPacked(subject.path, digest)
        : acquirePluginDirectory(subject.path, digest)
    },
  })
}
