import type { Diagnostic } from '../protocol/index.js'
import type { ContractDefinition, ContractIndex } from './contract.js'
import type { AcquiredPluginRequirement, AcquiredPluginSubject } from './plugin.js'

export type PluginCompatibilityVerdict =
  | 'compatible-in-scope'
  | 'incompatible'
  | 'unproven'

export type PluginRequirementStatus =
  | 'satisfied'
  | 'not-required-from-host'
  | 'missing'
  | 'unproven'

export interface PluginRequirementAnalysis {
  readonly packageName: string
  readonly range: string
  readonly relationship: AcquiredPluginRequirement['relationship']
  readonly status: PluginRequirementStatus
  readonly targetVersion?: string
}

export interface PluginCompatibilityAnalysis {
  readonly verdict: PluginCompatibilityVerdict
  readonly requirements: readonly PluginRequirementAnalysis[]
  readonly diagnostics: readonly Diagnostic[]
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareRequirements(
  left: AcquiredPluginRequirement,
  right: AcquiredPluginRequirement,
): number {
  return compareCodePoints(left.relationship, right.relationship)
    || compareCodePoints(left.packageName, right.packageName)
    || compareCodePoints(left.range, right.range)
}

function normalizedRequirements(
  requirements: readonly AcquiredPluginRequirement[],
): readonly AcquiredPluginRequirement[] {
  const byKey = new Map<string, AcquiredPluginRequirement>()
  for (const requirement of requirements) {
    const key = `${requirement.relationship}\u0000${requirement.packageName}\u0000${requirement.range}`
    byKey.set(key, requirement)
  }
  return [...byKey.values()].toSorted(compareRequirements)
}

function packageContracts(index: ContractIndex, packageName: string): readonly ContractDefinition[] {
  return index.contracts.filter(contract =>
    contract.kind === 'package'
    && (contract.name === packageName || contract.id === `package:${packageName}`),
  )
}

function packageVersion(
  index: ContractIndex,
  packageName: string,
): { readonly exists: boolean; readonly version?: string } {
  const contracts = packageContracts(index, packageName)
  if (contracts.length === 0) return { exists: false }

  const versions = new Set<string>()
  for (const contract of contracts) {
    for (const fact of contract.facts) {
      if (fact.key === 'version' && fact.value.length > 0) versions.add(fact.value)
    }
  }

  if (versions.size !== 1) return { exists: true }
  return { exists: true, version: [...versions][0] }
}

function pluginDiagnostic(
  code: string,
  severity: Diagnostic['severity'],
  summary: string,
): Diagnostic {
  return Object.freeze({
    code,
    severity,
    domain: 'plugin',
    summary,
  })
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return compareCodePoints(left.code, right.code)
    || compareCodePoints(left.severity, right.severity)
    || compareCodePoints(left.summary, right.summary)
    || compareCodePoints((left.locations ?? []).join('\u0000'), (right.locations ?? []).join('\u0000'))
}

export function analyzePluginCompatibility(
  subject: AcquiredPluginSubject,
  index: ContractIndex,
): PluginCompatibilityAnalysis {
  const diagnostics: Diagnostic[] = [...subject.diagnostics]
  const requirements: PluginRequirementAnalysis[] = []
  let provenIncompatible = false
  let unproven = subject.completeness !== 'complete'

  for (const requirement of normalizedRequirements(subject.requirements)) {
    if (requirement.relationship !== 'host-peer-required') {
      requirements.push(Object.freeze({
        packageName: requirement.packageName,
        range: requirement.range,
        relationship: requirement.relationship,
        status: 'not-required-from-host' as const,
      }))
      continue
    }

    const installed = packageVersion(index, requirement.packageName)
    if (!installed.exists) {
      provenIncompatible = true
      requirements.push(Object.freeze({
        packageName: requirement.packageName,
        range: requirement.range,
        relationship: requirement.relationship,
        status: 'missing' as const,
      }))
      diagnostics.push(pluginDiagnostic(
        'PLUGIN_DSH_PACKAGE_MISSING',
        'error',
        `Required Host peer ${requirement.packageName} is absent from the exact target Contract Index.`,
      ))
      continue
    }

    if (installed.version !== undefined && installed.version === requirement.range) {
      requirements.push(Object.freeze({
        packageName: requirement.packageName,
        range: requirement.range,
        relationship: requirement.relationship,
        status: 'satisfied' as const,
        targetVersion: installed.version,
      }))
      continue
    }

    unproven = true
    requirements.push(Object.freeze({
      packageName: requirement.packageName,
      range: requirement.range,
      relationship: requirement.relationship,
      status: 'unproven' as const,
      ...(installed.version === undefined ? {} : { targetVersion: installed.version }),
    }))
    diagnostics.push(pluginDiagnostic(
      'PLUGIN_DSH_VERSION_UNPROVEN',
      'warning',
      installed.version === undefined
        ? `The exact target does not expose one unambiguous version fact for required Host peer ${requirement.packageName}.`
        : `Compatibility of required Host peer ${requirement.packageName} range ${requirement.range} with target version ${installed.version} is not proven by the static alpha range adapter.`,
    ))
  }

  const verdict: PluginCompatibilityVerdict = provenIncompatible
    ? 'incompatible'
    : unproven
      ? 'unproven'
      : 'compatible-in-scope'

  return Object.freeze({
    verdict,
    requirements: Object.freeze(requirements),
    diagnostics: Object.freeze(diagnostics.toSorted(compareDiagnostics)),
  })
}
