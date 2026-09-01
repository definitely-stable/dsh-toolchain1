import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DOMAINS = [
  'approval-policy',
  'approval-request',
  'scope-hierarchy',
  'scope-lifecycle',
  'session-reads',
  'session-search',
  'tool-runtime',
  'tool-schema',
] as const

export function syntheticCalibrationDataset(): Record<string, unknown> {
  const tasks = DOMAINS.flatMap(domain => Array.from({ length: 12 }, (_, index) => ({
    id: `${domain}-${String(index + 1).padStart(2, '0')}`,
    domain,
    prompt: `Check ${domain} calibration task ${index + 1}.`,
    successRule: {
      kind: 'api-exists-any',
      package: '@deepseek-ai/dsh',
      symbols: [`Synthetic${index + 1}`],
    },
  })))

  return {
    schema: 'dsh-toolchain-m2-agent-dataset-v2',
    datasetId: 'H1',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: 'dsh-target-v2:synthetic',
      contractIndexFingerprint: 'dsh-contract-index-v1:synthetic',
    },
    taskCount: tasks.length,
    tasks,
  }
}

export async function writeSyntheticCalibrationDataset(): Promise<{ readonly root: string; readonly path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-test-'))
  const path = join(root, 'dataset.json')
  await writeFile(path, JSON.stringify(syntheticCalibrationDataset()), 'utf8')
  return { root, path }
}