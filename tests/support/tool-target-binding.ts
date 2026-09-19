import type { DshAmbientTargetBindingPort } from '../../src/integrations/dsh/runtime-target-binding.js'

/**
 * Resolver-side stand-in for the native Agent Tool target binding.
 *
 * Tool specs assert argument shape, canonical request formation and rendering; how a running Host
 * proves its own immutable target epoch is covered by `tests/dsh/ambient-target-binding.spec.ts`
 * against the real port. This stub therefore only echoes a profile, so a spec that unexpectedly
 * relies on runtime proof fails loudly in the binding spec instead of passing here by accident.
 */
export function stubTargetBinding(ambientProfile = 'web'): DshAmbientTargetBindingPort {
  return Object.freeze({
    async targetRequest(profile?: string) {
      return Object.freeze({ profile: profile ?? ambientProfile })
    },
  })
}
