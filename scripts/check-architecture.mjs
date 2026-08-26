import { readdir, readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageName = 'dsh-toolchain'
const architectureSourceExtensions = ['.ts', '.tsx', '.mts', '.cts']

function normalizePath(value) {
  return value.replaceAll('\\', '/')
}

function isPureLayer(file) {
  return file === 'src/product.ts' ||
    file.startsWith('src/kernel/') ||
    file.startsWith('src/model/') ||
    file.startsWith('src/protocol/')
}

function isClientLayer(file) {
  return file.startsWith('src/client/') || file.startsWith('src/frontends/web/')
}

function isPackageSelfReference(specifier) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`)
}

function isForbiddenPureRuntime(specifier) {
  // The semantic core is intentionally runtime-neutral. `isBuiltin()` catches
  // both `node:fs` and legacy bare forms such as `fs` / `fs/promises`.
  return specifier.startsWith('@deepseek-ai/') || isBuiltin(specifier)
}

function resolveRelativeImport(file, specifier) {
  if (!specifier.startsWith('.')) return undefined
  return normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)))
}

function isOutwardTarget(file, specifier) {
  if (!isPureLayer(file)) return false
  if (isPackageSelfReference(specifier)) return true

  const target = resolveRelativeImport(file, specifier)
  if (!target) return false
  return target.startsWith('src/frontends/') || target.startsWith('src/integrations/')
}

function isClientHostTarget(file, specifier) {
  if (!isClientLayer(file)) return false
  if (specifier === `${packageName}/dsh` || specifier.startsWith(`${packageName}/dsh/`)) return true

  const target = resolveRelativeImport(file, specifier)
  return target?.startsWith('src/integrations/dsh/') ?? false
}

function collectModuleSpecifiers(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.getScriptKindFromFileName(file),
  )
  const specifiers = []

  function add(node) {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      add(node.arguments[0])
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length === 1
    ) {
      add(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

export function isArchitectureSourceFile(file) {
  return architectureSourceExtensions.some(extension => file.endsWith(extension))
}

export function checkSourceImportPolicy(files) {
  const violations = []

  for (const entry of files) {
    const file = normalizePath(entry.path)
    for (const specifier of collectModuleSpecifiers(entry.source, file)) {
      if (isPureLayer(file) && isForbiddenPureRuntime(specifier)) {
        violations.push({ file, specifier, rule: 'pure-layer-runtime-boundary' })
      } else if (isOutwardTarget(file, specifier)) {
        violations.push({ file, specifier, rule: 'dependency-direction' })
      } else if (isClientLayer(file) && isBuiltin(specifier)) {
        violations.push({ file, specifier, rule: 'client-runtime-boundary' })
      } else if (isClientHostTarget(file, specifier)) {
        violations.push({ file, specifier, rule: 'client-host-boundary' })
      }
    }
  }

  return violations
}

async function collectTypeScriptFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name)
    const relative = normalizePath(path.posix.join(prefix, entry.name))
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(absolute, relative))
    } else if (entry.isFile() && isArchitectureSourceFile(entry.name)) {
      files.push({ path: normalizePath(path.posix.join('src', relative)), source: await readFile(absolute, 'utf8') })
    }
  }

  return files
}

async function main() {
  const files = await collectTypeScriptFiles(path.join(root, 'src'))
  const violations = checkSourceImportPolicy(files)
  if (violations.length === 0) return

  for (const violation of violations) {
    console.error(`${violation.file}: ${violation.rule}: ${violation.specifier}`)
  }
  process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
