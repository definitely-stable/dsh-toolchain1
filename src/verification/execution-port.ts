import type {
  PluginVerificationExecutionInput,
  PluginVerificationExecutionPort,
} from '../model/plugin-verify.js'
import {
  runPackedPluginVerification,
  type PackedPluginVerificationExecution,
  type PackedPluginVerificationInput,
} from './packed-worker.js'

export type PackedPluginVerificationRunner = (
  input: PackedPluginVerificationInput,
  signal?: AbortSignal,
) => Promise<PackedPluginVerificationExecution>

const defaultRunner: PackedPluginVerificationRunner = (input, signal) =>
  runPackedPluginVerification(input, {}, signal)

export function createPackedPluginVerificationExecutionPort(
  runner: PackedPluginVerificationRunner = defaultRunner,
): PluginVerificationExecutionPort {
  return Object.freeze({
    async verify(input: PluginVerificationExecutionInput, signal?: AbortSignal) {
      const execution = await runner({
        artifact: {
          path: input.artifactPath,
          expectedContentHash: input.expectedContentHash,
        },
        target: input.target,
        executionPolicy: input.executionPolicy,
        ...(input.visibilityAssertions === undefined
          ? {}
          : { visibilityAssertions: input.visibilityAssertions }),
      }, signal)

      return Object.freeze({
        ...(execution.artifactFingerprint === undefined
          ? {}
          : { artifactFingerprint: execution.artifactFingerprint }),
        targetFingerprint: execution.targetFingerprint,
        ...(execution.lifecycleFingerprint === undefined
          ? {}
          : { lifecycleFingerprint: execution.lifecycleFingerprint }),
        executionPolicy: execution.executionPolicy,
        checks: execution.checks,
        diagnostics: execution.diagnostics,
        cleanup: execution.cleanup,
        terminal: execution.terminal,
      })
    },
  })
}
