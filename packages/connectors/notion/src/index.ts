import { z } from 'zod'
import type { NormalizedKnowledgeDocument } from '@context-connect/contracts'
import {
  asIsoTimestamp,
  parseJsonResponse,
  type Connector,
  type ConnectorBatch,
  type ConnectorScope,
  type ConnectorValidation,
  type DiscoveredSource,
  type FetchLike,
  type IncrementalSyncInput,
} from '@context-connect/connectors'
import { normalizeNotionPageId, stableChecksum, stableId } from '@context-connect/knowledge'

export const NotionConnectorConfigSchema = z.object({
  token: z.string().min(1),
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
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(['database', 'page']),
        projectId: z.string().min(1).optional(),
      }),
    )
    .default([]),
  apiBaseUrl: z.string().url().default('https://api.notion.com'),
  notionVersion: z.string().default('2022-06-28'),
  pageSize: z.number().int().min(1).max(100).default(50),
})
export type NotionConnectorConfig = z.infer<typeof NotionConnectorConfigSchema>

export interface NotionRichText {
  plain_text: string
  href?: string | null
}

export interface NotionProperty {
  id: string
  type: string
  [key: string]: unknown
}

export interface NotionPage {
  object: 'page'
  id: string
  url: string
  created_time: string
  last_edited_time: string
  archived?: boolean
  in_trash?: boolean
  created_by?: { id: string }
  last_edited_by?: { id: string }
  parent: { type: string; database_id?: string; page_id?: string; workspace?: boolean }
  properties: Record<string, NotionProperty>
}

export interface NotionBlock {
  object: 'block'
  id: string
  type: string
  has_children: boolean
  created_time?: string
  last_edited_time?: string
  children?: NotionBlock[]
  [key: string]: unknown
}

interface NotionListResponse<T> {
  results: T[]
  has_more: boolean
  next_cursor: string | null
}

export interface NotionPageSnapshot {
  page: NotionPage
  blocks: NotionBlock[]
  sourceKind: 'database' | 'page'
  configuredSourceId?: string
}

interface SyncCursor {
  sourceIndex: number
  apiCursor?: string
}

function parseSyncCursor(value?: string): SyncCursor {
  if (!value) return { sourceIndex: 0 }
  const separator = value.indexOf(':')
  const sourceIndex = Number(separator < 0 ? value : value.slice(0, separator))
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0)
    throw new TypeError('Invalid Notion sync cursor')
  return {
    sourceIndex,
    apiCursor:
      separator < 0 ? undefined : decodeURIComponent(value.slice(separator + 1)) || undefined,
  }
}

function encodeSyncCursor(cursor: SyncCursor): string {
  return `${cursor.sourceIndex}:${cursor.apiCursor ? encodeURIComponent(cursor.apiCursor) : ''}`
}

function richText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .filter(
      (item): item is NotionRichText =>
        Boolean(item) && typeof item === 'object' && 'plain_text' in item,
    )
    .map((item) => item.plain_text)
    .join('')
}

function propertyValue(property: NotionProperty): unknown {
  const value = property[property.type]
  if (property.type === 'title' || property.type === 'rich_text') return richText(value)
  if (property.type === 'select' || property.type === 'status') {
    return value && typeof value === 'object' && 'name' in value
      ? (value as { name: unknown }).name
      : null
  }
  if (property.type === 'multi_select' && Array.isArray(value)) {
    return value
      .map((item) => (item && typeof item === 'object' && 'name' in item ? item.name : null))
      .filter(Boolean)
  }
  if (property.type === 'people' && Array.isArray(value)) {
    return value
      .map((person) => {
        if (!person || typeof person !== 'object') return null
        return 'name' in person && person.name ? person.name : 'id' in person ? person.id : null
      })
      .filter(Boolean)
  }
  if (property.type === 'relation' && Array.isArray(value)) {
    return value
      .map((relation) =>
        relation && typeof relation === 'object' && 'id' in relation ? relation.id : null,
      )
      .filter(Boolean)
  }
  if (property.type === 'date' && value && typeof value === 'object') {
    return { start: 'start' in value ? value.start : null, end: 'end' in value ? value.end : null }
  }
  if (property.type === 'formula' && value && typeof value === 'object' && 'type' in value) {
    return (value as Record<string, unknown>)[String(value.type)]
  }
  return value ?? null
}

function blockText(block: NotionBlock, depth = 0): string {
  const value = block[block.type]
  const blockValue = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const ownText =
    richText(blockValue.rich_text) ||
    (typeof blockValue.caption === 'string' ? blockValue.caption : '')
  const prefix =
    block.type === 'bulleted_list_item' ? '- ' : block.type === 'numbered_list_item' ? '1. ' : ''
  const codeSuffix =
    block.type === 'code' && typeof blockValue.language === 'string'
      ? ` [${blockValue.language}]`
      : ''
  const childText = (block.children ?? [])
    .map((child) => blockText(child, depth + 1))
    .filter(Boolean)
    .join('\n')
  return [`${'  '.repeat(depth)}${prefix}${ownText}${codeSuffix}`.trimEnd(), childText]
    .filter(Boolean)
    .join('\n')
}

function pageTitle(page: NotionPage): string {
  for (const property of Object.values(page.properties)) {
    if (property.type === 'title') return String(propertyValue(property) ?? '')
  }
  return 'Untitled'
}

export class NotionConnector implements Connector<NotionConnectorConfig, NotionPageSnapshot> {
  private readonly config: NotionConnectorConfig

  constructor(
    config: NotionConnectorConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.config = NotionConnectorConfigSchema.parse(config)
  }

  private async request<T>(
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    const response = await this.fetcher(new URL(path, this.config.apiBaseUrl), {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.config.token}`,
        'notion-version': this.config.notionVersion,
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    return parseJsonResponse<T>(response, `Notion ${path.split('?')[0]}`)
  }

  async validateConfig(): Promise<ConnectorValidation> {
    try {
      await this.request<{ id: string }>('/v1/users/me')
      return { valid: true, errors: [] }
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            code: 'notion_auth_failed',
            message: error instanceof Error ? error.message : 'Notion validation failed',
          },
        ],
      }
    }
  }

  async discover(cursor?: string): Promise<ConnectorBatch<DiscoveredSource>> {
    const response = await this.request<
      NotionListResponse<
        NotionPage | { object: 'database'; id: string; url: string; title: NotionRichText[] }
      >
    >('/v1/search', {
      method: 'POST',
      body: { page_size: this.config.pageSize, ...(cursor ? { start_cursor: cursor } : {}) },
    })
    return {
      items: response.results.map((item) => ({
        id: item.id,
        name: item.object === 'page' ? pageTitle(item) : richText(item.title),
        kind: item.object === 'page' ? 'notion_page' : 'notion_database',
        canonicalUrl: item.url,
        metadata: {},
      })),
      cursor: response.next_cursor ?? undefined,
      hasMore: response.has_more,
      fetchedAt: new Date().toISOString(),
    }
  }

  fullSync(cursor?: string): AsyncIterable<ConnectorBatch<NotionPageSnapshot>> {
    return this.sync(undefined, cursor)
  }

  incrementalSync(input: IncrementalSyncInput): AsyncIterable<ConnectorBatch<NotionPageSnapshot>> {
    return this.sync(input.since, input.cursor)
  }

  private async *sync(
    since?: string,
    encodedCursor?: string,
  ): AsyncIterable<ConnectorBatch<NotionPageSnapshot>> {
    const starting = parseSyncCursor(encodedCursor)
    for (
      let sourceIndex = starting.sourceIndex;
      sourceIndex < this.config.sources.length;
      sourceIndex += 1
    ) {
      const source = this.config.sources[sourceIndex]!
      if (source.kind === 'page') {
        const snapshot = await this.fetchPageSnapshot(source.id, 'page', source.id)
        const items =
          !since || new Date(snapshot.page.last_edited_time) > new Date(since) ? [snapshot] : []
        if (items.length > 0) {
          const next = { sourceIndex: sourceIndex + 1 }
          yield {
            items,
            cursor:
              next.sourceIndex < this.config.sources.length ? encodeSyncCursor(next) : undefined,
            hasMore: next.sourceIndex < this.config.sources.length,
            fetchedAt: new Date().toISOString(),
          }
        }
        continue
      }

      let apiCursor = sourceIndex === starting.sourceIndex ? starting.apiCursor : undefined
      for (;;) {
        const response = await this.request<NotionListResponse<NotionPage>>(
          `/v1/databases/${source.id}/query`,
          {
            method: 'POST',
            body: {
              page_size: this.config.pageSize,
              ...(apiCursor ? { start_cursor: apiCursor } : {}),
              ...(since
                ? {
                    filter: {
                      timestamp: 'last_edited_time',
                      last_edited_time: { on_or_after: asIsoTimestamp(since) },
                    },
                  }
                : {}),
            },
          },
        )
        const snapshots = await Promise.all(
          response.results.map((page) =>
            this.fetchPageSnapshot(page.id, 'database', source.id, page),
          ),
        )
        const next =
          response.has_more && response.next_cursor
            ? { sourceIndex, apiCursor: response.next_cursor }
            : { sourceIndex: sourceIndex + 1 }
        if (snapshots.length > 0) {
          yield {
            items: snapshots,
            cursor:
              next.sourceIndex < this.config.sources.length ? encodeSyncCursor(next) : undefined,
            hasMore: next.sourceIndex < this.config.sources.length,
            fetchedAt: new Date().toISOString(),
          }
        }
        if (!response.has_more || !response.next_cursor) break
        apiCursor = response.next_cursor
      }
    }
  }

  async fetchById(id: string): Promise<NotionPageSnapshot | null> {
    const pageId = normalizeNotionPageId(id)
    if (!pageId) throw new TypeError('Invalid Notion page id')
    try {
      return await this.fetchPageSnapshot(pageId, 'page')
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404)
        return null
      throw error
    }
  }

  private async fetchBlocks(blockId: string, depth = 0): Promise<NotionBlock[]> {
    if (depth > 8) return []
    const blocks: NotionBlock[] = []
    let cursor: string | undefined
    do {
      const response = await this.request<NotionListResponse<NotionBlock>>(
        `/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      for (const block of response.results) {
        blocks.push(
          block.has_children
            ? { ...block, children: await this.fetchBlocks(block.id, depth + 1) }
            : block,
        )
      }
      cursor = response.next_cursor ?? undefined
    } while (cursor)
    return blocks
  }

  private async fetchPageSnapshot(
    pageId: string,
    sourceKind: 'database' | 'page',
    configuredSourceId?: string,
    existingPage?: NotionPage,
  ): Promise<NotionPageSnapshot> {
    const page = existingPage ?? (await this.request<NotionPage>(`/v1/pages/${pageId}`))
    const blocks = await this.fetchBlocks(page.id)
    return { page, blocks, sourceKind, configuredSourceId }
  }

  async normalize(snapshot: NotionPageSnapshot): Promise<NormalizedKnowledgeDocument[]> {
    const scope: ConnectorScope = this.config.scope
    const pageId = normalizeNotionPageId(snapshot.page.id)
    if (!pageId) throw new TypeError(`Notion returned invalid page id: ${snapshot.page.id}`)
    const configuredSource = this.config.sources.find(
      (source) =>
        normalizeNotionPageId(source.id) ===
        normalizeNotionPageId(snapshot.configuredSourceId ?? ''),
    )
    const properties = Object.fromEntries(
      Object.entries(snapshot.page.properties).map(([name, property]) => [
        name,
        propertyValue(property),
      ]),
    )
    const content = snapshot.blocks
      .map((block) => blockText(block))
      .filter(Boolean)
      .join('\n\n')
    const findProperty = (...names: string[]) => {
      const entry = Object.entries(properties).find(([name]) =>
        names.includes(name.toLocaleLowerCase()),
      )
      return entry?.[1]
    }
    const externalId = `notion:${pageId}`
    return [
      {
        id: await stableId('document', { tenantId: scope.tenantId, source: 'notion', externalId }),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        projectId: configuredSource?.projectId ?? scope.projectId,
        sourceConnectionId: scope.sourceConnectionId,
        source: 'notion',
        type:
          snapshot.sourceKind === 'database' || snapshot.page.parent.database_id
            ? 'task'
            : 'document',
        externalId,
        canonicalUrl: snapshot.page.url,
        title: pageTitle(snapshot.page),
        content,
        authorId: snapshot.page.last_edited_by?.id ?? snapshot.page.created_by?.id,
        createdAt: asIsoTimestamp(snapshot.page.created_time),
        updatedAt: asIsoTimestamp(snapshot.page.last_edited_time),
        metadata: {
          properties,
          content,
          status: findProperty('status'),
          assignee: findProperty('assignee', '担当者'),
          priority: findProperty('priority', '優先度'),
          notionParent: snapshot.page.parent,
          archived: snapshot.page.archived ?? snapshot.page.in_trash ?? false,
        },
        visibilityScope: scope.visibilityScope,
        checksum: await stableChecksum({ page: snapshot.page, blocks: snapshot.blocks }),
        sourceRevision: snapshot.page.last_edited_time,
      },
    ]
  }
}
