import { performance } from 'node:perf_hooks'

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`)
  return value
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
  const value = await operation()
  const elapsedMs = performance.now() - started
  const cpu = process.cpuUsage(cpuBefore)
  const eventLoop = performance.eventLoopUtilization(eventLoopBefore)
  const memory = process.memoryUsage()
  const resources = process.resourceUsage()

  const sample = Object.freeze({
    schema: 'dsh-perf-sample-v1',
    caseName,
    phase,
    iteration,
    concurrency,
    outcome: 'ok',
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
  })

  return Object.freeze({ value, sample })
}
