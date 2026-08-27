import ts from 'typescript'

export interface DeclarationNamedExportBinding {
  readonly importedName: string
  readonly exportedName: string
}

export type DeclarationReexportEdge =
  | {
      readonly kind: 'star'
      readonly specifier: string
    }
  | {
      readonly kind: 'named'
      readonly specifier: string
      readonly bindings: readonly DeclarationNamedExportBinding[]
    }
  | {
      readonly kind: 'namespace'
      readonly specifier: string
      readonly exportedName: string
    }
  | {
      readonly kind: 'import-equals'
      readonly specifier: string
      readonly exportedName: string
    }

export interface ParsedDeclarationSyntax {
  readonly exports: readonly string[]
  readonly relativeReexports: readonly DeclarationReexportEdge[]
  readonly relativePathReferences: readonly string[]
}

export interface DeclarationSyntaxPort {
  parse(fileName: string, content: string): ParsedDeclarationSyntax
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareReexportEdges(left: DeclarationReexportEdge, right: DeclarationReexportEdge): number {
  const bySpecifier = compareCodePoints(left.specifier, right.specifier)
  if (bySpecifier !== 0) return bySpecifier
  const byKind = compareCodePoints(left.kind, right.kind)
  if (byKind !== 0) return byKind
  if (left.kind === 'namespace' && right.kind === 'namespace') {
    return compareCodePoints(left.exportedName, right.exportedName)
  }
  if (left.kind === 'import-equals' && right.kind === 'import-equals') {
    return compareCodePoints(left.exportedName, right.exportedName)
  }
  if (left.kind === 'named' && right.kind === 'named') {
    return compareCodePoints(
      left.bindings.map(binding => `${binding.importedName}:${binding.exportedName}`).join('\u0000'),
      right.bindings.map(binding => `${binding.importedName}:${binding.exportedName}`).join('\u0000'),
    )
  }
  return 0
}

function isRelativeSpecifier(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../')
}

/**
 * TypeScript with `rewriteRelativeImportExtensions` can emit declaration files
 * whose relative module/path references retain source `.ts/.mts/.cts/.tsx`
 * spellings. M2.1 consumes declaration evidence only, so resolve those
 * spellings to emitted declaration siblings while keeping declaration-form
 * specifiers idempotent.
 */
function declarationTargetSpecifier(value: string): string {
  if (
    value.endsWith('.d.ts')
    || value.endsWith('.d.mts')
    || value.endsWith('.d.cts')
  ) return value
  if (value.endsWith('.mts')) return `${value.slice(0, -4)}.d.mts`
  if (value.endsWith('.cts')) return `${value.slice(0, -4)}.d.cts`
  if (value.endsWith('.tsx')) return `${value.slice(0, -4)}.d.ts`
  if (value.endsWith('.ts')) return `${value.slice(0, -3)}.d.ts`
  return value
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(modifier => modifier.kind === kind) ?? false)
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

function addExportedDeclarationName(
  node: ts.ClassDeclaration | ts.FunctionDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ModuleDeclaration,
  result: Set<string>,
): void {
  if (!hasModifier(node, ts.SyntaxKind.ExportKeyword)) return
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    result.add('default')
    return
  }
  if (node.name !== undefined) result.add(node.name.text)
}

function moduleSpecifierText(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined
}

function externalModuleReferenceText(node: ts.ModuleReference): string | undefined {
  if (!ts.isExternalModuleReference(node)) return undefined
  return moduleSpecifierText(node.expression)
}

function syntaxDiagnosticMessage(fileName: string, sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (diagnostic.start === undefined) return `${fileName}: TS${diagnostic.code}: ${message}`
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
  return `${fileName}:${line + 1}:${character + 1}: TS${diagnostic.code}: ${message}`
}

function assertSyntacticallyValid(
  fileName: string,
  content: string,
  sourceFile: ts.SourceFile,
): void {
  // createSourceFile intentionally recovers from malformed input. Build an
  // isolated, no-lib/no-resolve Program only to ask the public Compiler API for
  // syntactic diagnostics. No semantic diagnostics, type checking, module
  // resolution or target-package loading occurs here.
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  }
  const host: ts.CompilerHost = {
    fileExists: candidate => candidate === fileName,
    readFile: candidate => candidate === fileName ? content : undefined,
    getSourceFile: candidate => candidate === fileName ? sourceFile : undefined,
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    getCanonicalFileName: candidate => candidate,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }
  const program = ts.createProgram([fileName], options, host)
  const diagnostic = program.getSyntacticDiagnostics(sourceFile)[0]
  if (diagnostic !== undefined) {
    throw new SyntaxError(syntaxDiagnosticMessage(fileName, sourceFile, diagnostic))
  }
}

function freezeNamedBindings(bindings: DeclarationNamedExportBinding[]): readonly DeclarationNamedExportBinding[] {
  return Object.freeze(
    bindings
      .map(binding => Object.freeze({ ...binding }))
      .toSorted((left, right) => {
        const byExported = compareCodePoints(left.exportedName, right.exportedName)
        return byExported !== 0 ? byExported : compareCodePoints(left.importedName, right.importedName)
      }),
  )
}

function freezeEdge(edge: DeclarationReexportEdge): DeclarationReexportEdge {
  if (edge.kind !== 'named') return Object.freeze({ ...edge })
  return Object.freeze({ ...edge, bindings: freezeNamedBindings([...edge.bindings]) })
}

export function parseTypeScriptDeclarationSyntax(fileName: string, content: string): ParsedDeclarationSyntax {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  )
  assertSyntacticallyValid(fileName, content, sourceFile)

  const exports = new Set<string>()
  const relativeReexports: DeclarationReexportEdge[] = []
  const relativePathReferences = new Set<string>()

  for (const reference of sourceFile.referencedFiles) {
    if (isRelativeSpecifier(reference.fileName)) {
      relativePathReferences.add(declarationTargetSpecifier(reference.fileName))
    }
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isClassDeclaration(statement)
      || ts.isFunctionDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    ) {
      addExportedDeclarationName(statement, exports)
      continue
    }

    if (ts.isVariableStatement(statement)) {
      if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, exports)
      }
      continue
    }

    if (ts.isExportDeclaration(statement)) {
      const rawSpecifier = moduleSpecifierText(statement.moduleSpecifier)
      const relative = rawSpecifier !== undefined && isRelativeSpecifier(rawSpecifier)
      const specifier = relative && rawSpecifier !== undefined
        ? declarationTargetSpecifier(rawSpecifier)
        : rawSpecifier

      if (statement.exportClause === undefined) {
        if (relative && specifier !== undefined) relativeReexports.push({ kind: 'star', specifier })
        continue
      }

      if (ts.isNamedExports(statement.exportClause)) {
        const bindings = statement.exportClause.elements.map(element => ({
          importedName: element.propertyName?.text ?? element.name.text,
          exportedName: element.name.text,
        }))
        for (const binding of bindings) exports.add(binding.exportedName)
        if (relative && specifier !== undefined) {
          relativeReexports.push({
            kind: 'named',
            specifier,
            bindings: freezeNamedBindings(bindings),
          })
        }
        continue
      }

      const exportedName = statement.exportClause.name.text
      exports.add(exportedName)
      if (relative && specifier !== undefined) relativeReexports.push({ kind: 'namespace', specifier, exportedName })
      continue
    }

    if (ts.isExportAssignment(statement)) {
      exports.add(statement.isExportEquals ? 'export=' : 'default')
      continue
    }

    if (ts.isNamespaceExportDeclaration(statement)) {
      exports.add(statement.name.text)
      continue
    }

    if (ts.isImportEqualsDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      exports.add(statement.name.text)
      const rawSpecifier = externalModuleReferenceText(statement.moduleReference)
      if (rawSpecifier !== undefined && isRelativeSpecifier(rawSpecifier)) {
        relativeReexports.push({
          kind: 'import-equals',
          specifier: declarationTargetSpecifier(rawSpecifier),
          exportedName: statement.name.text,
        })
      }
    }
  }

  return Object.freeze({
    exports: Object.freeze([...exports].toSorted(compareCodePoints)),
    relativeReexports: Object.freeze(relativeReexports.map(freezeEdge).toSorted(compareReexportEdges)),
    relativePathReferences: Object.freeze([...relativePathReferences].toSorted(compareCodePoints)),
  })
}

export const typescriptDeclarationSyntaxPort: DeclarationSyntaxPort = Object.freeze({
  parse: parseTypeScriptDeclarationSyntax,
})
