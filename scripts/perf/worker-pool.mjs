import { Worker } from 'node:worker_threads'

function requirePoolSize(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error('Performance worker pool size must be an integer between 1 and 32')
  }
  return value
}

function workerFailure(message) {
  const detail = message?.error
  if (detail && typeof detail === 'object') {
    const error = new Error(typeof detail.message === 'string' ? detail.message : 'Performance worker failed')
    if (typeof detail.name === 'string' && detail.name.length > 0) error.name = detail.name
    return error
  }
  return new Error('Performance worker returned an invalid failure response')
}

/**
 * @param {{ size: number; workerUrl: URL }} options
 */
export function createWorkerPool({ size, workerUrl }) {
  const poolSize = requirePoolSize(size)
  if (!(workerUrl instanceof URL)) throw new Error('Performance workerUrl must be a URL')

  let nextTaskId = 1
  let closed = false
  let failed = false
  const queue = []
  const slots = []

  const rejectEverything = error => {
    if (failed || closed) return
    failed = true
    for (const slot of slots) {
      if (slot.task !== undefined) {
        slot.task.reject(error)
        slot.task = undefined
        slot.busy = false
      }
    }
    while (queue.length > 0) queue.shift().reject(error)
  }

  const dispatch = () => {
    if (closed || failed) return
    for (const slot of slots) {
      if (slot.busy || queue.length === 0) continue
      const task = queue.shift()
      slot.busy = true
      slot.task = task
      slot.worker.postMessage({ id: task.id, payload: task.payload })
    }
  }

  for (let index = 0; index < poolSize; index += 1) {
    const worker = new Worker(workerUrl)
    const slot = { worker, busy: false, task: undefined }
    slots.push(slot)

    worker.on('message', message => {
      const task = slot.task
      if (task === undefined) {
        rejectEverything(new Error('Performance worker returned a response without an active task'))
        return
      }
      if (message?.id !== task.id) {
        rejectEverything(new Error(`Performance worker response id mismatch: expected ${task.id}, received ${String(message?.id)}`))
        return
      }

      slot.task = undefined
      slot.busy = false
      if (message?.error !== undefined) task.reject(workerFailure(message))
      else task.resolve(message?.value)
      dispatch()
    })

    worker.on('error', error => rejectEverything(error))
    worker.on('exit', code => {
      if (!closed) rejectEverything(new Error(`Performance worker exited unexpectedly with code ${code}`))
    })
  }

  const run = payload => {
    if (closed) return Promise.reject(new Error('Performance worker pool is closed'))
    if (failed) return Promise.reject(new Error('Performance worker pool is failed'))
    const id = nextTaskId
    nextTaskId += 1
    return new Promise((resolve, reject) => {
      queue.push({ id, payload, resolve, reject })
      dispatch()
    })
  }

  return Object.freeze({
    size: poolSize,
    run,
    runMany(payloads) {
      if (!Array.isArray(payloads)) return Promise.reject(new Error('Performance worker batch must be an array'))
      return Promise.all(payloads.map(payload => run(payload)))
    },
    async close() {
      if (closed) return
      closed = true
      const closingError = new Error('Performance worker pool closed with pending work')
      for (const slot of slots) {
        if (slot.task !== undefined) {
          slot.task.reject(closingError)
          slot.task = undefined
        }
      }
      while (queue.length > 0) queue.shift().reject(closingError)
      await Promise.all(slots.map(slot => slot.worker.terminate()))
    },
  })
}
