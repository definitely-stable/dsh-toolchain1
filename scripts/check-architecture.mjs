import { readdir, readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageName = 'dsh-toolchain'
const architectureSourceExtensions = [
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
]
const productionTypeScriptExtensions = new Set(['.ts', '.tsx', '.mts', '.cts'])
const semanticLayers = new Set(['product', 'protocol', 'model', 'kernel'])
const forbiddenSemanticRuntimeGlobals = new Set(['process', 'Buffer', 'fetch'])

// Semantic code is dependency-closed by default. A future third-party package
// belongs here only after we prove it is runtime-neutral and add policy tests;
// otherwise a seemingly harmless import can reintroduce MCP/Node/host coupling.
const allowedSemanticExternalDependencies = new Set()

const allowedInternalDependencies = new Map([
  ['public', new Set(['public', 'product', 'protocol'])],
  ['product', new Set(['product'])],
  ['protocol', new Set(['protocol'])],
  ['model', new Set(['model', 'product', 'protocol'])],
  ['kernel', new Set(['kernel', 'model', 'product', 'protocol'])],
  ['acquisition', new Set(['acquisition', 'model', 'product', 'protocol'])],
  ['verification', new Set(['verification', 'model', 'product', 'protocol'])],
  ['dsh', new Set(['dsh', 'acquisition', 'verification', 'kernel', 'model', 'product', 'protocol'])],
  ['cli', new Set(['cli', 'mcp', 'acquisition', 'verification', 'kernel', 'model', 'product', 'protocol'])],
  ['mcp', new Set(['mcp', 'acquisition', 'verification', 'kernel', 'model', 'product', 'protocol'])],
  ['web', new Set(['web', 'model', 'product', 'protocol'])],
])

function normalizePath(value) {
  return value.replaceAll('\\', '/')
}

function sourceExtension(file) {
  return path.posix.extname(file).toLowerCase()
}

function classifySourceLayer(file) {
  if (file === 'src/index.ts') return 'public'
  if (file === 'src/product.ts') return 'product'
  if (file.startsWith('src/protocol/')) return 'protocol'
  if (file.startsWith('src/model/')) return 'model'
  if (file.startsWith('src/kernel/')) return 'kernel'
  if (file.startsWith('src/acquisition/')) return 'acquisition'
  if (file.startsWith('src/verification/')) return 'verification'
  if (file.startsWith('src/integrations/dsh/')) return 'dsh'
  if (file.startsWith('src/frontends/cli/')) return 'cli'
  if (file.startsWith('src/frontends/mcp/')) return 'mcp'
  if (file.startsWith('src/frontends/web/') || file.startsWith('src/client/')) return 'web'
  return undefined
}

function isPackageSelfReference(specifier) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`)
}

function isBareExternalSpecifier(specifier) {
  return !specifier.startsWith('.') && !isBuiltin(specifier) && !isPackageSelfReference(specifier)
}

function resolveRelativeCandidate(file, specifier) {
  if (!specifier.startsWith('.')) return undefined
  return normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)))
}

function replacementCandidates(candidate) {
  const extension = sourceExtension(candidate)
  if (extension === '.js') return [candidate, `${candidate.slice(0, -3)}.ts`, `${candidate.slice(0, -3)}.tsx`]
  if (extension === '.jsx') return [candidate, `${candidate.slice(0, -4)}.tsx`]
  if (extension === '.mjs') return [candidate, `${candidate.slice(0, -4)}.mts`]
  if (extension === '.cjs') return [candidate, `${candidate.slice(0, -4)}.cts`]
  if (extension !== '') return [candidate]
  return [
    candidate,
    `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.mts`, `${candidate}.cts`,
    `${candidate}/index.ts`, `${candidate}/index.tsx`, `${candidate}/index.mts`, `${candidate}/index.cts`,
  ]
}

function resolveInternalTarget(file, specifier, fileSet) {
  const candidate = resolveRelativeCandidate(file, specifier)
  if (!candidate) return undefined
  return replacementCandidates(candidate).find(value => fileSet.has(value))
}

function isIdentifierReference(node) {
  const parent = node.parent
  if (!parent) return true
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false
  if (ts.isParameter(parent) && parent.name === node) return false
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false
  if (ts.isClassDeclaration(parent) && parent.name === node) return false
  if (ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)) return false
  return true
}

function scriptKindForFile(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

function collectSourceFacts(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(file),
  )
  const moduleSpecifiers = []
  const runtimeGlobals = new Set()
  const dynamicLoaders = new Set()

  function addSpecifier(node) {
    if (node && ts.isStringLiteralLike(node)) moduleSpecifiers.push(node.text)
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addSpecifier(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
        addSpecifier(node.arguments[0])
      } else {
        dynamicLoaders.add('import()')
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      dynamicLoaders.add('require()')
      if (node.arguments.length === 1) addSpecifier(node.arguments[0])
    }

    if (
      ts.isIdentifier(node) &&
      forbiddenSemanticRuntimeGlobals.has(node.text) &&
      isIdentifierReference(node)
    ) {
      runtimeGlobals.add(node.text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { moduleSpecifiers, runtimeGlobals, dynamicLoaders }
}

export function isArchitectureSourceFile(file) {
  return architectureSourceExtensions.some(extension => file.endsWith(extension))
}

export function checkSourceImportPolicy(files) {
  const entries = files.map(entry => ({
    path: normalizePath(entry.path),
    source: entry.source,
  }))
  const fileSet = new Set(entries.map(entry => entry.path))
  const layerByFile = new Map(entries.map(entry => [entry.path, classifySourceLayer(entry.path)]))
  const violations = []

  for (const entry of entries) {
    const file = entry.path
    const layer = layerByFile.get(file)

    if (!productionTypeScriptExtensions.has(sourceExtension(file))) {
      violations.push({ file, rule: 'unsupported-production-source' })
      continue
    }

    if (layer === undefined) {
      violations.push({ file, rule: 'unclassified-source-layer' })
      continue
    }

    const facts = collectSourceFacts(entry.source, file)

    if (semanticLayers.has(layer)) {
      for (const symbol of facts.runtimeGlobals) violations.push({ file, symbol, rule: 'semantic-runtime-global' })
      for (const symbol of facts.dynamicLoaders) violations.push({ file, symbol, rule: 'semantic-dynamic-loader' })
    }

    for (const specifier of facts.moduleSpecifiers) {
      if (semanticLayers.has(layer) && (isBuiltin(specifier) || specifier.startsWith('@deepseek-ai/'))) {
        violations.push({ file, specifier, rule: 'semantic-runtime-boundary' })
        continue
      }

      if (semanticLayers.has(layer) && isPackageSelfReference(specifier)) {
        violations.push({ file, specifier, rule: 'dependency-layer' })
        continue
      }

      if (
        semanticLayers.has(layer) &&
        isBareExternalSpecifier(specifier) &&
        !allowedSemanticExternalDependencies.has(specifier)
      ) {
        violations.push({ file, specifier, rule: 'semantic-external-dependency' })
        continue
      }

      if (layer === 'web' && isBuiltin(specifier)) {
        violations.push({ file, specifier, rule: 'client-runtime-boundary' })
        continue
      }

      if (layer === 'web' && (specifier === `${packageName}/dsh` || specifier.startsWith(`${packageName}/dsh/`))) {
        violations.push({ file, specifier, rule: 'client-host-boundary' })
        continue
      }

      const target = resolveInternalTarget(file, specifier, fileSet)
      if (!target) continue

      const targetLayer = layerByFile.get(target)
      if (targetLayer === undefined || !allowedInternalDependencies.get(layer)?.has(targetLayer)) {
        violations.push({ file, specifier, target, rule: 'dependency-layer' })
      }
    }
  }

  return violations
}

async function collectArchitectureFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name)
    const relative = normalizePath(path.posix.join(prefix, entry.name))
    if (entry.isDirectory()) {
      files.push(...await collectArchitectureFiles(absolute, relative))
    } else if (entry.isFile() && isArchitectureSourceFile(entry.name)) {
      files.push({ path: normalizePath(path.posix.join('src', relative)), source: await readFile(absolute, 'utf8') })
    }
  }

  return files
}

async function main() {
  const files = await collectArchitectureFiles(path.join(root, 'src'))
  const violations = checkSourceImportPolicy(files)
  if (violations.length === 0) return

  for (const violation of violations) {
    const detail = violation.specifier ?? violation.symbol ?? ''
    const target = violation.target ? ` -> ${violation.target}` : ''
    console.error(`${violation.file}: ${violation.rule}: ${detail}${target}`)
  }
  process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
