export const STRUCTURED_RESULT_SCHEMA = 'dsh-toolchain-staged-eval-result-v1'

const RESULT_KEYS = new Set(['schema', 'taskId', 'apiValid', 'taskSuccess', 'claims'])
const CLAIM_KEYS = new Set(['kind', 'name'])

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

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function parseClaim(value, index) {
  const label = `claims[${index}]`
  const claim = requireRecord(value, label)
  rejectUnknownKeys(claim, CLAIM_KEYS, label)
  return Object.freeze({
    kind: requireNonBlankString(claim.kind, `${label}.kind`),
    name: requireNonBlankString(claim.name, `${label}.name`),
  })
}

/**
 * Parse the explicit development-only measurement transport.
 * Free text is intentionally not accepted or recovered here: a provider that
 * cannot return this structure is a measurement capability failure for the
 * staged canary and must be handled by the execution boundary as STOP evidence.
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
  const apiValid = requireBoolean(result.apiValid, 'apiValid')
  const taskSuccess = requireBoolean(result.taskSuccess, 'taskSuccess')
  if (!Array.isArray(result.claims)) throw new Error('claims must be an array')

  const claims = result.claims.map(parseClaim)
  const identities = new Set()
  for (const claim of claims) {
    const identity = `${claim.kind}\u0000${claim.name}`
    if (identities.has(identity)) throw new Error(`duplicate claim: ${claim.kind}:${claim.name}`)
    identities.add(identity)
  }

  return Object.freeze({
    schema: STRUCTURED_RESULT_SCHEMA,
    taskId,
    apiValid,
    taskSuccess,
    claims: Object.freeze(claims),
  })
}
