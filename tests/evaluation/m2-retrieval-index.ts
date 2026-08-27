import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createContractIndex, type ContractIndex } from '../../src/model/contract.js'

export const M2_RETRIEVAL_TARGET = Object.freeze({
  dshVersion: '0.1.1-rc.2',
  profile: 'headless',
  upstreamCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  targetFingerprint: 'dsh-target-v2:84ee12bc591ba87cdb4392280ab8f3c8a211301bcc9c460334ede6e8015ee6be',
  targetProof: 'Toolchain CI #398 / primary target smoke',
})

/**
 * RED scaffold. Task 2 replaces the empty evidence set with a representative
 * rc.2 normalized package-contract fixture while keeping production index
 * construction/fingerprinting authoritative.
 */
export async function createFrozenM2RetrievalIndex(): Promise<ContractIndex> {
  return createContractIndex(
    M2_RETRIEVAL_TARGET.targetFingerprint,
    [],
    [],
    createNodeSha256Port(),
  )
}
