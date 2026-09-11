const PROFILE_NAMES = Object.freeze(['smoke', 'benchmark', 'stress'])

const PROFILES = Object.freeze({
  smoke: Object.freeze({
    name: 'smoke',
    warmups: 1,
    iterations: 3,
    scale: 1,
    concurrency: Object.freeze([1]),
  }),
  benchmark: Object.freeze({
    name: 'benchmark',
    warmups: 2,
    iterations: 10,
    scale: 2,
    concurrency: Object.freeze([1, 4]),
  }),
  stress: Object.freeze({
    name: 'stress',
    warmups: 2,
    iterations: 20,
    scale: 4,
    concurrency: Object.freeze([1, 4, 8]),
  }),
})

export function listPerfProfiles() {
  return [...PROFILE_NAMES]
}

export function getPerfProfile(name) {
  if (typeof name !== 'string' || !(name in PROFILES)) {
    throw new Error(`Unknown performance profile: ${String(name)}`)
  }
  return PROFILES[name]
}
