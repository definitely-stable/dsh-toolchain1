import os from 'node:os'
import { performance } from 'node:perf_hooks'

const MAX_ERROR_NAME_LENGTH = 80
const MAX_ERROR_MESSAGE_LENGTH = 512

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
  return value
}

function replaceAllLiteral(value, needle, replacement) {
  if (typeof needle !== 'string' || needle === '') return value
  return value.split(needle).join(replacement)
}

/**
 * Convert an arbitrary failure into bounded diagnostics safe for persisted benchmark evidence.
 * The original Error object is returned separately by measureSample and is never serialized.
 * @param {unknown} error
 */
export function perfErrorDetails(error) {
  const name = (error instanceof Error ? error.name : 'Error').slice(0, MAX_ERROR_NAME_LENGTH) || 'Error'
  let message = error instanceof Error ? error.message : String(error)

  for (const [root, replacement] of [
    [process.cwd(), '<cwd>'],
    [os.homedir(), '<home>'],
    [os.tmpdir(), '<tmp>'],
  ]) {
    message = replaceAllLiteral(message, root, replacement)
  }

  for (const value of Object.values(process.env)) {
    if (typeof value === 'string' && value.length >= 12) {
      message = replaceAllLiteral(message, value, '<redacted>')
    }
  }

  message = message.replace(/\s+/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
  return Object.freeze({ name, message })
}

export async function measureSample({ caseName, phase, iteration, concurrency, operation }) {
  if (typeof caseName !== 'string' || caseName === '') throw new Error('caseName is required')
  if (typeof phase !== 'string' || phase === '') throw new Error('phase is required')
  requirePositiveInteger(iteration, 'iteration')
  requirePositiveInteger(concurrency, 'concurrency')
  if (typeof operation !== 'function') throw new Error('operation must be a function')

  const cpuBefore = process.cpuUsage()
  const eventLoopBefore = performance.eventLoopUtilization()
  const started = performance.now()
  let value
  let error
  try {
    value = await operation()
  } catch (caught) {
    error = caught
  }
  const elapsedMs = performance.now() - started
  const cpu = process.cpuUsage(cpuBefore)
  const eventLoop = performance.eventLoopUtilization(eventLoopBefore)
  const memory = process.memoryUsage()
  const resources = process.resourceUsage()

  const common = {
    schema: 'dsh-perf-sample-v1',
    caseName,
    phase,
    iteration,
    concurrency,
    elapsedMs,
    cpu: Object.freeze({
      userMicros: cpu.user,
      systemMicros: cpu.system,
    }),
    memory: Object.freeze({
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      maxRssKiB: resources.maxRSS,
    }),
    eventLoop: Object.freeze({
      utilization: eventLoop.utilization,
      activeMs: eventLoop.active,
      idleMs: eventLoop.idle,
    }),
  }

  if (error === undefined) {
    return Object.freeze({
      value,
      error: undefined,
      sample: Object.freeze({ ...common, outcome: 'ok', error: undefined }),
    })
  }

  return Object.freeze({
    value: undefined,
    error,
    sample: Object.freeze({ ...common, outcome: 'error', error: perfErrorDetails(error) }),
  })
}
