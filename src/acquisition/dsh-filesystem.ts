import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Evidence, ResolvedPackageIdentity, TargetResolveRequest } from '../protocol/index.js'
import {
  TargetAcquisitionError,
  type TargetAcquisitionErrorCode,
  type TargetAcquisitionPort,
} from '../model/target.js'
import type { Sha256Port } from '../model/digest.js'
import { createNodeSha256Port } from './node-sha256.js'

const DSH_PACKAGE = '@deepseek-ai/dsh'
const ABSENT_PATCH_SENTINEL = 'dsh-target-v1:profile-patch:absent'

interface RuntimeFacts {
  readonly nodeVersion: string
  readonly platform: string
  readonly arch: string
}

interface AcquisitionOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly runtime?: RuntimeFacts
  readonly digest?: Sha256Port
}

interface ManifestRecord {
  readonly location: string
  readonly content: string
  readonly value: Record<string, unknown>
}

function acquisitionError(
  code: TargetAcquisitionErrorCode,
  message: string,
  locations: readonly string[],
  cause?: unknown,
): TargetAcquisitionError {
  return new TargetAcquisitionError(code, message, locations, cause === undefined ? undefined : { cause })
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function expandTilde(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2))
  return value
}

function absolutePath(value: string): string {
  return path.resolve(expandTilde(value))
}

function resolveDshHome(request: TargetResolveRequest, env: Readonly<Record<string, string | undefined>>): string {
  const configured = request.dshHome ?? (env.DSH_HOME?.trim() || path.join(homedir(), '.dsh'))
  return absolutePath(configured)
}

function validateProfile(profile: string): void {
  if (
    profile.length === 0 ||
    profile === '.' ||
    profile === '..' ||
    profile === 'node_modules' ||
    profile.includes('/') ||
    profile.includes('\\')
  ) {
    throw acquisitionError('TARGET_PROFILE_INVALID', `Invalid DSH profile name: ${profile}`, [profile])
  }
}

async function readUtf8(location: string): Promise<string> {
  try {
    return await readFile(location, 'utf8')
  } catch (cause) {
    throw acquisitionError(
      'TARGET_EVIDENCE_READ_FAILED',
      `Could not read target evidence: ${location}`,
      [location],
      cause,
    )
  }
}

async function readManifest(location: string): Promise<ManifestRecord> {
  const content = await readUtf8(location)
  try {
    const value: unknown = JSON.parse(content)
    if (!isRecord(value)) throw new TypeError('Package manifest must contain a JSON object')
    return { location, content, value }
  } catch (cause) {
    if (cause instanceof TargetAcquisitionError) throw cause
    throw acquisitionError(
      'TARGET_MANIFEST_INVALID',
      `Target package manifest is invalid: ${location}`,
      [location],
      cause,
    )
  }
}

function packageIdentity(manifest: ManifestRecord, expectedName: string): ResolvedPackageIdentity {
  const { name, version } = manifest.value
  if (name !== expectedName || typeof version !== 'string' || version.length === 0) {
    throw acquisitionError(
      'TARGET_MANIFEST_INVALID',
      `Expected ${expectedName} with an exact version in ${manifest.location}`,
      [manifest.location],
    )
  }
  return { name: expectedName, version }
}

function bundleIdentity(manifest: ManifestRecord, expectedName: string): ResolvedPackageIdentity {
  const identity = packageIdentity(manifest, expectedName)
  const dsh = manifest.value.dsh
  const bundle = isRecord(dsh) ? dsh.bundle : undefined
  const patchDeclaration = isRecord(bundle) ? bundle.patch : undefined
  if (typeof patchDeclaration !== 'string' || patchDeclaration.length === 0) {
    throw acquisitionError(
      'TARGET_MANIFEST_INVALID',
      `Profile bundle ${expectedName} declares no DSH bundle patch in ${manifest.location}`,
      [manifest.location],
    )
  }
  return identity
}

async function packageManifestCandidates(packageName: string, anchor: string): Promise<string[]> {
  let canonicalAnchor: string
  try {
    canonicalAnchor = await realpath(anchor)
  } catch (cause) {
    throw acquisitionError(
      'TARGET_EVIDENCE_READ_FAILED',
      `Could not resolve target evidence path: ${anchor}`,
      [anchor],
      cause,
    )
  }

  // pnpm exposes packages through symlinks. Node follows the real package path
  // before resolving that package's own dependency graph, so inspection must
  // consider both the observed anchor and its canonical target. Evidence keeps
  // the observed path; canonicalization affects resolution only.
  const resolutionAnchors = canonicalAnchor === anchor ? [anchor] : [anchor, canonicalAnchor]
  return resolutionAnchors.flatMap(candidateAnchor => {
    const lookupPaths = createRequire(candidateAnchor).resolve.paths(packageName) ?? []
    return lookupPaths.map(directory => path.join(directory, packageName, 'package.json'))
  })
}

async function findPackageManifest(
  packageName: string,
  anchors: readonly string[],
  missingCode: 'TARGET_BUNDLE_NOT_FOUND' | 'TARGET_DEPENDENCY_NOT_FOUND' | 'TARGET_DSH_NOT_FOUND',
): Promise<ManifestRecord> {
  const candidateGroups = await Promise.all(
    anchors.map(anchor => packageManifestCandidates(packageName, anchor)),
  )
  const locations = [...new Set(candidateGroups.flat())]
  for (const location of locations) {
    try {
      return await readManifest(location)
    } catch (error) {
      if (error instanceof TargetAcquisitionError && isMissing(error.cause)) continue
      throw error
    }
  }
  throw acquisitionError(missingCode, `Could not resolve installed package ${packageName}`, locations)
}

async function resolveDshManifest(explicitRoot: string | undefined): Promise<ManifestRecord> {
  if (explicitRoot !== undefined) {
    const location = path.join(absolutePath(explicitRoot), 'package.json')
    try {
      return await readManifest(location)
    } catch (error) {
      if (error instanceof TargetAcquisitionError && isMissing(error.cause)) {
        throw acquisitionError('TARGET_DSH_NOT_FOUND', `DSH package root was not found: ${location}`, [location])
      }
      throw error
    }
  }
  return findPackageManifest(
    DSH_PACKAGE,
    [fileURLToPath(import.meta.url)],
    'TARGET_DSH_NOT_FOUND',
  )
}

function profilePackageNames(manifest: ManifestRecord): {
  readonly bundles: readonly string[]
  readonly dependencies: readonly string[]
} {
  const dsh = manifest.value.dsh
  const profile = isRecord(dsh) ? dsh.profile : undefined
  const bundles = isRecord(profile) ? profile.bundles ?? [] : []
  const dependencies = manifest.value.dependencies ?? {}
  if (
    (dsh !== undefined && !isRecord(dsh)) ||
    (profile !== undefined && !isRecord(profile)) ||
    !Array.isArray(bundles) || !bundles.every(name => typeof name === 'string' && name.length > 0) ||
    !isRecord(dependencies) || !Object.values(dependencies).every(range => typeof range === 'string')
  ) {
    throw acquisitionError(
      'TARGET_MANIFEST_INVALID',
      `DSH profile manifest is invalid: ${manifest.location}`,
      [manifest.location],
    )
  }
  return { bundles, dependencies: Object.keys(dependencies) }
}

async function evidence(
  id: string,
  source: string,
  manifest: ManifestRecord,
  digest: Sha256Port,
): Promise<Evidence> {
  return {
    id,
    kind: 'manifest',
    strength: 'authoritative',
    source,
    contentHash: await digest.sha256Utf8(manifest.content),
    location: manifest.location,
  }
}

export function createDshFilesystemTargetAcquisition(
  options: AcquisitionOptions = {},
): TargetAcquisitionPort {
  const env = options.env ?? process.env
  const runtime = options.runtime ?? {
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }
  const digest = options.digest ?? createNodeSha256Port()

  return {
    async acquire(request) {
      validateProfile(request.profile)
      const dshHome = resolveDshHome(request, env)
      const profileManifestLocation = path.join(dshHome, 'profiles', request.profile, 'package.json')
      const profileDirectory = path.dirname(profileManifestLocation)
      const dshManifest = await resolveDshManifest(request.dshPackageRoot)
      const dshIdentity = packageIdentity(dshManifest, DSH_PACKAGE)
      const dsh = { name: DSH_PACKAGE, version: dshIdentity.version } as const

      let profileManifest: ManifestRecord
      try {
        profileManifest = await readManifest(profileManifestLocation)
      } catch (error) {
        if (error instanceof TargetAcquisitionError && isMissing(error.cause)) {
          throw acquisitionError(
            'TARGET_PROFILE_NOT_FOUND',
            `DSH profile was not found: ${profileManifestLocation}`,
            [profileManifestLocation],
          )
        }
        throw error
      }

      const names = profilePackageNames(profileManifest)
      const patchLocation = path.join(profileDirectory, 'cordis.patch.yml')
      let patchContent: string | undefined
      try {
        patchContent = await readFile(patchLocation, 'utf8')
      } catch (cause) {
        if (!isMissing(cause)) {
          throw acquisitionError(
            'TARGET_EVIDENCE_READ_FAILED',
            `Could not read target evidence: ${patchLocation}`,
            [patchLocation],
            cause,
          )
        }
      }
      const patchHash = await digest.sha256Utf8(patchContent ?? ABSENT_PATCH_SENTINEL)

      const bundleManifests = await Promise.all(names.bundles.map(name =>
        findPackageManifest(
          name,
          [dshManifest.location, profileManifest.location],
          'TARGET_BUNDLE_NOT_FOUND',
        ),
      ))
      const dependencyManifests = await Promise.all(names.dependencies.map(name =>
        findPackageManifest(name, [profileManifest.location], 'TARGET_DEPENDENCY_NOT_FOUND'),
      ))
      const bundles = bundleManifests.map((manifest, index) =>
        bundleIdentity(manifest, names.bundles[index]!),
      )
      const dependencies = dependencyManifests.map((manifest, index) =>
        packageIdentity(manifest, names.dependencies[index]!),
      )

      const capturedEvidence: Evidence[] = [
        await evidence('manifest:dsh', DSH_PACKAGE, dshManifest, digest),
        await evidence('manifest:profile', `profile:${request.profile}`, profileManifest, digest),
        {
          id: 'patch:profile',
          kind: 'composed-config',
          strength: patchContent === undefined ? 'observed' : 'authoritative',
          source: `profile:${request.profile}:cordis.patch.yml`,
          contentHash: patchHash,
          location: patchLocation,
        },
      ]
      for (const [index, manifest] of bundleManifests.entries()) {
        const name = names.bundles[index]!
        capturedEvidence.push(await evidence(`manifest:bundle:${index}:${name}`, name, manifest, digest))
      }
      for (const [index, manifest] of dependencyManifests.entries()) {
        const name = names.dependencies[index]!
        capturedEvidence.push(await evidence(`manifest:dependency:${name}`, name, manifest, digest))
      }

      return {
        dsh,
        runtime: { ...runtime },
        profile: {
          name: request.profile,
          bundles,
          dependencies,
          patchHash,
        },
        evidence: capturedEvidence,
      }
    },
  }
}
