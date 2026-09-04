export const STRUCTURED_RESULT_SCHEMA = 'dsh-toolchain-staged-eval-result-v1'

export const PACKAGE_NAME_PATTERN_SOURCE = '^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?$'
export const PACKAGE_CLAIM_PATTERN_SOURCE = '^(?:\\*|@?[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?)$'
export const SYMBOL_PATTERN_SOURCE = '^[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*$'

const PACKAGE_NAME_PATTERN = new RegExp(PACKAGE_NAME_PATTERN_SOURCE, 'u')
const PACKAGE_CLAIM_PATTERN = new RegExp(PACKAGE_CLAIM_PATTERN_SOURCE, 'u')
const SYMBOL_PATTERN = new RegExp(SYMBOL_PATTERN_SOURCE, 'u')
const RESULT_KEYS = new Set(['schema', 'taskId', 'claims'])
const MEASUREMENT_INPUT_KEYS = new Set(['claim'])
const CLAIM_KEYS = new Set(['package', 'symbol', 'assertion'])

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
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

export function requirePackageName(value, label = 'package') {
  const packageName = requireNonBlankString(value, label)
  if (!PACKAGE_NAME_PATTERN.test(packageName)) throw new Error(`${label} must be a valid package name`)
  return packageName
}

export function requireApiSymbol(value, label = 'symbol') {
  const symbol = requireNonBlankString(value, label)
  if (!SYMBOL_PATTERN.test(symbol)) throw new Error(`${label} must be a dotted API identifier`)
  return symbol
}

function requireClaimPackage(value, label) {
  const packageName = requireNonBlankString(value, label)
  if (!PACKAGE_CLAIM_PATTERN.test(packageName)) throw new Error(`${label} must be a package name or *`)
  return packageName
}

function requireAssertion(value, label) {
  if (value !== 'exists' && value !== 'absent') throw new Error(`${label} must be exists or absent`)
  return value
}

export function parseStagedMeasurementClaim(value, label = 'claim') {
  const claim = requireRecord(value, label)
  rejectUnknownKeys(claim, CLAIM_KEYS, label)
  return Object.freeze({
    package: requireClaimPackage(claim.package, `${label}.package`),
    symbol: requireApiSymbol(claim.symbol, `${label}.symbol`),
    assertion: requireAssertion(claim.assertion, `${label}.assertion`),
  })
}

export function parseStagedMeasurementInput(value) {
  const input = requireRecord(value, 'measurement input')
  rejectUnknownKeys(input, MEASUREMENT_INPUT_KEYS, 'measurement input')
  return Object.freeze({ claim: parseStagedMeasurementClaim(input.claim) })
}

export function createCanonicalStagedResult(taskIdValue, measurementInput) {
  const taskId = requireNonBlankString(taskIdValue, 'taskId')
  const input = parseStagedMeasurementInput(measurementInput)
  return Object.freeze({
    schema: STRUCTURED_RESULT_SCHEMA,
    taskId,
    claims: Object.freeze([input.claim]),
  })
}

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
    claims: Object.freeze([parseStagedMeasurementClaim(result.claims[0], 'claims[0]')]),
  })
}
