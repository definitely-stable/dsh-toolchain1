import { H2_POLICY } from './h2-config.mjs'

export const H2_ACP_PROFILE = 'acp'

/**
 * The causal boundary of H2: Arm B is the unmodified automation-only DSH
 * `acp` profile; Arm C is exactly Arm B plus the production DSH Toolchain
 * bundle. Nothing else may differ, and `assertBcParity` proves it.
 *
 * @typedef {object} H2ArmComposition
 * @property {'B'|'C'} arm
 * @property {string} profile
 * @property {readonly {tarball: string, bundle: string}[]} pluginInstalls
 * @property {readonly string[]} patchOverlays
 * @property {readonly string[]} expectedExtraBundles
 */

/**
 * @param {{arm: string, toolchainTarball?: string}} input
 * @returns {H2ArmComposition}
 */
export function buildArmComposition({ arm, toolchainTarball }) {
  if (arm === 'B') {
    return Object.freeze({
      arm: 'B',
      profile: H2_ACP_PROFILE,
      pluginInstalls: Object.freeze([]),
      patchOverlays: Object.freeze([]),
      expectedExtraBundles: Object.freeze([]),
    })
  }
  if (arm === 'C') {
    if (typeof toolchainTarball !== 'string' || toolchainTarball.length === 0) {
      throw new Error('Arm C requires the exact packed Toolchain tarball path')
    }
    return Object.freeze({
      arm: 'C',
      profile: H2_ACP_PROFILE,
      pluginInstalls: Object.freeze([Object.freeze({ tarball: toolchainTarball, bundle: H2_POLICY.toolchainPatch.bundle })]),
      patchOverlays: Object.freeze([]),
      expectedExtraBundles: Object.freeze([H2_POLICY.toolchainPatch.bundle]),
    })
  }
  throw new Error(`unknown H2 arm: ${String(arm)}`)
}

/**
 * Structural proof that C = B + Toolchain: stripping the declared Toolchain
 * install from C must reproduce B exactly, and C may not add any other
 * plugin, patch, bundle, or profile change.
 */
export function assertBcParity({ b, c }) {
  if (b.arm !== 'B' || c.arm !== 'C') throw new Error('H2 parity requires a B and a C composition')
  if (b.profile !== c.profile) throw new Error('H2 parity violated: arm profiles differ')
  if (b.patchOverlays.length !== c.patchOverlays.length) throw new Error('H2 parity violated: arm patch overlays differ')
  for (let index = 0; index < b.patchOverlays.length; index += 1) {
    if (b.patchOverlays[index] !== c.patchOverlays[index]) throw new Error('H2 parity violated: arm patch overlay content differs')
  }
  const expectedInstalls = H2_POLICY.toolchainPatch.bundle
  const cInstalls = c.pluginInstalls.filter(install => install.bundle === expectedInstalls)
  const otherInstalls = c.pluginInstalls.filter(install => install.bundle !== expectedInstalls)
  if (cInstalls.length !== 1) throw new Error('H2 parity violated: Arm C must install the Toolchain bundle exactly once')
  if (otherInstalls.length !== 0) throw new Error('H2 parity violated: Arm C installs capabilities beyond the Toolchain')
  if (b.pluginInstalls.length !== 0) throw new Error('H2 parity violated: Arm B must install no profile plugin')
  const expectedBundles = [...b.expectedExtraBundles, expectedInstalls].sort().join('\n')
  if ([...c.expectedExtraBundles].sort().join('\n') !== expectedBundles) {
    throw new Error('H2 parity violated: Arm C adds bundles beyond the Toolchain')
  }
  return true
}

/** DSH CLI argv for profile-scoped plugin installation (argv after `dsh`). */
export function pluginAddArgs({ profile, tarball }) {
  return ['plugin', '--profile', profile, 'add', '--ignore-scripts', tarball]
}

/** DSH CLI argv for a normal profile boot (argv after `dsh`). */
/**
 * DSH CLI argv for a normal profile boot (argv after `dsh`). `appArgs` are
 * the launcher arguments handed to the booted application; the Web profile
 * needs `--no-open --port 0` to boot headlessly for a probe.
 *
 * @param {{profile: string, appArgs?: string[]}} input
 */
export function bootArgs({ profile, appArgs = [] }) {
  return ['--profile', profile, ...appArgs]
}

/** DSH CLI argv for a boot-free composition dump (argv after `dsh`). */
export function dumpConfigArgs({ profile }) {
  return ['--profile', profile, '--dump-config']
}

/**
 * Extracts `- id:` / `name:` row pairs from a composed DSH config dump.
 * The dump is trusted launcher output; a tiny line scanner avoids adding a
 * YAML dependency for what is a structural presence check.
 */
export function extractCompositionFacts(dump) {
  if (typeof dump !== 'string') throw new Error('composition dump must be a string')
  const rows = []
  let currentId
  for (const rawLine of dump.split(/\r?\n/)) {
    const idMatch = /^\s*-\s*id:\s*(\S+)\s*$/.exec(rawLine)
    if (idMatch !== null) {
      currentId = idMatch[1]
      continue
    }
    const nameMatch = /^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(rawLine)
    if (nameMatch !== null && currentId !== undefined) {
      rows.push(Object.freeze({ id: currentId, name: nameMatch[1] }))
      currentId = undefined
    }
  }
  return Object.freeze({ rows: Object.freeze(rows) })
}

/**
 * Empirical parity check over two real `--dump-config` outputs:
 * every Arm-B row must exist in Arm-C, and the only Arm-C additions must be
 * the single `dsh-toolchain` row contributed by the production bundle patch.
 */
export function assertDumpParity({ dumpB, dumpC }) {
  const factsB = extractCompositionFacts(dumpB)
  const factsC = extractCompositionFacts(dumpC)
  const key = row => `${row.id}\u0000${row.name}`
  const setB = new Set(factsB.rows.map(key))
  const setC = new Set(factsC.rows.map(key))
  // Arm B must be pristine before any additive comparison is meaningful.
  const toolchainRowsB = factsB.rows.filter(row => row.id.includes('dsh-toolchain') || row.name.includes('dsh-toolchain'))
  if (toolchainRowsB.length !== 0) throw new Error('H2 dump parity violated: Arm B already contains Toolchain rows')
  for (const row of factsB.rows) {
    if (!setC.has(key(row))) throw new Error(`H2 dump parity violated: Arm C is missing Arm-B row ${row.id}`)
  }
  const addedRows = factsC.rows.filter(row => !setB.has(key(row)))
  const expectedRow = H2_POLICY.toolchainPatch
  if (addedRows.length !== 1) {
    throw new Error(`H2 dump parity violated: Arm C must add exactly one row, saw ${addedRows.length}`)
  }
  const [added] = addedRows
  if (added.id !== expectedRow.rowId || added.name !== expectedRow.rowName) {
    throw new Error(`H2 dump parity violated: Arm C added unexpected row ${added.id} / ${added.name}`)
  }
  if (!dumpC.includes('dsh-toolchain')) throw new Error('H2 dump parity violated: Arm C dump does not mention the Toolchain bundle')
  return Object.freeze({ addedRows: Object.freeze(addedRows) })
}