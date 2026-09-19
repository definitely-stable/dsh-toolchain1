import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { createApplicationKernel, type ApplicationKernel } from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredPluginSubject } from '../../src/model/plugin.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'

const FIXTURE_DIRECTORY = new URL('./fixtures/m2/rc2-web-v1/', import.meta.url)

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIRECTORY), 'utf8')) as T
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export interface FrozenM2KernelHarness {
  readonly kernel: ApplicationKernel
  replaceEvidenceContentHash(evidenceId: string, contentHash: string): void
  /**
   * Install the subject the next `plugin.check` acquisition returns.
   *
   * The frozen fixture describes one exact DSH target and its Contract Index, not a plugin
   * workspace, so a plugin.check population must supply its subject explicitly. Acquisition fails
   * closed before a subject is installed rather than resolving a half-configured check.
   */
  setPluginSubject(subject: AcquiredPluginSubject): void
}

export async function createFrozenM2KernelHarness(): Promise<FrozenM2KernelHarness> {
  const frozenTargetFacts = await readFixture<AcquiredTargetFacts>('target-facts.json')
  const frozenContractFacts = await readFixture<AcquiredContractFacts>('contract-facts.json')
  let currentContractFacts = clone(frozenContractFacts)
  let currentPluginSubject: AcquiredPluginSubject | undefined

  const kernel = createApplicationKernel({
    targetAcquisition: {
      acquire: async () => clone(frozenTargetFacts),
    },
    contractAcquisition: {
      acquire: async () => clone(currentContractFacts),
    },
    pluginSubjectAcquisition: {
      acquire: async () => {
        if (currentPluginSubject === undefined) {
          throw new Error('Frozen M2 kernel harness has no plugin subject installed')
        }
        return clone(currentPluginSubject)
      },
    },
    digest: {
      sha256Utf8: async value => createHash('sha256').update(value, 'utf8').digest('hex'),
    },
    now: () => '2026-08-28T00:00:00.000Z',
  })

  return Object.freeze({
    kernel,
    setPluginSubject(subject: AcquiredPluginSubject): void {
      currentPluginSubject = subject
    },
    replaceEvidenceContentHash(evidenceId: string, contentHash: string): void {
      if (!/^[0-9a-f]{64}$/.test(contentHash)) {
        throw new Error(`Replacement evidence hash must be lowercase SHA-256: ${contentHash}`)
      }
      let replaced = false
      currentContractFacts = {
        evidence: currentContractFacts.evidence.map(item => {
          if (item.id !== evidenceId) return item
          replaced = true
          return { ...item, contentHash }
        }),
        contracts: currentContractFacts.contracts,
      }
      if (!replaced) throw new Error(`Unknown frozen evidence id ${evidenceId}`)
    },
  })
}
