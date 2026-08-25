import { mapCsvRows, parseCsv } from './csv'
import { processGitHubWebhook, syncGitHub } from './github'
import { digest, ingestDocument, rebuildDocumentIndex } from './ingestion'
import { syncNotion } from './notion'
import { normalizeMarkdown } from '@context-connect/connector-markdown'
import {
  ConnectorError,
  type Env,
  type SourceConnection,
  type SyncCounters,
  type SyncMessage,
} from './types'

export async function processJob(env: Env, message: SyncMessage): Promise<SyncCounters> {
  const job = await env.DB.prepare(
    `SELECT source_connection_id, payload_json FROM sync_jobs
      WHERE tenant_id = ?1 AND id = ?2 AND status != 'cancelled'`,
  )
    .bind(message.tenantId, message.jobId)
    .first<{
      source_connection_id: string
      payload_json: string
    }>()
  if (!job)
    throw new ConnectorError('job_not_found', 'Sync job was not found or was cancelled', false)
  const source = await loadSource(
    env,
    message.tenantId,
    message.sourceConnectionId ?? job.source_connection_id,
  )
  const now = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE sync_jobs SET status = 'running', attempt = attempt + 1, started_at = COALESCE(started_at, ?1),
            error_code = NULL, error_message = NULL, updated_at = ?1
      WHERE tenant_id = ?2 AND id = ?3`,
  )
    .bind(now, message.tenantId, message.jobId)
    .run()

  const persistedPayload = parseObject(job.payload_json)
  const payload = { ...persistedPayload, ...(message.payload ?? {}) }
  let counters: SyncCounters
  switch (message.kind) {
    case 'full_sync':
      counters = await syncSource(env, source, 'full')
      break
    case 'incremental_sync':
      counters = await syncSource(env, source, 'incremental')
      break
    case 'github_webhook':
      counters = await processWebhookSnapshot(env, source, payload)
      break
    case 'import_csv':
      counters = await importCsv(env, source, stringValue(payload.importId))
      break
    case 'reindex':
      counters = await reindex(env, source)
      break
    case 'import_markdown':
      counters = await importMarkdown(env, source, stringValue(payload.importId))
      break
  }

  const finishedAt = new Date().toISOString()
  const completed = counters.created + counters.updated + counters.skipped
  const status = counters.failed === 0 ? 'succeeded' : completed > 0 ? 'partial' : 'failed'
  await env.DB.prepare(
    `UPDATE sync_jobs SET status = ?1, fetched_count = ?2, created_count = ?3,
            updated_count = ?4, skipped_count = ?5, failed_count = ?6,
            finished_at = ?7, updated_at = ?7
      WHERE tenant_id = ?8 AND id = ?9`,
  )
    .bind(
      status,
      counters.fetched,
      counters.created,
      counters.updated,
      counters.skipped,
      counters.failed,
      finishedAt,
      message.tenantId,
      message.jobId,
    )
    .run()
  // Advancing a cursor after a partial result can permanently skip failed source objects.
  if (
    status === 'succeeded' &&
    ['full_sync', 'incremental_sync', 'github_webhook'].includes(message.kind)
  ) {
    await env.DB.prepare(
      `INSERT INTO sync_cursors
         (id, tenant_id, source_connection_id, scope, source_updated_at, last_succeeded_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'default', ?4, ?4, ?4, ?4)
       ON CONFLICT(tenant_id, source_connection_id, scope) DO UPDATE SET
         source_updated_at = excluded.source_updated_at,
         last_succeeded_at = excluded.last_succeeded_at,
         updated_at = excluded.updated_at`,
    )
      .bind(crypto.randomUUID(), message.tenantId, source.id, finishedAt)
      .run()
  }
  await env.DB.prepare(
    `UPDATE source_connections SET status = 'active', last_validated_at = ?1,
            last_error_code = NULL, updated_at = ?1
      WHERE tenant_id = ?2 AND id = ?3`,
  )
    .bind(finishedAt, message.tenantId, source.id)
    .run()
  return counters
}

export async function markJobFailure(
  env: Env,
  message: SyncMessage,
  error: unknown,
  final: boolean,
): Promise<void> {
  const safe =
    error instanceof ConnectorError
      ? { code: error.code, message: error.message, retryable: error.retryable }
      : {
          code: 'internal_sync_error',
          message: 'An unexpected synchronization error occurred',
          retryable: true,
        }
  await env.DB.prepare(
    `UPDATE sync_jobs SET status = ?1, failed_count = failed_count + 1,
            error_code = ?2, error_message = ?3, error_json = ?4,
            finished_at = CASE WHEN ?5 = 1 THEN ?6 ELSE finished_at END,
            updated_at = ?6
      WHERE tenant_id = ?7 AND id = ?8`,
  )
    .bind(
      final ? 'failed' : 'partial',
      safe.code,
      safe.message.slice(0, 1000),
      JSON.stringify({ retryable: safe.retryable }),
      Number(final),
      new Date().toISOString(),
      message.tenantId,
      message.jobId,
    )
    .run()
}

export function retryDelay(error: unknown, attempts: number): number {
  if (error instanceof ConnectorError && !error.retryable) return 0
  if (error instanceof ConnectorError && error.retryAfterSeconds) {
    return Math.min(3600, Math.max(1, error.retryAfterSeconds))
  }
  return Math.min(900, 2 ** Math.min(attempts, 9))
}

async function syncSource(env: Env, source: SourceConnection, mode: 'full' | 'incremental') {
  if (source.type === 'github') return syncGitHub(env, source, mode)
  if (source.type === 'notion') return syncNotion(env, source, mode)
  throw new ConnectorError(
    'unsupported_scheduled_source',
    `${source.type} sources are import-only`,
    false,
  )
}

async function processWebhookSnapshot(
  env: Env,
  source: SourceConnection,
  payload: Record<string, unknown>,
): Promise<SyncCounters> {
  const rawKey = stringValue(payload.rawKey)
  const event = stringValue(payload.event)
  if (!rawKey || !event)
    throw new ConnectorError('invalid_webhook_job', 'Webhook snapshot reference is missing', false)
  const object = await env.RAW_BUCKET.get(rawKey)
  if (!object)
    throw new ConnectorError('webhook_snapshot_missing', 'Webhook snapshot is missing', true)
  const raw = parseObject(await object.text())
  return processGitHubWebhook(env, source, event, raw)
}

async function importCsv(
  env: Env,
  source: SourceConnection,
  importId: string | null,
): Promise<SyncCounters> {
  if (!importId) throw new ConnectorError('import_id_missing', 'Import ID is missing', false)
  const record = await env.DB.prepare(
    `SELECT workspace_id, project_id, file_name, raw_r2_key, mapping_json
       FROM imports WHERE tenant_id = ?1 AND id = ?2 AND type = 'csv'`,
  )
    .bind(source.tenantId, importId)
    .first<{
      workspace_id: string
      project_id: string | null
      file_name: string
      raw_r2_key: string
      mapping_json: string
    }>()
  if (!record) throw new ConnectorError('import_not_found', 'CSV import record not found', false)
  await env.DB.prepare(
    "UPDATE imports SET status = 'running', updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3",
  )
    .bind(new Date().toISOString(), source.tenantId, importId)
    .run()
  const object = await env.RAW_BUCKET.get(record.raw_r2_key)
  if (!object)
    throw new ConnectorError('import_file_missing', 'CSV object is missing from R2', false)
  const rows = parseCsv(await object.text())
  const mapping = parseStringMap(record.mapping_json)
  const mapped = mapCsvRows(rows, mapping)
  const counters = emptyCounters()
  for (let index = 0; index < mapped.length; index += 1) {
    const row = mapped[index]!
    counters.fetched += 1
    try {
      const stableValue = JSON.stringify(
        Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
      )
      const externalId =
        row.external_id || row.id
          ? `csv:${row.external_id || row.id}`
          : `csv-hash:${(await digest(stableValue)).slice(0, 32)}`
      const title = row.title || row.name || `Imported task ${index + 1}`
      const content =
        row.content ||
        row.description ||
        Object.entries(row)
          .filter(([key]) => !['external_id', 'id', 'title', 'name'].includes(key))
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n')
      const revision = await digest(stableValue)
      const result = await ingestDocument(env, {
        tenantId: source.tenantId,
        workspaceId: record.workspace_id,
        projectId: record.project_id,
        repositoryId: null,
        sourceConnectionId: source.id,
        source: 'csv',
        type: row.type === 'incident' ? 'incident' : 'task',
        externalId,
        canonicalUrl: row.canonical_url || null,
        title,
        content,
        authorId: row.author_id || row.assignee || null,
        createdAt: isoOrNull(row.created_at),
        updatedAt: isoOrNull(row.updated_at) ?? isoOrNull(row.created_at),
        metadata: row,
        visibilityScope: 'project',
        sourceRevision: revision,
        raw: { importId, row: index + 2, values: row },
      })
      counters[result.state] += 1
    } catch {
      counters.failed += 1
    }
  }
  const status =
    counters.failed === 0
      ? 'succeeded'
      : counters.created + counters.updated > 0
        ? 'partial'
        : 'failed'
  await env.DB.prepare(
    `UPDATE imports SET status = ?1, row_count = ?2, imported_count = ?3,
            failed_count = ?4, updated_at = ?5
      WHERE tenant_id = ?6 AND id = ?7`,
  )
    .bind(
      status,
      counters.fetched,
      counters.created + counters.updated,
      counters.failed,
      new Date().toISOString(),
      source.tenantId,
      importId,
    )
    .run()
  return counters
}

async function importMarkdown(
  env: Env,
  source: SourceConnection,
  importId: string | null,
): Promise<SyncCounters> {
  if (!importId) throw new ConnectorError('import_id_missing', 'Import ID is missing', false)
  const record = await env.DB.prepare(
    `SELECT workspace_id, project_id, file_name, raw_r2_key
       FROM imports WHERE tenant_id = ?1 AND id = ?2 AND type = 'markdown'`,
  )
    .bind(source.tenantId, importId)
    .first<{
      workspace_id: string
      project_id: string | null
      file_name: string
      raw_r2_key: string
    }>()
  if (!record)
    throw new ConnectorError('import_not_found', 'Markdown import record not found', false)
  await env.DB.prepare(
    "UPDATE imports SET status = 'running', updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3",
  )
    .bind(new Date().toISOString(), source.tenantId, importId)
    .run()
  const object = await env.RAW_BUCKET.get(record.raw_r2_key)
  if (!object)
    throw new ConnectorError('import_file_missing', 'Markdown object is missing from R2', false)
  const rawContent = await object.text()
  const normalized = await normalizeMarkdown(
    { sourcePath: record.file_name, content: rawContent, modifiedAt: new Date().toISOString() },
    {
      scope: {
        tenantId: source.tenantId,
        workspaceId: record.workspace_id,
        ...(record.project_id ? { projectId: record.project_id } : {}),
        sourceConnectionId: source.id,
        visibilityScope: {
          workspaceIds: [record.workspace_id],
          projectIds: record.project_id ? [record.project_id] : [],
          sourceConnectionIds: [source.id],
        },
      },
      canonicalBaseUrl: 'https://context-connect.invalid/markdown/',
      defaultType: 'document',
    },
  )
  const result = await ingestDocument(env, {
    tenantId: normalized.tenantId,
    workspaceId: normalized.workspaceId,
    projectId: normalized.projectId ?? null,
    repositoryId: null,
    sourceConnectionId: normalized.sourceConnectionId ?? source.id,
    source: 'markdown',
    type: normalized.type,
    externalId: normalized.externalId,
    canonicalUrl: normalized.canonicalUrl,
    title: normalized.title,
    content: normalized.content,
    authorId: normalized.authorId ?? null,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    metadata: normalized.metadata,
    visibilityScope: 'project',
    sourceRevision: normalized.sourceRevision,
    raw: { importId, fileName: record.file_name, content: rawContent },
  })
  await env.DB.prepare(
    `UPDATE imports SET status = 'succeeded', row_count = 1, imported_count = 1,
            failed_count = 0, updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3`,
  )
    .bind(new Date().toISOString(), source.tenantId, importId)
    .run()
  const counters = emptyCounters()
  counters.fetched = 1
  counters[result.state] = 1
  return counters
}

async function reindex(env: Env, source: SourceConnection): Promise<SyncCounters> {
  const counters = emptyCounters()
  const rows = await env.DB.prepare(
    `SELECT id, tenant_id, workspace_id, project_id, source, type, title, content_ref, checksum
       FROM documents WHERE tenant_id = ?1 AND source_connection_id = ?2 AND deleted_at IS NULL`,
  )
    .bind(source.tenantId, source.id)
    .all<{
      id: string
      tenant_id: string
      workspace_id: string
      project_id: string | null
      source: string
      type: string
      title: string
      content_ref: string | null
      checksum: string
    }>()
  for (const row of rows.results) {
    counters.fetched += 1
    try {
      if (!row.content_ref) throw new Error('raw reference missing')
      const object = await env.RAW_BUCKET.get(row.content_ref)
      if (!object) throw new Error('raw object missing')
      const snapshot = parseObject(await object.text())
      const normalized =
        snapshot.normalized && typeof snapshot.normalized === 'object'
          ? (snapshot.normalized as Record<string, unknown>)
          : {}
      const content = stringValue(normalized.content)
      if (content === null) throw new Error('normalized raw content missing')
      await rebuildDocumentIndex(env, {
        id: row.id,
        tenantId: row.tenant_id,
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        source: row.source,
        type: row.type,
        sourceConnectionId: source.id,
        title: stringValue(normalized.title) ?? row.title,
        content,
        checksum: row.checksum,
      })
      await env.DB.prepare('UPDATE documents SET indexed_at = ?1 WHERE tenant_id = ?2 AND id = ?3')
        .bind(new Date().toISOString(), row.tenant_id, row.id)
        .run()
      counters.updated += 1
    } catch {
      counters.failed += 1
    }
  }
  return counters
}

async function loadSource(env: Env, tenantId: string, id: string): Promise<SourceConnection> {
  const row = await env.DB.prepare(
    `SELECT id, tenant_id, workspace_id, type, config_json, secret_ref
       FROM source_connections WHERE tenant_id = ?1 AND id = ?2 AND status != 'disabled'`,
  )
    .bind(tenantId, id)
    .first<{
      id: string
      tenant_id: string
      workspace_id: string | null
      type: SourceConnection['type']
      config_json: string
      secret_ref: string | null
    }>()
  if (!row)
    throw new ConnectorError('source_not_found', 'Source connection not found or disabled', false)
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    type: row.type,
    config: parseObject(row.config_json),
    secretRef: row.secret_ref,
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseStringMap(value: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parseObject(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}
function emptyCounters(): SyncCounters {
  return { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 }
}
function isoOrNull(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}
