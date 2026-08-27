import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const PNPM_SETUP_SHA = '84cb39b217b10273981911c288cd62326dc7c6d2'
const FORBIDDEN_ARTIFACT_PATHS = [
  'node_modules',
  '.artifacts',
  'dsh-toolchain.tgz',
  'dsh-home',
]

function leadingSpaces(line) {
  return /^\s*/.exec(line)?.[0].length ?? 0
}

function collectStepBlocks(source) {
  const lines = source.split(/\r?\n/)
  const blocks = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = /^(\s*)-\s+(?:name:|uses:|if:|run:)/.exec(line)
    if (!match) continue

    const indent = match[1].length
    const block = [line]
    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor]
      if (candidate.startsWith(`${' '.repeat(indent)}- `)) break
      if (candidate.trim().length > 0 && leadingSpaces(candidate) < indent) break
      block.push(candidate)
    }

    blocks.push({
      line: index + 1,
      text: block.join('\n'),
    })
    index = cursor - 1
  }

  return blocks
}

function actionUse(block) {
  const match = /^\s*(?:-\s*)?uses:\s+([^\s#]+)(?:\s+#.*)?$/m.exec(block.text)
  return match?.[1]
}

function collectActionBlocks(source, action) {
  return collectStepBlocks(source)
    .map((block) => ({ ...block, use: actionUse(block) }))
    .filter((block) => block.use?.startsWith(`${action}@`))
}

function hasLine(block, pattern) {
  return block.text.split(/\r?\n/).some((line) => pattern.test(line))
}

export function checkCiStoragePolicy(source) {
  const violations = []
  const pnpmSetupBlocks = collectActionBlocks(source, 'pnpm/setup')
  const setupNodeBlocks = collectActionBlocks(source, 'actions/setup-node')
  const directCacheBlocks = collectActionBlocks(source, 'actions/cache')
  const artifactBlocks = collectActionBlocks(source, 'actions/upload-artifact')

  if (setupNodeBlocks.length === 0) {
    violations.push({
      rule: 'pnpm-cache-required',
      message: 'CI must contain at least one actions/setup-node lane with explicit pnpm-store caching',
    })
  }

  if (pnpmSetupBlocks.length !== setupNodeBlocks.length) {
    violations.push({
      rule: 'pnpm-bootstrap-count',
      message: `expected one pnpm/setup bootstrap per setup-node lane; found ${pnpmSetupBlocks.length} pnpm/setup and ${setupNodeBlocks.length} setup-node blocks`,
    })
  }

  for (const [index, block] of pnpmSetupBlocks.entries()) {
    if (block.use !== `pnpm/setup@${PNPM_SETUP_SHA}`) {
      violations.push({
        rule: 'pnpm-bootstrap-pin',
        message: `pnpm/setup at line ${block.line} must be pinned to ${PNPM_SETUP_SHA}`,
      })
    }
    if (!hasLine(block, /^\s+install:\s*false\s*$/)) {
      violations.push({
        rule: 'pnpm-bootstrap-install',
        message: `pnpm/setup at line ${block.line} must use install: false so the explicit frozen install remains authoritative`,
      })
    }
    if (hasLine(block, /^\s+cache:\s*true\s*$/)) {
      violations.push({
        rule: 'pnpm-bootstrap-cache',
        message: `pnpm/setup at line ${block.line} must not create a second dependency cache`,
      })
    }

    const nodeBlock = setupNodeBlocks[index]
    if (nodeBlock && block.line > nodeBlock.line) {
      violations.push({
        rule: 'pnpm-bootstrap-order',
        message: `pnpm/setup at line ${block.line} must run before setup-node at line ${nodeBlock.line}`,
      })
    }
  }

  for (const block of setupNodeBlocks) {
    const required = [
      ['cache: pnpm', /^\s+cache:\s*pnpm\s*$/],
      ['cache-dependency-path: pnpm-lock.yaml', /^\s+cache-dependency-path:\s*pnpm-lock\.yaml\s*$/],
      ['package-manager-cache: false', /^\s+package-manager-cache:\s*false\s*$/],
    ]

    for (const [label, pattern] of required) {
      if (!hasLine(block, pattern)) {
        violations.push({
          rule: 'pnpm-cache-config',
          message: `setup-node at line ${block.line} must declare ${label}`,
        })
      }
    }
  }

  for (const block of directCacheBlocks) {
    violations.push({
      rule: 'direct-cache-action',
      message: `actions/cache at line ${block.line} is forbidden in required CI; cache only the pnpm store through setup-node`,
    })
  }

  for (const block of artifactBlocks) {
    if (!hasLine(block, /^\s+retention-days:\s*1\s*$/)) {
      violations.push({
        rule: 'artifact-retention',
        message: `upload-artifact at line ${block.line} must use retention-days: 1`,
      })
    }

    for (const forbiddenPath of FORBIDDEN_ARTIFACT_PATHS) {
      if (block.text.includes(forbiddenPath)) {
        violations.push({
          rule: 'product-artifact-persistence',
          message: `upload-artifact at line ${block.line} must not persist ${forbiddenPath}`,
        })
      }
    }
  }

  if (/corepack\s+(?:enable|prepare)/.test(source)) {
    violations.push({
      rule: 'legacy-pnpm-bootstrap',
      message: 'required CI must bootstrap pnpm through the pinned pnpm/setup action instead of Corepack',
    })
  }

  return violations
}

async function main() {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const violations = checkCiStoragePolicy(workflow)
  if (violations.length === 0) return

  for (const violation of violations) console.error(`${violation.rule}: ${violation.message}`)
  process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
