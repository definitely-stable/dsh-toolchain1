import { readFile } from 'node:fs/promises'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createContractIndex, type ContractIndex } from '../../src/model/contract.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'

interface M2FixtureManifest {
  readonly schema: 'dsh-toolchain-m2-fixture-v1'
  readonly fixtureVersion: 'rc2-web-v1'
  readonly generatedAt: string
  readonly canonicalTarget: {
    readonly package: '@deepseek-ai/dsh'
    readonly version: '0.1.1-rc.2'
    readonly profile: 'web'
    readonly upstreamDocumentationCommit: string
  }
  readonly generator: {
    readonly toolchainCommit: string
    readonly nodeVersion: string
    readonly platform: string
    readonly arch: string
    readonly pnpmVersion: string
    readonly generationPolicy: 'registry-artifact-production-acquisition-v1'
    readonly sanitizationPolicy: 'drop-evidence-location-v1'
  }
  readonly source: {
    readonly lockfileSha256: string
  }
  readonly expected: {
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
    readonly contractCount: number
    readonly evidenceCount: number
  }
  readonly packages: readonly {
    readonly name: string
    readonly version: string
  }[]
}

const fixtureRoot = new URL('./fixtures/m2/rc2-web-v1/', import.meta.url)

async function readFixtureJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8')) as T
}

// Files are generated from the exact registry artifact by
// scripts/generate-m2-evaluation-fixture.mjs. This top-level read is deliberate:
// a checkout missing the frozen receipt must fail closed during evaluation import.
export const M2_RETRIEVAL_FIXTURE_MANIFEST = Object.freeze(
  await readFixtureJson<M2FixtureManifest>('manifest.json'),
)

const frozenContractFacts = await readFixtureJson<AcquiredContractFacts>('contract-facts.json')

export const M2_RETRIEVAL_TARGET = Object.freeze({
  dshVersion: M2_RETRIEVAL_FIXTURE_MANIFEST.canonicalTarget.version,
  profile: M2_RETRIEVAL_FIXTURE_MANIFEST.canonicalTarget.profile,
  upstreamCommit: M2_RETRIEVAL_FIXTURE_MANIFEST.canonicalTarget.upstreamDocumentationCommit,
  targetFingerprint: M2_RETRIEVAL_FIXTURE_MANIFEST.expected.targetFingerprint,
  contractIndexFingerprint: M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractIndexFingerprint,
  targetProof: 'registry artifact fixture rc2-web-v1',
})

export async function createFrozenM2RetrievalIndex(): Promise<ContractIndex> {
  const index = await createContractIndex(
    M2_RETRIEVAL_TARGET.targetFingerprint,
    frozenContractFacts.evidence,
    frozenContractFacts.contracts,
    createNodeSha256Port(),
  )
  if (index.fingerprint !== M2_RETRIEVAL_TARGET.contractIndexFingerprint) {
    throw new Error(
      `Frozen M2.3 Contract Index fingerprint drifted: expected ${M2_RETRIEVAL_TARGET.contractIndexFingerprint}, got ${index.fingerprint}`,
    )
  }
  return index
}
