import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

// Keep this list explicit. Not every @deepseek-ai/* package is necessarily
// host-identity-sensitive; adding a package here is an architecture decision.
const HOST_IDENTITY_PACKAGES = Object.freeze([
  '@deepseek-ai/cordis',
])
const installTimeScripts = ['preinstall', 'install', 'postinstall', 'prepare']

function dependencySection(manifest, name) {
  const value = manifest?.[name]
  return value && typeof value === 'object' ? value : {}
}

function parseReleaseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return undefined
  return match.slice(1).map(Number)
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

function caretUpperBound(base) {
  const [major, minor, patch] = base
  if (major > 0) return [major + 1, 0, 0]
  if (minor > 0) return [0, minor + 1, 0]
  return [0, 0, patch + 1]
}

function exactVersionSatisfiesPeerRange(range, version) {
  if (range === version) return true
  if (!range.startsWith('^')) return false

  const base = parseReleaseSemver(range.slice(1))
  const exact = parseReleaseSemver(version)
  if (!base || !exact) return false

  return compareSemver(exact, base) >= 0 && compareSemver(exact, caretUpperBound(base)) < 0
}

export function checkPackageManifest(manifest) {
  const violations = []
  const dependencies = dependencySection(manifest, 'dependencies')
  const optionalDependencies = dependencySection(manifest, 'optionalDependencies')
  const peerDependencies = dependencySection(manifest, 'peerDependencies')
  const devDependencies = dependencySection(manifest, 'devDependencies')
  const scripts = dependencySection(manifest, 'scripts')

  for (const packageName of HOST_IDENTITY_PACKAGES) {
    if (packageName in dependencies || packageName in optionalDependencies) {
      violations.push({
        rule: 'host-peer-identity',
        message: `${packageName} must not be a runtime dependency; DSH owns the host instance`,
      })
    }

    const peerRange = peerDependencies[packageName]
    const devVersion = devDependencies[packageName]
    if (typeof peerRange !== 'string' || typeof devVersion !== 'string') {
      violations.push({
        rule: 'host-peer-identity',
        message: `${packageName} must be declared as both peerDependency and devDependency`,
      })
      continue
    }

    if (!exactVersionSatisfiesPeerRange(peerRange, devVersion)) {
      violations.push({
        rule: 'host-peer-dev-version',
        message: `${packageName} devDependency ${devVersion} must satisfy peerDependency ${peerRange}`,
      })
    }
  }

  for (const script of installTimeScripts) {
    if (script in scripts) {
      violations.push({
        rule: 'install-time-script',
        message: `package script ${script} executes during installation and is forbidden`,
      })
    }
  }

  return violations
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const violations = checkPackageManifest(manifest)
  if (violations.length === 0) return

  for (const violation of violations) console.error(`${violation.rule}: ${violation.message}`)
  process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
