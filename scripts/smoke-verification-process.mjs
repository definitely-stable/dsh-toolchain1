#!/usr/bin/env node

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { runVerificationProcess } from '../lib/verification/process.js'

const fixture = fileURLToPath(new URL('./fixtures/verification-child.mjs', import.meta.url))

function request(args, overrides = {}) {
  return {
    command: process.execPath,
    args: [fixture, ...args],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 2_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    ...overrides,
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return !(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')
  }
}

async function waitForProcessGone(pid) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return !processExists(pid)
}

export async function smokeVerificationProcess() {
  const timeout = await runVerificationProcess(request(['spawn-grandchild'], {
    timeoutMs: 250,
  }))
  assert.equal(timeout.kind, 'timeout', 'verification process smoke: timeout was not classified')
  assert.equal(typeof timeout.stdout, 'string', 'verification process smoke: timeout stdout missing')

  const descendantPid = Number.parseInt(timeout.stdout.trim(), 10)
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0, 'verification process smoke: descendant pid missing')
  const descendantGone = await waitForProcessGone(descendantPid)
  if (!descendantGone) {
    try {
      process.kill(descendantPid, 'SIGKILL')
    } catch {
      // Best-effort smoke cleanup only; assertion below remains the signal.
    }
  }
  assert.equal(descendantGone, true, 'verification process smoke: descendant survived tree termination')

  const controller = new AbortController()
  const cancelled = runVerificationProcess(request(['sleep', '60000']), controller.signal)
  setTimeout(() => controller.abort(), 100)
  assert.equal((await cancelled).kind, 'cancelled', 'verification process smoke: cancellation was not classified')

  const overflow = await runVerificationProcess(request(['stdout', '4096'], {
    maxStdoutBytes: 256,
  }))
  assert.deepEqual(overflow, {
    kind: 'output-limit',
    stream: 'stdout',
  }, 'verification process smoke: stdout ceiling did not fail closed')

  process.stdout.write(`Verification process smoke: ${process.platform}/${process.arch} timeout + cancellation + tree cleanup + output bound verified\n`)
}

const invokedAsScript = process.argv[1]
  ? fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))
  : false

if (invokedAsScript) await smokeVerificationProcess()
