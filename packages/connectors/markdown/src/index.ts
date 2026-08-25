import { z } from 'zod'
import type { DocumentType, NormalizedKnowledgeDocument } from '@context-connect/contracts'
import { asIsoTimestamp } from '@context-connect/connectors'
import { stableChecksum, stableId } from '@context-connect/knowledge'

const DocumentTypeSchema = z.enum([
  'task',
  'pull_request',
  'commit',
  'review',
  'document',
  'incident',
])

export const MarkdownNormalizerConfigSchema = z.object({
  scope: z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    sourceConnectionId: z.string().min(1),
    visibilityScope: z.object({
      workspaceIds: z.array(z.string()).default([]),
      projectIds: z.array(z.string()).default([]),
      sourceConnectionIds: z.array(z.string()).default([]),
    }),
  }),
  canonicalBaseUrl: z.string().url().default('https://context-connect.invalid/markdown/'),
  defaultType: DocumentTypeSchema.default('document'),
})
export type MarkdownNormalizerConfig = z.infer<typeof MarkdownNormalizerConfigSchema>

export interface MarkdownInput {
  sourcePath: string
  content: string
  canonicalUrl?: string
  modifiedAt?: string
}

export interface ParsedFrontMatter {
  attributes: Record<string, unknown>
  body: string
}

function scalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => scalar(item))
      .filter((item) => item !== '')
  }
  return trimmed
}

/** Minimal deterministic YAML front matter parser for scalar values and lists. */
export function parseFrontMatter(content: string): ParsedFrontMatter {
  const normalized = content.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return { attributes: {}, body: normalized }
  }
  const lines = normalized.split(/\r?\n/)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex < 0) throw new TypeError('Markdown front matter is not terminated')
  const attributes: Record<string, unknown> = {}
  let activeList: string | undefined
  for (const line of lines.slice(1, closingIndex)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const list = line.match(/^\s*-\s+(.+)$/)
    if (list && activeList) {
      const current = attributes[activeList]
      attributes[activeList] = [...(Array.isArray(current) ? current : []), scalar(list[1]!)]
      continue
    }
    const pair = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (!pair) throw new TypeError(`Unsupported Markdown front matter line: ${line}`)
    const [, key, value] = pair
    activeList = key
    attributes[key!] = value ? scalar(value) : []
  }
  return {
    attributes,
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .trimStart(),
  }
}

function validUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return new URL(value).toString()
  } catch {
    return undefined
  }
}

function firstHeading(body: string): string | undefined {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim()
}

function pathTitle(path: string): string {
  const fileName = path.split('/').pop() ?? path
  return fileName.replace(/\.(md|markdown)$/i, '').replace(/[-_]+/g, ' ')
}

function documentType(value: unknown, fallback: DocumentType): DocumentType {
  const parsed = DocumentTypeSchema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

export async function normalizeMarkdown(
  input: MarkdownInput,
  rawConfig: MarkdownNormalizerConfig,
): Promise<NormalizedKnowledgeDocument> {
  const config = MarkdownNormalizerConfigSchema.parse(rawConfig)
  const { attributes, body } = parseFrontMatter(input.content)
  const contentChecksum = await stableChecksum(input.content)
  const suppliedId = typeof attributes.id === 'string' ? attributes.id.trim() : ''
  const externalId = suppliedId
    ? `markdown:${suppliedId}`
    : `markdown-path:${(await stableChecksum(input.sourcePath.normalize('NFC'))).slice(0, 32)}`
  const id = await stableId('document', {
    tenantId: config.scope.tenantId,
    source: 'markdown',
    externalId,
  })
  const modifiedAt = asIsoTimestamp(
    input.modifiedAt ??
      (typeof attributes.updatedAt === 'string' ? attributes.updatedAt : undefined),
    new Date(0).toISOString(),
  )
  const createdAt = asIsoTimestamp(
    typeof attributes.createdAt === 'string' ? attributes.createdAt : undefined,
    modifiedAt,
  )
  const title =
    typeof attributes.title === 'string' && attributes.title.trim()
      ? attributes.title.trim()
      : (firstHeading(body) ?? pathTitle(input.sourcePath))
  const canonicalUrl =
    validUrl(input.canonicalUrl) ??
    validUrl(attributes.canonicalUrl) ??
    new URL(
      input.sourcePath.split('/').map(encodeURIComponent).join('/'),
      config.canonicalBaseUrl,
    ).toString()

  return {
    id,
    tenantId: config.scope.tenantId,
    workspaceId: config.scope.workspaceId,
    projectId:
      typeof attributes.projectId === 'string' ? attributes.projectId : config.scope.projectId,
    sourceConnectionId: config.scope.sourceConnectionId,
    source: 'markdown',
    type: documentType(attributes.type, config.defaultType),
    externalId,
    canonicalUrl,
    title,
    content: body,
    authorId: typeof attributes.author === 'string' ? attributes.author : undefined,
    createdAt,
    updatedAt: modifiedAt,
    metadata: { ...attributes, sourcePath: input.sourcePath },
    visibilityScope: config.scope.visibilityScope,
    checksum: contentChecksum,
    sourceRevision: typeof attributes.revision === 'string' ? attributes.revision : contentChecksum,
  }
}
