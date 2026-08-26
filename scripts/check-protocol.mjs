import { readFile } from 'node:fs/promises'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const root = new URL('../', import.meta.url)
const schemaUrl = new URL('spec/schemas/v1/toolchain-protocol.schema.json', root)
const examples = [
  {
    url: new URL('spec/examples/v1/validation-failed.json', root),
    dataRef: '#/$defs/validationReport',
  },
  {
    url: new URL('spec/examples/v1/verification-passed.json', root),
    dataRef: '#/$defs/verificationReport',
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

const validateEnvelope = requireValidator('')

for (const example of examples) {
  const value = JSON.parse(await readFile(example.url, 'utf8'))
  const label = example.url.pathname.split('/').at(-1) ?? example.url.pathname

  assertValid(validateEnvelope, value, `${label} envelope`)
  assertValid(requireValidator(example.dataRef), value.data, `${label} data`)
}

console.error(`Protocol conformance: ${examples.length}/${examples.length} examples valid`)
