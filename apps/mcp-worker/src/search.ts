import { canAccessProject, documentAcl } from './acl'
import { AuthError } from './auth'
import type { Env, Principal, SearchFilters, SearchHit } from './types'

type Row = Record<string, unknown>

export async function searchKnowledge(
  env: Env,
  principal: Principal,
  query: string,
  filters: SearchFilters = {},
  requestedLimit = 10,
): Promise<SearchHit[]> {
  const limit = Math.min(maxResults(env), Math.max(1, requestedLimit))
  if (filters.project_id && !canAccessProject(principal, filters.project_id)) {
    throw new AuthError('forbidden', 'Project access is not allowed')
  }
  const acl = documentAcl(principal)
  const clauses = [
    'd.tenant_id = ?',
    'd.deleted_at IS NULL',
    "(d.title LIKE ? ESCAPE '\\' OR d.content_text LIKE ? ESCAPE '\\' OR d.external_id = ? OR d.canonical_url = ?)",
  ]
  const like = `%${escapeLike(query)}%`
  const params: unknown[] = [principal.tenantId, ...acl.params, like, like, query, query]
  if (acl.sql) clauses.splice(2, 0, acl.sql.replace(/^ AND /, ''))
  addFilters(clauses, params, filters)
  params.push(Math.min(100, limit * 5))
  const keyword = await env.DB.prepare(
    `${documentSelect()} WHERE ${clauses.join(' AND ')}
      ORDER BY CASE WHEN d.external_id = ? OR d.canonical_url = ? THEN 0 ELSE 1 END,
               d.source_updated_at DESC LIMIT ?`,
  )
    .bind(...params.slice(0, -1), query, query, params.at(-1))
    .all<Row>()

  const scores = new Map<string, { row: Row; score: number; modes: Set<string> }>()
  for (const row of keyword.results) {
    const exact = row.external_id === query || row.canonical_url === query
    scores.set(String(row.id), {
      row,
      score: exact ? 1.5 : titleIncludes(row, query) ? 0.8 : 0.55,
      modes: new Set(exact ? ['exact'] : ['keyword']),
    })
  }

  try {
    const vector = await embedQuery(env, query)
    const response = await env.VECTOR_INDEX.query(vector, {
      topK: Math.min(100, limit * 8),
      returnMetadata: 'all',
      filter: { tenantId: principal.tenantId },
    })
    const semantic = new Map<string, number>()
    for (const match of response.matches) {
      const documentId =
        typeof match.metadata?.documentId === 'string' ? match.metadata.documentId : null
      if (documentId) semantic.set(documentId, Math.max(semantic.get(documentId) ?? 0, match.score))
    }
    const semanticIds = [...semantic.keys()]
    if (semanticIds.length > 0) {
      const semanticAcl = documentAcl(principal)
      const semanticRows = await env.DB.prepare(
        `${documentSelect()} WHERE d.tenant_id = ? AND d.deleted_at IS NULL${semanticAcl.sql}
          AND d.id IN (${semanticIds.map(() => '?').join(',')})`,
      )
        .bind(principal.tenantId, ...semanticAcl.params, ...semanticIds)
        .all<Row>()
      for (const row of semanticRows.results) {
        if (!matchesFilters(row, filters)) continue
        const id = String(row.id)
        const vectorScore = semantic.get(id) ?? 0
        const current = scores.get(id)
        if (current) {
          current.score += vectorScore * 0.8
          current.modes.add('semantic')
        } else scores.set(id, { row, score: vectorScore * 0.8, modes: new Set(['semantic']) })
      }
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'semantic_search_degraded',
        error: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }

  return [...scores.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        String(right.row.source_updated_at).localeCompare(String(left.row.source_updated_at)),
    )
    .slice(0, limit)
    .map(({ row, score, modes }) => ({
      ...mapDocument(row),
      id: String(row.id),
      type: String(row.type),
      title: String(row.title),
      external_id: String(row.external_id),
      canonical_url: typeof row.canonical_url === 'string' ? row.canonical_url : null,
      score: Number(score.toFixed(4)),
      match_mode: [...modes],
    }))
}

export async function getDocument(
  env: Env,
  principal: Principal,
  id: string,
  type?: string,
): Promise<Row | null> {
  const acl = documentAcl(principal)
  const row = await env.DB.prepare(
    `${documentSelect(true)} WHERE d.tenant_id = ? AND d.deleted_at IS NULL${acl.sql}
      AND (d.id = ? OR d.external_id = ? OR d.canonical_url = ?)
      ${type ? 'AND d.type = ?' : ''} LIMIT 1`,
  )
    .bind(principal.tenantId, ...acl.params, id, id, id, ...(type ? [type] : []))
    .first<Row>()
  if (!row) return null
  const relatedAcl = documentAcl(principal, 'rd')
  const relations = await env.DB.prepare(
    `SELECT r.id, r.relation_type, r.link_mode, r.confidence, r.status, r.evidence_json,
            CASE WHEN r.from_document_id = ?2 THEN 'outgoing' ELSE 'incoming' END AS direction,
            rd.id AS document_id, rd.type AS document_type, rd.external_id,
            rd.canonical_url, rd.title, rd.source_updated_at
       FROM relations r
       JOIN documents rd ON rd.tenant_id = r.tenant_id
        AND rd.id = CASE WHEN r.from_document_id = ?2 THEN r.to_document_id ELSE r.from_document_id END
      WHERE r.tenant_id = ?1 AND (r.from_document_id = ?2 OR r.to_document_id = ?2)
        AND r.status != 'rejected' AND rd.deleted_at IS NULL${relatedAcl.sql}
      ORDER BY r.confidence DESC LIMIT 100`,
  )
    .bind(principal.tenantId, String(row.id), ...relatedAcl.params)
    .all<Row>()
  return { ...mapDocument(row), relations: relations.results.map(mapRelation) }
}

export async function findRelatedHistory(
  env: Env,
  principal: Principal,
  documentId: string,
): Promise<Row[]> {
  const root = await getDocument(env, principal, documentId)
  if (!root) return []
  const results: Row[] = [root]
  const visited = new Set([String(root.id)])
  let frontier = [String(root.id)]
  for (let depth = 0; depth < 3 && frontier.length > 0 && results.length < 50; depth += 1) {
    const edges = await env.DB.prepare(
      `SELECT from_document_id, to_document_id FROM relations
        WHERE tenant_id = ? AND status != 'rejected'
          AND (from_document_id IN (${frontier.map(() => '?').join(',')})
            OR to_document_id IN (${frontier.map(() => '?').join(',')}))
        ORDER BY confidence DESC LIMIT 100`,
    )
      .bind(principal.tenantId, ...frontier, ...frontier)
      .all<{ from_document_id: string; to_document_id: string }>()
    const candidates = new Set<string>()
    for (const edge of edges.results) {
      if (!visited.has(edge.from_document_id)) candidates.add(edge.from_document_id)
      if (!visited.has(edge.to_document_id)) candidates.add(edge.to_document_id)
    }
    frontier = []
    for (const candidate of candidates) {
      const document = await getDocument(env, principal, candidate)
      visited.add(candidate)
      if (!document) continue
      results.push({ ...document, graph_depth: depth + 1 })
      frontier.push(candidate)
      if (results.length >= 50) break
    }
  }
  return results.sort((left, right) =>
    String(left.source_updated_at).localeCompare(String(right.source_updated_at)),
  )
}

export async function getChangeHistory(
  env: Env,
  principal: Principal,
  input: { project_id?: string; path?: string; query?: string },
): Promise<Row[]> {
  if (input.project_id && !canAccessProject(principal, input.project_id))
    throw new AuthError('forbidden', 'Project access is not allowed')
  const acl = documentAcl(principal)
  const clauses = ['d.tenant_id = ?', 'd.deleted_at IS NULL']
  const params: unknown[] = [principal.tenantId, ...acl.params]
  if (acl.sql) clauses.push(acl.sql.replace(/^ AND /, ''))
  if (input.project_id) {
    clauses.push('d.project_id = ?')
    params.push(input.project_id)
  }
  if (input.path) {
    clauses.push("(d.content_text LIKE ? ESCAPE '\\' OR d.metadata_json LIKE ? ESCAPE '\\')")
    const like = `%${escapeLike(input.path)}%`
    params.push(like, like)
  }
  if (input.query) {
    clauses.push("(d.title LIKE ? ESCAPE '\\' OR d.content_text LIKE ? ESCAPE '\\')")
    const like = `%${escapeLike(input.query)}%`
    params.push(like, like)
  }
  params.push(50)
  const rows = await env.DB.prepare(
    `${documentSelect()} WHERE ${clauses.join(' AND ')}
      ORDER BY d.source_updated_at ASC, d.id ASC LIMIT ?`,
  )
    .bind(...params)
    .all<Row>()
  return rows.results.map(mapDocument)
}

export async function getProjectContext(
  env: Env,
  principal: Principal,
  projectId: string,
): Promise<Row | null> {
  if (!canAccessProject(principal, projectId))
    throw new AuthError('forbidden', 'Project access is not allowed')
  const project = await env.DB.prepare(
    `SELECT p.id, p.workspace_id, p.slug, p.name, p.description
       FROM projects p WHERE p.tenant_id = ?1 AND p.id = ?2`,
  )
    .bind(principal.tenantId, projectId)
    .first<Row>()
  if (!project) return null
  const acl = documentAcl(principal)
  const docs = await env.DB.prepare(
    `${documentSelect()} WHERE d.tenant_id = ?1 AND d.project_id = ?2
      AND d.deleted_at IS NULL${acl.sql}
      ORDER BY CASE d.type WHEN 'document' THEN 0 WHEN 'task' THEN 1 ELSE 2 END,
               d.source_updated_at DESC LIMIT 40`,
  )
    .bind(principal.tenantId, projectId, ...acl.params)
    .all<Row>()
  return { ...project, documents: docs.results.map(mapDocument) }
}

export function truncatePack(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value)
  if (json.length <= maxChars) return json
  return JSON.stringify({
    truncated: true,
    max_chars: maxChars,
    content: json.slice(0, Math.max(0, maxChars - 100)),
  })
}

function documentSelect(includeContent = false): string {
  return `SELECT d.id, d.workspace_id, d.project_id, d.repository_id, d.source_connection_id,
    d.source, d.type, d.external_id, d.canonical_url, d.title,
    ${includeContent ? 'd.content_text' : 'substr(d.content_text, 1, 3000) AS content_excerpt'},
    d.author_id, d.source_created_at, d.source_updated_at, d.metadata_json,
    d.visibility_scope, d.source_revision FROM documents d`
}

function addFilters(clauses: string[], params: unknown[], filters: SearchFilters): void {
  const columns: Array<[keyof SearchFilters, string]> = [
    ['project_id', 'd.project_id'],
    ['repository_id', 'd.repository_id'],
    ['source', 'd.source'],
    ['type', 'd.type'],
    ['author_id', 'd.author_id'],
  ]
  for (const [key, column] of columns) {
    if (filters[key]) {
      clauses.push(`${column} = ?`)
      params.push(filters[key])
    }
  }
  if (filters.date_from) {
    clauses.push('d.source_updated_at >= ?')
    params.push(filters.date_from)
  }
  if (filters.date_to) {
    clauses.push('d.source_updated_at <= ?')
    params.push(filters.date_to)
  }
}

function matchesFilters(row: Row, filters: SearchFilters): boolean {
  if (filters.project_id && row.project_id !== filters.project_id) return false
  if (filters.repository_id && row.repository_id !== filters.repository_id) return false
  if (filters.source && row.source !== filters.source) return false
  if (filters.type && row.type !== filters.type) return false
  if (filters.author_id && row.author_id !== filters.author_id) return false
  if (filters.date_from && String(row.source_updated_at) < filters.date_from) return false
  if (filters.date_to && String(row.source_updated_at) > filters.date_to) return false
  return true
}

function mapDocument(row: Row): Row {
  const result = { ...row }
  result.metadata = parseJson(result.metadata_json)
  delete result.metadata_json
  return result
}

function mapRelation(row: Row): Row {
  const result: Row = { ...row, evidence: parseJson(row.evidence_json) }
  delete result.evidence_json
  return result
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return {}
  try {
    return JSON.parse(value) as unknown
  } catch {
    return {}
  }
}

async function embedQuery(env: Env, query: string): Promise<number[]> {
  const response = await (
    env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }
  ).run(env.EMBEDDING_MODEL ?? '@cf/baai/bge-m3', { text: [query] })
  const data =
    response && typeof response === 'object' ? (response as { data?: unknown }).data : undefined
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0] as number[]
  if (Array.isArray(data) && data.every((entry) => typeof entry === 'number'))
    return data as number[]
  throw new Error('Embedding response is invalid')
}

function titleIncludes(row: Row, query: string): boolean {
  return (
    typeof row.title === 'string' &&
    row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )
}
function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}
function maxResults(env: Env): number {
  const parsed = Number.parseInt(env.MAX_MCP_RESULTS ?? '20', 10)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 20
}
