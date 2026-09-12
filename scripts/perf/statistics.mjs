function finiteSample(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Performance statistics require a non-empty sample')
  }
  if (values.some(value => !Number.isFinite(value))) {
    throw new Error('Performance statistics require finite numbers')
  }
  return [...values].toSorted((left, right) => left - right)
}

export function percentile(values, requestedPercentile) {
  if (!Number.isFinite(requestedPercentile) || requestedPercentile < 0 || requestedPercentile > 1) {
    throw new Error(`Performance percentile must be between 0 and 1, received ${String(requestedPercentile)}`)
  }
  const sorted = finiteSample(values)
  const rank = requestedPercentile === 0 ? 1 : Math.ceil(requestedPercentile * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

export function summarizeNumbers(values) {
  const sorted = finiteSample(values)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return Object.freeze({
    count: sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    mean: total / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  })
}
