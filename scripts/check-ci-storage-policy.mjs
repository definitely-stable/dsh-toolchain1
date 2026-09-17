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
  const frozenInstallCount = (source.match(/^\s*run:\s*pnpm install --frozen-lockfile --ignore-scripts\s*$/gm) ?? []).length

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

  if (frozenInstallCount !== setupNodeBlocks.length) {
    violations.push({
      rule: 'frozen-install-count',
      message: `expected one authoritative frozen pnpm install per setup-node lane; found ${frozenInstallCount} installs for ${setupNodeBlocks.length} lanes`,
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

/** Paths an H2 scoring artifact must never carry, whatever its retention is. */
const H2_FORBIDDEN_ARTIFACT_PATHS = [
  'node_modules',
  'dsh-home',
  'pnpm-store',
  'dsh-toolchain-candidate.tgz',
]

/**
 * The H2 scoring workflow is the one paid lane, so it is the one that can turn a
 * misconfiguration into model spend. Its policy is therefore separate from the
 * deterministic CI lane: manual dispatch only, from `main` only, bounded, and
 * with transient sanitized evidence only.
 */
export function checkH2ScoringWorkflow(source) {
  const violations = []

  if (!/^\s{2}workflow_dispatch:/m.test(source)) {
    violations.push({ rule: 'h2-manual-dispatch', message: 'H2 scoring must be dispatched manually' })
  }
  for (const trigger of ['push:', 'pull_request:', 'schedule:', 'workflow_run:']) {
    if (new RegExp(`^\\s{2}${trigger}`, 'm').test(source)) {
      violations.push({ rule: 'h2-trigger', message: `H2 scoring must not run on ${trigger.replace(':', '')}` })
    }
  }
  if (!/refs\/heads\/main/.test(source)) {
    violations.push({ rule: 'h2-main-only', message: 'H2 scoring must refuse refs other than refs/heads/main' })
  }
  if (!/^\s{2}contents:\s*read\s*$/m.test(source)) {
    violations.push({ rule: 'h2-permissions', message: 'H2 scoring must declare permissions: contents: read' })
  }
  const timeout = /timeout-minutes:\s*(\d+)/.exec(source)
  if (timeout === null) {
    violations.push({ rule: 'h2-timeout', message: 'H2 scoring must bound the job with timeout-minutes' })
  } else if (Number(timeout[1]) > 350) {
    violations.push({ rule: 'h2-timeout', message: `H2 scoring timeout ${timeout[1]} minutes exceeds the 350-minute ceiling` })
  }
  if (!/--confirm-scoring/.test(source)) {
    violations.push({ rule: 'h2-confirm-scoring', message: 'H2 scoring must pass --confirm-scoring to authorize the paid run' })
  }

  for (const block of collectActionBlocks(source, 'actions/upload-artifact')) {
    if (!hasLine(block, /^\s+retention-days:\s*1\s*$/)) {
      violations.push({ rule: 'h2-artifact-retention', message: `H2 upload-artifact at line ${block.line} must use retention-days: 1` })
    }
    for (const forbiddenPath of H2_FORBIDDEN_ARTIFACT_PATHS) {
      if (block.text.includes(forbiddenPath)) {
        violations.push({ rule: 'h2-artifact-content', message: `H2 upload-artifact at line ${block.line} must not persist ${forbiddenPath}` })
      }
    }
  }
  for (const block of collectActionBlocks(source, 'actions/cache')) {
    violations.push({ rule: 'h2-direct-cache', message: `actions/cache at line ${block.line} is forbidden in the H2 scoring lane` })
  }

  return violations
}

async function main() {
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const violations = checkCiStoragePolicy(workflow).map(violation => ({ ...violation, file: 'ci.yml' }))

  const scoring = await readFile(path.join(root, '.github', 'workflows', 'h2-scoring.yml'), 'utf8')
  violations.push(...checkH2ScoringWorkflow(scoring).map(violation => ({ ...violation, file: 'h2-scoring.yml' })))

  if (violations.length === 0) return

  for (const violation of violations) console.error(`${violation.file}: ${violation.rule}: ${violation.message}`)
  process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
