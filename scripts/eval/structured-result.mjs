export const STRUCTURED_RESULT_SCHEMA = 'dsh-toolchain-staged-eval-result-v1'

const RESULT_KEYS = new Set(['schema', 'taskId', 'claims'])
const CLAIM_KEYS = new Set(['package', 'symbol', 'assertion'])
const PACKAGE_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/u
const SYMBOL_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a structured result object`)
  }
  return /** @type {Record<string, unknown>} */ (value)
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown key: ${key}`)
  }
}

function requireNonBlankString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requirePackage(value, label) {
  const packageName = requireNonBlankString(value, label)
  if (packageName !== '*' && !PACKAGE_PATTERN.test(packageName)) {
    throw new Error(`${label} must be a package name or *`)
  }
  return packageName
}

function requireSymbol(value, label) {
  const symbol = requireNonBlankString(value, label)
  if (!SYMBOL_PATTERN.test(symbol)) throw new Error(`${label} must be a dotted API identifier`)
  return symbol
}

function requireAssertion(value, label) {
  if (value !== 'exists' && value !== 'absent') throw new Error(`${label} must be exists or absent`)
  return value
}

function parseClaim(value, index) {
  const label = `claims[${index}]`
  const claim = requireRecord(value, label)
  rejectUnknownKeys(claim, CLAIM_KEYS, label)
  return Object.freeze({
    package: requirePackage(claim.package, `${label}.package`),
    symbol: requireSymbol(claim.symbol, `${label}.symbol`),
    assertion: requireAssertion(claim.assertion, `${label}.assertion`),
  })
}

/**
 * Parse the explicit development-only measurement transport.
 * Free text and model-supplied verdicts are intentionally not accepted here.
 * The provider reports one explicit API claim; deterministic exact-target
 * adjudication decides API validity and task success downstream.
 *
 * @param {unknown} value
 */
export function parseDevelopmentStructuredResult(value) {
  const result = requireRecord(value, 'structured result')
  rejectUnknownKeys(result, RESULT_KEYS, 'structured result')

  if (result.schema !== STRUCTURED_RESULT_SCHEMA) {
    throw new Error(`structured result schema must equal ${STRUCTURED_RESULT_SCHEMA}`)
  }

  const taskId = requireNonBlankString(result.taskId, 'taskId')
  if (!Array.isArray(result.claims) || result.claims.length !== 1) {
    throw new Error('claims must contain exactly one claim')
  }

  return Object.freeze({
    schema: STRUCTURED_RESULT_SCHEMA,
    taskId,
    claims: Object.freeze(result.claims.map(parseClaim)),
  })
}
