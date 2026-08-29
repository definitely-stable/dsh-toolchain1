import { posix } from 'node:path'

import * as ts from 'typescript'

import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import type {
  OrdinaryWorkspace,
  OrdinaryWorkspaceFile,
  OrdinaryWorkspacePackage,
} from './m2-agent-ordinary-workspace.js'

const TRUTH_SCHEMA = 'dsh-api-truth-v2'
const VIRTUAL_NODE_MODULES = '/exact-target/node_modules/'

export type ApiTruthEntryKindV2 =
  | 'export'
  | 'class-member'
  | 'interface-member'
  | 'type-member'

export interface ApiTruthEvidenceV2 {
  readonly path: string
  readonly sha256: string
}

export interface ApiTruthEntryV2 {
  readonly package: string
  readonly kind: ApiTruthEntryKindV2
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

interface PackageManifest {
  readonly types?: unknown
  readonly typings?: unknown
  readonly exports?: unknown
}

interface MutablePackageTruth {
  readonly name: string
  readonly version: string
  readonly entrypoints: Set<string>
  readonly visitedDeclarations: Set<string>
  readonly unresolvedPublicEdges: Set<string>
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function packageRoot(packageName: string): string {
  return `${VIRTUAL_NODE_MODULES}${packageName}/`
}

function isDeclarationFile(file: OrdinaryWorkspaceFile): boolean {
  return file.mediaType === 'text/typescript' && /\.d\.(?:ts|mts|cts)$/u.test(file.path)
}

function normalizeVirtualPath(path: string): string {
  return posix.normalize(path)
}

function staticName(name: ts.DeclarationName | undefined): string | undefined {
  if (name === undefined) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false
  return ts.getModifiers(node)?.some(modifier => modifier.kind === kind) ?? false
}

function isExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword)
}

function isPublicMember(node: ts.Node): boolean {
  return !hasModifier(node, ts.SyntaxKind.PrivateKeyword)
    && !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
}

function evidenceForSource(
  sourceFile: ts.SourceFile,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
): ApiTruthEvidenceV2 | undefined {
  const file = filesByPath.get(normalizeVirtualPath(sourceFile.fileName))
  return file === undefined ? undefined : Object.freeze({ path: file.path, sha256: file.sha256 })
}

function evidenceKey(evidence: ApiTruthEvidenceV2): string {
  return `${evidence.path}\u0000${evidence.sha256}`
}

function canonicalEvidence(values: readonly ApiTruthEvidenceV2[]): readonly ApiTruthEvidenceV2[] {
  const byKey = new Map<string, ApiTruthEvidenceV2>()
  for (const value of values) byKey.set(evidenceKey(value), value)
  return Object.freeze([...byKey.values()].toSorted((left, right) => (
    compareStrings(left.path, right.path) || compareStrings(left.sha256, right.sha256)
  )))
}

function entry(
  packageName: string,
  kind: ApiTruthEntryKindV2,
  qualifiedSymbol: string,
  evidence: readonly ApiTruthEvidenceV2[],
  owner?: string,
): ApiTruthEntryV2 {
  const symbol = qualifiedSymbol.slice(qualifiedSymbol.lastIndexOf('.') + 1)
  return Object.freeze({
    package: packageName,
    kind,
    symbol,
    qualifiedSymbol,
    ...(owner === undefined ? {} : { owner }),
    evidence: canonicalEvidence(evidence),
  })
}

function memberEntries(
  packageName: string,
  exportedName: string,
  declaration: ts.Declaration,
  sourceEvidence: ApiTruthEvidenceV2,
): readonly ApiTruthEntryV2[] {
  let kind: Exclude<ApiTruthEntryKindV2, 'export'> | undefined
  let members: readonly ts.TypeElement[] | readonly ts.ClassElement[] = []

  if (ts.isClassDeclaration(declaration)) {
    kind = 'class-member'
    members = declaration.members
  } else if (ts.isInterfaceDeclaration(declaration)) {
    kind = 'interface-member'
    members = declaration.members
  } else if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
    kind = 'type-member'
    members = declaration.type.members
  }

  if (kind === undefined) return Object.freeze([])

  const result: ApiTruthEntryV2[] = []
  for (const member of members) {
    if (!isPublicMember(member) || ts.isConstructorDeclaration(member)) continue
    const name = staticName(member.name)
    if (name === undefined) continue
    result.push(entry(
      packageName,
      kind,
      `${exportedName}.${name}`,
      [sourceEvidence],
      exportedName,
    ))
  }
  return Object.freeze(result)
}

function collectTypesTargets(value: unknown, values: Set<string>, underTypes = false): void {
  if (typeof value === 'string') {
    if (underTypes) values.add(value)
    return
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return

  for (const [key, child] of Object.entries(value)) {
    if (key === 'types') {
      collectTypesTargets(child, values, true)
    } else if (typeof child === 'object' && child !== null) {
      collectTypesTargets(child, values, underTypes)
    } else if (underTypes && typeof child === 'string') {
      values.add(child)
    }
  }
}

function manifestTypesTargets(manifest: PackageManifest): readonly string[] {
  const values = new Set<string>()
  if (typeof manifest.types === 'string') values.add(manifest.types)
  if (typeof manifest.typings === 'string') values.add(manifest.typings)
  collectTypesTargets(manifest.exports, values)
  return Object.freeze([...values].toSorted(compareStrings))
}

function resolveManifestEntrypoints(
  pkg: OrdinaryWorkspacePackage,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
  truth: MutablePackageTruth,
): readonly string[] {
  const root = packageRoot(pkg.name)
  const manifestPath = `${root}package.json`
  const manifestFile = filesByPath.get(manifestPath)
  if (manifestFile === undefined) {
    truth.unresolvedPublicEdges.add(`${manifestPath} -> missing package manifest`)
    return Object.freeze([])
  }

  let manifest: PackageManifest
  try {
    manifest = JSON.parse(manifestFile.content) as PackageManifest
  } catch {
    truth.unresolvedPublicEdges.add(`${manifestPath} -> invalid package manifest JSON`)
    return Object.freeze([])
  }

  const targets = manifestTypesTargets(manifest)
  if (targets.length === 0) {
    const fallback = `${root}index.d.ts`
    if (filesByPath.has(fallback)) return Object.freeze([fallback])
    truth.unresolvedPublicEdges.add(`${manifestPath} -> no declaration entrypoint`)
    return Object.freeze([])
  }

  const resolved: string[] = []
  for (const target of targets) {
    const path = normalizeVirtualPath(posix.join(root, target))
    if (!path.startsWith(root) || !filesByPath.has(path)) {
      truth.unresolvedPublicEdges.add(`${manifestPath} -> ${target}`)
      continue
    }
    resolved.push(path)
  }
  return Object.freeze([...new Set(resolved)].toSorted(compareStrings))
}

function virtualDirectories(filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>): Set<string> {
  const directories = new Set<string>(['/', '/exact-target', VIRTUAL_NODE_MODULES.slice(0, -1)])
  for (const path of filesByPath.keys()) {
    let directory = posix.dirname(path)
    while (directory !== '/' && !directories.has(directory)) {
      directories.add(directory)
      directory = posix.dirname(directory)
    }
    directories.add('/')
  }
  return directories
}

function createCompilerHost(
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
  options: ts.CompilerOptions,
): ts.CompilerHost {
  const directories = virtualDirectories(filesByPath)
  const sourceFiles = new Map<string, ts.SourceFile>()

  const host: ts.CompilerHost = {
    fileExists: fileName => filesByPath.has(normalizeVirtualPath(fileName)),
    readFile: fileName => filesByPath.get(normalizeVirtualPath(fileName))?.content,
    getSourceFile: (fileName, languageVersion) => {
      const normalized = normalizeVirtualPath(fileName)
      const file = filesByPath.get(normalized)
      if (file === undefined || !isDeclarationFile(file)) return undefined
      const cached = sourceFiles.get(normalized)
      if (cached !== undefined) return cached
      const created = ts.createSourceFile(normalized, file.content, languageVersion, true, ts.ScriptKind.TS)
      sourceFiles.set(normalized, created)
      return created
    },
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/exact-target',
    getDirectories: directoryName => {
      const normalized = normalizeVirtualPath(directoryName)
      const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`
      const children = new Set<string>()
      for (const directory of directories) {
        if (!directory.startsWith(prefix) || directory === normalized) continue
        const remainder = directory.slice(prefix.length)
        if (remainder.length > 0 && !remainder.includes('/')) children.add(directory)
      }
      return [...children].toSorted(compareStrings)
    },
    directoryExists: directoryName => directories.has(normalizeVirtualPath(directoryName)),
    getCanonicalFileName: fileName => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    realpath: fileName => normalizeVirtualPath(fileName),
  }

  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map(moduleName => (
    ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule
  ))

  return host
}

function resolvedPublicModule(
  moduleName: string,
  containingFile: string,
  options: ts.CompilerOptions,
  host: ts.CompilerHost,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
): string | undefined {
  const resolved = ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule
  if (resolved === undefined) return undefined
  const path = normalizeVirtualPath(resolved.resolvedFileName)
  return filesByPath.has(path) ? path : undefined
}

function traversePublicDeclarationGraph(
  entrypoint: string,
  truth: MutablePackageTruth,
  program: ts.Program,
  options: ts.CompilerOptions,
  host: ts.CompilerHost,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
  seen: Set<string>,
): void {
  if (seen.has(entrypoint)) return
  seen.add(entrypoint)
  truth.visitedDeclarations.add(entrypoint)

  const sourceFile = program.getSourceFile(entrypoint)
  if (sourceFile === undefined) {
    truth.unresolvedPublicEdges.add(`${entrypoint} -> declaration source unavailable`)
    return
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) {
      truth.unresolvedPublicEdges.add(`${entrypoint} -> non-literal public re-export`)
      continue
    }
    if (statement.exportClause !== undefined && ts.isNamespaceExport(statement.exportClause)) {
      truth.unresolvedPublicEdges.add(`${entrypoint} -> namespace export ${statement.moduleSpecifier.text} is not flattened by Truth v2`)
    }
    const target = resolvedPublicModule(
      statement.moduleSpecifier.text,
      entrypoint,
      options,
      host,
      filesByPath,
    )
    if (target === undefined) {
      truth.unresolvedPublicEdges.add(`${entrypoint} -> ${statement.moduleSpecifier.text}`)
      continue
    }
    traversePublicDeclarationGraph(target, truth, program, options, host, filesByPath, seen)
  }
}

function declarationEvidence(
  symbol: ts.Symbol,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
): readonly ApiTruthEvidenceV2[] {
  const values: ApiTruthEvidenceV2[] = []
  for (const declaration of symbol.getDeclarations() ?? []) {
    const evidence = evidenceForSource(declaration.getSourceFile(), filesByPath)
    if (evidence !== undefined) values.push(evidence)
  }
  return canonicalEvidence(values)
}

function resolvedExportSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
}

function entriesForExport(
  packageName: string,
  exportedSymbol: ts.Symbol,
  checker: ts.TypeChecker,
  filesByPath: ReadonlyMap<string, OrdinaryWorkspaceFile>,
  truth: MutablePackageTruth,
): readonly ApiTruthEntryV2[] {
  const exportedName = exportedSymbol.getName()
  const resolved = resolvedExportSymbol(exportedSymbol, checker)
  const evidence = declarationEvidence(resolved, filesByPath)
  if (evidence.length === 0) {
    truth.unresolvedPublicEdges.add(`export ${exportedName} -> declaration evidence unavailable`)
    return Object.freeze([])
  }

  const values: ApiTruthEntryV2[] = [entry(packageName, 'export', exportedName, evidence)]
  for (const declaration of resolved.getDeclarations() ?? []) {
    const sourceEvidence = evidenceForSource(declaration.getSourceFile(), filesByPath)
    if (sourceEvidence === undefined) continue
    values.push(...memberEntries(packageName, exportedName, declaration, sourceEvidence))
  }
  return Object.freeze(values)
}

function canonicalEntries(values: readonly ApiTruthEntryV2[]): readonly ApiTruthEntryV2[] {
  const byIdentity = new Map<string, ApiTruthEntryV2>()
  for (const value of values) {
    const key = `${value.package}\u0000${value.kind}\u0000${value.qualifiedSymbol}`
    const previous = byIdentity.get(key)
    if (previous === undefined) {
      byIdentity.set(key, value)
      continue
    }
    byIdentity.set(key, entry(
      value.package,
      value.kind,
      value.qualifiedSymbol,
      [...previous.evidence, ...value.evidence],
      value.owner,
    ))
  }

  return Object.freeze([...byIdentity.values()].toSorted((left, right) => (
    compareStrings(left.package, right.package)
    || compareStrings(left.qualifiedSymbol, right.qualifiedSymbol)
    || compareStrings(left.kind, right.kind)
  )))
}

function freezePackageTruth(truth: MutablePackageTruth): ApiTruthPackageV2 {
  const unresolvedPublicEdges = Object.freeze([...truth.unresolvedPublicEdges].toSorted(compareStrings))
  return Object.freeze({
    name: truth.name,
    version: truth.version,
    entrypoints: Object.freeze([...truth.entrypoints].toSorted(compareStrings)),
    visitedDeclarations: Object.freeze([...truth.visitedDeclarations].toSorted(compareStrings)),
    unresolvedPublicEdges,
    complete: truth.entrypoints.size > 0 && unresolvedPublicEdges.length === 0,
  })
}

function truthProjection(
  workspace: OrdinaryWorkspace,
  packages: readonly ApiTruthPackageV2[],
  entries: readonly ApiTruthEntryV2[],
): unknown {
  return {
    schema: TRUTH_SCHEMA,
    targetFingerprint: workspace.target.targetFingerprint,
    workspaceSnapshotSha256: workspace.workspaceSnapshotSha256,
    packages,
    entries,
  }
}

export async function buildApiTruthUniverseV2(
  workspace: OrdinaryWorkspace,
  sha256: Sha256Port,
): Promise<ApiTruthUniverseV2> {
  const filesByPath = new Map(workspace.files.map(file => [normalizeVirtualPath(file.path), file]))
  const declarationFiles = workspace.files.filter(isDeclarationFile).map(file => normalizeVirtualPath(file.path))
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noLib: true,
    skipLibCheck: true,
    types: [],
  }
  const host = createCompilerHost(filesByPath, options)
  const program = ts.createProgram({ rootNames: declarationFiles, options, host })
  const checker = program.getTypeChecker()
  const packageTruth: ApiTruthPackageV2[] = []
  const allEntries: ApiTruthEntryV2[] = []

  for (const pkg of workspace.packages.toSorted((left, right) => compareStrings(left.name, right.name))) {
    const mutable: MutablePackageTruth = {
      name: pkg.name,
      version: pkg.version,
      entrypoints: new Set<string>(),
      visitedDeclarations: new Set<string>(),
      unresolvedPublicEdges: new Set<string>(),
    }
    const entrypoints = resolveManifestEntrypoints(pkg, filesByPath, mutable)
    for (const entrypoint of entrypoints) {
      mutable.entrypoints.add(entrypoint)
      traversePublicDeclarationGraph(
        entrypoint,
        mutable,
        program,
        options,
        host,
        filesByPath,
        new Set<string>(),
      )
      const sourceFile = program.getSourceFile(entrypoint)
      const moduleSymbol = sourceFile === undefined ? undefined : checker.getSymbolAtLocation(sourceFile)
      if (moduleSymbol === undefined) {
        mutable.unresolvedPublicEdges.add(`${entrypoint} -> module symbol unavailable`)
        continue
      }
      for (const exportedSymbol of checker.getExportsOfModule(moduleSymbol)) {
        if (exportedSymbol.getName() === '__esModule') continue
        allEntries.push(...entriesForExport(pkg.name, exportedSymbol, checker, filesByPath, mutable))
      }
    }
    packageTruth.push(freezePackageTruth(mutable))
  }

  const packages = Object.freeze(packageTruth.toSorted((left, right) => compareStrings(left.name, right.name)))
  const entries = canonicalEntries(allEntries)
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(truthProjection(workspace, packages, entries)))
  return Object.freeze({
    schema: TRUTH_SCHEMA,
    targetFingerprint: workspace.target.targetFingerprint,
    workspaceSnapshotSha256: workspace.workspaceSnapshotSha256,
    packages,
    entries,
    fingerprint: `dsh-api-truth-v2:${digest}`,
  })
}
