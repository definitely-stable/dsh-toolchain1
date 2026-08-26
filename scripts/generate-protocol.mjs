import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { compile } from 'json-schema-to-typescript'

const root = new URL('../', import.meta.url)
const schemaUrl = new URL('spec/schemas/v1/toolchain-protocol.schema.json', root)
const outputUrl = new URL('src/protocol/generated.ts', root)
const checkOnly = process.argv.includes('--check')

const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
const protocolVersion = schema?.$defs?.responseEnvelope?.properties?.protocolVersion?.const

if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) {
  throw new Error('Protocol schema must define responseEnvelope.properties.protocolVersion.const')
}

const unsupportedCodegenKeywords = new Set([
  '$dynamicRef',
  '$dynamicAnchor',
  'prefixItems',
  'unevaluatedItems',
  'unevaluatedProperties',
  'dependentSchemas',
  'dependentRequired',
])

function lowerForTypeCodegen(value, path = '#') {
  if (Array.isArray(value)) {
    return value.map((item, index) => lowerForTypeCodegen(item, `${path}/${index}`))
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const result = {}

  for (const [key, nested] of Object.entries(value)) {
    if (unsupportedCodegenKeywords.has(key)) {
      throw new Error(
        `Protocol type codegen cannot safely lower JSON Schema 2020-12 keyword ${key} at ${path}. ` +
          'Use a 2020-12-native generator before introducing this keyword.',
      )
    }

    if (key === '$schema') {
      result.$schema = 'http://json-schema.org/draft-07/schema#'
      continue
    }

    if (key === '$defs') {
      result.definitions = lowerForTypeCodegen(nested, `${path}/$defs`)
      continue
    }

    if (key === '$ref' && typeof nested === 'string') {
      result.$ref = nested.replace(/^#\/\$defs\//, '#/definitions/')
      continue
    }

    result[key] = lowerForTypeCodegen(nested, `${path}/${key}`)
  }

  return result
}

// Runtime validation remains Draft 2020-12. This lowering exists only because
// json-schema-to-typescript 15 does not resolve local $defs refs reliably.
// Reject 2020-12-only applicator keywords above rather than silently changing semantics.
const codegenSchema = lowerForTypeCodegen(schema)

const generatedTypes = await compile(codegenSchema, 'ToolchainProtocolResponse', {
  bannerComment: '',
  unreachableDefinitions: true,
  unknownAny: true,
  style: {
    singleQuote: true,
    semi: false,
    trailingComma: 'all',
    tabWidth: 2,
    useTabs: false,
    printWidth: 100,
    bracketSpacing: true,
  },
})

const expected = [
  '// This file is generated from spec/schemas/v1/toolchain-protocol.schema.json.',
  '// DO NOT EDIT BY HAND. Run `pnpm generate` after changing the canonical schema.',
  '',
  `export const TOOLCHAIN_PROTOCOL_VERSION = ${JSON.stringify(protocolVersion)} as const`,
  '',
  generatedTypes.trimEnd(),
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
