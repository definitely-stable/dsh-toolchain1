import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const CORDIS = '@deepseek-ai/cordis'
const installTimeScripts = ['preinstall', 'install', 'postinstall', 'prepare']

function dependencySection(manifest, name) {
  const value = manifest?.[name]
  return value && typeof value === 'object' ? value : {}
}

export function checkPackageManifest(manifest) {
  const violations = []
  const dependencies = dependencySection(manifest, 'dependencies')
  const optionalDependencies = dependencySection(manifest, 'optionalDependencies')
  const peerDependencies = dependencySection(manifest, 'peerDependencies')
  const devDependencies = dependencySection(manifest, 'devDependencies')
  const scripts = dependencySection(manifest, 'scripts')

  if (CORDIS in dependencies || CORDIS in optionalDependencies) {
    violations.push({
      rule: 'cordis-peer-identity',
      message: `${CORDIS} must not be a runtime dependency; DSH owns the host instance`,
    })
  }

  if (!(CORDIS in peerDependencies) || !(CORDIS in devDependencies)) {
    violations.push({
      rule: 'cordis-peer-identity',
      message: `${CORDIS} must be declared as both peerDependency and devDependency`,
    })
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
