import { chunkText } from './chunk'
import type { Env, IngestionResult, NormalizedDocument } from './types'

const encoder = new TextEncoder()

export async function digest(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  const result = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function ingestDocument(
  env: Env,
  document: NormalizedDocument,
): Promise<IngestionResult> {
  // Hash every normalized field that affects retrieval, authorization or provenance.
  // Content-only checksums would silently miss title, metadata and ACL changes.
  const checksum = await digest(
    JSON.stringify({
      workspaceId: document.workspaceId,
      projectId: document.projectId,
      repositoryId: document.repositoryId,
      sourceConnectionId: document.sourceConnectionId,
      source: document.source,
      type: document.type,
      externalId: document.externalId,
      canonicalUrl: document.canonicalUrl,
      title: document.title,
      content: document.content,
      authorId: document.authorId,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      metadata: document.metadata,
      visibilityScope: document.visibilityScope,
      sourceRevision: document.sourceRevision,
    }),
  )
  const existing = await env.DB.prepare(
    `SELECT id, checksum, indexed_at FROM documents
      WHERE tenant_id = ?1 AND source = ?2 AND type = ?3 AND external_id = ?4`,
  )
    .bind(document.tenantId, document.source, document.type, document.externalId)
    .first<{
      id: string
      checksum: string
      indexed_at: string | null
    }>()
  if (existing?.checksum === checksum && existing.indexed_at) {
    return { documentId: existing.id, state: 'skipped' }
  }

  const documentId = existing?.id ?? crypto.randomUUID()
  const rawKey = `raw/${document.tenantId}/${document.source}/${document.type}/${documentId}/${document.sourceRevision}.json`
  const now = new Date().toISOString()
  await env.RAW_BUCKET.put(
    rawKey,
    JSON.stringify({
      schemaVersion: 1,
      normalized: {
        title: document.title,
        content: document.content,
        source: document.source,
        type: document.type,
        workspaceId: document.workspaceId,
        projectId: document.projectId,
      },
      source: document.raw,
    }),
    {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { checksum, source_revision: document.sourceRevision },
    },
  )

  await env.DB.prepare(
    `INSERT INTO documents
       (id, tenant_id, workspace_id, project_id, repository_id, source_connection_id,
        source, type, external_id, canonical_url, title, content_ref, content_text,
        author_id, source_created_at, source_updated_at, metadata_json, visibility_scope,
        checksum, source_revision, indexed_at, deleted_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
             ?14, ?15, ?16, ?17, ?18, ?19, ?20, NULL, NULL, ?21, ?21)
     ON CONFLICT(tenant_id, source, type, external_id) DO UPDATE SET
       workspace_id = excluded.workspace_id,
       project_id = excluded.project_id,
       repository_id = excluded.repository_id,
       source_connection_id = excluded.source_connection_id,
       canonical_url = excluded.canonical_url,
       title = excluded.title,
       content_ref = excluded.content_ref,
       content_text = excluded.content_text,
       author_id = excluded.author_id,
       source_created_at = excluded.source_created_at,
       source_updated_at = excluded.source_updated_at,
       metadata_json = excluded.metadata_json,
       visibility_scope = excluded.visibility_scope,
       checksum = excluded.checksum,
       source_revision = excluded.source_revision,
       indexed_at = NULL,
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
  )
    .bind(
      documentId,
      document.tenantId,
      document.workspaceId,
      document.projectId,
      document.repositoryId,
      document.sourceConnectionId,
      document.source,
      document.type,
      document.externalId,
      document.canonicalUrl,
      document.title,
      rawKey,
      document.content,
      document.authorId,
      document.createdAt,
      document.updatedAt,
      JSON.stringify(document.metadata),
      document.visibilityScope,
      checksum,
      document.sourceRevision,
      now,
    )
    .run()

  await rebuildDocumentIndex(env, {
    id: documentId,
    tenantId: document.tenantId,
    workspaceId: document.workspaceId,
    projectId: document.projectId,
    source: document.source,
    type: document.type,
    sourceConnectionId: document.sourceConnectionId,
    title: document.title,
    content: document.content,
    checksum,
  })
  await env.DB.prepare(
    'UPDATE documents SET indexed_at = ?1, updated_at = ?1 WHERE tenant_id = ?2 AND id = ?3',
  )
    .bind(new Date().toISOString(), document.tenantId, documentId)
    .run()

  if (document.type === 'pull_request') {
    await linkExplicitNotionReferences(env, document, documentId)
    await inferTaskRelations(env, document, documentId)
  }
  return { documentId, state: existing ? 'updated' : 'created' }
}

async function inferTaskRelations(
  env: Env,
  document: NormalizedDocument,
  pullRequestId: string,
): Promise<void> {
  if (!document.projectId) return
  const explicit = await env.DB.prepare(
    `SELECT 1 FROM relations WHERE tenant_id = ?1 AND to_document_id = ?2
      AND relation_type = 'task_pr' AND link_mode = 'explicit' LIMIT 1`,
  )
    .bind(document.tenantId, pullRequestId)
    .first()
  if (explicit) return
  const candidates = await env.DB.prepare(
    `SELECT id, title, content_text, author_id, source_updated_at
       FROM documents WHERE tenant_id = ?1 AND project_id = ?2 AND type = 'task'
        AND deleted_at IS NULL ORDER BY source_updated_at DESC LIMIT 100`,
  )
    .bind(document.tenantId, document.projectId)
    .all<{
      id: string
      title: string
      content_text: string | null
      author_id: string | null
      source_updated_at: string | null
    }>()
  for (const candidate of candidates.results) {
    const titleSimilarity = textSimilarity(document.title, candidate.title)
    const contentSimilarity = textSimilarity(
      document.content.slice(0, 5000),
      `${candidate.title}\n${candidate.content_text ?? ''}`,
    )
    const dateScore = dateProximity(document.updatedAt, candidate.source_updated_at)
    const authorScore =
      document.authorId && candidate.author_id && document.authorId === candidate.author_id ? 1 : 0
    const score =
      titleSimilarity * 0.3 + dateScore * 0.2 + authorScore * 0.2 + 0.15 + contentSimilarity * 0.15
    if (score < 0.5) continue
    await upsertRelation(env, {
      tenantId: document.tenantId,
      fromDocumentId: candidate.id,
      toDocumentId: pullRequestId,
      relationType: 'task_pr',
      linkMode: 'inferred',
      confidence: Number(score.toFixed(4)),
      status: score >= 0.75 ? 'candidate' : 'active',
      evidence: {
        title_similarity: titleSimilarity,
        date_proximity: dateScore,
        author_match: authorScore,
        project_match: 1,
        content_similarity: contentSimilarity,
      },
    })
  }
}

function textSimilarity(left: string, right: string): number {
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let overlap = 0
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1
  return overlap / (leftTokens.size + rightTokens.size - overlap)
}

function tokens(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  const result = new Set(words.filter((word) => word.length > 1))
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2)
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2}$/u.test(pair)) result.add(pair)
  }
  return result
}

function dateProximity(left: string | null, right: string | null): number {
  if (!left || !right) return 0
  const deltaDays = Math.abs(new Date(left).valueOf() - new Date(right).valueOf()) / 86_400_000
  if (!Number.isFinite(deltaDays)) return 0
  return Math.max(0, 1 - deltaDays / 90)
}

export interface IndexableDocument {
  id: string
  tenantId: string
  workspaceId: string
  projectId: string | null
  source: string
  type: string
  sourceConnectionId?: string
  title: string
  content: string
  checksum: string
}

export async function rebuildDocumentIndex(env: Env, document: IndexableDocument): Promise<void> {
  const chunks = chunkText(
    `${document.title}\n\n${document.content}`,
    numberVar(env.CHUNK_MAX_CHARS, 1800),
    numberVar(env.CHUNK_OVERLAP_CHARS, 200),
  )
  const old = await env.DB.prepare(
    'SELECT id, embedding_id FROM chunks WHERE tenant_id = ?1 AND document_id = ?2',
  )
    .bind(document.tenantId, document.id)
    .all<{ id: string; embedding_id: string | null }>()
  const vectors: number[][] = []
  for (let index = 0; index < chunks.length; index += 50) {
    vectors.push(
      ...(await embed(
        env,
        chunks.slice(index, index + 50).map((entry) => entry.text),
      )),
    )
  }
  if (vectors.length !== chunks.length)
    throw new Error('Embedding provider returned an unexpected vector count')
  if (vectors.some((vector) => vector.length !== 1024)) {
    throw new Error(
      'Embedding dimension does not match the 1024-dimensional bge-m3 Vectorize index',
    )
  }

  const chunkChecksums = await Promise.all(chunks.map((entry) => digest(entry.text)))
  const ids = chunks.map(
    (entry, index) => `${document.id}:${entry.ordinal}:${chunkChecksums[index]!.slice(0, 16)}`,
  )
  const staleIds = old.results
    .map((entry) => entry.embedding_id)
    .filter((id): id is string => Boolean(id) && !ids.includes(id as string))
  for (let index = 0; index < staleIds.length; index += 500) {
    await env.VECTOR_INDEX.deleteByIds(staleIds.slice(index, index + 500))
  }
  if (chunks.length > 0) {
    const vectorRecords = chunks.map((entry, index) => ({
      id: ids[index]!,
      values: vectors[index]!,
      metadata: {
        tenantId: document.tenantId,
        workspaceId: document.workspaceId,
        ...(document.projectId ? { projectId: document.projectId } : {}),
        ...(document.sourceConnectionId ? { sourceConnectionId: document.sourceConnectionId } : {}),
        documentId: document.id,
        source: document.source,
        type: document.type,
        ordinal: entry.ordinal,
      },
    }))
    for (let index = 0; index < vectorRecords.length; index += 500) {
      await env.VECTOR_INDEX.upsert(vectorRecords.slice(index, index + 500))
    }
  }

  const now = new Date().toISOString()
  await env.DB.prepare('DELETE FROM chunks WHERE tenant_id = ?1 AND document_id = ?2')
    .bind(document.tenantId, document.id)
    .run()
  const statements = chunks.map((entry, index) =>
    env.DB.prepare(
      `INSERT INTO chunks
         (id, tenant_id, document_id, ordinal, text, token_estimate, embedding_id,
          metadata_json, checksum, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
    ).bind(
      ids[index],
      document.tenantId,
      document.id,
      entry.ordinal,
      entry.text,
      entry.tokenEstimate,
      ids[index],
      JSON.stringify({ source: document.source, type: document.type }),
      chunkChecksums[index],
      now,
    ),
  )
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50))
  }
}

export async function upsertRelation(
  env: Env,
  input: {
    tenantId: string
    fromDocumentId: string
    toDocumentId: string
    relationType: string
    linkMode: 'explicit' | 'inferred' | 'manual'
    confidence: number
    status?: 'active' | 'candidate' | 'confirmed' | 'rejected'
    evidence?: Record<string, unknown>
  },
): Promise<void> {
  if (input.fromDocumentId === input.toDocumentId) return
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO relations
       (id, tenant_id, from_document_id, to_document_id, relation_type, link_mode,
        confidence, status, evidence_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT(tenant_id, from_document_id, to_document_id, relation_type) DO UPDATE SET
       link_mode = CASE WHEN excluded.link_mode = 'explicit' THEN 'explicit' ELSE relations.link_mode END,
       confidence = MAX(relations.confidence, excluded.confidence),
       status = CASE WHEN excluded.link_mode = 'explicit' THEN 'confirmed' ELSE relations.status END,
       evidence_json = excluded.evidence_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      input.tenantId,
      input.fromDocumentId,
      input.toDocumentId,
      input.relationType,
      input.linkMode,
      input.confidence,
      input.status ?? (input.linkMode === 'explicit' ? 'confirmed' : 'active'),
      JSON.stringify(input.evidence ?? {}),
      now,
    )
    .run()
}

async function linkExplicitNotionReferences(
  env: Env,
  document: NormalizedDocument,
  pullRequestId: string,
): Promise<void> {
  const pageIds = extractNotionPageIds(`${document.title}\n${document.content}`)
  for (const pageId of pageIds) {
    const compact = pageId.replaceAll('-', '')
    const task = await env.DB.prepare(
      `SELECT id FROM documents
        WHERE tenant_id = ?1 AND source = 'notion' AND type = 'task'
          AND (REPLACE(external_id, '-', '') = ?2 OR REPLACE(canonical_url, '-', '') LIKE ?3)
        LIMIT 1`,
    )
      .bind(document.tenantId, compact, `%${compact}%`)
      .first<{ id: string }>()
    if (!task) continue
    await upsertRelation(env, {
      tenantId: document.tenantId,
      fromDocumentId: task.id,
      toDocumentId: pullRequestId,
      relationType: 'task_pr',
      linkMode: 'explicit',
      confidence: 1,
      evidence: { signal: 'notion_url', page_id: pageId },
    })
  }
}

export function extractNotionPageIds(value: string): string[] {
  const ids = new Set<string>()
  const urlPattern =
    /https?:\/\/(?:www\.)?(?:notion\.(?:so|site)|[A-Za-z0-9-]+\.notion\.site)\/[^\s<>)]*/gi
  for (const match of value.matchAll(urlPattern)) {
    const id = match[0].match(
      /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[^0-9a-f]|$)/i,
    )?.[1]
    if (id) ids.add(formatUuid(id))
  }
  return [...ids]
}

function formatUuid(value: string): string {
  const compact = value.replaceAll('-', '').toLowerCase()
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
}

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const ai = env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }
  const response = await ai.run(env.EMBEDDING_MODEL ?? '@cf/baai/bge-m3', { text: texts })
  if (
    response &&
    typeof response === 'object' &&
    Array.isArray((response as { data?: unknown }).data)
  ) {
    const data = (response as { data: unknown[] }).data
    if (data.every((entry) => Array.isArray(entry))) return data as number[][]
    if (texts.length === 1 && data.every((entry) => typeof entry === 'number'))
      return [data as number[]]
  }
  throw new Error('Embedding provider response is invalid')
}

function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
