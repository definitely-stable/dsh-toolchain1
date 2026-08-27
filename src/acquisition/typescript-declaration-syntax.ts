import ts from 'typescript'

export interface ParsedDeclarationSyntax {
  readonly exports: readonly string[]
  readonly relativeReexports: readonly string[]
  readonly relativePathReferences: readonly string[]
}

export interface DeclarationSyntaxPort {
  parse(fileName: string, content: string): ParsedDeclarationSyntax
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRelativeSpecifier(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../')
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

export function parseTypeScriptDeclarationSyntax(fileName: string, content: string): ParsedDeclarationSyntax {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  )
  const exports = new Set<string>()
  const relativeReexports = new Set<string>()
  const relativePathReferences = new Set<string>()

  for (const reference of sourceFile.referencedFiles) {
    if (isRelativeSpecifier(reference.fileName)) relativePathReferences.add(reference.fileName)
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
      const specifier = moduleSpecifierText(statement.moduleSpecifier)
      if (specifier !== undefined && isRelativeSpecifier(specifier)) relativeReexports.add(specifier)

      if (statement.exportClause !== undefined) {
        if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) exports.add(element.name.text)
        } else {
          exports.add(statement.exportClause.name.text)
        }
      }
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
      const specifier = externalModuleReferenceText(statement.moduleReference)
      if (specifier !== undefined && isRelativeSpecifier(specifier)) relativeReexports.add(specifier)
    }
  }

  return Object.freeze({
    exports: Object.freeze([...exports].toSorted(compareCodePoints)),
    relativeReexports: Object.freeze([...relativeReexports].toSorted(compareCodePoints)),
    relativePathReferences: Object.freeze([...relativePathReferences].toSorted(compareCodePoints)),
  })
}

export const typescriptDeclarationSyntaxPort: DeclarationSyntaxPort = Object.freeze({
  parse: parseTypeScriptDeclarationSyntax,
})
