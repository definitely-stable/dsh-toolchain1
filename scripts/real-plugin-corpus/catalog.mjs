export const REAL_PLUGIN_CORPUS_DSH_VERSION = '0.1.5-rc.2'

const CORPUS = Object.freeze([
  Object.freeze({
    id: 'modlens',
    packageName: '@liustack/modlens',
    version: '3.26.1',
    sourceRepo: 'liustack/modlens',
    sourceRef: 'a1923d016c2b617ccd1d6ef3f9e9368622841e67',
    category: 'vision',
    distribution: 'npm',
    runtimeVerify: false,
  }),
  Object.freeze({
    id: 'better-sidebar',
    packageName: 'dsh-better-sidebar',
    version: '0.19.1',
    sourceRepo: 'omdsh-dev/DSH-better-sidebar',
    sourceRef: '1fcf43ccbedd6e66370b7fb81df2b4dd0ef2604e',
    category: 'ui-productivity',
    distribution: 'npm',
    runtimeVerify: false,
  }),
  Object.freeze({
    id: 'dsh-tui',
    packageName: '@deepseek-harness-tui/dsh-tui',
    version: '0.10.1',
    sourceRepo: 'ccch1mneyyy/dsh-TUI',
    sourceRef: 'ece45c2eb3b861b768000675b840679ed90bd650',
    category: 'terminal',
    distribution: 'npm',
    runtimeVerify: false,
  }),
  Object.freeze({
    id: 'dsh-market',
    packageName: 'dshmarket',
    version: '1.45.1',
    sourceRepo: 'dsh-market/dsh-market',
    sourceRef: 'f33c7fbe7dec0d826025383c3b76f5ade5583d04',
    category: 'ui-productivity',
    distribution: 'npm',
    runtimeVerify: true,
  }),
  Object.freeze({
    id: 'agent-teams',
    packageName: '@nanmicoder/dsh-agent-teams',
    version: '0.1.17',
    sourceRepo: 'NanmiCoder/dsh-agent-teams',
    sourceRef: '18fba6211fc3aac305fc9bb1c8a7faaf7273137a',
    category: 'skills-workflows',
    distribution: 'npm',
    runtimeVerify: true,
  }),
  Object.freeze({
    id: 'at-file',
    packageName: 'dsh-at-file',
    version: '0.7.0',
    sourceRepo: 'FSMargoo/dsh-at-file',
    sourceRef: 'da602d1a8f1b417b8a1d8d4059e0f4cb1c353524',
    category: 'developer-tools',
    distribution: 'github-source',
    runtimeVerify: true,
  }),
])

const MODES = Object.freeze(['smoke', 'static', 'full'])
const SMOKE_IDS = new Set(['modlens', 'at-file'])

function selectedEntry(entry, runtimeExecution) {
  return Object.freeze({
    ...entry,
    runtimeExecution,
  })
}

export function listRealPluginCorpus() {
  return [...CORPUS]
}

export function selectRealPluginCorpus(mode) {
  if (typeof mode !== 'string' || !MODES.includes(mode)) {
    throw new Error(`Unknown real plugin corpus mode: ${String(mode)}`)
  }

  const entries = mode === 'smoke'
    ? CORPUS.filter(entry => SMOKE_IDS.has(entry.id))
    : CORPUS

  return entries.map(entry => selectedEntry(
    entry,
    mode === 'full' && entry.runtimeVerify,
  ))
}
