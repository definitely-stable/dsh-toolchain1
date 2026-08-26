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

const generatedTypes = await compile(schema, 'ToolchainProtocolResponse', {
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
