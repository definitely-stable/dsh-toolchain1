import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createWorkerPool } from '../../scripts/perf/worker-pool.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('performance worker pool', () => {
  it('executes one concurrent batch across distinct worker threads', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-perf-worker-pool-'))
    temporaryDirectories.push(root)
    const workerPath = path.join(root, 'worker.mjs')
    await writeFile(workerPath, `
      import { parentPort, threadId } from 'node:worker_threads'
      if (parentPort === null) throw new Error('missing parent port')
      parentPort.on('message', ({ id, payload }) => {
        const started = Date.now()
        while (Date.now() - started < 25) {}
        parentPort.postMessage({ id, value: { payload, threadId } })
      })
    `, 'utf8')

    const pool = createWorkerPool({
      size: 4,
      workerUrl: pathToFileURL(workerPath),
    })

    try {
      const values = await pool.runMany(['a', 'b', 'c', 'd']) as Array<{ payload: string; threadId: number }>
      expect(values.map(value => value.payload)).toEqual(['a', 'b', 'c', 'd'])
      expect(new Set(values.map(value => value.threadId)).size).toBe(4)
    } finally {
      await pool.close()
    }
  })

  it('rejects active and queued work when a worker exits cleanly before replying', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-perf-worker-exit-'))
    temporaryDirectories.push(root)
    const workerPath = path.join(root, 'worker.mjs')
    await writeFile(workerPath, `
      import { parentPort } from 'node:worker_threads'
      if (parentPort === null) throw new Error('missing parent port')
      parentPort.on('message', () => parentPort.close())
    `, 'utf8')

    const pool = createWorkerPool({
      size: 1,
      workerUrl: pathToFileURL(workerPath),
    })

    try {
      const active = pool.run('active')
      const queued = pool.run('queued')
      const timeout = delay(500).then(() => { throw new Error('worker exit did not fail pending work') })

      await expect(Promise.race([active, timeout])).rejects.toThrow(/worker exited unexpectedly/i)
      await expect(queued).rejects.toThrow(/worker exited unexpectedly/i)
    } finally {
      await pool.close()
    }
  })
})