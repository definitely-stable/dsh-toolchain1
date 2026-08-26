import { createHash } from 'node:crypto'
import type { Sha256Port } from '../model/digest.js'

export function createNodeSha256Port(): Sha256Port {
  return {
    async sha256Utf8(value) {
      return createHash('sha256').update(value, 'utf8').digest('hex')
    },
  }
}
