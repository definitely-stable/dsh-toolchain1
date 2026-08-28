import type { ModelVisibleTool } from './m2-agent-execution-evidence.js'
import type { OrdinaryWorkspace, OrdinaryWorkspaceFile } from './m2-agent-ordinary-workspace.js'

const READ_DEFAULT_LINES = 120
const READ_MAX_LINES = 200
const SEARCH_DEFAULT_LIMIT = 20
const SEARCH_MAX_LIMIT = 50
const SEARCH_MAX_QUERY_BYTES = 128
const SEARCH_MAX_EXCERPT_CHARS = 400
const VIRTUAL_PREFIX_ROOT = '/exact-target/'

interface OrdinaryToolDefinition extends ModelVisibleTool {
  execute(input: unknown): Promise<unknown>
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertClosedFields(record: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} contains forbidden field: ${key}`)
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function optionalPositiveInteger(
  value: unknown,
  fallback: number,
  max: number,
  label: string,
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}`)
  }
  return value
}

function assertVirtualPath(path: string, label: string): void {
  if (path.includes('\\') || path.includes('\0')) throw new Error(`${label} contains an invalid path separator`)
  if (!path.startsWith(VIRTUAL_PREFIX_ROOT)) throw new Error(`${label} must stay under /exact-target`)
  if (path.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error(`${label} path traversal is forbidden`)
  }
}

function logicalLines(content: string): readonly string[] {
  const lines = content.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') return lines.slice(0, -1)
  return lines
}

function fileMap(workspace: OrdinaryWorkspace): ReadonlyMap<string, OrdinaryWorkspaceFile> {
  return new Map(workspace.files.map(file => [file.path, file]))
}

function boundedExcerpt(line: string): string {
  return Array.from(line).slice(0, SEARCH_MAX_EXCERPT_CHARS).join('')
}

export function createOrdinaryReadToolDefinition(workspace: OrdinaryWorkspace): OrdinaryToolDefinition {
  const byPath = fileMap(workspace)
  return {
    family: 'ordinary',
    name: 'read_file',
    description: 'Read a bounded line window from one file in the frozen exact-target workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        lineCount: { type: 'integer', minimum: 1, maximum: READ_MAX_LINES },
      },
      required: ['path'],
    },
    async execute(input: unknown): Promise<unknown> {
      const request = requireRecord(input, 'read_file input')
      assertClosedFields(request, new Set(['path', 'startLine', 'lineCount']), 'read_file input')
      const path = requireString(request.path, 'read_file path')
      assertVirtualPath(path, 'read_file path')
      const startLine = optionalPositiveInteger(request.startLine, 1, Number.MAX_SAFE_INTEGER, 'read_file startLine')
      const lineCount = optionalPositiveInteger(request.lineCount, READ_DEFAULT_LINES, READ_MAX_LINES, 'read_file lineCount')
      const file = byPath.get(path)
      if (file === undefined) throw new Error(`read_file path not found in frozen workspace: ${path}`)
      const lines = logicalLines(file.content)
      if (startLine > lines.length) {
        throw new Error(`read_file startLine ${startLine} exceeds file line count ${lines.length}`)
      }
      const endLine = Math.min(lines.length, startLine + lineCount - 1)
      return {
        path,
        sha256: file.sha256,
        startLine,
        endLine,
        totalLines: lines.length,
        content: lines.slice(startLine - 1, endLine).join('\n'),
      }
    },
  }
}

export function createOrdinarySearchToolDefinition(workspace: OrdinaryWorkspace): OrdinaryToolDefinition {
  return {
    family: 'ordinary',
    name: 'search_text',
    description: 'Search frozen exact-target files using deterministic case-insensitive literal line matching.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1 },
        pathPrefix: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: SEARCH_MAX_LIMIT },
      },
      required: ['query'],
    },
    async execute(input: unknown): Promise<unknown> {
      const request = requireRecord(input, 'search_text input')
      assertClosedFields(request, new Set(['query', 'pathPrefix', 'limit']), 'search_text input')
      const query = requireString(request.query, 'search_text query')
      const queryBytes = new TextEncoder().encode(query).byteLength
      if (queryBytes > SEARCH_MAX_QUERY_BYTES) {
        throw new Error(`search_text query must be at most ${SEARCH_MAX_QUERY_BYTES} UTF-8 bytes`)
      }
      const pathPrefix = request.pathPrefix === undefined
        ? undefined
        : requireString(request.pathPrefix, 'search_text pathPrefix')
      if (pathPrefix !== undefined) assertVirtualPath(pathPrefix, 'search_text pathPrefix')
      const limit = optionalPositiveInteger(request.limit, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, 'search_text limit')
      const needle = query.toLocaleLowerCase('en-US')
      const matches: Array<{ path: string; line: number; column: number; text: string }> = []

      for (const file of workspace.files) {
        if (pathPrefix !== undefined && !file.path.startsWith(pathPrefix)) continue
        const lines = logicalLines(file.content)
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]!
          const columnIndex = line.toLocaleLowerCase('en-US').indexOf(needle)
          if (columnIndex < 0) continue
          matches.push({
            path: file.path,
            line: index + 1,
            column: columnIndex + 1,
            text: boundedExcerpt(line),
          })
        }
      }

      return {
        query,
        matches: matches.slice(0, limit),
        truncated: matches.length > limit,
      }
    },
  }
}
