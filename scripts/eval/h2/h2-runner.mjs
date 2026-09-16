import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { H2_POLICY } from './h2-config.mjs'
import { assertBcParity, buildArmComposition, pluginAddArgs } from './h2-composition.mjs'
import {
  classifyTerminal,
  createAcpControlPlane,
  createBudgetGuard,
  createProcessAcpTransport,
} from './h2-dsh.mjs'
import { createDshGraderIo, writeTelemetryOverlay } from './h2-dsh-env.mjs'
import { runGrader } from './h2-grader.mjs'
import {
  assertModelIdentityMatches,
  assertReceiptSanitized,
  buildObservationReceipt,
  parseSessionLog,
} from './h2-telemetry.mjs'
import { applyCleanupPolicy, directoryDigestFrom, materializeWorkspace, observationLayout, prepareObservationDir } from './h2-workspace.mjs'

export const H2_ACP_PROFILE = 'acp'

/**
 * Locates the append-only session log for one ACP session. The controller
 * watches it live so the frozen provider-completion budget is enforced from
 * the authoritative telemetry plane rather than from the control plane.
 *
 * The header line must *identify* this session: a subagent child's log carries
 * its parent's id in `parentSession`, so a substring match could select the
 * child's file and report the child's usage, tools, and model as the parent's.
 */
export async function findSessionLog({ dshHome, sessionId, timeoutMs = 60_000, pollMs = 250 }) {
  const sessionsRoot = join(dshHome, 'sessions')
  const deadline = Date.now() + timeoutMs
  let compressedSeen = false
  while (Date.now() < deadline) {
    if (existsSync(sessionsRoot)) {
      for (const project of await readdir(sessionsRoot)) {
        const projectDir = join(sessionsRoot, project)
        let sessionDirs = []
        try {
          sessionDirs = await readdir(projectDir)
        } catch {
          continue
        }
        for (const sessionDir of sessionDirs) {
          const dir = join(projectDir, sessionDir)
          let files = []
          try {
            files = await readdir(dir)
          } catch {
            continue
          }
          for (const file of files) {
            if (!/^session\.v\d+\.jsonl$/.test(file)) {
              if (/^session\.v\d+\.jsonl\.zstd$/.test(file)) compressedSeen = true
              continue
            }
            const full = join(dir, file)
            const text = await readFile(full, 'utf8')
            const header = text.split(/\r?\n/, 1)[0]
            if (!header.includes(sessionId)) continue
            let parsed
            try {
              parsed = JSON.parse(header)
            } catch {
              continue
            }
            if (parsed?.id !== sessionId) continue
            return full
          }
        }
      }
    }
    await delay(pollMs)
  }
  if (compressedSeen) {
    throw new Error(
      `H2 found only compressed session logs under ${sessionsRoot}: the telemetry overlay that disables log compression did not apply, `
      + 'so the frozen completion budget cannot be enforced from the authoritative log.',
    )
  }
  throw new Error(`H2 could not locate the session log for ${sessionId} under ${sessionsRoot}`)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * The environment the agent under test runs in: the operator environment minus
 * every `H2_*` variable.
 *
 * H2 owns that namespace, and the agent must not inherit it: `H2_DATASET_DIR`
 * alone would hand the agent the absolute path of the private corpus, and the
 * harness variables it genuinely needs are set explicitly by the caller. The
 * rule is a prefix rule rather than a list, so a new H2_ variable cannot leak
 * by being forgotten here.
 *
 * @param {{base?: Record<string, string | undefined>, overrides?: Record<string, string | undefined>}} [input]
 */
export function buildAgentEnvironment({ base = process.env, overrides = {} } = {}) {
  const env = {}
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith('H2_')) continue
    env[key] = value
  }
  return { ...env, ...overrides }
}

/**
 * Bounds the ACP prompt await by the frozen wall clock. `session/cancel` is a
 * request, not a kill, so a stuck agent would otherwise run past the limit
 * indefinitely; once the limit is reached the session is cancelled, the agent
 * gets a short grace to finish the turn, and then the caller's transport
 * termination owns process lifetime.
 */
async function awaitPromptWithinWallClock({ promptPromise, limitMs, onExpiry, graceMs = 5_000 }) {
  let timer
  const expiry = new Promise(resolve => {
    timer = setTimeout(() => {
      onExpiry()
      resolve(null)
    }, limitMs)
  })
  try {
    const settled = await Promise.race([promptPromise.then(value => ({ value })), expiry])
    if (settled !== null) return settled.value
    const grace = await Promise.race([promptPromise.then(value => ({ value })), delay(graceMs).then(() => null)])
    return grace === null ? null : grace.value
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Runs one real DSH agent observation through the ACP stdio surface:
 * fresh home, fresh workspace, fresh session, one attempt, zero retries,
 * frozen model identity and budget, then an independent deterministic grade.
 */
export async function runObservation({
  arm, task, runtime, toolchainTarball, runId,
  artifactRoot, environment = {}, graderIoFactory = createDshGraderIo, now = () => Date.now(), pollMs = 250,
  cleanup = 'scratch',
}) {
  const layout = observationLayout({ artifactRoot, runId, taskId: task.taskId, arm })
  await prepareObservationDir(layout)
  const composition = buildArmComposition({ arm, toolchainTarball })
  // The authoritative telemetry plane must be readable before anything is
  // spent: without it the frozen completion budget cannot be enforced.
  writeTelemetryOverlay({ homeDir: layout.dshHome, profile: composition.profile })
  const guard = createBudgetGuard({ policy: H2_POLICY.resource, now })
  const startedAt = now()
  let transport
  let sessionId = null
  let stopReason = null
  let budgetReason = null
  let acp = null
  let infrastructureError = null
  let telemetryError = null
  let metrics = parseSessionLog('').metrics
  let identityDrift = false
  let grader = { status: 'not-run', checks: [] }
  let digestBefore = null
  let digestAfter = null
  const budgetWatch = { cancelled: false }

  try {
    digestBefore = await materializeWorkspace({
      sourceDir: task.workspaceDir,
      targetDir: layout.workspaceDir,
      expectedSha256: task.contentHashes.workspaceSha256,
    })

    if (composition.pluginInstalls.length > 0) {
      for (const install of composition.pluginInstalls) {
        runtime.run(pluginAddArgs({ profile: composition.profile, tarball: install.tarball }), {
          env: { ...environment, DSH_HOME: layout.dshHome, CI: 'true', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
          cwd: runtime.dshRoot ?? process.cwd(),
          timeout: 300_000,
        })
      }
    }

    transport = createProcessAcpTransport({
      command: runtime.command,
      args: [...runtime.prefix, '--profile', composition.profile],
      cwd: runtime.dshRoot ?? process.cwd(),
      // The file policy is pinned instead of inherited: the agent must never be
      // able to write outside its own observation workspace, and an operator
      // shell that exports a wider mode must not silently widen the benchmark.
      // Both arms get exactly this environment, with H2's own configuration
      // stripped so the agent cannot read the private corpus path out of it.
      env: buildAgentEnvironment({
        overrides: {
          ...environment,
          DSH_HOME: layout.dshHome,
          DSH_PERMISSION_MODE: 'workspace-write',
          CI: 'true',
          COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        },
      }),
    })
    const control = createAcpControlPlane({ transport })
    acp = control
    const init = await control.initialize()
    if (!init || init.protocolVersion !== 1) throw new Error(`unexpected ACP protocol version: ${JSON.stringify(init?.protocolVersion)}`)
    const authMethods = Array.isArray(init.authMethods) ? init.authMethods : []
    if (authMethods.length > 0) await control.authenticate(authMethods[0].id)
    const session = await control.newSession({ cwd: layout.workspaceDir })
    sessionId = session.sessionId
    await control.setConfigOption({ sessionId, configId: 'model', value: H2_POLICY.model.model })
    await control.setConfigOption({ sessionId, configId: 'reasoning_effort', value: H2_POLICY.model.reasoningEffort })

    const promptText = await readFile(task.promptPath, 'utf8')
    const promptPromise = control.prompt({ sessionId, text: promptText })

    const watchdog = (async () => {
      let sessionLogPath
      try {
        sessionLogPath = await findSessionLog({ dshHome: layout.dshHome, sessionId, pollMs })
      } catch (error) {
        // Spending without an enforceable budget is not allowed: cancel the
        // session and let the observation fail closed as infrastructure.
        telemetryError = error
        budgetWatch.cancelled = true
        control.cancel(sessionId)
        return
      }
      while (!budgetWatch.cancelled) {
        const evaluation = guard.evaluate()
        if (evaluation.exhausted) {
          budgetReason = evaluation.reason
          budgetWatch.cancelled = true
          control.cancel(sessionId)
          return
        }
        try {
          const text = await readFile(sessionLogPath, 'utf8')
          const live = parseSessionLog(text).metrics
          if (live.providerCompletions > guard.completions) {
            while (guard.completions < live.providerCompletions) guard.recordCompletion()
          }
        } catch {
          // log not flushed yet
        }
        await delay(pollMs)
      }
    })().catch(error => {
      telemetryError = telemetryError ?? error
      budgetWatch.cancelled = true
    })

    const response = await awaitPromptWithinWallClock({
      promptPromise,
      limitMs: H2_POLICY.resource.wallTimeLimitMs,
      onExpiry: () => {
        budgetReason = 'WALL_TIME'
        budgetWatch.cancelled = true
        control.cancel(sessionId)
      },
    })
    stopReason = response?.stopReason ?? null
    budgetWatch.cancelled = true
    await watchdog
    if (budgetReason === null) {
      const evaluation = guard.evaluate()
      if (evaluation.exhausted) budgetReason = evaluation.reason
    }
    try {
      await control.closeSession(sessionId)
    } catch {
      // close is best effort; terminate below owns process lifetime
    }
  } catch (error) {
    infrastructureError = error
  } finally {
    if (transport !== undefined) {
      try {
        await transport.terminate({ graceMs: 5_000 })
      } catch {
        // process already gone
      }
    }
  }

  const wallTimeMs = now() - startedAt
  try {
    if (sessionId !== null) {
      const logPath = await findSessionLog({ dshHome: layout.dshHome, sessionId, pollMs: 1, timeoutMs: 15_000 })
      metrics = parseSessionLog(await readFile(logPath, 'utf8')).metrics
      try {
        assertModelIdentityMatches({ frozen: H2_POLICY.model, observed: metrics.modelIdentities })
      } catch {
        identityDrift = true
      }
    }
  } catch (error) {
    // An unreadable telemetry plane is an infrastructure failure, never a model
    // identity drift: reporting it as drift would blame the model and still
    // produce a "resolved" observation with zero usage.
    telemetryError = telemetryError ?? error
  }
  if (telemetryError !== null && infrastructureError === null) infrastructureError = telemetryError

  // The append-only session log is the authoritative usage plane, so the frozen
  // completion budget is reconciled against it after the agent stops. The live
  // guard cancels as soon as it observes an over-limit completion, which is one
  // completion too late to prevent that completion; this is what keeps the
  // recorded outcome honest: an observation that consumed more than the frozen
  // limit is budget-exhausted (success 0), never a success.
  if (budgetReason === null && metrics.usage.providerCompletions > H2_POLICY.resource.providerCompletionsLimit) {
    budgetReason = 'PROVIDER_COMPLETIONS'
  }

  const terminal = /** @type {{terminalReason: string, gradeable: boolean, budgetExhausted: boolean}} */ (infrastructureError !== null
    ? { terminalReason: 'INFRASTRUCTURE_FAILURE', gradeable: false, budgetExhausted: false }
    : classifyTerminal({ stopReason, budgetReason }))

  if (terminal.gradeable) {
    try {
      const graderModule = await import(pathToFileURL(task.graderPath).href)
      grader = /** @type {any} */ (await runGrader({
        workspaceDir: layout.workspaceDir,
        grader: graderModule.grader,
        io: graderIoFactory({ runtime, layout, environment }),
      }))
    } catch (error) {
      grader = { status: 'not-run', checks: [{ name: 'grader', status: 'fail', detail: String(error?.message ?? error).slice(0, 400) }] }
    }
  }

  try {
    digestAfter = await directoryDigestFrom(layout.workspaceDir)
  } catch {
    digestAfter = null
  }

  const success = terminal.gradeable && terminal.budgetExhausted === false && grader.status === 'pass'
  const receipt = buildObservationReceipt({
    runId,
    taskId: task.taskId,
    stratum: task.stratum,
    arm,
    attempt: 1,
    terminalReason: terminal.terminalReason,
    budgetExhausted: terminal.budgetExhausted,
    success,
    grader,
    metrics,
    wallTimeMs,
    stopReason,
    usageUpdates: acp?.updates?.usageUpdates ?? 0,
    workspaceDigestBefore: digestBefore,
    workspaceDigestAfter: digestAfter,
    acpToolCalls: acp?.updates?.toolCalls?.length ?? 0,
    identityDrift,
    telemetry: {
      // Resolved means the append-only log was found *and* identified this
      // session, which is what every metric in this receipt depends on.
      resolved: telemetryError === null && sessionId !== null,
      error: telemetryError === null ? null : String(telemetryError?.message ?? telemetryError).slice(0, 300),
    },
  })
  assertReceiptSanitized(receipt)
  await writeFile(join(layout.receiptsDir, 'observation.json'), `${JSON.stringify({
    ...receipt,
    ...(infrastructureError === null ? {} : { infrastructureFailure: 'INFRASTRUCTURE_FAILURE' }),
  }, null, 2)}\n`, 'utf8')

  if (cleanup !== 'none') {
    await applyCleanupPolicy(layout, /** @type {any} */ (cleanup))
  }

  return Object.freeze({ receipt, layout, infrastructureError })
}

/**
 * The frozen causal boundary check used by every scoring run: the two arm
 * compositions must differ exactly by the Toolchain bundle.
 */
export function assertRunCompositionParity({ toolchainTarball }) {
  const b = buildArmComposition({ arm: 'B' })
  const c = buildArmComposition({ arm: 'C', toolchainTarball })
  return assertBcParity({ b, c })
}