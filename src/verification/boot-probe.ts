import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BOOT_PROBE_PACKAGE_NAME = '@dsh-toolchain/verification-boot-probe'
const BOOT_PROBE_ID = 'dsh-toolchain-verification-boot-probe'
const BOOT_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:'

export interface VerificationBootProbe {
  readonly packagePath: string
  readonly marker: string
}

function profileMarker(profile: string): string {
  if (profile.trim().length === 0) {
    throw new Error('Verification boot probe profile must be non-empty.')
  }
  const digest = createHash('sha256').update(`profile:${profile}`, 'utf8').digest('hex')
  return `${BOOT_PROBE_MARKER_PREFIX}${digest}`
}

export async function createVerificationBootProbe(
  root: string,
  profile: string,
): Promise<VerificationBootProbe> {
  if (root.trim().length === 0) {
    throw new Error('Verification boot probe root must be non-empty.')
  }

  const packagePath = path.join(root, 'boot-probe')
  const marker = profileMarker(profile)
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
  const source = `export function apply(rootCtx) {\n  const appExit = rootCtx.get('appExit')\n  if (typeof appExit !== 'function') throw new Error('DSH verification boot probe requires launcher-owned ctx.appExit')\n  process.stdout.write(${JSON.stringify(`${marker}\n`)})\n  appExit(0)\n}\n`

  await Promise.all([
    writeFile(path.join(packagePath, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(packagePath, 'cordis.patch.yml'), patch, { flag: 'wx' }),
    writeFile(path.join(packagePath, 'probe.mjs'), source, { flag: 'wx' }),
  ])

  return Object.freeze({ packagePath, marker })
}
