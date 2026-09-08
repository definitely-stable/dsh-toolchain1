import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { PluginVisibilityAssertion } from '../protocol/index.js'

const BOOT_PROBE_PACKAGE_NAME = '@dsh-toolchain/verification-boot-probe'
const BOOT_PROBE_ID = 'dsh-toolchain-verification-boot-probe'
const BOOT_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:'
const VISIBILITY_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2:'

export interface VerificationVisibilityProbe {
  readonly passedMarker: string
  readonly failedMarker: string
}

export interface VerificationBootProbe {
  readonly packagePath: string
  readonly marker: string
  readonly visibility?: VerificationVisibilityProbe
}

function profileMarker(profile: string): string {
  if (profile.trim().length === 0) {
    throw new Error('Verification boot probe profile must be non-empty.')
  }
  const digest = createHash('sha256').update(`profile:${profile}`, 'utf8').digest('hex')
  return `${BOOT_PROBE_MARKER_PREFIX}${digest}`
}

function visibilityMarkers(
  profile: string,
  assertions: readonly PluginVisibilityAssertion[],
): VerificationVisibilityProbe | undefined {
  if (assertions.length === 0) return undefined
  const digest = createHash('sha256')
    .update(`profile:${profile}\nvisibility:${JSON.stringify(assertions)}`, 'utf8')
    .digest('hex')
  const prefix = `${VISIBILITY_PROBE_MARKER_PREFIX}${digest}`
  return Object.freeze({
    passedMarker: `${prefix}:PASS`,
    failedMarker: `${prefix}:FAIL`,
  })
}

function hostVisibilitySource(): string {
  return `  for (const assertion of assertions) {\n    if (assertion.kind !== 'host-service') continue\n    try {\n      if (rootCtx.get(assertion.name, false) === undefined) {\n        visibilityPassed = false\n      }\n    } catch {\n      visibilityPassed = false\n    }\n  }\n`
}

function agentToolVisibilitySource(): string {
  return `  const toolAssertions = assertions.filter(assertion => assertion.kind === 'agent-tool')\n  let handle\n  try {\n    const agents = rootCtx.get('agents')\n    const tools = rootCtx.get('tools')\n    if (agents === undefined || tools === undefined) {\n      visibilityPassed = false\n    } else {\n      handle = await agents.create({\n        sessionId: \`dsh-toolchain-verify-\${randomUUID()}\`,\n      })\n      const visibleTools = new Set(tools.schemas(handle.agent).map(schema => schema.name))\n      for (const assertion of toolAssertions) {\n        if (!visibleTools.has(assertion.name)) visibilityPassed = false\n      }\n    }\n  } catch {\n    visibilityPassed = false\n  } finally {\n    if (handle !== undefined) {\n      try {\n        await handle.dispose()\n      } catch {\n        visibilityPassed = false\n      }\n    }\n  }\n`
}

export async function createVerificationBootProbe(
  root: string,
  profile: string,
  visibilityAssertions: readonly PluginVisibilityAssertion[] = [],
): Promise<VerificationBootProbe> {
  if (root.trim().length === 0) {
    throw new Error('Verification boot probe root must be non-empty.')
  }

  const packagePath = path.join(root, 'boot-probe')
  const marker = profileMarker(profile)
  const visibility = visibilityMarkers(profile, visibilityAssertions)
  const hasAgentToolAssertions = visibilityAssertions.some(assertion => assertion.kind === 'agent-tool')
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
  const assertions = JSON.stringify(visibilityAssertions)
  const visibilitySource = visibility === undefined
    ? ''
    : `  const assertions = ${assertions}\n  let visibilityPassed = true\n${hostVisibilitySource()}${hasAgentToolAssertions ? agentToolVisibilitySource() : ''}  process.stdout.write(visibilityPassed ? ${JSON.stringify(`${visibility.passedMarker}\n`)} : ${JSON.stringify(`${visibility.failedMarker}\n`)})\n`
  const imports = hasAgentToolAssertions ? "import { randomUUID } from 'node:crypto'\n\n" : ''
  const inject = hasAgentToolAssertions ? "export const inject = ['agents', 'tools']\n\n" : ''
  const apply = hasAgentToolAssertions ? 'export async function apply(rootCtx)' : 'export function apply(rootCtx)'
  const source = `${imports}${inject}${apply} {\n  const appExit = rootCtx.get('appExit')\n  if (typeof appExit !== 'function') throw new Error('DSH verification boot probe requires launcher-owned ctx.appExit')\n  process.stdout.write(${JSON.stringify(`${marker}\n`)})\n${visibilitySource}  appExit(0)\n}\n`

  await Promise.all([
    writeFile(path.join(packagePath, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(packagePath, 'cordis.patch.yml'), patch, { flag: 'wx' }),
    writeFile(path.join(packagePath, 'probe.mjs'), source, { flag: 'wx' }),
  ])

  return Object.freeze({
    packagePath,
    marker,
    ...(visibility === undefined ? {} : { visibility }),
  })
}
