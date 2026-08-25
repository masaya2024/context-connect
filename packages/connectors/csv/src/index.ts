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

export const CsvNormalizerConfigSchema = z.object({
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
  mapping: z.object({
    externalId: z.string().min(1).optional(),
    title: z.string().min(1),
    content: z.string().min(1).optional(),
    canonicalUrl: z.string().min(1).optional(),
    authorId: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    sourceRevision: z.string().min(1).optional(),
    metadata: z.record(z.string()).default({}),
  }),
  delimiter: z.string().length(1).default(','),
  defaultType: DocumentTypeSchema.default('task'),
  canonicalBaseUrl: z.string().url().default('https://context-connect.invalid/imports/'),
})
export type CsvNormalizerConfig = z.infer<typeof CsvNormalizerConfigSchema>

export interface CsvImportInput {
  fileName: string
  content: string
  importedAt?: string
}

export interface ParsedCsv {
  headers: string[]
  rows: Array<Record<string, string>>
}

export function parseCsv(content: string, delimiter = ','): ParsedCsv {
  if (delimiter.length !== 1) throw new TypeError('CSV delimiter must be one character')
  const source = content.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  const finishField = () => {
    record.push(field)
    field = ''
  }
  const finishRecord = () => {
    finishField()
    if (record.some((value) => value.length > 0)) records.push(record)
    record = []
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }
    if (character === '"' && field.length === 0) quoted = true
    else if (character === delimiter) finishField()
    else if (character === '\n') finishRecord()
    else if (character !== '\r') field += character
  }
  if (quoted) throw new TypeError('CSV contains an unterminated quoted field')
  if (field.length > 0 || record.length > 0) finishRecord()
  if (records.length === 0) return { headers: [], rows: [] }

  const headers = records[0]!.map((header) => header.trim())
  if (headers.some((header) => !header)) throw new TypeError('CSV headers cannot be empty')
  if (new Set(headers).size !== headers.length) throw new TypeError('CSV headers must be unique')
  const rows = records.slice(1).map((values, rowIndex) => {
    if (values.length > headers.length)
      throw new TypeError(`CSV row ${rowIndex + 2} has too many columns`)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
  return { headers, rows }
}

function safeCanonicalUrl(value: string | undefined, fallback: string): string {
  if (value) {
    try {
      return new URL(value).toString()
    } catch {
      // An invalid source URL is preserved in metadata, never used as provenance.
    }
  }
  return fallback
}

function parseDocumentType(value: string | undefined, fallback: DocumentType): DocumentType {
  const parsed = DocumentTypeSchema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

export async function normalizeCsv(
  input: CsvImportInput,
  rawConfig: CsvNormalizerConfig,
): Promise<NormalizedKnowledgeDocument[]> {
  const config = CsvNormalizerConfigSchema.parse(rawConfig)
  const parsed = parseCsv(input.content, config.delimiter)
  const importedAt = asIsoTimestamp(input.importedAt, new Date().toISOString())
  const requiredColumns = [
    config.mapping.title,
    ...Object.values(config.mapping).filter((value) => typeof value === 'string'),
  ]
  for (const column of requiredColumns) {
    if (!parsed.headers.includes(column))
      throw new TypeError(`Mapped CSV column does not exist: ${column}`)
  }

  const documents: NormalizedKnowledgeDocument[] = []
  for (const [rowIndex, row] of parsed.rows.entries()) {
    const stableRowHash = await stableChecksum(row)
    const sourceId = config.mapping.externalId ? row[config.mapping.externalId]?.trim() : ''
    const externalId = sourceId ? `csv:${sourceId}` : `csv-hash:${stableRowHash.slice(0, 32)}`
    const id = await stableId('document', {
      tenantId: config.scope.tenantId,
      source: 'csv',
      externalId,
    })
    const title = row[config.mapping.title]?.trim() ?? ''
    const content = config.mapping.content ? (row[config.mapping.content] ?? '') : title
    const createdAt = asIsoTimestamp(
      config.mapping.createdAt ? row[config.mapping.createdAt] : undefined,
      importedAt,
    )
    const updatedAt = asIsoTimestamp(
      config.mapping.updatedAt ? row[config.mapping.updatedAt] : undefined,
      createdAt,
    )
    const projectId =
      (config.mapping.projectId ? row[config.mapping.projectId]?.trim() : '') ||
      config.scope.projectId
    const sourceUrl = config.mapping.canonicalUrl
      ? row[config.mapping.canonicalUrl]?.trim()
      : undefined
    const fallbackUrl = new URL(
      `${encodeURIComponent(input.fileName)}/${encodeURIComponent(externalId)}`,
      config.canonicalBaseUrl,
    ).toString()
    const mappedMetadata = Object.fromEntries(
      Object.entries(config.mapping.metadata).map(([metadataKey, column]) => [
        metadataKey,
        row[column] ?? '',
      ]),
    )

    documents.push({
      id,
      tenantId: config.scope.tenantId,
      workspaceId: config.scope.workspaceId,
      projectId,
      sourceConnectionId: config.scope.sourceConnectionId,
      source: 'csv',
      type: parseDocumentType(
        config.mapping.type ? row[config.mapping.type] : undefined,
        config.defaultType,
      ),
      externalId,
      canonicalUrl: safeCanonicalUrl(sourceUrl, fallbackUrl),
      title,
      content,
      authorId: config.mapping.authorId
        ? row[config.mapping.authorId]?.trim() || undefined
        : undefined,
      createdAt,
      updatedAt,
      metadata: {
        ...mappedMetadata,
        importFileName: input.fileName,
        rowNumber: rowIndex + 2,
        rawRow: row,
        invalidCanonicalUrl:
          sourceUrl && safeCanonicalUrl(sourceUrl, '') === '' ? sourceUrl : undefined,
      },
      visibilityScope: config.scope.visibilityScope,
      checksum: stableRowHash,
      sourceRevision:
        (config.mapping.sourceRevision ? row[config.mapping.sourceRevision]?.trim() : '') ||
        stableRowHash,
    })
  }
  return documents
}
