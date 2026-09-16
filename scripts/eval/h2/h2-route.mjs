import { chmodSync, copyFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { H2_POLICY } from './h2-config.mjs'

/**
 * The pinned model route as *observation-home configuration*.
 *
 * A fresh observation home starts from the shipped `acp` profile, which
 * registers exactly one provider route (`deepseek-official`) and reads no
 * credential at all. The frozen route therefore has to be written into the
 * home's own profile patch layer, and the home has to be given credential
 * material, or the agent under test cannot make a single model call. Both are
 * environment, never arm manipulation: the same entries and the same
 * credential material go into both arms, so the C-minus-B difference stays
 * exactly the Toolchain bundle.
 *
 * The patch layer is DSH's documented customization seam for a profile
 * (`profiles/<name>/cordis.patch.yml`, applied after every bundle layer), so
 * the pinned route is visible in `dsh --dump-config` and is therefore also
 * provable by the composition-parity probe.
 */

/** Profile-patch row that owns the provider routes. */
export const H2_ROUTE_ROW_ID = 'llm-pi-ai'

/** Profile-patch row that owns the default model identity. */
export const H2_DEFAULT_MODEL_ROW_ID = 'agent-default-model'

/** DSH's credential document inside a harness home. */
export const H2_CREDENTIALS_FILENAME = '.credentials.yaml'

/**
 * Opaque, per-observation value for the relay's session-affinity header. It
 * only has to be stable within one conversation and distinct between
 * observations; run id, task id, and arm already identify the observation
 * uniquely, and the value is recorded in the receipt-bearing run directory.
 *
 * @param {{runId: string, taskId: string, arm: string}} input
 */
export function sessionAffinityValue({ runId, taskId, arm }) {
  for (const [label, value] of [['runId', runId], ['taskId', taskId], ['arm', arm]]) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`H2 session affinity ${label} must be a non-empty string`)
  }
  const raw = `${arm}-${runId}-${taskId}`
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) throw new Error('H2 session affinity value must be a safe opaque token')
  return raw
}

/**
 * Profile-patch entries pinning the frozen route: one row configuring the
 * provider profile (credential reference plus the relay's routing header) and
 * one row pinning provider, model, and reasoning effort as the profile default.
 *
 * @param {{model?: {provider: string, model: string, reasoningEffort: string,
 *   credentialRef: string, sessionAffinityHeader: string}, sessionAffinity: string}} input
 */
export function routePatchEntries({ model = H2_POLICY.model, sessionAffinity }) {
  if (typeof sessionAffinity !== 'string' || sessionAffinity.length === 0) {
    throw new Error('H2 route patch requires a per-observation session affinity value')
  }
  const { provider, model: modelId, reasoningEffort, credentialRef, sessionAffinityHeader } = model
  return [
    {
      id: H2_ROUTE_ROW_ID,
      config: {
        providers: {
          [provider]: {
            apiKeyEnv: credentialRef,
            headers: { [sessionAffinityHeader]: sessionAffinity },
          },
        },
      },
    },
    {
      id: H2_DEFAULT_MODEL_ROW_ID,
      config: { provider, model: modelId, reasoningEffort },
    },
  ]
}

/** The operator's harness home, when this process can name one. */
export function operatorHome(env = process.env) {
  return resolve(env.DSH_HOME ?? join(homedir(), '.dsh'))
}

/**
 * Which credential sources the pinned route can resolve from, reported so that
 * `validate` names the authority for its own verdict instead of asserting a
 * specific variable name.
 *
 * The credential *value* is deliberately never read here: DSH's own credential
 * provider resolves the reference inside the observation home, so the
 * controller never parses, holds, or logs a secret.
 *
 * @param {{ref?: string, env?: Record<string, string | undefined>, home?: string}} [input]
 */
export function credentialSources({ ref = H2_POLICY.model.credentialRef, env = process.env, home = operatorHome(env) } = {}) {
  const fromEnv = typeof env[ref] === 'string' && env[ref].length > 0
  const document = join(home, H2_CREDENTIALS_FILENAME)
  const fromDocument = existsSync(document)
  return Object.freeze({
    ref,
    environment: fromEnv ? 'present' : 'missing',
    document: fromDocument ? document : null,
    providerHome: home,
    resolvable: fromEnv || fromDocument,
  })
}

/**
 * Copies the operator's credential document into an observation home.
 *
 * DSH resolves a credential reference from the inherited environment first and
 * from `$DSH_HOME/.credentials.yaml` second. A fresh observation home inherits
 * the operator environment but not the operator home, so a route whose
 * credential lives only in the store would fail there; copying the document is
 * what makes the observation self-sufficient. The document holds nothing but
 * credentials by DSH's own contract, it is readable only by its owner, and the
 * home is disposable — `cleanup: 'scratch'` deletes it after the observation.
 *
 * @param {{dshHome: string, home?: string, env?: Record<string, string | undefined>}} input
 */
export function seedRouteCredentials({ dshHome, home = operatorHome(), env = process.env }) {
  const sources = credentialSources({ env, home })
  if (sources.environment === 'present') return Object.freeze({ seeded: false, from: 'environment', ref: sources.ref })
  if (sources.document === null) {
    throw new Error(
      `H2 observation home has no credential for the frozen route: ${sources.ref} is neither exported in the operator environment `
      + `nor stored in ${join(home, H2_CREDENTIALS_FILENAME)}. Export it, or store it through DSH, before spending an observation.`,
    )
  }
  const target = join(dshHome, H2_CREDENTIALS_FILENAME)
  copyFileSync(sources.document, target)
  // The credential provider refuses a document other OS users can read, and a
  // copied file carries whatever mode the source had.
  chmodSync(target, 0o600)
  return Object.freeze({ seeded: true, from: 'document', ref: sources.ref })
}
