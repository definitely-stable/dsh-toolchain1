import { posix } from 'node:path'

import ts from 'typescript'

import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import type {
  OrdinaryWorkspace,
  OrdinaryWorkspaceFile,
} from './m2-agent-ordinary-workspace.js'

const VIRTUAL_ROOT = '/exact-target/node_modules/'
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

export type ApiTruthEntryKind =
  | 'export'
  | 'class-member'
  | 'interface-member'
  | 'type-member'
  | 'namespace-member'

export interface ApiTruthEvidenceV2 {
  readonly path: string
  readonly sha256: string
}

export interface ApiTruthEntryV2 {
  readonly package: string
  readonly kind: ApiTruthEntryKind
  readonly symbol: string
  readonly qualifiedSymbol: string
  readonly owner?: string
  readonly evidence: readonly ApiTruthEvidenceV2[]
}

export interface ApiTruthPackageV2 {
  readonly name: string
  readonly version: string
  readonly entrypoints: readonly string[]
  readonly visitedDeclarations: readonly string[]
  readonly unresolvedPublicEdges: readonly string[]
  readonly complete: boolean
}

export interface ApiTruthUniverseV2 {
  readonly schema: 'dsh-api-truth-v2'
  readonly targetFingerprint: string
  readonly workspaceSnapshotSha256: string
  readonly packages: readonly ApiTruthPackageV2[]
  readonly entries: readonly ApiTruthEntryV2[]
  readonly fingerprint: string
}

type ShapeKind = 'class' | 'interface' | 'type' | 'namespace' | 'other'

interface DeclarationShape {
  readonly kind: ShapeKind
  readonly members: readonly string[]
}

interface LocalExportBinding {
  readonly exportedName: string
  readonly localName?: string
  readonly shape?: DeclarationShape
}

interface ImportedBinding {
  readonly specifier: string
  readonly importedName: string | 'namespace'
}

type ReexportEdge =
  | { readonly kind: 'star'; readonly specifier: string }
  | {
      readonly kind: 'named'
      readonly specifier: string
      readonly bindings: readonly { readonly importedName: string; readonly exportedName: string }[]
    }
  | { readonly kind: 'namespace'; readonly specifier: string; readonly exportedName: string }

interface ParsedDeclarationFile {
  readonly locals: ReadonlyMap<string, DeclarationShape>
  readonly imports: ReadonlyMap<string, ImportedBinding>
  readonly localExports: readonly LocalExportBinding[]
  readonly reexports: readonly ReexportEdge[]
}

interface ResolvedSymbol {
  readonly shape?: DeclarationShape
  readonly evidencePaths: ReadonlySet<string>
}

interface PackageIndex {
  readonly name: string
  readonly version: string
  readonly prefix: string
  readonly manifestPath: string
  readonly manifest?: Record<string, unknown>
}

interface PackageResolutionState {
  readonly visited: Set<string>
  readonly unresolved: Set<string>
  readonly cache: Map<string, Map<string, ResolvedSymbol>>
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(modifier => modifier.kind === kind) ?? false)
}

function exported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword)
}

function defaultExport(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword)
}

function publicMember(node: ts.Node): boolean {
  return !hasModifier(node, ts.SyntaxKind.PrivateKeyword)
    && !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
}

function memberName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (name === undefined) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isPrivateIdentifier(name)) return undefined
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return undefined
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].toSorted(compare))
}

function collectBindingNames(name: ts.BindingName, result: Set<string>): void {
  if (ts.isIdentifier(name)) {
    result.add(name.text)
    return
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, result)
  }
}

function collectNamedMembers(nodes: readonly ts.Node[]): readonly string[] {
  const members = new Set<string>()
  for (const node of nodes) {
    if (!publicMember(node)) continue
    if (ts.isConstructorDeclaration(node)) continue
    const name = 'name' in node ? memberName(node.name as ts.PropertyName | undefined) : undefined
    if (name !== undefined) members.add(name)
  }
  return sortedUnique(members)
}

function namespaceMembers(node: ts.ModuleDeclaration): readonly string[] {
  const names = new Set<string>()
  let body = node.body
  while (body !== undefined && ts.isModuleDeclaration(body)) body = body.body
  if (body === undefined || !ts.isModuleBlock(body)) return Object.freeze([])
  for (const statement of body.statements) {
    if (!exported(statement)) continue
    if (
      ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    ) {
      if (statement.name !== undefined) names.add(statement.name.text)
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) collectBindingNames(declaration.name, names)
    }
  }
  return sortedUnique(names)
}

function declarationShape(node: ts.Node): DeclarationShape {
  if (ts.isClassDeclaration(node)) {
    return Object.freeze({ kind: 'class', members: collectNamedMembers([...node.members]) })
  }
  if (ts.isInterfaceDeclaration(node)) {
    return Object.freeze({ kind: 'interface', members: collectNamedMembers([...node.members]) })
  }
  if (ts.isTypeAliasDeclaration(node)) {
    const members = ts.isTypeLiteralNode(node.type) ? collectNamedMembers([...node.type.members]) : Object.freeze([])
    return Object.freeze({ kind: 'type', members })
  }
  if (ts.isModuleDeclaration(node)) {
    return Object.freeze({ kind: 'namespace', members: namespaceMembers(node) })
  }
  return Object.freeze({ kind: 'other', members: Object.freeze([]) })
}

function parseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
}

function parseDeclarationFile(file: OrdinaryWorkspaceFile): ParsedDeclarationFile {
  const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const diagnostic = parseDiagnostics(sourceFile)[0]
  if (diagnostic !== undefined) {
    throw new SyntaxError(`${file.path}: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
  }

  const locals = new Map<string, DeclarationShape>()
  const imports = new Map<string, ImportedBinding>()
  const localExports: LocalExportBinding[] = []
  const reexports: ReexportEdge[] = []

  for (const statement of sourceFile.statements) {
    if (
      ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    ) {
      const shape = declarationShape(statement)
      const localName = statement.name?.text
      if (localName !== undefined) locals.set(localName, shape)
      if (exported(statement)) {
        localExports.push(Object.freeze({
          exportedName: defaultExport(statement) ? 'default' : (localName ?? 'default'),
          ...(localName === undefined ? { shape } : { localName }),
        }))
      }
      continue
    }

    if (ts.isVariableStatement(statement)) {
      const names = new Set<string>()
      for (const declaration of statement.declarationList.declarations) collectBindingNames(declaration.name, names)
      for (const name of names) locals.set(name, declarationShape(statement))
      if (exported(statement)) {
        for (const name of names) localExports.push(Object.freeze({ exportedName: name, localName: name }))
      }
      continue
    }

    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.importClause
      if (clause?.name !== undefined) {
        imports.set(clause.name.text, { specifier: statement.moduleSpecifier.text, importedName: 'default' })
      }
      if (clause?.namedBindings !== undefined) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          imports.set(clause.namedBindings.name.text, { specifier: statement.moduleSpecifier.text, importedName: 'namespace' })
        } else {
          for (const element of clause.namedBindings.elements) {
            imports.set(element.name.text, {
              specifier: statement.moduleSpecifier.text,
              importedName: element.propertyName?.text ?? element.name.text,
            })
          }
        }
      }
      continue
    }

    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined
      if (statement.exportClause === undefined) {
        if (specifier !== undefined) reexports.push(Object.freeze({ kind: 'star', specifier }))
        continue
      }
      if (ts.isNamedExports(statement.exportClause)) {
        const bindings = statement.exportClause.elements.map(element => Object.freeze({
          importedName: element.propertyName?.text ?? element.name.text,
          exportedName: element.name.text,
        }))
        if (specifier === undefined) {
          for (const binding of bindings) {
            localExports.push(Object.freeze({ exportedName: binding.exportedName, localName: binding.importedName }))
          }
        } else {
          reexports.push(Object.freeze({ kind: 'named', specifier, bindings: Object.freeze(bindings) }))
        }
        continue
      }
      if (specifier !== undefined) {
        reexports.push(Object.freeze({
          kind: 'namespace',
          specifier,
          exportedName: statement.exportClause.name.text,
        }))
      }
      continue
    }

    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        localExports.push(Object.freeze({
          exportedName: statement.isExportEquals ? 'export=' : 'default',
          localName: statement.expression.text,
        }))
      } else {
        localExports.push(Object.freeze({
          exportedName: statement.isExportEquals ? 'export=' : 'default',
          shape: Object.freeze({ kind: 'other', members: Object.freeze([]) }),
        }))
      }
    }
  }

  return Object.freeze({
    locals,
    imports,
    localExports: Object.freeze(localExports),
    reexports: Object.freeze(reexports),
  })
}

function packagePrefix(packageName: string): string {
  return `${VIRTUAL_ROOT}${packageName}/`
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function collectTypeTargets(value: unknown, typeCondition = false, result: string[] = []): readonly string[] {
  if (typeof value === 'string') {
    if (typeCondition || /\.d\.(?:ts|mts|cts)$/u.test(value)) result.push(value)
    return result
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTypeTargets(item, typeCondition, result)
    return result
  }
  const object = record(value)
  if (object === undefined) return result
  for (const [key, child] of Object.entries(object)) {
    collectTypeTargets(child, typeCondition || key === 'types' || key.startsWith('types@'), result)
  }
  return result
}

function declarationPathCandidates(rawPath: string): readonly string[] {
  const result = new Set<string>()
  result.add(rawPath)
  if (rawPath.endsWith('.d.ts') || rawPath.endsWith('.d.mts') || rawPath.endsWith('.d.cts')) {
    return sortedUnique(result)
  }
  if (rawPath.endsWith('.mjs') || rawPath.endsWith('.mts')) result.add(`${rawPath.slice(0, rawPath.lastIndexOf('.'))}.d.mts`)
  else if (rawPath.endsWith('.cjs') || rawPath.endsWith('.cts')) result.add(`${rawPath.slice(0, rawPath.lastIndexOf('.'))}.d.cts`)
  else if (/\.(?:js|jsx|ts|tsx)$/u.test(rawPath)) result.add(`${rawPath.slice(0, rawPath.lastIndexOf('.'))}.d.ts`)
  else {
    result.add(`${rawPath}.d.ts`)
    result.add(`${rawPath}/index.d.ts`)
  }
  return sortedUnique(result)
}

function packageTargetPaths(
  packageIndex: PackageIndex,
  subpath: string,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
): readonly string[] {
  const manifest = packageIndex.manifest
  const declared: string[] = []
  if (manifest !== undefined) {
    const exportsValue = manifest.exports
    const exportsRecord = record(exportsValue)
    let selected: unknown
    if (exportsRecord !== undefined) {
      const key = subpath.length === 0 ? '.' : `./${subpath}`
      if (Object.hasOwn(exportsRecord, key)) selected = exportsRecord[key]
      else if (subpath.length === 0 && !Object.keys(exportsRecord).some(item => item.startsWith('.'))) selected = exportsValue
    } else if (subpath.length === 0) {
      selected = exportsValue
    }
    declared.push(...collectTypeTargets(selected))
    if (subpath.length === 0) {
      if (typeof manifest.types === 'string') declared.push(manifest.types)
      if (typeof manifest.typings === 'string') declared.push(manifest.typings)
    }
  }

  const candidates = new Set<string>()
  for (const target of declared) {
    const relative = target.startsWith('./') ? target.slice(2) : target
    for (const candidate of declarationPathCandidates(posix.normalize(`${packageIndex.prefix}${relative}`))) {
      if (filesByPath.has(candidate)) candidates.add(candidate)
    }
  }

  if (candidates.size === 0) {
    const conventional = subpath.length === 0
      ? `${packageIndex.prefix}index.d.ts`
      : `${packageIndex.prefix}${subpath}`
    for (const candidate of declarationPathCandidates(conventional)) {
      if (filesByPath.has(candidate)) candidates.add(candidate)
    }
  }
  return sortedUnique(candidates)
}

function packageSpecifier(value: string): { readonly name: string; readonly subpath: string } | undefined {
  if (value.startsWith('.') || value.startsWith('/') || value.startsWith('node:')) return undefined
  const parts = value.split('/')
  if (parts[0]?.startsWith('@')) {
    if (parts.length < 2) return undefined
    return { name: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join('/') }
  }
  const name = parts[0]
  return name === undefined ? undefined : { name, subpath: parts.slice(1).join('/') }
}

function resolveModuleSpecifier(
  importerPath: string,
  specifier: string,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
  packagesByName: ReadonlyMap<string, PackageIndex>,
): readonly string[] {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const base = posix.normalize(posix.join(posix.dirname(importerPath), specifier))
    return sortedUnique(declarationPathCandidates(base).filter(candidate => filesByPath.has(candidate)))
  }
  const parsed = packageSpecifier(specifier)
  if (parsed === undefined) return Object.freeze([])
  const packageIndex = packagesByName.get(parsed.name)
  return packageIndex === undefined
    ? Object.freeze([])
    : packageTargetPaths(packageIndex, parsed.subpath, filesByPath)
}

function cloneResolved(symbol: ResolvedSymbol, extraEvidence?: string): ResolvedSymbol {
  const evidencePaths = new Set(symbol.evidencePaths)
  if (extraEvidence !== undefined) evidencePaths.add(extraEvidence)
  return Object.freeze({
    ...(symbol.shape === undefined ? {} : { shape: symbol.shape }),
    evidencePaths,
  })
}

function namespaceShape(exports: ReadonlyMap<string, ResolvedSymbol>): DeclarationShape {
  return Object.freeze({
    kind: 'namespace',
    members: sortedUnique([...exports.keys()].filter(name => name !== 'default' && name !== 'export=')),
  })
}

function unresolvedEdge(state: PackageResolutionState, importerPath: string, specifier: string): void {
  state.unresolved.add(`${importerPath} -> ${specifier}`)
}

function resolveFileExports(
  filePath: string,
  state: PackageResolutionState,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
  packagesByName: ReadonlyMap<string, PackageIndex>,
  parseCache: Map<string, ParsedDeclarationFile>,
): Map<string, ResolvedSymbol> {
  const cached = state.cache.get(filePath)
  if (cached !== undefined) return cached
  state.visited.add(filePath)
  const result = new Map<string, ResolvedSymbol>()
  state.cache.set(filePath, result)

  const file = filesByPath.get(filePath)
  if (file === undefined) {
    unresolvedEdge(state, filePath, '<missing-declaration>')
    return result
  }

  let parsed: ParsedDeclarationFile
  try {
    parsed = parseCache.get(filePath) ?? parseDeclarationFile(file)
    parseCache.set(filePath, parsed)
  } catch {
    unresolvedEdge(state, filePath, '<syntax-error>')
    return result
  }

  const resolveImportedBinding = (binding: ImportedBinding): ResolvedSymbol | undefined => {
    const targets = resolveModuleSpecifier(filePath, binding.specifier, filesByPath, packagesByName)
    if (targets.length === 0) {
      unresolvedEdge(state, filePath, binding.specifier)
      return undefined
    }
    const merged = new Map<string, ResolvedSymbol>()
    for (const target of targets) {
      for (const [name, symbol] of resolveFileExports(target, state, filesByPath, packagesByName, parseCache)) {
        if (!merged.has(name)) merged.set(name, symbol)
      }
    }
    if (binding.importedName === 'namespace') {
      return Object.freeze({ shape: namespaceShape(merged), evidencePaths: new Set([filePath, ...targets]) })
    }
    const symbol = merged.get(binding.importedName)
    return symbol === undefined ? undefined : cloneResolved(symbol, filePath)
  }

  for (const binding of parsed.localExports) {
    let symbol: ResolvedSymbol | undefined
    if (binding.shape !== undefined) {
      symbol = Object.freeze({ shape: binding.shape, evidencePaths: new Set([filePath]) })
    } else if (binding.localName !== undefined) {
      const shape = parsed.locals.get(binding.localName)
      if (shape !== undefined) {
        symbol = Object.freeze({ shape, evidencePaths: new Set([filePath]) })
      } else {
        const imported = parsed.imports.get(binding.localName)
        if (imported !== undefined) symbol = resolveImportedBinding(imported)
      }
    }
    if (symbol === undefined) {
      unresolvedEdge(state, filePath, `<local:${binding.localName ?? binding.exportedName}>`)
      continue
    }
    result.set(binding.exportedName, symbol)
  }

  for (const edge of parsed.reexports) {
    const targets = resolveModuleSpecifier(filePath, edge.specifier, filesByPath, packagesByName)
    if (targets.length === 0) {
      unresolvedEdge(state, filePath, edge.specifier)
      continue
    }
    const targetExports = new Map<string, ResolvedSymbol>()
    for (const target of targets) {
      for (const [name, symbol] of resolveFileExports(target, state, filesByPath, packagesByName, parseCache)) {
        if (!targetExports.has(name)) targetExports.set(name, symbol)
      }
    }

    if (edge.kind === 'star') {
      for (const [name, symbol] of targetExports) {
        if (name === 'default' || name === 'export=' || result.has(name)) continue
        result.set(name, cloneResolved(symbol, filePath))
      }
      continue
    }
    if (edge.kind === 'namespace') {
      result.set(edge.exportedName, Object.freeze({
        shape: namespaceShape(targetExports),
        evidencePaths: new Set([filePath, ...targets]),
      }))
      continue
    }
    for (const binding of edge.bindings) {
      const symbol = targetExports.get(binding.importedName)
      if (symbol === undefined) {
        unresolvedEdge(state, filePath, `${edge.specifier}#${binding.importedName}`)
        continue
      }
      result.set(binding.exportedName, cloneResolved(symbol, filePath))
    }
  }

  return result
}

function packageIndexes(workspace: OrdinaryWorkspace): ReadonlyMap<string, PackageIndex> {
  const filesByPath = new Map(workspace.files.map(file => [file.path, file]))
  const result = new Map<string, PackageIndex>()
  for (const item of workspace.packages) {
    const prefix = packagePrefix(item.name)
    const manifestPath = `${prefix}package.json`
    const manifestFile = filesByPath.get(manifestPath)
    let manifest: Record<string, unknown> | undefined
    if (manifestFile !== undefined) {
      try {
        manifest = record(JSON.parse(manifestFile.content))
      } catch {
        manifest = undefined
      }
    }
    result.set(item.name, Object.freeze({
      name: item.name,
      version: item.version,
      prefix,
      manifestPath,
      ...(manifest === undefined ? {} : { manifest }),
    }))
  }
  return result
}

function memberKind(shape: DeclarationShape): ApiTruthEntryKind {
  if (shape.kind === 'class') return 'class-member'
  if (shape.kind === 'interface') return 'interface-member'
  if (shape.kind === 'type') return 'type-member'
  return 'namespace-member'
}

function freezeEvidence(paths: Iterable<string>, filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>): readonly ApiTruthEvidenceV2[] {
  return Object.freeze([...new Set(paths)]
    .flatMap(path => {
      const file = filesByPath.get(path)
      return file === undefined ? [] : [Object.freeze({ path, sha256: file.sha256 })]
    })
    .toSorted((left, right) => compare(left.path, right.path) || compare(left.sha256, right.sha256)))
}

function entryKey(packageName: string, qualifiedSymbol: string): string {
  return `${packageName}\u0000${qualifiedSymbol}`
}

function addEntry(
  entries: Map<string, ApiTruthEntryV2>,
  packageName: string,
  kind: ApiTruthEntryKind,
  symbol: string,
  qualifiedSymbol: string,
  evidence: readonly ApiTruthEvidenceV2[],
  owner?: string,
): void {
  const key = entryKey(packageName, qualifiedSymbol)
  const current = entries.get(key)
  if (current !== undefined) {
    const mergedEvidence = freezeEvidence(
      [...current.evidence.map(item => item.path), ...evidence.map(item => item.path)],
      new Map([...current.evidence, ...evidence].map(item => [item.path, {
        path: item.path,
        sha256: item.sha256,
      } as OrdinaryWorkspaceFile])),
    )
    entries.set(key, Object.freeze({ ...current, evidence: mergedEvidence }))
    return
  }
  entries.set(key, Object.freeze({
    package: packageName,
    kind,
    symbol,
    qualifiedSymbol,
    ...(owner === undefined ? {} : { owner }),
    evidence,
  }))
}

function mergeEvidence(left: readonly ApiTruthEvidenceV2[], right: readonly ApiTruthEvidenceV2[]): readonly ApiTruthEvidenceV2[] {
  const byPath = new Map<string, ApiTruthEvidenceV2>()
  for (const item of [...left, ...right]) byPath.set(item.path, item)
  return Object.freeze([...byPath.values()].toSorted((a, b) => compare(a.path, b.path) || compare(a.sha256, b.sha256)))
}

function insertEntry(entries: Map<string, ApiTruthEntryV2>, entry: ApiTruthEntryV2): void {
  const key = entryKey(entry.package, entry.qualifiedSymbol)
  const existing = entries.get(key)
  if (existing === undefined) {
    entries.set(key, entry)
    return
  }
  entries.set(key, Object.freeze({ ...existing, evidence: mergeEvidence(existing.evidence, entry.evidence) }))
}

function freezePackages(packages: ApiTruthPackageV2[]): readonly ApiTruthPackageV2[] {
  return Object.freeze(packages
    .toSorted((left, right) => compare(left.name, right.name) || compare(left.version, right.version))
    .map(item => Object.freeze({
      ...item,
      entrypoints: Object.freeze([...item.entrypoints]),
      visitedDeclarations: Object.freeze([...item.visitedDeclarations]),
      unresolvedPublicEdges: Object.freeze([...item.unresolvedPublicEdges]),
    })))
}

function freezeEntries(entries: Iterable<ApiTruthEntryV2>): readonly ApiTruthEntryV2[] {
  return Object.freeze([...entries]
    .toSorted((left, right) => (
      compare(left.package, right.package)
      || compare(left.qualifiedSymbol, right.qualifiedSymbol)
      || compare(left.kind, right.kind)
    ))
    .map(item => Object.freeze({ ...item, evidence: Object.freeze([...item.evidence]) })))
}

export async function createApiTruthUniverseV2(
  workspace: OrdinaryWorkspace,
  sha256: Sha256Port,
): Promise<ApiTruthUniverseV2> {
  const filesByPath = new Map(workspace.files.map(file => [file.path, file]))
  const packagesByName = packageIndexes(workspace)
  const parseCache = new Map<string, ParsedDeclarationFile>()
  const packageResults: ApiTruthPackageV2[] = []
  const entryMap = new Map<string, ApiTruthEntryV2>()

  for (const packageItem of [...workspace.packages].toSorted((left, right) => compare(left.name, right.name))) {
    const packageIndex = packagesByName.get(packageItem.name)
    if (packageIndex === undefined) continue
    const state: PackageResolutionState = {
      visited: new Set<string>(),
      unresolved: new Set<string>(),
      cache: new Map<string, Map<string, ResolvedSymbol>>(),
    }
    const entrypoints = packageTargetPaths(packageIndex, '', filesByPath)
    if (packageIndex.manifest === undefined) state.unresolved.add(`${packageIndex.manifestPath} -> <manifest>`)
    if (entrypoints.length === 0) state.unresolved.add(`${packageIndex.manifestPath} -> <public-entrypoint>`)

    const publicExports = new Map<string, ResolvedSymbol>()
    for (const entrypoint of entrypoints) {
      for (const [name, symbol] of resolveFileExports(entrypoint, state, filesByPath, packagesByName, parseCache)) {
        if (!publicExports.has(name)) publicExports.set(name, symbol)
      }
    }

    for (const [exportedName, resolved] of [...publicExports].toSorted(([left], [right]) => compare(left, right))) {
      const evidence = freezeEvidence(resolved.evidencePaths, filesByPath)
      insertEntry(entryMap, Object.freeze({
        package: packageItem.name,
        kind: 'export',
        symbol: exportedName,
        qualifiedSymbol: exportedName,
        evidence,
      }))
      if (resolved.shape === undefined) continue
      for (const member of resolved.shape.members) {
        if (!IDENTIFIER.test(member)) continue
        insertEntry(entryMap, Object.freeze({
          package: packageItem.name,
          kind: memberKind(resolved.shape),
          symbol: member,
          qualifiedSymbol: `${exportedName}.${member}`,
          owner: exportedName,
          evidence,
        }))
      }
    }

    packageResults.push(Object.freeze({
      name: packageItem.name,
      version: packageItem.version,
      entrypoints: sortedUnique(entrypoints),
      visitedDeclarations: sortedUnique(state.visited),
      unresolvedPublicEdges: sortedUnique(state.unresolved),
      complete: packageIndex.manifest !== undefined && entrypoints.length > 0 && state.unresolved.size === 0,
    }))
  }

  const packages = freezePackages(packageResults)
  const entries = freezeEntries(entryMap.values())
  const projection = {
    schema: 'dsh-api-truth-v2',
    targetFingerprint: workspace.target.targetFingerprint,
    workspaceSnapshotSha256: workspace.workspaceSnapshotSha256,
    packages,
    entries,
  }
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(projection))
  return Object.freeze({
    ...projection,
    schema: 'dsh-api-truth-v2' as const,
    fingerprint: `dsh-api-truth-v2:${digest}`,
  })
}
