import { describe, expect, it } from 'vitest'

import {
  createContractSearchIndex,
  intentQueryTokens,
  type ContractSearchIndex,
} from '../../src/model/contract-search-index.js'
import { explainContractSearch, searchContractIndex } from '../../src/model/contract.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import {
  R2_RETRIEVAL_DEV,
  fingerprintR2RetrievalCorpus,
} from './m2-retrieval-r2.js'
import {
  R2_FACT_COHERENCE_BASELINE_CORPUS_FINGERPRINT,
  R2_FACT_COHERENCE_BASELINE_RANKER_VERSION,
} from './m2-retrieval-r2-fact-coherence-snapshot.js'

const IDF_PRECISION = 1_000_000

function quantize(value: number): number {
  return Math.round(value * IDF_PRECISION) / IDF_PRECISION
}

function idf(index: ContractSearchIndex, token: string): number {
  const documentFrequency = index.documentFrequency.get(token) ?? 0
  if (index.documentCount <= 0 || documentFrequency <= 0) return 0
  return quantize(Math.log(
    1 + ((index.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5)),
  ))
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return quantize(numerator / denominator)
}

describe('Contract Search v3 abstention support audit', () => {
  it('records deterministic support features on the frozen R2-dev corpus before selecting an abstention rule', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const corpusFingerprint = fingerprintR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint)

    expect(derived.rankerVersion).toBe(R2_FACT_COHERENCE_BASELINE_RANKER_VERSION)
    expect(corpusFingerprint).toBe(R2_FACT_COHERENCE_BASELINE_CORPUS_FINGERPRINT)

    const rows = R2_RETRIEVAL_DEV.map(task => {
      const queryTokens = intentQueryTokens(task.query)
      const knownTokens = queryTokens.filter(token => (derived.documentFrequency.get(token) ?? 0) > 0)
      const oovTokens = queryTokens.filter(token => (derived.documentFrequency.get(token) ?? 0) === 0)
      const selection = searchContractIndex(index, task.query, undefined, 5, derived)
      const explanation = explainContractSearch(index, task.query, undefined, 5, derived)
      const top = selection.matches[0]
      const topExplanation = explanation.results[0]
      const matchedTerms = topExplanation?.terms ?? []
      const matchedTokens = matchedTerms.map(term => term.token)
      const knownIdfMass = knownTokens.reduce((sum, token) => sum + idf(derived, token), 0)
      const matchedIdfMass = matchedTokens.reduce((sum, token) => sum + idf(derived, token), 0)
      const contributionMass = matchedTerms.reduce((sum, term) => sum + term.contribution, 0)
      const identityContribution = matchedTerms
        .filter(term => term.field === 'identity')
        .reduce((sum, term) => sum + term.contribution, 0)
      const semanticTerms = matchedTerms.filter(term => term.field === 'fact' || term.field === 'summary')
      const topDocument = top === undefined ? undefined : derived.documents.get(top.id)
      const maxSameFactMatchedTokens = topDocument === undefined
        ? 0
        : Math.max(0, ...topDocument.facts.map(fact =>
          queryTokens.filter(token => fact.uniqueTokens.has(token)).length,
        ))
      const topContract = top === undefined
        ? undefined
        : index.contracts.find(contract => contract.id === top.id)
      const queryIncludesTopPackageName = topContract === undefined
        ? false
        : task.query.toLocaleLowerCase('en-US').includes(topContract.name.toLocaleLowerCase('en-US'))

      if (top !== undefined) expect(topExplanation?.contractId).toBe(top.id)

      return Object.freeze({
        taskId: task.id,
        scenario: task.scenario,
        expectNoResult: task.expectNoResult === true,
        topContractId: top?.id ?? null,
        topScore: top?.score ?? null,
        queryTokenCount: queryTokens.length,
        knownTokenCount: knownTokens.length,
        oovTokenCount: oovTokens.length,
        matchedTokenCount: matchedTokens.length,
        matchedQueryRatio: ratio(matchedTokens.length, queryTokens.length),
        matchedKnownRatio: ratio(matchedTokens.length, knownTokens.length),
        knownIdfMass: quantize(knownIdfMass),
        matchedIdfMass: quantize(matchedIdfMass),
        matchedIdfCoverage: ratio(matchedIdfMass, knownIdfMass),
        identityTermCount: matchedTerms.filter(term => term.field === 'identity').length,
        semanticTermCount: semanticTerms.length,
        identityContributionShare: ratio(identityContribution, contributionMass),
        maxSameFactMatchedTokens,
        queryIncludesTopPackageName,
        knownTokens,
        oovTokens,
        matchedTokens,
        fields: matchedTerms.map(term => `${term.token}:${term.field}`),
      })
    })

    console.log(`M2_RETRIEVAL_R2_ABSTENTION_SUPPORT_AUDIT ${JSON.stringify({
      rankerVersion: derived.rankerVersion,
      corpusFingerprint,
      rows,
    })}`)

    expect(rows).toHaveLength(18)
  })
})
