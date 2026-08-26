import type {
  Evidence,
  ResolvedPackageIdentity,
  TargetResolveRequest,
  TargetResolveResult,
  TargetSnapshot,
} from '../protocol/index.js'
import { TOOLCHAIN_PROTOCOL_VERSION } from '../protocol/index.js'
import { TOOLCHAIN_PRODUCT, TOOLCHAIN_VERSION } from '../product.js'
import type { Sha256Port } from '../model/digest.js'
import {
  createTargetSemanticProjectionV1,
  fingerprintTarget,
  type AcquiredTargetFacts,
  type TargetAcquisitionPort,
  type TargetSemanticProjectionV1,
} from '../model/target.js'

export interface KernelDescriptor {
  readonly product: typeof TOOLCHAIN_PRODUCT
  readonly version: typeof TOOLCHAIN_VERSION
  readonly protocolVersion: typeof TOOLCHAIN_PROTOCOL_VERSION
}

export interface ApplicationKernel {
  describe(): KernelDescriptor
  resolveTarget(request: TargetResolveRequest): Promise<TargetResolveResult>
}

export interface ApplicationKernelOptions {
  readonly targetAcquisition: TargetAcquisitionPort
  readonly digest: Sha256Port
  readonly now?: () => string
}

const descriptor: KernelDescriptor = Object.freeze({
  product: TOOLCHAIN_PRODUCT,
  version: TOOLCHAIN_VERSION,
  protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
})

function freezeIdentity(identity: ResolvedPackageIdentity): ResolvedPackageIdentity {
  return Object.freeze({ name: identity.name, version: identity.version })
}

function freezeEvidence(item: Evidence): Evidence {
  return Object.freeze({ ...item })
}

function createSnapshot(
  facts: AcquiredTargetFacts,
  projection: TargetSemanticProjectionV1,
  fingerprint: string,
  createdAt: string,
): TargetSnapshot {
  const bundles = projection.profile.bundles.map(freezeIdentity)
  const dependencies = projection.profile.dependencies.map(freezeIdentity)
  const evidence = facts.evidence.map(freezeEvidence)
  Object.freeze(bundles)
  Object.freeze(dependencies)
  Object.freeze(evidence)

  return Object.freeze({
    fingerprint,
    createdAt,
    dsh: Object.freeze({ ...projection.dsh }),
    runtime: Object.freeze({ ...projection.runtime }),
    profile: Object.freeze({
      name: projection.profile.name,
      bundles,
      dependencies,
      patchHash: projection.profile.patchHash,
    }),
    ...(facts.supportStatus === undefined ? {} : { supportStatus: facts.supportStatus }),
    evidence,
  })
}

export function createApplicationKernel(options: ApplicationKernelOptions): ApplicationKernel {
  const now = options.now ?? (() => new Date().toISOString())

  return Object.freeze({
    describe: () => descriptor,
    async resolveTarget(request: TargetResolveRequest): Promise<TargetResolveResult> {
      const facts = await options.targetAcquisition.acquire(request)
      const projection = createTargetSemanticProjectionV1(facts)
      const fingerprint = await fingerprintTarget(projection, options.digest)
      const snapshot = createSnapshot(facts, projection, fingerprint, now())
      return Object.freeze({ snapshot })
    },
  })
}
