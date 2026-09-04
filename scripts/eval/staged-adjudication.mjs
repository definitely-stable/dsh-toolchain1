import { requireApiSymbol, requirePackageName } from './staged-result-contract.mjs'

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return /** @type {Record<string, any>} */ (value)
}

function requireNonBlank(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireSymbols(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must contain at least one symbol`)
  const symbols = value.map((candidate, index) => requireApiSymbol(candidate, `${label}[${index}]`))
  if (new Set(symbols).size !== symbols.length) throw new Error(`${label} must not contain duplicate symbols`)
  return Object.freeze(symbols)
}

export function validateDevelopmentTaskOracle(taskValue) {
  const task = requireRecord(taskValue, 'development task')
  requireNonBlank(task.id, 'development task id')
  const rule = requireRecord(task.successRule, `development task ${task.id} successRule`)

  if (rule.kind === 'api-exists-any') {
    return Object.freeze({
      kind: 'api-exists-any',
      package: requirePackageName(rule.package, `development task ${task.id} successRule.package`),
      symbols: requireSymbols(rule.symbols, `development task ${task.id} successRule.symbols`),
    })
  }

  if (rule.kind === 'api-absent') {
    const proofScope = requireRecord(rule.proofScope, `development task ${task.id} successRule.proofScope`)
    let normalizedScope
    if (proofScope.kind === 'package') {
      normalizedScope = Object.freeze({
        kind: 'package',
        package: requirePackageName(proofScope.package, `development task ${task.id} successRule.proofScope.package`),
      })
    } else if (proofScope.kind === 'target') {
      normalizedScope = Object.freeze({ kind: 'target' })
    } else {
      throw new Error(`development task ${task.id} successRule.proofScope.kind must be package or target`)
    }
    return Object.freeze({
      kind: 'api-absent',
      symbols: requireSymbols(rule.symbols, `development task ${task.id} successRule.symbols`),
      proofScope: normalizedScope,
    })
  }

  throw new Error(`development task ${task.id} successRule.kind must be api-exists-any or api-absent`)
}

function resolved(isTrue) {
  return Object.freeze({
    status: 'resolved',
    decision: Object.freeze({ apiValid: isTrue, taskSuccess: isTrue }),
  })
}

function unresolved(reason) {
  return Object.freeze({ status: 'unresolved', reason })
}

export function adjudicateDevelopmentClaim(taskValue, structuredValue) {
  const task = requireRecord(taskValue, 'development task')
  const taskId = requireNonBlank(task.id, 'development task id')
  const structured = requireRecord(structuredValue, 'structured result')
  if (structured.taskId !== taskId) throw new Error(`structured result taskId ${String(structured.taskId)} does not match ${taskId}`)
  if (!Array.isArray(structured.claims) || structured.claims.length !== 1) throw new Error('structured result must contain exactly one parsed claim')
  const claim = requireRecord(structured.claims[0], 'structured result claim')
  const rule = validateDevelopmentTaskOracle(task)

  if (rule.kind === 'api-exists-any') {
    if (claim.package !== rule.package || !rule.symbols.includes(claim.symbol)) {
      return unresolved('CLAIM_OUTSIDE_TASK_ORACLE')
    }
    return resolved(claim.assertion === 'exists')
  }

  const packageMatches = rule.proofScope.kind === 'package'
    ? claim.package === rule.proofScope.package
    : claim.package === '*'
  if (!packageMatches || !rule.symbols.includes(claim.symbol)) {
    return unresolved('CLAIM_OUTSIDE_TASK_ORACLE')
  }
  return resolved(claim.assertion === 'absent')
}
