import { dirname } from 'node:path'

import {
  captureConventionalPackageFiles,
  createOrdinaryWorkspaceFixture,
} from './m2-ordinary-evidence.mjs'

function packageVersion(contract) {
  const facts = Array.isArray(contract.facts) ? contract.facts : []
  const versions = facts
    .filter(fact => fact?.key === 'version' && typeof fact.value === 'string' && fact.value.length > 0)
    .map(fact => fact.value)
  const unique = [...new Set(versions)]
  if (unique.length !== 1) {
    throw new Error(`Package contract ${String(contract.id)} must expose exactly one version fact`)
  }
  return unique[0]
}

function evidenceForContract(contract, evidenceById) {
  const ids = Array.isArray(contract.evidenceIds) ? contract.evidenceIds : []
  return ids.map(id => evidenceById.get(id)).filter(Boolean)
}

export async function captureOrdinaryWorkspaceFromAcquiredEvidence(input) {
  const contracts = Array.isArray(input.acquired?.contracts) ? input.acquired.contracts : []
  const evidence = Array.isArray(input.acquired?.evidence) ? input.acquired.evidence : []
  const evidenceById = new Map(evidence.map(item => [item.id, item]))
  const packageContracts = contracts
    .filter(contract => contract?.kind === 'package' && typeof contract.name === 'string')
    .toSorted((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

  const packages = []
  const files = []
  const seenPackages = new Set()
  for (const contract of packageContracts) {
    if (seenPackages.has(contract.name)) throw new Error(`Duplicate acquired package contract: ${contract.name}`)
    seenPackages.add(contract.name)

    const version = packageVersion(contract)
    const witnesses = evidenceForContract(contract, evidenceById)
    const manifestLocations = witnesses
      .filter(item => item.kind === 'manifest' && typeof item.location === 'string')
      .map(item => item.location)
    if (manifestLocations.length === 0) {
      throw new Error(`Package contract ${contract.name} has no manifest location in production evidence`)
    }
    const declarationLocations = witnesses
      .filter(item => item.kind === 'type-declaration' && typeof item.location === 'string')
      .map(item => item.location)
      .toSorted()

    packages.push({ name: contract.name, version })
    files.push(...await captureConventionalPackageFiles({
      name: contract.name,
      version,
      packageRoot: dirname(manifestLocations[0]),
      declarationLocations,
    }))
  }

  if (packages.length === 0) throw new Error('Production acquisition exposed no package contracts for ordinary workspace capture')
  return createOrdinaryWorkspaceFixture({
    fixtureVersion: input.fixtureVersion,
    target: input.target,
    packages,
    files,
  })
}
