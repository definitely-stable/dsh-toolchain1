import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default

const root = new URL('../', import.meta.url)
const schemaUrl = new URL('spec/schemas/v1/toolchain-protocol.schema.json', root)
const examples = [
  {
    url: new URL('spec/examples/v1/validation-failed.json', root),
    envelopeRef: '',
    dataRef: '#/$defs/validationReport',
  },
  {
    url: new URL('spec/examples/v1/verification-passed.json', root),
    envelopeRef: '',
    dataRef: '#/$defs/verificationReport',
  },
  {
    url: new URL('spec/examples/v1/target-resolved.json', root),
    envelopeRef: '#/$defs/targetResolveResponse',
    dataRef: '#/$defs/targetResolveResult',
  },
  {
    url: new URL('spec/examples/v1/target-failed.json', root),
    envelopeRef: '#/$defs/targetResolveResponse',
  },
]

const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
ajv.addSchema(schema)

function requireValidator(ref) {
  const validate = ajv.getSchema(`${schema.$id}${ref}`)
  if (!validate) {
    throw new Error(`Protocol schema reference is not resolvable: ${ref}`)
  }
  return validate
}

function assertValid(validate, value, label) {
  if (validate(value)) return

  throw new Error(`${label} failed schema validation:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`)
}

function assertInvalid(validate, value, label) {
  if (!validate(value)) return
  throw new Error(`${label} unexpectedly passed schema validation`)
}

for (const example of examples) {
  const value = JSON.parse(await readFile(example.url, 'utf8'))
  const label = example.url.pathname.split('/').at(-1) ?? example.url.pathname

  assertValid(requireValidator(example.envelopeRef), value, `${label} envelope`)
  if (example.dataRef) {
    assertValid(requireValidator(example.dataRef), value.data, `${label} data`)
  }

  if (example.dataRef === '#/$defs/targetResolveResult') {
    assertInvalid(
      requireValidator(example.envelopeRef),
      { ...value, data: { banana: 123 } },
      `${label} arbitrary data`,
    )
  }
}

console.error(`Protocol conformance: ${examples.length}/${examples.length} examples valid`)
