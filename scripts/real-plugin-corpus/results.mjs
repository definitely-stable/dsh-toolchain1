const TARGET_FINGERPRINT = /^dsh-target-v2:[0-9a-f]{64}$/u
const SUBJECT_FINGERPRINT = /^dsh-plugin-subject-v1:[0-9a-f]{64}$/u
const ARTIFACT_FINGERPRINT = /^dsh-plugin-artifact-v1:[0-9a-f]{64}$/u
const LIFECYCLE_FINGERPRINT = /^dsh-profile-lifecycle-v1:[0-9a-f]{64}$/u

const STATIC_OUTCOMES = new Set(['compatible-in-scope', 'incompatible', 'unproven'])
const VERIFY_OUTCOMES = new Set(['verified', 'partial', 'failed'])

function parseProtocolJson(stdout) {
  let envelope
  try {
    envelope = JSON.parse(stdout)
  } catch (cause) {
    throw new Error('Toolchain child output is not Protocol JSON', { cause })
  }

  if (envelope?.protocolVersion !== '1') {
    throw new Error(`Invalid protocolVersion in Toolchain child output: ${String(envelope?.protocolVersion)}`)
  }
  if (envelope?.status !== 'ok') {
    throw new Error(`Toolchain operation envelope status is ${String(envelope?.status)}`)
  }
  if (!TARGET_FINGERPRINT.test(envelope?.snapshotFingerprint ?? '')) {
    throw new Error('Toolchain child output is missing a valid target fingerprint')
  }
  if (typeof envelope?.data !== 'object' || envelope.data === null) {
    throw new Error('Toolchain child output is missing data')
  }

  return envelope
}

function resultShape({
  kind,
  semanticOutcome,
  targetFingerprint,
  subjectFingerprint,
  artifactFingerprint,
  lifecycleFingerprint,
  cleanup,
  checks,
  requirements,
  diagnostics,
}) {
  return Object.freeze({
    kind,
    semanticOutcome,
    harnessFailure: false,
    targetFingerprint,
    subjectFingerprint,
    artifactFingerprint,
    lifecycleFingerprint,
    cleanup,
    checks,
    requirements,
    diagnostics,
  })
}

export function parseToolchainEnvelope(stdout, kind) {
  const envelope = parseProtocolJson(stdout)

  if (kind === 'plugin.check') {
    const verdict = envelope.data.verdict
    if (!STATIC_OUTCOMES.has(verdict)) {
      throw new Error(`Invalid plugin.check verdict: ${String(verdict)}`)
    }
    if (!SUBJECT_FINGERPRINT.test(envelope.data.subjectFingerprint ?? '')) {
      throw new Error('plugin.check is missing a valid subject fingerprint')
    }
    if (envelope.data.candidateCodeExecuted !== false) {
      throw new Error('plugin.check unexpectedly executed candidate code')
    }
    if (envelope.data.subjectCompleteness !== 'complete') {
      throw new Error(`plugin.check subject completeness is ${String(envelope.data.subjectCompleteness)}`)
    }
    if (!Array.isArray(envelope.data.requirements)) {
      throw new Error('plugin.check is missing requirement analysis')
    }
    if (!Array.isArray(envelope.diagnostics)) {
      throw new Error('plugin.check is missing Protocol diagnostics')
    }

    return resultShape({
      kind,
      semanticOutcome: verdict,
      targetFingerprint: envelope.snapshotFingerprint,
      subjectFingerprint: envelope.data.subjectFingerprint,
      artifactFingerprint: undefined,
      lifecycleFingerprint: undefined,
      cleanup: undefined,
      checks: undefined,
      requirements: envelope.data.requirements,
      diagnostics: envelope.diagnostics,
    })
  }

  if (kind === 'plugin.verify') {
    const status = envelope.data.status
    if (!VERIFY_OUTCOMES.has(status)) {
      throw new Error(`Invalid plugin.verify status: ${String(status)}`)
    }
    if (envelope.data.cleanup !== 'succeeded') {
      throw new Error(`plugin.verify cleanup is ${String(envelope.data.cleanup)}`)
    }
    if (!ARTIFACT_FINGERPRINT.test(envelope.data.artifactFingerprint ?? '')) {
      throw new Error('plugin.verify is missing a valid artifact fingerprint')
    }
    if (!LIFECYCLE_FINGERPRINT.test(envelope.data.lifecycleFingerprint ?? '')) {
      throw new Error('plugin.verify is missing a valid lifecycle fingerprint')
    }
    if (!Array.isArray(envelope.data.checks)) {
      throw new Error('plugin.verify is missing canonical checks')
    }

    return resultShape({
      kind,
      semanticOutcome: status,
      targetFingerprint: envelope.snapshotFingerprint,
      subjectFingerprint: undefined,
      artifactFingerprint: envelope.data.artifactFingerprint,
      lifecycleFingerprint: envelope.data.lifecycleFingerprint,
      cleanup: envelope.data.cleanup,
      checks: envelope.data.checks,
      requirements: undefined,
      diagnostics: Array.isArray(envelope.data.diagnostics) ? envelope.data.diagnostics : [],
    })
  }

  throw new Error(`Unknown Toolchain operation kind: ${String(kind)}`)
}

export function summarizeCorpusResults(records) {
  const summary = {
    totalRecords: 0,
    harnessFailures: 0,
    staticVerdicts: {
      'compatible-in-scope': 0,
      incompatible: 0,
      unproven: 0,
    },
    verificationStatuses: {
      verified: 0,
      partial: 0,
      failed: 0,
    },
  }

  for (const record of records) {
    summary.totalRecords += 1
    if (record?.harnessFailure === true) {
      summary.harnessFailures += 1
      continue
    }

    if (record?.operation === 'plugin.check' && record.semanticOutcome in summary.staticVerdicts) {
      summary.staticVerdicts[record.semanticOutcome] += 1
    }
    if (record?.operation === 'plugin.verify' && record.semanticOutcome in summary.verificationStatuses) {
      summary.verificationStatuses[record.semanticOutcome] += 1
    }
  }

  return Object.freeze({
    ...summary,
    staticVerdicts: Object.freeze({ ...summary.staticVerdicts }),
    verificationStatuses: Object.freeze({ ...summary.verificationStatuses }),
  })
}
