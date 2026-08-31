import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { validateH1SourceBoundPreregistrationV2 } from './m2-h1-source-bound-preregistration-v2.js'

const publicationUrl = new URL(
  '../../docs/evaluation/m2/h1-source-bound-preregistration-v2.json',
  import.meta.url,
)

const EXPECTED = Object.freeze({
  receiptSha256: 'dc12ccf907f507b5f6da08c790a1a84563160e984879724e5c18283e0404219b',
  definitionSha256: 'c07c9d91eee82101872cd106e8170ecebcbba4368039255118673382a956d717',
  sourceBindingSha256: 'c7308f7344146b670fb3a24a76a960f83660e31ce20279accef77959cc709afc',
  envelopeSha256: '2d39af8d83aefc459d509be114618b92784015a96a796c9eccf0f03e1cab57c4',
  sourceCommitSha: '76951152e9ccce28dd86469410cb67131f3a46b1',
})

describe('published M2.3 H1 execution-source binding', () => {
  it('validates the exact public envelope and continuation identity', async () => {
    const raw = JSON.parse(await readFile(publicationUrl, 'utf8')) as unknown
    const publication = await validateH1SourceBoundPreregistrationV2(
      raw,
      createNodeSha256Port(),
    )

    expect(publication.receipt.receiptSha256).toBe(EXPECTED.receiptSha256)
    expect(publication.receipt.execution.definitionSha256).toBe(EXPECTED.definitionSha256)
    expect(publication.sourceBinding.sourceBindingSha256).toBe(EXPECTED.sourceBindingSha256)
    expect(publication.envelopeSha256).toBe(EXPECTED.envelopeSha256)

    expect(JSON.parse(publication.sourceBinding.sourceIdentity.inline)).toEqual({
      schema: 'dsh-toolchain-m2-h1-execution-source-v2',
      repository: 'definitely-stable/dsh-toolchain1',
      sourceCommitSha: EXPECTED.sourceCommitSha,
      runtime: 'node',
      runtimeVersion: '24.19.0',
      entrypoint: 'scripts/m2-opencode-go-p0-child.mjs',
      protocol: 'closed-ndjson-v1',
    })
  })
})
