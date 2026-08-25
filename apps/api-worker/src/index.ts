import { Hono } from 'hono'
import { z, ZodError, type ZodType } from 'zod'
import { assertProjectAccess, assertSourceAccess, documentAcl } from './acl'
import { writeAudit } from './audit'
import {
  HttpError,
  jsonOk,
  notFound,
  onError,
  requestIdMiddleware,
  requireRole,
  requireScope,
} from './http'
import { executeIdempotent } from './idempotency'
import { decodeCursor, encodeCursor, parseLimit } from './pagination'
import { authMiddleware, rateLimitMiddleware } from './security'
import type { AppBindings, Principal, SyncMessage } from './types'

const app = new Hono<AppBindings>()

app.use('*', requestIdMiddleware())
app.use('/api/v1/*', authMiddleware)
app.use('/api/v1/*', rateLimitMiddleware)

app.get('/health', (c) => jsonOk(c, { status: 'ok', service: 'api-worker' }))

app.get('/api/v1/me', async (c) => {
  const principal = c.get('principal')
  requireScope(principal, 'profile:read')
  const member = await c.env.DB.prepare(
    `SELECT id, email, display_name, role, status, last_login_at
       FROM members WHERE tenant_id = ?1 AND id = ?2`,
  )
    .bind(principal.tenantId, principal.id)
    .first()
  return jsonOk(c, { ...member, principal })
})

app.get('/api/v1/sources', async (c) => {
  const principal = c.get('principal')
  requireScope(principal, 'sources:read')
  const params: unknown[] = [principal.tenantId]
  let acl = ''
  if (principal.role !== 'owner' && principal.role !== 'admin') {
    if (principal.sourceConnectionIds.length === 0)
      return jsonOk(c, { items: [], next_cursor: null })
    acl = ` AND id IN (${principal.sourceConnectionIds.map(() => '?').join(',')})`
    params.push(...principal.sourceConnectionIds)
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, workspace_id, type, name, status, config_json, secret_hint,
            last_validated_at, last_error_code, created_at, updated_at
       FROM source_connections WHERE tenant_id = ?${1}${acl} ORDER BY created_at DESC`,
  )
    .bind(...params)
    .all<Record<string, unknown>>()
  return jsonOk(c, { items: rows.results.map(mapJsonColumns) })
})

const sourceBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    workspace_id: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    secret_ref: z.string().trim().min(1).max(160).optional(),
    secret_hint: z.string().trim().max(32).optional(),
  })
  .strict()

for (const type of ['github', 'notion'] as const) {
  app.post(`/api/v1/sources/${type}`, async (c) => {
    const principal = c.get('principal')
    requireRole(principal, ['owner', 'admin'])
    requireScope(principal, 'sources:write')
    const body = await parseJson(c.req.raw, sourceBody)
    assertNoSecrets(body.config)
    if (body.workspace_id) await assertWorkspace(c.env.DB, principal, body.workspace_id)
    const result = await executeIdempotent(
      c,
      principal,
      `source:${type}:create`,
      body,
      async () => {
        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        await c.env.DB.prepare(
          `INSERT INTO source_connections
           (id, tenant_id, workspace_id, type, name, status, config_json, secret_ref,
            secret_hint, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?9)`,
        )
          .bind(
            id,
            principal.tenantId,
            body.workspace_id ?? null,
            type,
            body.name,
            JSON.stringify(body.config),
            body.secret_ref ?? null,
            body.secret_hint ?? null,
            now,
          )
          .run()
        await writeAudit(c, principal, 'connector.add', 'source_connection', id, { type })
        return { status: 201, data: { id, type, status: 'pending' } }
      },
    )
    return jsonOk(c, result.data, result.status)
  })
}

app.delete('/api/v1/sources/:id', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin'])
  requireScope(principal, 'sources:write')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    "UPDATE source_connections SET status = 'disabled', updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3",
  )
    .bind(new Date().toISOString(), principal.tenantId, id)
    .run()
  if (!result.meta.changes)
    throw new HttpError(404, 'source_not_found', 'Source connection not found')
  await writeAudit(c, principal, 'connector.remove', 'source_connection', id)
  return jsonOk(c, { id, status: 'disabled' })
})

app.get('/api/v1/repositories', async (c) => {
  const principal = c.get('principal')
  requireScope(principal, 'sources:read')
  const params: unknown[] = [principal.tenantId]
  let acl = ''
  if (principal.role !== 'owner' && principal.role !== 'admin') {
    const clauses: string[] = []
    if (principal.projectIds.length > 0) {
      clauses.push(
        `(project_id IS NULL OR project_id IN (${principal.projectIds.map(() => '?').join(',')}))`,
      )
      params.push(...principal.projectIds)
    } else clauses.push('project_id IS NULL')
    if (principal.sourceConnectionIds.length > 0) {
      clauses.push(
        `source_connection_id IN (${principal.sourceConnectionIds.map(() => '?').join(',')})`,
      )
      params.push(...principal.sourceConnectionIds)
    } else clauses.push('1 = 0')
    acl = ` AND (${clauses.join(' AND ')})`
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, source_connection_id, project_id, external_id, owner, name, full_name,
            canonical_url, default_branch, selected, archived, updated_at
       FROM repositories WHERE tenant_id = ?1${acl} ORDER BY full_name`,
  )
    .bind(...params)
    .all()
  return jsonOk(c, { items: rows.results })
})

const repositoryPatch = z
  .object({
    selected: z.boolean().optional(),
    project_id: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    (body) => body.selected !== undefined || body.project_id !== undefined,
    'No changes supplied',
  )

app.patch('/api/v1/repositories/:id', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin'])
  requireScope(principal, 'sources:write')
  const body = await parseJson(c.req.raw, repositoryPatch)
  if (body.project_id) assertProjectAccess(principal, body.project_id)
  const row = await c.env.DB.prepare(
    'SELECT id, selected, project_id FROM repositories WHERE tenant_id = ?1 AND id = ?2',
  )
    .bind(principal.tenantId, c.req.param('id'))
    .first<{ id: string; selected: number; project_id: string | null }>()
  if (!row) throw new HttpError(404, 'repository_not_found', 'Repository not found')
  await c.env.DB.prepare(
    `UPDATE repositories SET selected = ?1, project_id = ?2, updated_at = ?3
      WHERE tenant_id = ?4 AND id = ?5`,
  )
    .bind(
      body.selected === undefined ? row.selected : Number(body.selected),
      body.project_id === undefined ? row.project_id : body.project_id,
      new Date().toISOString(),
      principal.tenantId,
      row.id,
    )
    .run()
  await writeAudit(c, principal, 'repository.update', 'repository', row.id, body)
  return jsonOk(c, { id: row.id, ...body })
})

const syncBody = z
  .object({
    source_connection_id: z.string().min(1),
    mode: z.enum(['full', 'incremental', 'reindex']).default('incremental'),
  })
  .strict()

app.post('/api/v1/sync-jobs', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin', 'developer'])
  requireScope(principal, 'sync:write')
  const body = await parseJson(c.req.raw, syncBody)
  assertSourceAccess(principal, body.source_connection_id)
  await assertSource(c.env.DB, principal, body.source_connection_id, undefined, true)
  const result = await executeIdempotent(c, principal, 'sync:create', body, async () => {
    const jobId = crypto.randomUUID()
    const now = new Date().toISOString()
    const jobType = body.mode === 'reindex' ? 'reindex' : body.mode
    await c.env.DB.prepare(
      `INSERT INTO sync_jobs
         (id, tenant_id, source_connection_id, job_type, status, idempotency_key,
          request_id, payload_json, max_attempts, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, 5, ?8, ?8)`,
    )
      .bind(
        jobId,
        principal.tenantId,
        body.source_connection_id,
        jobType,
        c.req.header('idempotency-key') ?? null,
        c.get('requestId'),
        JSON.stringify(body),
        now,
      )
      .run()
    const message: SyncMessage = {
      jobId,
      tenantId: principal.tenantId,
      sourceConnectionId: body.source_connection_id,
      kind:
        body.mode === 'full'
          ? 'full_sync'
          : body.mode === 'reindex'
            ? 'reindex'
            : 'incremental_sync',
      requestedBy: principal.id,
      requestId: c.get('requestId'),
    }
    await c.env.SYNC_QUEUE.send(message)
    await writeAudit(c, principal, 'sync.enqueue', 'sync_job', jobId, { mode: body.mode })
    return { status: 202, data: { id: jobId, status: 'queued' } }
  })
  return jsonOk(c, result.data, result.status)
})

app.get('/api/v1/sync-jobs/:id', async (c) => {
  const principal = c.get('principal')
  requireScope(principal, 'sync:read')
  const row = await c.env.DB.prepare(
    `SELECT id, source_connection_id, job_type, status, cursor, attempt, max_attempts,
            retry_of, fetched_count, created_count, updated_count, skipped_count,
            failed_count, error_code, error_message, started_at, finished_at, created_at, updated_at
       FROM sync_jobs WHERE tenant_id = ?1 AND id = ?2`,
  )
    .bind(principal.tenantId, c.req.param('id'))
    .first<Record<string, unknown>>()
  if (!row) throw new HttpError(404, 'sync_job_not_found', 'Sync job not found')
  assertSourceAccess(principal, String(row.source_connection_id))
  return jsonOk(c, row)
})

app.post('/api/v1/sync-jobs/:id/retry', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin', 'developer'])
  requireScope(principal, 'sync:write')
  const previous = await c.env.DB.prepare(
    `SELECT id, source_connection_id, job_type, payload_json
       FROM sync_jobs WHERE tenant_id = ?1 AND id = ?2 AND status IN ('failed', 'partial')`,
  )
    .bind(principal.tenantId, c.req.param('id'))
    .first<{
      id: string
      source_connection_id: string
      job_type: string
      payload_json: string
    }>()
  if (!previous)
    throw new HttpError(409, 'sync_job_not_retryable', 'Only failed or partial jobs can be retried')
  assertSourceAccess(principal, previous.source_connection_id)
  await assertSource(c.env.DB, principal, previous.source_connection_id, undefined, true)
  const jobId = crypto.randomUUID()
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `INSERT INTO sync_jobs
       (id, tenant_id, source_connection_id, job_type, status, request_id, retry_of,
        payload_json, max_attempts, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, 5, ?8, ?8)`,
  )
    .bind(
      jobId,
      principal.tenantId,
      previous.source_connection_id,
      previous.job_type,
      c.get('requestId'),
      previous.id,
      previous.payload_json,
      now,
    )
    .run()
  await c.env.SYNC_QUEUE.send({
    jobId,
    tenantId: principal.tenantId,
    sourceConnectionId: previous.source_connection_id,
    kind:
      previous.job_type === 'full'
        ? 'full_sync'
        : previous.job_type === 'reindex'
          ? 'reindex'
          : previous.job_type === 'import'
            ? 'import_csv'
            : 'incremental_sync',
    requestedBy: principal.id,
    requestId: c.get('requestId'),
  })
  await writeAudit(c, principal, 'sync.retry', 'sync_job', jobId, { retry_of: previous.id })
  return jsonOk(c, { id: jobId, status: 'queued', retry_of: previous.id }, 202)
})

app.post('/api/v1/imports/csv', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin', 'developer'])
  requireScope(principal, 'imports:write')
  const form = await c.req.raw.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'file_required', 'A CSV file is required')
  if (file.size === 0 || file.size > 25 * 1024 * 1024) {
    throw new HttpError(413, 'invalid_file_size', 'CSV must be between 1 byte and 25 MiB')
  }
  const metadata = parseWithSchema(
    {
      workspace_id: form.get('workspace_id'),
      project_id: nullableFormString(form.get('project_id')),
      source_connection_id: form.get('source_connection_id'),
      mapping: parseFormJson(form.get('mapping')),
    },
    z
      .object({
        workspace_id: z.string().min(1),
        project_id: z.string().nullable(),
        source_connection_id: z.string().min(1),
        mapping: z.record(z.string(), z.string()),
      })
      .strict(),
  )
  await assertWorkspace(c.env.DB, principal, metadata.workspace_id)
  assertProjectAccess(principal, metadata.project_id)
  if (metadata.project_id) await assertProjectWrite(c.env.DB, principal, metadata.project_id)
  assertSourceAccess(principal, metadata.source_connection_id)
  await assertSource(c.env.DB, principal, metadata.source_connection_id, 'csv', true)
  const bytes = await file.arrayBuffer()
  const checksum = await digestBytes(bytes)
  const idempotencyKey =
    c.req.header('idempotency-key') ?? `csv:${checksum}:${metadata.project_id ?? 'none'}`
  const existingImport = await c.env.DB.prepare(
    'SELECT id, status FROM imports WHERE tenant_id = ?1 AND idempotency_key = ?2',
  )
    .bind(principal.tenantId, idempotencyKey)
    .first<{ id: string; status: string }>()
  if (existingImport)
    return jsonOk(c, { id: existingImport.id, status: existingImport.status, duplicate: true }, 202)
  const payload = { ...metadata, file_name: file.name, checksum }
  const result = await executeIdempotent(c, principal, 'import:csv', payload, async () => {
    const importId = crypto.randomUUID()
    const jobId = crypto.randomUUID()
    const key = `imports/${principal.tenantId}/${importId}/${safeFileName(file.name)}`
    const now = new Date().toISOString()
    await c.env.RAW_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: 'text/csv; charset=utf-8' },
    })
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO imports
           (id, tenant_id, source_connection_id, workspace_id, project_id, type, status,
            file_name, raw_r2_key, checksum, mapping_json, idempotency_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'csv', 'queued', ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
      ).bind(
        importId,
        principal.tenantId,
        metadata.source_connection_id,
        metadata.workspace_id,
        metadata.project_id,
        file.name,
        key,
        checksum,
        JSON.stringify(metadata.mapping),
        idempotencyKey,
        now,
      ),
      c.env.DB.prepare(
        `INSERT INTO sync_jobs
           (id, tenant_id, source_connection_id, job_type, status, request_id, payload_json,
            max_attempts, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'import', 'queued', ?4, ?5, 5, ?6, ?6)`,
      ).bind(
        jobId,
        principal.tenantId,
        metadata.source_connection_id,
        c.get('requestId'),
        JSON.stringify({ importId }),
        now,
      ),
    ])
    await c.env.SYNC_QUEUE.send({
      jobId,
      tenantId: principal.tenantId,
      sourceConnectionId: metadata.source_connection_id,
      kind: 'import_csv',
      payload: { importId },
      requestedBy: principal.id,
      requestId: c.get('requestId'),
    })
    await writeAudit(c, principal, 'import.csv', 'import', importId, {
      file_name: file.name,
      checksum,
      job_id: jobId,
    })
    return { status: 202, data: { id: importId, job_id: jobId, status: 'queued' } }
  })
  return jsonOk(c, result.data, result.status)
})

app.post('/api/v1/imports/markdown', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin', 'developer'])
  requireScope(principal, 'imports:write')
  const form = await c.req.raw.formData()
  const file = form.get('file')
  if (!(file instanceof File))
    throw new HttpError(400, 'file_required', 'A Markdown file is required')
  if (file.size === 0 || file.size > 10 * 1024 * 1024 || !/\.(md|markdown)$/i.test(file.name)) {
    throw new HttpError(
      413,
      'invalid_markdown_file',
      'Markdown must be a non-empty .md file up to 10 MiB',
    )
  }
  const metadata = parseWithSchema(
    {
      workspace_id: form.get('workspace_id'),
      project_id: nullableFormString(form.get('project_id')),
      source_connection_id: form.get('source_connection_id'),
    },
    z
      .object({
        workspace_id: z.string().min(1),
        project_id: z.string().nullable(),
        source_connection_id: z.string().min(1),
      })
      .strict(),
  )
  await assertWorkspace(c.env.DB, principal, metadata.workspace_id)
  assertProjectAccess(principal, metadata.project_id)
  if (metadata.project_id) await assertProjectWrite(c.env.DB, principal, metadata.project_id)
  assertSourceAccess(principal, metadata.source_connection_id)
  await assertSource(c.env.DB, principal, metadata.source_connection_id, 'markdown', true)
  const bytes = await file.arrayBuffer()
  const checksum = await digestBytes(bytes)
  const idempotencyKey =
    c.req.header('idempotency-key') ?? `markdown:${checksum}:${metadata.project_id ?? 'none'}`
  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM imports WHERE tenant_id = ?1 AND idempotency_key = ?2',
  )
    .bind(principal.tenantId, idempotencyKey)
    .first<{ id: string; status: string }>()
  if (existing) return jsonOk(c, { id: existing.id, status: existing.status, duplicate: true }, 202)

  const importId = crypto.randomUUID()
  const jobId = crypto.randomUUID()
  const key = `imports/${principal.tenantId}/${importId}/${safeFileName(file.name)}`
  const now = new Date().toISOString()
  await c.env.RAW_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
  })
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO imports
         (id, tenant_id, source_connection_id, workspace_id, project_id, type, status,
          file_name, raw_r2_key, checksum, mapping_json, idempotency_key, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'markdown', 'queued', ?6, ?7, ?8, '{}', ?9, ?10, ?10)`,
    ).bind(
      importId,
      principal.tenantId,
      metadata.source_connection_id,
      metadata.workspace_id,
      metadata.project_id,
      file.name,
      key,
      checksum,
      idempotencyKey,
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO sync_jobs
         (id, tenant_id, source_connection_id, job_type, status, request_id, payload_json,
          max_attempts, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'import', 'queued', ?4, ?5, 5, ?6, ?6)`,
    ).bind(
      jobId,
      principal.tenantId,
      metadata.source_connection_id,
      c.get('requestId'),
      JSON.stringify({ importId }),
      now,
    ),
  ])
  await c.env.SYNC_QUEUE.send({
    jobId,
    tenantId: principal.tenantId,
    sourceConnectionId: metadata.source_connection_id,
    kind: 'import_markdown',
    payload: { importId },
    requestedBy: principal.id,
    requestId: c.get('requestId'),
  })
  await writeAudit(c, principal, 'import.markdown', 'import', importId, {
    file_name: file.name,
    checksum,
    job_id: jobId,
  })
  return jsonOk(c, { id: importId, job_id: jobId, status: 'queued' }, 202)
})

app.get('/api/v1/documents', async (c) => {
  const principal = c.get('principal')
  requireScope(principal, 'knowledge:read')
  const max = Math.max(1, Number.parseInt(c.env.MAX_PAGE_SIZE ?? '100', 10) || 100)
  const limit = parseLimit(c.req.query('limit'), max)
  const cursor = decodeCursor(c.req.query('cursor'))
  const filters = parseWithSchema(
    {
      query: c.req.query('query'),
      project_id: c.req.query('project_id'),
      repository_id: c.req.query('repository_id'),
      source: c.req.query('source'),
      type: c.req.query('type'),
      author_id: c.req.query('author_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    },
    documentFilters,
  )
  if (filters.project_id) assertProjectAccess(principal, filters.project_id)
  const acl = documentAcl(principal)
  const clauses = ['d.tenant_id = ?', 'd.deleted_at IS NULL']
  const params: unknown[] = [principal.tenantId, ...acl.params]
  if (acl.clause) clauses.push(acl.clause.replace(/^ AND /, ''))
  addFilter(clauses, params, 'd.project_id', filters.project_id)
  addFilter(clauses, params, 'd.repository_id', filters.repository_id)
  addFilter(clauses, params, 'd.source', filters.source)
  addFilter(clauses, params, 'd.type', filters.type)
  addFilter(clauses, params, 'd.author_id', filters.author_id)
  if (filters.query) {
    clauses.push(
      "(d.title LIKE ? ESCAPE '\\' OR d.content_text LIKE ? ESCAPE '\\' OR d.external_id = ?)",
    )
    const like = `%${escapeLike(filters.query)}%`
    params.push(like, like, filters.query)
  }
  if (filters.date_from) {
    clauses.push('d.source_updated_at >= ?')
    params.push(filters.date_from)
  }
  if (filters.date_to) {
    clauses.push('d.source_updated_at <= ?')
    params.push(filters.date_to)
  }
  if (cursor) {
    clauses.push('(d.source_updated_at < ? OR (d.source_updated_at = ? AND d.id < ?))')
    params.push(cursor.sort, cursor.sort, cursor.id)
  }
  params.push(limit + 1)
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.workspace_id, d.project_id, d.repository_id, d.source_connection_id,
            d.source, d.type, d.external_id, d.canonical_url, d.title, d.author_id,
            d.source_created_at, d.source_updated_at, d.metadata_json, d.visibility_scope,
            d.checksum, d.source_revision
       FROM documents d WHERE ${clauses.join(' AND ')}
      ORDER BY d.source_updated_at DESC, d.id DESC LIMIT ?`,
  )
    .bind(...params)
    .all<Record<string, unknown>>()
  const hasMore = rows.results.length > limit
  const items = rows.results.slice(0, limit).map(mapJsonColumns)
  const last = items.at(-1)
  return jsonOk(c, {
    items,
    next_cursor:
      hasMore && last
        ? encodeCursor({ sort: String(last.source_updated_at ?? ''), id: String(last.id) })
        : null,
  })
})

app.get('/api/v1/documents/:id', async (c) => {
  const principal = c.get('principal')
  requireScope(principal, 'knowledge:read')
  const acl = documentAcl(principal)
  const row = await c.env.DB.prepare(
    `SELECT d.* FROM documents d
      WHERE d.tenant_id = ?1 AND d.id = ?2 AND d.deleted_at IS NULL${acl.clause}`,
  )
    .bind(principal.tenantId, c.req.param('id'), ...acl.params)
    .first<Record<string, unknown>>()
  if (!row) throw new HttpError(404, 'document_not_found', 'Document not found')
  const relatedAcl = documentAcl(principal, 'rd')
  const relations = await c.env.DB.prepare(
    `SELECT r.id, r.from_document_id, r.to_document_id, r.relation_type, r.link_mode,
            r.confidence, r.status, r.evidence_json
       FROM relations r
       JOIN documents rd ON rd.tenant_id = r.tenant_id
        AND rd.id = CASE WHEN r.from_document_id = ? THEN r.to_document_id ELSE r.from_document_id END
      WHERE r.tenant_id = ? AND (r.from_document_id = ? OR r.to_document_id = ?)
        AND r.status != 'rejected' AND rd.deleted_at IS NULL${relatedAcl.clause}
      ORDER BY r.confidence DESC LIMIT 100`,
  )
    .bind(
      c.req.param('id'),
      principal.tenantId,
      c.req.param('id'),
      c.req.param('id'),
      ...relatedAcl.params,
    )
    .all<Record<string, unknown>>()
  return jsonOk(c, { ...mapJsonColumns(row), relations: relations.results.map(mapJsonColumns) })
})

app.get('/api/v1/relations', async (c) => {
  const principal = c.get('principal')
  requireScope(principal, 'relations:read')
  const limit = parseLimit(c.req.query('limit'), 100)
  const status = c.req.query('status')
  if (status && !['active', 'candidate', 'confirmed', 'rejected'].includes(status)) {
    throw new HttpError(400, 'invalid_status', 'Invalid relation status')
  }
  const aclFrom = documentAcl(principal, 'fd')
  const aclTo = documentAcl(principal, 'td')
  const params: unknown[] = [principal.tenantId, ...aclFrom.params, ...aclTo.params]
  const statusClause = status ? ' AND r.status = ?' : ''
  if (status) params.push(status)
  params.push(limit)
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.from_document_id, r.to_document_id, r.relation_type, r.link_mode,
            r.confidence, r.status, r.evidence_json, r.reviewed_by, r.reviewed_at,
            fd.title AS from_title, td.title AS to_title
       FROM relations r
       JOIN documents fd ON fd.tenant_id = r.tenant_id AND fd.id = r.from_document_id
       JOIN documents td ON td.tenant_id = r.tenant_id AND td.id = r.to_document_id
      WHERE r.tenant_id = ?${aclFrom.clause}${aclTo.clause}${statusClause}
      ORDER BY r.confidence DESC, r.updated_at DESC LIMIT ?`,
  )
    .bind(...params)
    .all<Record<string, unknown>>()
  return jsonOk(c, { items: rows.results.map(mapJsonColumns) })
})

const relationPatch = z.object({ status: z.enum(['confirmed', 'rejected']) }).strict()

app.patch('/api/v1/relations/:id', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin', 'developer'])
  requireScope(principal, 'relations:write')
  const body = await parseJson(c.req.raw, relationPatch)
  const aclFrom = documentAcl(principal, 'fd')
  const aclTo = documentAcl(principal, 'td')
  const relation = await c.env.DB.prepare(
    `SELECT r.id, fd.project_id AS from_project_id, fd.source_connection_id AS from_source_id,
            td.project_id AS to_project_id, td.source_connection_id AS to_source_id
       FROM relations r
       JOIN documents fd ON fd.tenant_id = r.tenant_id AND fd.id = r.from_document_id
       JOIN documents td ON td.tenant_id = r.tenant_id AND td.id = r.to_document_id
      WHERE r.tenant_id = ?1 AND r.id = ?2${aclFrom.clause}${aclTo.clause}`,
  )
    .bind(principal.tenantId, c.req.param('id'), ...aclFrom.params, ...aclTo.params)
    .first<{
      id: string
      from_project_id: string | null
      from_source_id: string | null
      to_project_id: string | null
      to_source_id: string | null
    }>()
  if (!relation) throw new HttpError(404, 'relation_not_found', 'Relation not found')
  for (const projectId of [relation.from_project_id, relation.to_project_id]) {
    if (projectId) await assertProjectWrite(c.env.DB, principal, projectId)
  }
  for (const sourceId of [relation.from_source_id, relation.to_source_id]) {
    if (sourceId) await assertSourceWrite(c.env.DB, principal, sourceId)
  }
  const now = new Date().toISOString()
  await c.env.DB.prepare(
    `UPDATE relations SET status = ?1, reviewed_by = ?2,
            reviewed_at = ?3, updated_at = ?3
      WHERE tenant_id = ?4 AND id = ?5`,
  )
    .bind(body.status, principal.id, now, principal.tenantId, c.req.param('id'))
    .run()
  await writeAudit(c, principal, `relation.${body.status}`, 'relation', c.req.param('id'))
  return jsonOk(c, { id: c.req.param('id'), status: body.status })
})

app.get('/api/v1/audit', async (c) => {
  const principal = c.get('principal')
  requireRole(principal, ['owner', 'admin'])
  requireScope(principal, 'audit:read')
  const limit = parseLimit(c.req.query('limit'), 100)
  const cursor = decodeCursor(c.req.query('cursor'))
  const params: unknown[] = [principal.tenantId]
  let cursorClause = ''
  if (cursor) {
    cursorClause = ' AND (created_at < ? OR (created_at = ? AND id < ?))'
    params.push(cursor.sort, cursor.sort, cursor.id)
  }
  params.push(limit + 1)
  const rows = await c.env.DB.prepare(
    `SELECT id, actor_member_id, action, resource_type, resource_id, outcome,
            request_id, metadata_json, created_at
       FROM audit_logs WHERE tenant_id = ?${cursorClause}
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...params)
    .all<Record<string, unknown>>()
  const hasMore = rows.results.length > limit
  const items = rows.results.slice(0, limit).map(mapJsonColumns)
  const last = items.at(-1)
  return jsonOk(c, {
    items,
    next_cursor:
      hasMore && last ? encodeCursor({ sort: String(last.created_at), id: String(last.id) }) : null,
  })
})

app.onError(onError)
app.notFound(notFound)

export { app }
export default app

const documentFilters = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  project_id: z.string().min(1).optional(),
  repository_id: z.string().min(1).optional(),
  source: z.enum(['github', 'notion', 'csv', 'markdown']).optional(),
  type: z.enum(['task', 'pull_request', 'commit', 'review', 'document', 'incident']).optional(),
  author_id: z.string().min(1).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
})

async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON')
  }
  return parseWithSchema(value, schema)
}

function parseWithSchema<T>(value: unknown, schema: ZodType<T>): T {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpError(400, 'validation_error', 'Request validation failed', error.issues)
    }
    throw error
  }
}

async function assertWorkspace(
  db: D1Database,
  principal: Principal,
  workspaceId: string,
): Promise<void> {
  const found = await db
    .prepare('SELECT id FROM workspaces WHERE tenant_id = ?1 AND id = ?2')
    .bind(principal.tenantId, workspaceId)
    .first()
  if (!found) throw new HttpError(404, 'workspace_not_found', 'Workspace not found')
  if (
    principal.role !== 'owner' &&
    principal.role !== 'admin' &&
    !principal.workspaceIds.includes(workspaceId)
  )
    throw new HttpError(403, 'forbidden', 'Workspace access is not allowed')
}

async function assertSource(
  db: D1Database,
  principal: Principal,
  sourceId: string,
  type?: string,
  write = false,
): Promise<void> {
  const row = await db
    .prepare('SELECT type, status FROM source_connections WHERE tenant_id = ?1 AND id = ?2')
    .bind(principal.tenantId, sourceId)
    .first<{ type: string; status: string }>()
  if (!row) throw new HttpError(404, 'source_not_found', 'Source connection not found')
  if (type && row.type !== type)
    throw new HttpError(409, 'source_type_mismatch', `A ${type} source is required`)
  if (row.status === 'disabled')
    throw new HttpError(409, 'source_disabled', 'Source connection is disabled')
  if (write) await assertSourceWrite(db, principal, sourceId)
}

async function assertSourceWrite(
  db: D1Database,
  principal: Principal,
  sourceId: string,
): Promise<void> {
  if (principal.role === 'owner' || principal.role === 'admin') return
  const row = await db
    .prepare(
      `SELECT 1 FROM member_source_acl WHERE tenant_id = ?1 AND member_id = ?2
      AND source_connection_id = ?3 AND permission IN ('developer', 'admin')`,
    )
    .bind(principal.tenantId, principal.id, sourceId)
    .first()
  if (!row) throw new HttpError(403, 'forbidden', 'Source write access is not allowed')
}

async function assertProjectWrite(
  db: D1Database,
  principal: Principal,
  projectId: string,
): Promise<void> {
  if (principal.role === 'owner' || principal.role === 'admin') return
  const row = await db
    .prepare(
      `SELECT 1 FROM member_project_acl WHERE tenant_id = ?1 AND member_id = ?2
      AND project_id = ?3 AND permission IN ('developer', 'admin')`,
    )
    .bind(principal.tenantId, principal.id, projectId)
    .first()
  if (!row) throw new HttpError(403, 'forbidden', 'Project write access is not allowed')
}

function assertNoSecrets(value: unknown, path = 'config'): void {
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(token|secret|password|private.?key|authorization|credential)/i.test(key)) {
      throw new HttpError(
        400,
        'secret_in_payload',
        `Secret-like field is not allowed at ${path}.${key}; use secret_ref`,
      )
    }
    assertNoSecrets(nested, `${path}.${key}`)
  }
}

function mapJsonColumns(row: Record<string, unknown>): Record<string, unknown> {
  const result = { ...row }
  for (const key of [
    'config_json',
    'metadata_json',
    'evidence_json',
    'mapping_json',
    'payload_json',
    'error_json',
  ] as const) {
    if (typeof result[key] === 'string') {
      try {
        result[key.replace(/_json$/, '')] = JSON.parse(result[key] as string) as unknown
      } catch {
        result[key.replace(/_json$/, '')] = {}
      }
      delete result[key]
    }
  }
  return result
}

function addFilter(
  clauses: string[],
  params: unknown[],
  column: string,
  value: string | undefined,
): void {
  if (value) {
    clauses.push(`${column} = ?`)
    params.push(value)
  }
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function nullableFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseFormJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return {}
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new HttpError(400, 'invalid_mapping', 'mapping must be valid JSON')
  }
}

async function digestBytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeFileName(value: string): string {
  return (
    value
      .normalize('NFKC')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .slice(0, 120) || 'import.csv'
  )
}
