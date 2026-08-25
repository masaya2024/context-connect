import { ingestDocument, upsertRelation } from './ingestion'
import { resolveSecret } from './github'
import { ConnectorError, type Env, type SourceConnection, type SyncCounters } from './types'

type JsonObject = Record<string, unknown>

export async function syncNotion(
  env: Env,
  source: SourceConnection,
  mode: 'full' | 'incremental',
): Promise<SyncCounters> {
  const counters: SyncCounters = { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 }
  const dataSourceIds = strings(source.config.dataSourceIds ?? source.config.data_source_ids)
  const pageIds = new Set(strings(source.config.pageIds ?? source.config.page_ids))
  const taskPageIds = new Set<string>()
  const cursor =
    mode === 'incremental'
      ? await env.DB.prepare(
          "SELECT source_updated_at FROM sync_cursors WHERE tenant_id = ?1 AND source_connection_id = ?2 AND scope = 'default'",
        )
          .bind(source.tenantId, source.id)
          .first<{ source_updated_at: string | null }>()
      : null
  for (const dataSourceId of dataSourceIds) {
    let nextCursor: string | null = null
    do {
      const response = asObject(
        await notionRequest(env, source, `/data_sources/${dataSourceId}/query`, {
          method: 'POST',
          body: JSON.stringify({
            page_size: 100,
            ...(nextCursor ? { start_cursor: nextCursor } : {}),
          }),
        }),
      )
      for (const result of array(response.results)) {
        const page = asObject(result)
        const lastEdited = string(page.last_edited_time)
        if (!cursor?.source_updated_at || !lastEdited || lastEdited > cursor.source_updated_at) {
          const id = string(page.id)
          if (id) {
            pageIds.add(id)
            taskPageIds.add(id)
          }
        }
      }
      nextCursor = response.has_more ? string(response.next_cursor) : null
    } while (nextCursor)
  }

  const maxObjects = numberVar(env.MAX_SYNC_OBJECTS, 5000)
  for (const pageId of pageIds) {
    if (counters.fetched >= maxObjects)
      throw new ConnectorError('sync_object_limit', `Sync exceeded ${maxObjects} pages`, false)
    try {
      const page = asObject(await notionRequest(env, source, `/pages/${pageId}`))
      const blocks = await retrieveBlocks(env, source, pageId)
      const title = notionTitle(asObject(page.properties)) ?? `Notion page ${pageId}`
      const propertyText = propertiesToText(asObject(page.properties))
      const content = [propertyText, blocks.text].filter(Boolean).join('\n\n')
      const workspaceId = source.workspaceId
      if (!workspaceId)
        throw new ConnectorError('workspace_missing', 'Notion source has no workspace', false)
      const result = await ingestDocument(env, {
        tenantId: source.tenantId,
        workspaceId,
        projectId: string(source.config.projectId ?? source.config.project_id),
        repositoryId: null,
        sourceConnectionId: source.id,
        source: 'notion',
        type: taskPageIds.has(pageId) ? 'task' : 'document',
        externalId: `notion:${pageId.replaceAll('-', '')}`,
        canonicalUrl: string(page.url),
        title,
        content,
        authorId: string(asObject(page.last_edited_by).id),
        createdAt: string(page.created_time),
        updatedAt: string(page.last_edited_time),
        metadata: {
          properties: plainProperties(asObject(page.properties)),
          block_count: blocks.count,
        },
        visibilityScope: 'project',
        sourceRevision: string(page.last_edited_time) ?? pageId,
        raw: { page, blocks: blocks.raw },
      })
      const compactPageId = pageId.replaceAll('-', '')
      const pullRequests = await env.DB.prepare(
        `SELECT id FROM documents
          WHERE tenant_id = ?1 AND source = 'github' AND type = 'pull_request'
            AND REPLACE(content_text, '-', '') LIKE ?2 AND deleted_at IS NULL`,
      )
        .bind(source.tenantId, `%${compactPageId}%`)
        .all<{ id: string }>()
      for (const pullRequest of pullRequests.results) {
        await upsertRelation(env, {
          tenantId: source.tenantId,
          fromDocumentId: result.documentId,
          toDocumentId: pullRequest.id,
          relationType: 'task_pr',
          linkMode: 'explicit',
          confidence: 1,
          evidence: { signal: 'notion_url', page_id: pageId },
        })
      }
      counters.fetched += 1
      counters[result.state] += 1
    } catch (error) {
      if (error instanceof ConnectorError && error.retryable) throw error
      counters.failed += 1
    }
  }
  return counters
}

async function retrieveBlocks(
  env: Env,
  source: SourceConnection,
  blockId: string,
  depth = 0,
): Promise<{ text: string; count: number; raw: JsonObject[] }> {
  if (depth > 20) return { text: '[nested block depth exceeded]', count: 0, raw: [] }
  const blocks: JsonObject[] = []
  let nextCursor: string | null = null
  do {
    const response = asObject(
      await notionRequest(
        env,
        source,
        `/blocks/${blockId}/children?page_size=100${nextCursor ? `&start_cursor=${encodeURIComponent(nextCursor)}` : ''}`,
      ),
    )
    blocks.push(...array(response.results).map(asObject))
    nextCursor = response.has_more ? string(response.next_cursor) : null
  } while (nextCursor)
  const parts: string[] = []
  let count = blocks.length
  for (const block of blocks) {
    const type = string(block.type)
    const payload = type ? asObject(block[type]) : {}
    const text = richText(array(payload.rich_text))
    if (text) parts.push(text)
    else if (type && !['divider', 'column_list', 'column'].includes(type)) parts.push(`[${type}]`)
    if (block.has_children && string(block.id)) {
      const child = await retrieveBlocks(env, source, string(block.id)!, depth + 1)
      parts.push(child.text)
      count += child.count
    }
  }
  return { text: parts.filter(Boolean).join('\n'), count, raw: blocks }
}

async function notionRequest(
  env: Env,
  source: SourceConnection,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const token = resolveSecret(env, source.secretRef, 'NOTION_TOKEN')
  if (!token)
    throw new ConnectorError(
      'notion_credential_missing',
      'Notion credential is not configured',
      false,
    )
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'notion-version': env.NOTION_VERSION ?? '2026-03-11',
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  if (response.ok) return response.json()
  const retryAfter = Number(response.headers.get('retry-after') ?? '0') || undefined
  throw new ConnectorError(
    `notion_http_${response.status}`,
    `Notion request failed with HTTP ${response.status}`,
    response.status === 429 || response.status >= 500,
    retryAfter,
  )
}

function notionTitle(properties: JsonObject): string | null {
  for (const property of Object.values(properties)) {
    const value = asObject(property)
    if (value.type === 'title') return richText(array(value.title)) || null
  }
  return null
}

function propertiesToText(properties: JsonObject): string {
  return Object.entries(properties)
    .map(([name, property]) => {
      const value = propertyValue(asObject(property))
      return value ? `${name}: ${value}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function plainProperties(properties: JsonObject): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => [name, propertyValue(asObject(property))]),
  )
}

function propertyValue(property: JsonObject): string {
  const type = string(property.type)
  const value = type ? property[type] : undefined
  if (type === 'title' || type === 'rich_text') return richText(array(value))
  if (type === 'select' || type === 'status') return string(asObject(value).name) ?? ''
  if (type === 'multi_select')
    return array(value)
      .map((entry) => string(asObject(entry).name))
      .filter(Boolean)
      .join(', ')
  if (type === 'people')
    return array(value)
      .map((entry) => string(asObject(entry).name) ?? string(asObject(entry).id))
      .filter(Boolean)
      .join(', ')
  if (type === 'date') return string(asObject(value).start) ?? ''
  if (type === 'formula' || type === 'rollup') return JSON.stringify(value ?? null)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return ''
}

function richText(values: unknown[]): string {
  return values
    .map(
      (entry) =>
        string(asObject(entry).plain_text) ?? string(asObject(asObject(entry).text).content) ?? '',
    )
    .join('')
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function strings(value: unknown): string[] {
  return array(value).filter((entry): entry is string => typeof entry === 'string')
}
function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
