import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8')
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`Missing transform anchor in ${path}: ${before.slice(0, 80)}`)
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Non-unique transform anchor in ${path}: ${before.slice(0, 80)}`)
  }
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length), 'utf8')
}

async function appendBefore(path, anchor, addition) {
  await replaceOnce(path, anchor, `${addition}${anchor}`)
}

await replaceOnce(
  'scripts/generate-protocol.mjs',
  `      if (node.additionalProperties !== false) {\n        members.push('  readonly [key: string]: unknown')\n      }`,
  `      if (node.additionalProperties !== false) {\n        const additionalType = node.additionalProperties === true || node.additionalProperties === undefined\n          ? 'unknown'\n          : typeExpression(node.additionalProperties, \`\${path}/additionalProperties\`)\n        members.push(\`  readonly [key: string]: \${additionalType}\`)\n      }`,
)

await appendBefore(
  'spec/schemas/v1/toolchain-protocol.schema.json',
  `    "pluginVerifyRequest": {`,
  `    "jsonValue": {\n      "oneOf": [\n        {"type": "null"},\n        {"type": "boolean"},\n        {"type": "number"},\n        {"type": "string"},\n        {"type": "array", "items": {"$ref": "#/$defs/jsonValue"}},\n        {"type": "object", "additionalProperties": {"$ref": "#/$defs/jsonValue"}}\n      ]\n    },\n    "pluginBehaviorAssertion": {\n      "type": "object",\n      "additionalProperties": false,\n      "required": ["kind", "name", "arguments", "expectedValue"],\n      "properties": {\n        "kind": {"const": "agent-tool-result"},\n        "name": {"type": "string", "minLength": 1, "maxLength": 256, "pattern": "\\\\S"},\n        "arguments": {"$ref": "#/$defs/jsonValue"},\n        "expectedValue": {"$ref": "#/$defs/jsonValue"}\n      }\n    },\n`,
)

await replaceOnce(
  'spec/schemas/v1/toolchain-protocol.schema.json',
  `        "visibilityAssertions": {\n          "type": "array",\n          "minItems": 1,\n          "maxItems": 32,\n          "uniqueItems": true,\n          "items": {"$ref": "#/$defs/pluginVisibilityAssertion"}\n        }`,
  `        "visibilityAssertions": {\n          "type": "array",\n          "minItems": 1,\n          "maxItems": 32,\n          "uniqueItems": true,\n          "items": {"$ref": "#/$defs/pluginVisibilityAssertion"}\n        },\n        "behaviorAssertions": {\n          "type": "array",\n          "minItems": 1,\n          "maxItems": 8,\n          "uniqueItems": true,\n          "items": {"$ref": "#/$defs/pluginBehaviorAssertion"}\n        }`,
)

await replaceOnce(
  'src/protocol/request-validation.ts',
  `  ContractSearchRequest,\n  OperationRequest,\n  PluginCheckRequest,`,
  `  ContractSearchRequest,\n  JsonValue,\n  OperationRequest,\n  PluginBehaviorAssertion,\n  PluginCheckRequest,`,
)
await replaceOnce(
  'src/protocol/request-validation.ts',
  `  'executionPolicy',\n  'visibilityAssertions',\n])`,
  `  'executionPolicy',\n  'visibilityAssertions',\n  'behaviorAssertions',\n])`,
)
await replaceOnce(
  'src/protocol/request-validation.ts',
  `const pluginVisibilityAssertionKeys = new Set<keyof PluginVisibilityAssertion>(['kind', 'name'])\nconst profilePattern`,
  `const pluginVisibilityAssertionKeys = new Set<keyof PluginVisibilityAssertion>(['kind', 'name'])\nconst pluginBehaviorAssertionKeys = new Set<keyof PluginBehaviorAssertion>([\n  'kind',\n  'name',\n  'arguments',\n  'expectedValue',\n])\nconst profilePattern`,
)
await replaceOnce(
  'src/protocol/request-validation.ts',
  `const MAX_VISIBILITY_ASSERTION_NAME_LENGTH = 256\nconst MAX_OPERATION_ID_LENGTH`,
  `const MAX_VISIBILITY_ASSERTION_NAME_LENGTH = 256\nconst MAX_BEHAVIOR_ASSERTIONS = 8\nconst MAX_BEHAVIOR_ASSERTION_NAME_LENGTH = 256\nconst MAX_OPERATION_ID_LENGTH`,
)

await appendBefore(
  'src/protocol/request-validation.ts',
  `export function parseTargetResolveRequest`,
  `function parseJsonValue(value: unknown, message: string, active: Set<object> = new Set()): JsonValue {\n  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value\n  if (typeof value === 'number') {\n    if (!Number.isFinite(value)) invalid(message)\n    return Object.is(value, -0) ? 0 : value\n  }\n\n  if (typeof value !== 'object' || value === null) invalid(message)\n  if (active.has(value)) invalid(message)\n  active.add(value)\n  try {\n    if (Array.isArray(value)) {\n      return value.map(item => parseJsonValue(item, message, active))\n    }\n\n    const prototype = Object.getPrototypeOf(value)\n    if (prototype !== Object.prototype && prototype !== null) invalid(message)\n    const parsed: Record<string, JsonValue> = {}\n    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {\n      parsed[key] = parseJsonValue(item, message, active)\n    }\n    return parsed\n  } finally {\n    active.delete(value)\n  }\n}\n\nfunction canonicalJsonValue(value: JsonValue): string {\n  function normalize(item: JsonValue): JsonValue {\n    if (Array.isArray(item)) return item.map(normalize)\n    if (item !== null && typeof item === 'object') {\n      const normalized: Record<string, JsonValue> = {}\n      for (const key of Object.keys(item).toSorted()) {\n        normalized[key] = normalize(item[key])\n      }\n      return normalized\n    }\n    if (typeof item === 'number' && Object.is(item, -0)) return 0\n    return item\n  }\n  return JSON.stringify(normalize(value))\n}\n\nfunction parsePluginBehaviorAssertions(\n  value: unknown,\n  message: string,\n): PluginVerifyRequest['behaviorAssertions'] | undefined {\n  if (value === undefined) return undefined\n  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BEHAVIOR_ASSERTIONS) {\n    invalid(message)\n  }\n\n  const assertions: PluginBehaviorAssertion[] = []\n  const seen = new Set<string>()\n  for (const assertion of value) {\n    if (!isRecord(assertion)) invalid(message)\n    if (\n      Object.keys(assertion).some(\n        key => !pluginBehaviorAssertionKeys.has(key as keyof PluginBehaviorAssertion),\n      )\n    ) invalid(message)\n    if (\n      assertion.kind !== 'agent-tool-result'\n      || typeof assertion.name !== 'string'\n      || assertion.name.trim().length === 0\n      || assertion.name.length > MAX_BEHAVIOR_ASSERTION_NAME_LENGTH\n    ) invalid(message)\n\n    const parsedArguments = parseJsonValue(assertion.arguments, message)\n    const parsedExpectedValue = parseJsonValue(assertion.expectedValue, message)\n    const identity = [\n      assertion.kind,\n      assertion.name,\n      canonicalJsonValue(parsedArguments),\n      canonicalJsonValue(parsedExpectedValue),\n    ].join('\\u0000')\n    if (seen.has(identity)) invalid(message)\n    seen.add(identity)\n    assertions.push({\n      kind: 'agent-tool-result',\n      name: assertion.name,\n      arguments: parsedArguments,\n      expectedValue: parsedExpectedValue,\n    })\n  }\n\n  return assertions as [PluginBehaviorAssertion, ...PluginBehaviorAssertion[]]\n}\n\n`,
)

await replaceOnce(
  'src/protocol/request-validation.ts',
  `  const { target, subject, executionPolicy, visibilityAssertions } = value\n  const parsedTarget = parseTargetResolveRequestWithMessage(target, message)\n  const parsedVisibilityAssertions = parsePluginVisibilityAssertions(visibilityAssertions, message)`,
  `  const { target, subject, executionPolicy, visibilityAssertions, behaviorAssertions } = value\n  const parsedTarget = parseTargetResolveRequestWithMessage(target, message)\n  const parsedVisibilityAssertions = parsePluginVisibilityAssertions(visibilityAssertions, message)\n  const parsedBehaviorAssertions = parsePluginBehaviorAssertions(behaviorAssertions, message)`,
)
await replaceOnce(
  'src/protocol/request-validation.ts',
  `    ...(parsedVisibilityAssertions === undefined ? {} : {\n      visibilityAssertions: parsedVisibilityAssertions,\n    }),\n  }`,
  `    ...(parsedVisibilityAssertions === undefined ? {} : {\n      visibilityAssertions: parsedVisibilityAssertions,\n    }),\n    ...(parsedBehaviorAssertions === undefined ? {} : {\n      behaviorAssertions: parsedBehaviorAssertions,\n    }),\n  }`,
)

await replaceOnce(
  'src/verification/stages.ts',
  `type RuntimeVerificationStageId = 'package' | 'install' | 'compose' | 'boot' | 'visibility'`,
  `type RuntimeVerificationStageId = 'package' | 'install' | 'compose' | 'boot' | 'visibility' | 'behavior'`,
)
await replaceOnce(
  'src/verification/stages.ts',
  `  'boot',\n  'visibility',\n])`,
  `  'boot',\n  'visibility',\n  'behavior',\n])`,
)
await replaceOnce(
  'src/verification/stages.ts',
  `  boot: 'compose',\n  visibility: 'boot',\n})`,
  `  boot: 'compose',\n  visibility: 'boot',\n  behavior: 'boot',\n})`,
)
await replaceOnce(
  'src/verification/stages.ts',
  `  package: Object.freeze(['install', 'compose', 'boot', 'visibility'] as const),\n  install: Object.freeze(['compose', 'boot', 'visibility'] as const),\n  compose: Object.freeze(['boot', 'visibility'] as const),\n  boot: Object.freeze(['visibility'] as const),\n  visibility: Object.freeze([] as const),`,
  `  package: Object.freeze(['install', 'compose', 'boot', 'visibility', 'behavior'] as const),\n  install: Object.freeze(['compose', 'boot', 'visibility', 'behavior'] as const),\n  compose: Object.freeze(['boot', 'visibility', 'behavior'] as const),\n  boot: Object.freeze(['visibility', 'behavior'] as const),\n  visibility: Object.freeze(['behavior'] as const),\n  behavior: Object.freeze([] as const),`,
)
await replaceOnce(
  'src/verification/stages.ts',
  `  if (id === 'behavior') return 'not-supported-in-m4.1'`,
  `  if (id === 'behavior') return 'no-behavior-assertions'`,
)

await writeFile('src/verification/boot-probe.ts', `import { createHash } from 'node:crypto'\nimport { mkdir, writeFile } from 'node:fs/promises'\nimport path from 'node:path'\n\nimport type {\n  PluginBehaviorAssertion,\n  PluginVisibilityAssertion,\n} from '../protocol/index.js'\n\nconst BOOT_PROBE_PACKAGE_NAME = '@dsh-toolchain/verification-boot-probe'\nconst BOOT_PROBE_ID = 'dsh-toolchain-verification-boot-probe'\nconst BOOT_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:'\nconst VISIBILITY_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_VISIBILITY_PROBE_V2:'\nconst BEHAVIOR_PROBE_MARKER_PREFIX = 'DSH_TOOLCHAIN_VERIFY_BEHAVIOR_PROBE_V1:'\n\nexport interface VerificationVisibilityProbe {\n  readonly passedMarker: string\n  readonly failedMarker: string\n}\n\nexport interface VerificationBehaviorProbe {\n  readonly passedMarker: string\n  readonly failedMarker: string\n}\n\nexport interface VerificationBootProbe {\n  readonly packagePath: string\n  readonly marker: string\n  readonly visibility?: VerificationVisibilityProbe\n  readonly behavior?: VerificationBehaviorProbe\n}\n\nfunction profileMarker(profile: string): string {\n  if (profile.trim().length === 0) {\n    throw new Error('Verification boot probe profile must be non-empty.')\n  }\n  const digest = createHash('sha256').update(\`profile:\${profile}\`, 'utf8').digest('hex')\n  return \`\${BOOT_PROBE_MARKER_PREFIX}\${digest}\`\n}\n\nfunction resultMarkers(\n  prefix: string,\n  material: string,\n): VerificationVisibilityProbe {\n  const digest = createHash('sha256').update(material, 'utf8').digest('hex')\n  const markerPrefix = \`\${prefix}\${digest}\`\n  return Object.freeze({\n    passedMarker: \`\${markerPrefix}:PASS\`,\n    failedMarker: \`\${markerPrefix}:FAIL\`,\n  })\n}\n\nfunction visibilityMarkers(\n  profile: string,\n  assertions: readonly PluginVisibilityAssertion[],\n): VerificationVisibilityProbe | undefined {\n  if (assertions.length === 0) return undefined\n  return resultMarkers(\n    VISIBILITY_PROBE_MARKER_PREFIX,\n    \`profile:\${profile}\\nvisibility:\${JSON.stringify(assertions)}\`,\n  )\n}\n\nfunction behaviorMarkers(\n  profile: string,\n  assertions: readonly PluginBehaviorAssertion[],\n): VerificationBehaviorProbe | undefined {\n  if (assertions.length === 0) return undefined\n  return resultMarkers(\n    BEHAVIOR_PROBE_MARKER_PREFIX,\n    \`profile:\${profile}\\nbehavior:\${JSON.stringify(assertions)}\`,\n  )\n}\n\nfunction hostVisibilitySource(): string {\n  return \`  for (const assertion of visibilityAssertions) {\\n    if (assertion.kind !== 'host-service') continue\\n    try {\\n      if (rootCtx.get(assertion.name, false) === undefined) visibilityPassed = false\\n    } catch {\\n      visibilityPassed = false\\n    }\\n  }\\n\`\n}\n\nfunction agentVisibilitySource(): string {\n  return \`  const toolAssertions = visibilityAssertions.filter(assertion => assertion.kind === 'agent-tool')\\n  if (toolAssertions.length > 0) {\\n    if (agent === undefined || tools === undefined) {\\n      visibilityPassed = false\\n    } else {\\n      try {\\n        const visibleTools = new Set(tools.schemas(agent).map(schema => schema.name))\\n        for (const assertion of toolAssertions) {\\n          if (!visibleTools.has(assertion.name)) visibilityPassed = false\\n        }\\n      } catch {\\n        visibilityPassed = false\\n      }\\n    }\\n  }\\n\`\n}\n\nfunction agentSetupSource(profile: string): string {\n  const agentId = JSON.stringify(\`dsh-toolchain-verify-agent-\${profile}\`)\n  return \`  let tools\\n  let agent\\n  try {\\n    const agentLoop = rootCtx.get('agentLoop', false)\\n    tools = rootCtx.get('tools', false)\\n    if (agentLoop !== undefined && tools !== undefined) {\\n      agent = agentLoop.create(\${agentId})\\n    }\\n  } catch {\\n    tools = undefined\\n    agent = undefined\\n  }\\n\`\n}\n\nfunction behaviorSource(behavior: VerificationBehaviorProbe): string {\n  return \`  let behaviorPassed = agent !== undefined && tools !== undefined\\n  if (behaviorPassed) {\\n    for (let index = 0; index < behaviorAssertions.length; index += 1) {\\n      const assertion = behaviorAssertions[index]\\n      try {\\n        const result = await tools.execute({\\n          callId: \\\`dsh-toolchain-verify-behavior-\\\${index}\\\`,\\n          name: assertion.name,\\n          arguments: assertion.arguments,\\n          agent,\\n          signal: AbortSignal.timeout(10000),\\n        })\\n        if (result.isError || !isDeepStrictEqual(result.value, assertion.expectedValue)) {\\n          behaviorPassed = false\\n          break\\n        }\\n      } catch {\\n        behaviorPassed = false\\n        break\\n      }\\n    }\\n  }\\n  process.stdout.write(behaviorPassed ? \${JSON.stringify(\`\${behavior.passedMarker}\\n\`)} : \${JSON.stringify(\`\${behavior.failedMarker}\\n\`)})\\n\`\n}\n\n/**\n * Creates Toolchain-owned instrumentation inside the disposable DSH process.\n * Markers are deterministic coordination evidence, not authentication against\n * adversarial candidate code executing inside the same process boundary.\n */\nexport async function createVerificationBootProbe(\n  root: string,\n  profile: string,\n  visibilityAssertions: readonly PluginVisibilityAssertion[] = [],\n  behaviorAssertions: readonly PluginBehaviorAssertion[] = [],\n): Promise<VerificationBootProbe> {\n  if (root.trim().length === 0) {\n    throw new Error('Verification boot probe root must be non-empty.')\n  }\n\n  const packagePath = path.join(root, 'boot-probe')\n  const marker = profileMarker(profile)\n  const visibility = visibilityMarkers(profile, visibilityAssertions)\n  const behavior = behaviorMarkers(profile, behaviorAssertions)\n  const hasAgentToolAssertions = visibilityAssertions.some(assertion => assertion.kind === 'agent-tool')\n  const needsAgent = hasAgentToolAssertions || behavior !== undefined\n  await mkdir(packagePath, { recursive: false })\n\n  const manifest = {\n    name: BOOT_PROBE_PACKAGE_NAME,\n    version: '0.0.0',\n    private: true,\n    type: 'module',\n    exports: './probe.mjs',\n    dsh: { bundle: { patch: './cordis.patch.yml' } },\n  }\n  const patch = \`- insert:\\n    - id: \${BOOT_PROBE_ID}\\n      name: '\${BOOT_PROBE_PACKAGE_NAME}'\\n\`\n  const visibilityAssertionsSource = JSON.stringify(visibilityAssertions)\n  const behaviorAssertionsSource = JSON.stringify(behaviorAssertions)\n  const imports = behavior === undefined ? '' : \"import { isDeepStrictEqual } from 'node:util'\\n\\n\"\n  const inject = needsAgent ? \"export const inject = ['tools', 'agentLoop']\\n\\n\" : ''\n  const agentSetup = needsAgent ? agentSetupSource(profile) : ''\n  const visibilitySource = visibility === undefined\n    ? ''\n    : \`  const visibilityAssertions = \${visibilityAssertionsSource}\\n  let visibilityPassed = true\\n\${hostVisibilitySource()}\${hasAgentToolAssertions ? agentVisibilitySource() : ''}  process.stdout.write(visibilityPassed ? \${JSON.stringify(\`\${visibility.passedMarker}\\n\`)} : \${JSON.stringify(\`\${visibility.failedMarker}\\n\`)})\\n\`\n  const behaviorAssertionsDeclaration = behavior === undefined\n    ? ''\n    : \`  const behaviorAssertions = \${behaviorAssertionsSource}\\n\`\n  const behaviorExecution = behavior === undefined ? '' : behaviorSource(behavior)\n  const applyKeyword = behavior === undefined ? 'function' : 'async function'\n  const source = \`\${imports}\${inject}export \${applyKeyword} apply(rootCtx) {\\n  const appExit = rootCtx.get('appExit')\\n  if (typeof appExit !== 'function') throw new Error('DSH verification boot probe requires launcher-owned ctx.appExit')\\n  process.stdout.write(\${JSON.stringify(\`\${marker}\\n\`)})\\n\${agentSetup}\${visibilitySource}\${behaviorAssertionsDeclaration}\${behaviorExecution}  appExit(0)\\n}\\n\`\n\n  await Promise.all([\n    writeFile(path.join(packagePath, 'package.json'), \`\${JSON.stringify(manifest, undefined, 2)}\\n\`, { flag: 'wx' }),\n    writeFile(path.join(packagePath, 'cordis.patch.yml'), patch, { flag: 'wx' }),\n    writeFile(path.join(packagePath, 'probe.mjs'), source, { flag: 'wx' }),\n  ])\n\n  return Object.freeze({\n    packagePath,\n    marker,\n    ...(visibility === undefined ? {} : { visibility }),\n    ...(behavior === undefined ? {} : { behavior }),\n  })\n}\n`, 'utf8')

await replaceOnce(
  'src/verification/packed-worker.ts',
  `  Diagnostic,\n  PluginVisibilityAssertion,`,
  `  Diagnostic,\n  PluginBehaviorAssertion,\n  PluginVisibilityAssertion,`,
)
await replaceOnce(
  'src/verification/packed-worker.ts',
  `  readonly visibilityAssertions?: readonly PluginVisibilityAssertion[]\n}`,
  `  readonly visibilityAssertions?: readonly PluginVisibilityAssertion[]\n  readonly behaviorAssertions?: readonly PluginBehaviorAssertion[]\n}`,
)
await replaceOnce(
  'src/verification/packed-worker.ts',
  `          input.target.profile.name,\n          input.visibilityAssertions ?? [],\n        )`,
  `          input.target.profile.name,\n          input.visibilityAssertions ?? [],\n          input.behaviorAssertions ?? [],\n        )`,
)
await replaceOnce(
  'src/verification/packed-worker.ts',
  `      if ((input.visibilityAssertions?.length ?? 0) > 0) {\n        const visibility = bootProbe.visibility\n        const passed = visibility !== undefined && hasExactMarker(bootOutcome.stdout, visibility.passedMarker)\n        const failed = visibility !== undefined && hasExactMarker(bootOutcome.stdout, visibility.failedMarker)\n\n        if (passed && !failed) {\n          checks = passVerificationStage(checks, 'visibility')\n        } else if (failed && !passed) {\n          const diagnostic = verificationDiagnostic(\n            'VERIFY_VISIBILITY_FAILED',\n            'One or more requested visibility assertions were not satisfied in the live DSH probe context.',\n          )\n          diagnostics.push(diagnostic)\n          checks = failStage(checks, 'visibility', diagnostic)\n        } else {\n          checks = skipVerificationStage(checks, 'visibility', 'visibility-assertions-not-executed')\n        }\n      }\n      terminal = 'completed'`,
  `      if ((input.visibilityAssertions?.length ?? 0) > 0) {\n        const visibility = bootProbe.visibility\n        const passed = visibility !== undefined && hasExactMarker(bootOutcome.stdout, visibility.passedMarker)\n        const failed = visibility !== undefined && hasExactMarker(bootOutcome.stdout, visibility.failedMarker)\n\n        if (passed && !failed) {\n          checks = passVerificationStage(checks, 'visibility')\n        } else if (failed && !passed) {\n          const diagnostic = verificationDiagnostic(\n            'VERIFY_VISIBILITY_FAILED',\n            'One or more requested visibility assertions were not satisfied in the live DSH probe context.',\n          )\n          diagnostics.push(diagnostic)\n          checks = failStage(checks, 'visibility', diagnostic)\n        } else {\n          checks = skipVerificationStage(checks, 'visibility', 'visibility-assertions-not-executed')\n        }\n      }\n\n      if ((input.behaviorAssertions?.length ?? 0) > 0) {\n        const visibilityRequested = (input.visibilityAssertions?.length ?? 0) > 0\n        const visibilityCheck = checks.find(check => check.id === 'visibility')\n        if (visibilityRequested && visibilityCheck?.status !== 'passed') {\n          if (visibilityCheck?.status !== 'failed') {\n            checks = skipVerificationStage(checks, 'behavior', 'behavior-assertions-not-executed')\n          }\n        } else {\n          const behavior = bootProbe.behavior\n          const passed = behavior !== undefined && hasExactMarker(bootOutcome.stdout, behavior.passedMarker)\n          const failed = behavior !== undefined && hasExactMarker(bootOutcome.stdout, behavior.failedMarker)\n          if (passed && !failed) {\n            checks = passVerificationStage(checks, 'behavior')\n          } else if (failed && !passed) {\n            const diagnostic = verificationDiagnostic(\n              'VERIFY_BEHAVIOR_FAILED',\n              'Requested Agent Tool behavior did not match its expected structured result.',\n            )\n            diagnostics.push(diagnostic)\n            checks = failStage(checks, 'behavior', diagnostic)\n          } else {\n            checks = skipVerificationStage(checks, 'behavior', 'behavior-assertions-not-executed')\n          }\n        }\n      }\n      terminal = 'completed'`,
)

await replaceOnce(
  'src/model/plugin-verify.ts',
  `  Diagnostic,\n  PluginCheckResult,`,
  `  Diagnostic,\n  PluginBehaviorAssertion,\n  PluginCheckResult,`,
)
await replaceOnce(
  'src/model/plugin-verify.ts',
  `  readonly visibilityAssertions?: readonly PluginVisibilityAssertion[]\n}`,
  `  readonly visibilityAssertions?: readonly PluginVisibilityAssertion[]\n  readonly behaviorAssertions?: readonly PluginBehaviorAssertion[]\n}`,
)
await appendBefore(
  'src/model/plugin-verify.ts',
  `export function reducePluginVerification`,
  `function behaviorCheck(checks: readonly VerificationCheck[]): VerificationCheck {\n  const behavior = checks.find(check => check.id === 'behavior')\n  if (behavior === undefined) {\n    return Object.freeze({\n      id: 'behavior',\n      status: 'skipped',\n      reason: 'worker-check-missing',\n    })\n  }\n  return behavior\n}\n\nfunction behaviorFailed(checks: readonly VerificationCheck[]): boolean {\n  return behaviorCheck(checks).status === 'failed'\n}\n\nfunction behaviorIncomplete(checks: readonly VerificationCheck[]): boolean {\n  const behavior = behaviorCheck(checks)\n  return behavior.status === 'skipped' && behavior.reason !== 'no-behavior-assertions'\n}\n\n`,
)
await replaceOnce(
  'src/model/plugin-verify.ts',
  `  const visibilityUnproven = visibilityIncomplete(checks)\n  if (visibilityUnproven) {\n    reducerDiagnostics.push(diagnostic(\n      'VERIFY_VISIBILITY_UNPROVEN',\n      'warning',\n      'A requested runtime visibility assertion was not executed to a proven pass or fail outcome.',\n    ))\n  }`,
  `  const visibilityUnproven = visibilityIncomplete(checks)\n  if (visibilityUnproven) {\n    reducerDiagnostics.push(diagnostic(\n      'VERIFY_VISIBILITY_UNPROVEN',\n      'warning',\n      'A requested runtime visibility assertion was not executed to a proven pass or fail outcome.',\n    ))\n  }\n\n  const behaviorUnproven = behaviorIncomplete(checks)\n  if (behaviorUnproven) {\n    reducerDiagnostics.push(diagnostic(\n      'VERIFY_BEHAVIOR_UNPROVEN',\n      'warning',\n      'A requested Agent Tool behavior assertion was not executed to a proven pass or fail outcome.',\n    ))\n  }`,
)
await replaceOnce(
  'src/model/plugin-verify.ts',
  `        || requiredCheckFailed(checks)\n        || visibilityFailed(checks)\n        ? 'failed'`,
  `        || requiredCheckFailed(checks)\n        || visibilityFailed(checks)\n        || behaviorFailed(checks)\n        ? 'failed'`,
)
await replaceOnce(
  'src/model/plugin-verify.ts',
  `          || requiredCheckIncomplete(checks)\n          || visibilityUnproven\n          ? 'partial'`,
  `          || requiredCheckIncomplete(checks)\n          || visibilityUnproven\n          || behaviorUnproven\n          ? 'partial'`,
)

await replaceOnce(
  'src/verification/execution-port.ts',
  `        ...(input.visibilityAssertions === undefined\n          ? {}\n          : { visibilityAssertions: input.visibilityAssertions }),`,
  `        ...(input.visibilityAssertions === undefined\n          ? {}\n          : { visibilityAssertions: input.visibilityAssertions }),\n        ...(input.behaviorAssertions === undefined\n          ? {}\n          : { behaviorAssertions: input.behaviorAssertions }),`,
)

await replaceOnce(
  'src/kernel/index.ts',
  `        ...(request.visibilityAssertions === undefined\n          ? {}\n          : { visibilityAssertions: request.visibilityAssertions }),`,
  `        ...(request.visibilityAssertions === undefined\n          ? {}\n          : { visibilityAssertions: request.visibilityAssertions }),\n        ...(request.behaviorAssertions === undefined\n          ? {}\n          : { behaviorAssertions: request.behaviorAssertions }),`,
)

await replaceOnce(
  'src/integrations/dsh/plugin-verify-tool.ts',
  `    visibilityAssertions: {\n      type: 'array',\n      minItems: 1,\n      maxItems: 32,\n      items: {\n        type: 'object',\n        additionalProperties: false,\n        properties: {\n          kind: { enum: ['host-service', 'agent-tool'] },\n          name: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\\\S' },\n        },\n        required: ['kind', 'name'],\n      },\n    },`,
  `    visibilityAssertions: {\n      type: 'array',\n      minItems: 1,\n      maxItems: 32,\n      items: {\n        type: 'object',\n        additionalProperties: false,\n        properties: {\n          kind: { enum: ['host-service', 'agent-tool'] },\n          name: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\\\S' },\n        },\n        required: ['kind', 'name'],\n      },\n    },\n    behaviorAssertions: {\n      type: 'array',\n      minItems: 1,\n      maxItems: 8,\n      items: {\n        type: 'object',\n        additionalProperties: false,\n        properties: {\n          kind: { enum: ['agent-tool-result'] },\n          name: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\\\S' },\n          arguments: {},\n          expectedValue: {},\n        },\n        required: ['kind', 'name', 'arguments', 'expectedValue'],\n      },\n    },`,
)
await replaceOnce(
  'src/integrations/dsh/plugin-verify-tool.ts',
  `description: 'Verify one packed plugin against an exact installed DSH target. This executes candidate code in an isolated temporary DSH environment under the safe policy and can prove explicitly requested Host Service visibility or Agent Tool callable-schema visibility without mutating the active profile.',`,
  `description: 'Verify one packed plugin against an exact installed DSH target. This executes candidate code in an isolated temporary DSH environment under the safe policy and can prove explicitly requested Host Service visibility, Agent Tool callable-schema visibility, or exact Agent Tool structured behavior results without mutating the active profile.',`,
)

await replaceOnce(
  'spec/protocol.md',
  `M4.3.1 supports exactly one visibility assertion shape: \`{ "kind": "host-service", "name": <non-blank service name> }\`. M4.3.2 adds exactly one more: \`{ "kind": "agent-tool", "name": <non-blank tool name> }\`. Names of either kind are limited to 256 UTF-16 code units and duplicate \`(kind, name)\` assertions are invalid; the same name under different kinds is valid because the namespaces are semantically distinct. At most 32 assertions are accepted in total across both kinds. Client/page, behavior, trusted-policy, and other assertion kinds are not accepted by this request shape.`,
  `M4.3.1 supports exactly one visibility assertion shape: \`{ "kind": "host-service", "name": <non-blank service name> }\`. M4.3.2 adds exactly one more: \`{ "kind": "agent-tool", "name": <non-blank tool name> }\`. Names of either kind are limited to 256 UTF-16 code units and duplicate \`(kind, name)\` assertions are invalid; the same name under different kinds is valid because the namespaces are semantically distinct. At most 32 assertions are accepted in total across both kinds. M4.3.3 additionally accepts optional \`behaviorAssertions\`: a non-empty array of at most eight closed \`{ "kind": "agent-tool-result", "name", "arguments", "expectedValue" }\` assertions whose values must be losslessly JSON-serializable. Duplicate behavior assertions are invalid under structural JSON equality, including object-key-order variants. Client/page, trusted-policy, generic scripting, shell/filesystem/network assertion kinds, and implicit behavior discovery remain unsupported.`,
)
await replaceOnce(
  'spec/protocol.md',
  `- optional \`visibilityAssertions\` — a non-empty array of at most 32 explicit visibility assertions.`,
  `- optional \`visibilityAssertions\` — a non-empty array of at most 32 explicit visibility assertions;\n- optional \`behaviorAssertions\` — a non-empty array of at most 8 explicit Agent Tool structured-result assertions.`,
)
await replaceOnce(
  'spec/protocol.md',
  `3. bind the authoritative packed bytes to \`dsh-plugin-artifact-v1:<sha256>\` and pass the same exact content hash plus the initial \`TargetSnapshot\`, execution policy, and any canonical visibility assertions to the isolated worker;`,
  `3. bind the authoritative packed bytes to \`dsh-plugin-artifact-v1:<sha256>\` and pass the same exact content hash plus the initial \`TargetSnapshot\`, execution policy, and any canonical visibility or behavior assertions to the isolated worker;`,
)
await replaceOnce(
  'spec/protocol.md',
  `5. when visibility assertions were requested, prove them through Toolchain-owned instrumentation in the same composed/booted DSH runtime rather than from static declarations: Host Service assertions resolve through the live Cordis context, while Agent Tool assertions are evaluated against the capability catalog of one verifier-owned Agent created through the synchronous \`agentLoop\` seam and torn down with the disposable boot process;`,
  `5. when visibility or behavior assertions were requested, prove them through Toolchain-owned instrumentation in the same composed/booted DSH runtime rather than from static declarations: Host Service assertions resolve through the live Cordis context, Agent Tool visibility is evaluated against the capability catalog of one verifier-owned Agent, and behavior assertions call \`ToolRuntime.execute\` sequentially with the same owned Agent and compare the successful canonical JSON \`value\` structurally;`,
)
await replaceOnce(
  'spec/protocol.md',
  `\`build\` and \`behavior\` remain outside the current alpha claim.`,
  `\`build\` remains outside the current alpha claim. \`behavior\` remains non-blocking when no behavior assertions are requested, but becomes required for a request that explicitly supplies \`behaviorAssertions\`.`,
)
await appendBefore(
  'spec/protocol.md',
  `Host Service visibility MUST be based on live runtime observation`,
  `When no behavior assertions are requested, \`behavior\` MUST be \`skipped / no-behavior-assertions\` and does not block an otherwise verified report. When requested, every assertion must execute after boot (and after requested visibility has passed), return a non-error Tool result, and structurally equal its \`expectedValue\`; success yields \`behavior: passed\`, a Tool error/timeout/missing Tool/value mismatch yields \`behavior: failed\` plus \`VERIFY_BEHAVIOR_FAILED\`, and absence of unambiguous execution evidence yields \`partial\` plus \`VERIFY_BEHAVIOR_UNPROVEN\` unless a stronger status applies. Object key order is irrelevant, array order is significant, and values follow lossless JSON semantics.\n\n`,
)
await replaceOnce(
  'spec/protocol.md',
  `Its published parameter schema MUST expose the supported Protocol visibility assertion shapes so a native DSH Agent can request the same Host Service and Agent Tool proofs as CLI and MCP.`,
  `Its published parameter schema MUST expose the supported Protocol visibility and behavior assertion shapes so a native DSH Agent can request the same Host Service, Agent Tool visibility, and structured Tool-result proofs as MCP.`,
)
await replaceOnce(
  'spec/protocol.md',
  `\`plugin.verify\` MUST likewise use the closed Protocol request/response schemas, including \`visibilityAssertions\`, and the shared kernel reducer;`,
  `\`plugin.verify\` MUST likewise use the closed Protocol request/response schemas, including \`visibilityAssertions\` and \`behaviorAssertions\`, and the shared kernel reducer;`,
)

await appendBefore(
  'spec/verification.md',
  `## Isolation\n`,
  `## M4.3.3 Explicit Agent Tool behavior assertion\n\nM4.3.3 adds one closed opt-in behavior vocabulary to the same isolated boot epoch:\n\n\`\`\`json\n{ "kind": "agent-tool-result", "name": "<tool-name>", "arguments": {}, "expectedValue": {} }\n\`\`\`\n\nBehavior is never inferred. No assertions preserves \`behavior: skipped / no-behavior-assertions\`. When requested, Toolchain creates one verifier-owned Agent for the request's Agent Tool visibility/behavior work and executes assertions sequentially through the exact DSH \`ToolRuntime.execute({ callId, name, arguments, agent, signal })\` seam. Each call uses a Toolchain-owned 10-second \`AbortSignal.timeout\`; all assertions share the existing bounded boot process and no new retry loop or generic scripting surface is introduced.\n\nA successful assertion requires \`result.isError === false\` and structural equality between the canonical lossless-JSON \`result.value\` and \`expectedValue\`. Object key insertion order is irrelevant, array order is significant, and request validation rejects non-finite numbers, bigint, functions, symbols, cycles, or any other direct JavaScript value that cannot cross canonical JSON transport. Tool errors, timeout/cancellation, missing/invisible Tools, invalid arguments, thrown execution, or unequal values produce \`VERIFY_BEHAVIOR_FAILED\`. Requested behavior without an unambiguous PASS/FAIL marker is unproven and prevents \`verified\`.\n\nIf visibility assertions were also requested, behavior executes only after visibility passes; Host Service-only visibility still creates no Agent unless behavior itself requires one. Behavior and Agent Tool visibility share exactly one Agent epoch.\n\nThe behavior marker is a deterministic control-flow/evidence synchronization token bound to the profile and ordered assertion set. It is **not authentication against adversarial candidate code executing inside the same DSH process**. Policy \`safe\` remains disposable Toolchain-owned home/process isolation, not a malicious-code sandbox; receipts MUST NOT be described as tamper-proof against code running inside that trust boundary.\n\n`,
)

await replaceOnce(
  'docs/superpowers/specs/2026-09-13-m4-behavior-result-design.md',
  `Success comparison uses structured deep equality; object key insertion order is irrelevant.`,
  `Success comparison uses structured deep equality over lossless JSON; object key insertion order is irrelevant, array order is significant, and the Protocol parser normalizes direct \`-0\` to JSON-equivalent \`0\`.`
)
await appendBefore(
  'docs/superpowers/specs/2026-09-13-m4-behavior-result-design.md',
  `## Reducer\n`,
  `The deterministic PASS/FAIL markers are verifier control-flow/evidence synchronization tokens, not authentication against adversarial candidate code executing in the same process. The current \`safe\` boundary therefore makes no tamper-proof receipt claim; adversarial-process attestation would require a different isolation/trust boundary and is outside this slice.\n\n`,
)

const generated = spawnSync(process.execPath, ['scripts/generate-protocol.mjs'], { stdio: 'inherit' })
if (generated.status !== 0) process.exit(generated.status ?? 1)
