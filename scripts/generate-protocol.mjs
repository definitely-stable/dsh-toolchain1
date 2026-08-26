import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const schemaUrl = new URL('spec/schemas/v1/toolchain-protocol.schema.json', root)
const outputUrl = new URL('src/protocol/generated.ts', root)
const checkOnly = process.argv.includes('--check')

const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
const protocolVersion = schema?.$defs?.responseEnvelope?.properties?.protocolVersion?.const

if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) {
  throw new Error('Protocol schema must define responseEnvelope.properties.protocolVersion.const')
}

const supportedKeywords = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minLength',
  'minimum',
  'maximum',
  'pattern',
  'format',
  'uniqueItems',
])

function assertSchemaNode(node, path = '#') {
  if (typeof node === 'boolean') return
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`Expected JSON Schema object/boolean at ${path}`)
  }

  for (const key of Object.keys(node)) {
    if (!supportedKeywords.has(key)) {
      throw new Error(
        `Protocol type generator does not support JSON Schema keyword ${key} at ${path}. ` +
          'Extend the generator with tests before using this keyword.',
      )
    }
  }

  for (const [name, child] of Object.entries(node.$defs ?? {})) {
    assertSchemaNode(child, `${path}/$defs/${name}`)
  }

  for (const [name, child] of Object.entries(node.properties ?? {})) {
    assertSchemaNode(child, `${path}/properties/${name}`)
  }

  if (node.items !== undefined) {
    assertSchemaNode(node.items, `${path}/items`)
  }

  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    assertSchemaNode(node.additionalProperties, `${path}/additionalProperties`)
  }
}

function pascalCase(value) {
  return value
    .replace(/(^|[-_\s]+)([a-zA-Z0-9])/g, (_match, _prefix, char) => char.toUpperCase())
    .replace(/[^a-zA-Z0-9_$]/g, '')
}

function literal(value) {
  return JSON.stringify(value)
}

function refType(ref) {
  const prefix = '#/$defs/'
  if (!ref.startsWith(prefix)) {
    throw new Error(`Protocol type generator only supports local $defs refs, received: ${ref}`)
  }
  return pascalCase(ref.slice(prefix.length))
}

function typeExpression(node, path) {
  if (node === true || (node && typeof node === 'object' && Object.keys(node).length === 0)) {
    return 'unknown'
  }
  if (node === false) return 'never'
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`Expected schema object at ${path}`)
  }

  if ('$ref' in node) return refType(node.$ref)
  if ('const' in node) return literal(node.const)
  if (Array.isArray(node.enum)) return node.enum.map(literal).join(' | ') || 'never'

  if (Array.isArray(node.type)) {
    return node.type
      .map((type) => typeExpression({ ...node, type }, `${path}/type`))
      .join(' | ')
  }

  switch (node.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `Array<${typeExpression(node.items ?? {}, `${path}/items`)}>`
    case 'object': {
      const properties = node.properties ?? {}
      const required = new Set(node.required ?? [])
      const members = Object.entries(properties).map(([name, child]) => {
        const optional = required.has(name) ? '' : '?'
        return `  readonly ${JSON.stringify(name)}${optional}: ${typeExpression(child, `${path}/properties/${name}`)}`
      })

      if (node.additionalProperties !== false) {
        members.push('  readonly [key: string]: unknown')
      }

      return members.length === 0 ? 'Record<string, unknown>' : `{\n${members.join('\n')}\n}`
    }
    case undefined:
      return 'unknown'
    default:
      throw new Error(`Unsupported schema type ${JSON.stringify(node.type)} at ${path}`)
  }
}

function emitDefinition(name, node) {
  const typeName = pascalCase(name)
  return `export type ${typeName} = ${typeExpression(node, `#/$defs/${name}`)}`
}

assertSchemaNode(schema)

const definitions = Object.entries(schema.$defs ?? {}).map(([name, node]) => emitDefinition(name, node))
const rootType = typeExpression(schema, '#')

const expected = [
  '// This file is generated from spec/schemas/v1/toolchain-protocol.schema.json.',
  '// DO NOT EDIT BY HAND. Run `pnpm generate` after changing the canonical schema.',
  '',
  `export const TOOLCHAIN_PROTOCOL_VERSION = ${JSON.stringify(protocolVersion)} as const`,
  '',
  ...definitions.flatMap((definition) => [definition, '']),
  `export type ToolchainProtocolResponse = ${rootType}`,
  '',
].join('\n')

if (checkOnly) {
  let actual
  try {
    actual = await readFile(outputUrl, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.error('Generated protocol file is missing. Run `pnpm generate`.')
      process.exitCode = 1
      process.exit()
    }
    throw error
  }

  if (actual !== expected) {
    console.error('Generated protocol file is stale. Run `pnpm generate`.')
    process.exitCode = 1
  }
} else {
  await mkdir(new URL('src/protocol/', root), { recursive: true })
  await writeFile(outputUrl, expected, 'utf8')
}
