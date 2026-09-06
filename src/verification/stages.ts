import type { VerificationReport } from '../protocol/index.js'

type VerificationCheck = VerificationReport['checks'][number]
type VerificationStageId = VerificationCheck['id']
type VerificationStageStatus = VerificationCheck['status']

const STAGE_IDS = Object.freeze([
  'structure',
  'manifest',
  'dependency',
  'contract',
  'build',
  'package',
  'install',
  'compose',
  'boot',
  'visibility',
  'behavior',
] as const satisfies readonly VerificationStageId[])

const RUNTIME_PASSABLE = new Set<VerificationStageId>([
  'package',
  'install',
  'compose',
  'boot',
  'visibility',
])

const PREREQUISITE: Partial<Record<VerificationStageId, VerificationStageId>> = Object.freeze({
  install: 'package',
  compose: 'install',
  boot: 'compose',
  visibility: 'boot',
})

const DOWNSTREAM: Readonly<Record<'package' | 'install' | 'compose' | 'boot' | 'visibility', readonly VerificationStageId[]>> = Object.freeze({
  package: Object.freeze(['install', 'compose', 'boot', 'visibility']),
  install: Object.freeze(['compose', 'boot', 'visibility']),
  compose: Object.freeze(['boot', 'visibility']),
  boot: Object.freeze(['visibility']),
  visibility: Object.freeze([]),
})

function freezeChecks(checks: readonly VerificationCheck[]): readonly VerificationCheck[] {
  return Object.freeze(checks.map(check => Object.freeze({ ...check })))
}

function initialReason(id: VerificationStageId): string {
  if (id === 'structure' || id === 'manifest' || id === 'dependency' || id === 'contract') {
    return 'handled-by-static-check'
  }
  if (id === 'build') return 'not-requested-in-m4.1'
  if (id === 'visibility') return 'no-visibility-assertions'
  if (id === 'behavior') return 'not-supported-in-m4.1'
  return 'not-executed'
}

function replaceCheck(
  checks: readonly VerificationCheck[],
  id: VerificationStageId,
  status: VerificationStageStatus,
  reason?: string,
): readonly VerificationCheck[] {
  return freezeChecks(checks.map(check => check.id === id
    ? { id, status, ...(reason === undefined ? {} : { reason }) }
    : check))
}

function checkFor(checks: readonly VerificationCheck[], id: VerificationStageId): VerificationCheck {
  const check = checks.find(candidate => candidate.id === id)
  if (check === undefined) throw new Error(`Verification stage ledger is missing ${id}.`)
  return check
}

function assertRuntimePassable(id: VerificationStageId): void {
  if (!RUNTIME_PASSABLE.has(id)) {
    throw new Error(`Verification stage ${id} is not passable by the M4.1 runtime worker.`)
  }
}

export function createM41StageLedger(): readonly VerificationCheck[] {
  return freezeChecks(STAGE_IDS.map(id => ({ id, status: 'skipped' as const, reason: initialReason(id) })))
}

export function passVerificationStage(
  checks: readonly VerificationCheck[],
  id: VerificationStageId,
): readonly VerificationCheck[] {
  assertRuntimePassable(id)
  const prerequisite = PREREQUISITE[id]
  if (prerequisite !== undefined && checkFor(checks, prerequisite).status !== 'passed') {
    throw new Error(`Verification stage ${id} cannot pass before prerequisite ${prerequisite}.`)
  }
  return replaceCheck(checks, id, 'passed')
}

export function failVerificationStage(
  checks: readonly VerificationCheck[],
  id: VerificationStageId,
  reason: string,
): readonly VerificationCheck[] {
  assertRuntimePassable(id)
  if (reason.length === 0) throw new Error('Failed verification stage requires a reason.')

  let next = replaceCheck(checks, id, 'failed', reason)
  const downstream = DOWNSTREAM[id as keyof typeof DOWNSTREAM]
  for (const downstreamId of downstream) {
    next = replaceCheck(next, downstreamId, 'skipped', `prerequisite-${id}-failed`)
  }
  return next
}

export function skipVerificationStage(
  checks: readonly VerificationCheck[],
  id: VerificationStageId,
  reason: string,
): readonly VerificationCheck[] {
  if (reason.length === 0) throw new Error('Skipped verification stage requires a reason.')
  return replaceCheck(checks, id, 'skipped', reason)
}
