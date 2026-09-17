import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  PluginBehaviorAssertion,
  PluginVisibilityAssertion,
} from '../protocol/index.js'

const BOOT_PROBE_PACKAGE_NAME = '@dsh-toolchain/verification-boot-probe'
const BOOT_PROBE_ID = 'dsh-toolchain-verification-boot-probe'
const BOOT_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:'
const VISIBILITY_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2:'
const BEHAVIOR_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_BEHAVIOR_PROBE_V1:'

export interface VerificationVisibilityProbe {
  readonly passedMarker: string
  readonly failedMarker: string
}

export interface VerificationBehaviorProbe {
  readonly passedMarker: string
  readonly failedMarker: string
}

export interface VerificationBootProbe {
  readonly packagePath: string
  readonly marker: string
  readonly visibility?: VerificationVisibilityProbe
  readonly behavior?: VerificationBehaviorProbe
}

function profileMarker(profile: string): string {
  if (profile.trim().length === 0) {
    throw new Error('Verification boot probe profile must be non-empty.')
  }
  const digest = createHash('sha256').update(`profile:${profile}`, 'utf8').digest('hex')
  return `${BOOT_PROBE_MARKER_PREFIX}${digest}`
}

function resultMarkers(
  prefix: string,
  material: string,
): VerificationVisibilityProbe {
  const digest = createHash('sha256').update(material, 'utf8').digest('hex')
  const markerPrefix = `${prefix}${digest}`
  return Object.freeze({
    passedMarker: `${markerPrefix}:PASS`,
    failedMarker: `${markerPrefix}:FAIL`,
  })
}

function visibilityMarkers(
  profile: string,
  assertions: readonly PluginVisibilityAssertion[],
): VerificationVisibilityProbe | undefined {
  if (assertions.length === 0) return undefined
  return resultMarkers(
    VISIBILITY_PROBE_MARKER_PREFIX,
    `profile:${profile}\nvisibility:${JSON.stringify(assertions)}`,
  )
}

function behaviorMarkers(
  profile: string,
  assertions: readonly PluginBehaviorAssertion[],
): VerificationBehaviorProbe | undefined {
  if (assertions.length === 0) return undefined
  return resultMarkers(
    BEHAVIOR_PROBE_MARKER_PREFIX,
    `profile:${profile}\nbehavior:${JSON.stringify(assertions)}`,
  )
}

function hostVisibilitySource(): string {
  return `  for (const assertion of visibilityAssertions) {\n    if (assertion.kind !== 'host-service') continue\n    try {\n      if (rootCtx.get(assertion.name, false) === undefined) visibilityPassed = false\n    } catch {\n      visibilityPassed = false\n    }\n  }\n`
}

function agentVisibilitySource(): string {
  return `  const toolAssertions = visibilityAssertions.filter(assertion => assertion.kind === 'agent-tool')\n  if (toolAssertions.length > 0) {\n    if (agent === undefined || tools === undefined) {\n      visibilityPassed = false\n    } else {\n      try {\n        const visibleTools = new Set(tools.schemas(agent).map(schema => schema.name))\n        for (const assertion of toolAssertions) {\n          if (!visibleTools.has(assertion.name)) visibilityPassed = false\n        }\n      } catch {\n        visibilityPassed = false\n      }\n    }\n  }\n`
}

function agentSetupSource(profile: string): string {
  const agentId = JSON.stringify(`dsh-toolchain-verify-agent-${profile}`)
  return `  let tools\n  let agent\n  try {\n    const agentLoop = rootCtx.get('agentLoop', false)\n    tools = rootCtx.get('tools', false)\n    if (agentLoop !== undefined && tools !== undefined) {\n      agent = await agentLoop.create(${agentId})\n    }\n  } catch {\n    tools = undefined\n    agent = undefined\n  }\n`
}

function behaviorSource(
  behavior: VerificationBehaviorProbe,
  requiresVisibilityPass: boolean,
): string {
  const visibilityGate = requiresVisibilityPass ? ' && visibilityPassed' : ''
  return `  let behaviorPassed = agent !== undefined && tools !== undefined${visibilityGate}\n  if (behaviorPassed) {\n    try {\n      agent.ctx.tools.presentAs('native')\n    } catch {\n      behaviorPassed = false\n    }\n  }\n  if (behaviorPassed) {\n    for (let index = 0; index < behaviorAssertions.length; index += 1) {\n      const assertion = behaviorAssertions[index]\n      try {\n        const result = await tools.execute({\n          callId: \`dsh-toolchain-verify-behavior-\${index}\`,\n          name: assertion.name,\n          arguments: assertion.arguments,\n          agent,\n          signal: AbortSignal.timeout(10000),\n        })\n        if (result.isError || !isDeepStrictEqual(result.value, assertion.expectedValue)) {\n          behaviorPassed = false\n          break\n        }\n      } catch {\n        behaviorPassed = false\n        break\n      }\n    }\n  }\n  process.stdout.write(behaviorPassed ? ${JSON.stringify(`${behavior.passedMarker}\n`)} : ${JSON.stringify(`${behavior.failedMarker}\n`)})\n`
}

/**
 * Creates Toolchain-owned instrumentation inside the disposable DSH process.
 * Markers are deterministic coordination evidence, not authentication against
 * adversarial candidate code executing inside the same process boundary.
 */
export async function createVerificationBootProbe(
  root: string,
  profile: string,
  visibilityAssertions: readonly PluginVisibilityAssertion[] = [],
  behaviorAssertions: readonly PluginBehaviorAssertion[] = [],
): Promise<VerificationBootProbe> {
  if (root.trim().length === 0) {
    throw new Error('Verification boot probe root must be non-empty.')
  }

  const packagePath = path.join(root, 'boot-probe')
  const marker = profileMarker(profile)
  const visibility = visibilityMarkers(profile, visibilityAssertions)
  const behavior = behaviorMarkers(profile, behaviorAssertions)
  const hasAgentToolAssertions = visibilityAssertions.some(assertion => assertion.kind === 'agent-tool')
  const needsAgent = hasAgentToolAssertions || behavior !== undefined
  await mkdir(packagePath, { recursive: false })

  const manifest = {
    name: BOOT_PROBE_PACKAGE_NAME,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: './probe.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }
  const patch = `- insert:\n    - id: ${BOOT_PROBE_ID}\n      name: '${BOOT_PROBE_PACKAGE_NAME}'\n`
  const visibilityAssertionsSource = JSON.stringify(visibilityAssertions)
  const behaviorAssertionsSource = JSON.stringify(behaviorAssertions)
  const imports = behavior === undefined ? '' : "import { isDeepStrictEqual } from 'node:util'\n\n"
  const inject = needsAgent ? "export const inject = ['tools', 'agentLoop']\n\n" : ''
  const agentSetup = needsAgent ? agentSetupSource(profile) : ''
  const visibilitySource = visibility === undefined
    ? ''
    : `  const visibilityAssertions = ${visibilityAssertionsSource}\n  let visibilityPassed = true\n${hostVisibilitySource()}${hasAgentToolAssertions ? agentVisibilitySource() : ''}  process.stdout.write(visibilityPassed ? ${JSON.stringify(`${visibility.passedMarker}\n`)} : ${JSON.stringify(`${visibility.failedMarker}\n`)})\n`
  const behaviorAssertionsDeclaration = behavior === undefined
    ? ''
    : `  const behaviorAssertions = ${behaviorAssertionsSource}\n`
  const behaviorExecution = behavior === undefined
    ? ''
    : behaviorSource(behavior, visibility !== undefined)
  const applyKeyword = needsAgent ? 'async function' : 'function'
  const source = `${imports}${inject}export ${applyKeyword} apply(rootCtx) {\n  const appExit = rootCtx.get('appExit')\n  if (typeof appExit !== 'function') throw new Error('DSH verification boot probe requires launcher-owned ctx.appExit')\n  process.stdout.write(${JSON.stringify(`${marker}\n`)})\n${agentSetup}${visibilitySource}${behaviorAssertionsDeclaration}${behaviorExecution}  appExit(0)\n}\n`

  await Promise.all([
    writeFile(path.join(packagePath, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(packagePath, 'cordis.patch.yml'), patch, { flag: 'wx' }),
    writeFile(path.join(packagePath, 'probe.mjs'), source, { flag: 'wx' }),
  ])

  return Object.freeze({
    packagePath,
    marker,
    ...(visibility === undefined ? {} : { visibility }),
    ...(behavior === undefined ? {} : { behavior }),
  })
}
