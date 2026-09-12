import { parentPort } from 'node:worker_threads'

import { createDefaultCases } from './run.mjs'

if (parentPort === null) throw new Error('Performance default worker requires a parent port')

const registries = new Map()

async function registryForScale(scale) {
  let registry = registries.get(scale)
  if (registry === undefined) {
    registry = createDefaultCases({ scale })
    registries.set(scale, registry)
  }
  return registry
}

function boundedWorkerError(error) {
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : String(error)
  return Object.freeze({
    name: name.slice(0, 80) || 'Error',
    message: message.replace(/\s+/gu, ' ').trim().slice(0, 512),
  })
}

parentPort.on('message', async message => {
  const id = message?.id
  try {
    const payload = message?.payload
    const caseName = payload?.caseName
    const scale = payload?.scale
    const concurrency = payload?.concurrency
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Performance worker task id is invalid')
    if (typeof caseName !== 'string' || caseName.length === 0) throw new Error('Performance worker caseName is required')
    if (!Number.isSafeInteger(scale) || scale < 1) throw new Error('Performance worker scale must be a positive integer')
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Performance worker concurrency must be a positive integer')

    const registry = await registryForScale(scale)
    const perfCase = registry.find(candidate => candidate.name === caseName)
    if (perfCase === undefined) throw new Error(`Unknown performance worker case: ${caseName}`)
    const value = await perfCase.run({ scale, concurrency })
    parentPort.postMessage({ id, value })
  } catch (error) {
    parentPort.postMessage({ id, error: boundedWorkerError(error) })
  }
})
