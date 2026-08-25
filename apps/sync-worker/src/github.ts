import { digest, ingestDocument, upsertRelation } from './ingestion'
import type {
  ConnectorError,
  Env,
  RepositoryContext,
  SourceConnection,
  SyncCounters,
} from './types'
import { ConnectorError as SyncError } from './types'

interface GitHubRepositoryRow {
  id: string
  full_name: string
  project_id: string | null
  project_workspace_id: string | null
  source_workspace_id: string | null
}

type JsonObject = Record<string, unknown>

export async function syncGitHub(
  env: Env,
  source: SourceConnection,
  mode: 'full' | 'incremental',
): Promise<SyncCounters> {
  const counters = emptyCounters()
  await discoverRepositories(env, source)
  const repositories = await env.DB.prepare(
    `SELECT r.id, r.full_name, r.project_id, p.workspace_id AS project_workspace_id,
            s.workspace_id AS source_workspace_id
       FROM repositories r
       JOIN source_connections s ON s.tenant_id = r.tenant_id AND s.id = r.source_connection_id
       LEFT JOIN projects p ON p.tenant_id = r.tenant_id AND p.id = r.project_id
      WHERE r.tenant_id = ?1 AND r.source_connection_id = ?2
        AND r.selected = 1 AND r.archived = 0`,
  )
    .bind(source.tenantId, source.id)
    .all<GitHubRepositoryRow>()
  const cursor =
    mode === 'incremental'
      ? await env.DB.prepare(
          "SELECT source_updated_at FROM sync_cursors WHERE tenant_id = ?1 AND source_connection_id = ?2 AND scope = 'default'",
        )
          .bind(source.tenantId, source.id)
          .first<{ source_updated_at: string | null }>()
      : null
  const maxObjects = numberVar(env.MAX_SYNC_OBJECTS, 5000)

  for (const row of repositories.results) {
    const repository = toRepositoryContext(row)
    const pullRequests = await githubPaginate(
      env,
      source,
      `/repos/${repository.fullName}/pulls?state=all&sort=updated&direction=asc&per_page=100`,
    )
    for (const pullRequest of pullRequests) {
      const updatedAt = stringValue(pullRequest.updated_at)
      if (cursor?.source_updated_at && updatedAt && updatedAt <= cursor.source_updated_at) continue
      if (counters.fetched >= maxObjects) {
        throw new SyncError('sync_object_limit', `Sync exceeded ${maxObjects} objects`, false)
      }
      const result = await ingestPullRequest(env, source, repository, pullRequest)
      addResult(counters, result)
    }
    const since = cursor?.source_updated_at
      ? `&since=${encodeURIComponent(cursor.source_updated_at)}`
      : ''
    const commits = await githubPaginate(
      env,
      source,
      `/repos/${repository.fullName}/commits?per_page=100${since}`,
    )
    for (const value of commits) {
      if (counters.fetched >= maxObjects) {
        throw new SyncError('sync_object_limit', `Sync exceeded ${maxObjects} objects`, false)
      }
      counters.fetched += 1
      const result = await ingestCommit(env, source, repository, value, null)
      increment(counters, result.state)
    }
  }
  return counters
}

async function discoverRepositories(env: Env, source: SourceConnection): Promise<void> {
  let values: JsonObject[]
  try {
    const response = asObject(
      await githubRequest(env, source, '/installation/repositories?per_page=100'),
    )
    values = arrayValue(response.repositories).map(asObject)
  } catch (error) {
    if (!(error instanceof SyncError) || error.code !== 'github_http_404') throw error
    values = await githubPaginate(
      env,
      source,
      '/user/repos?affiliation=owner,collaborator,organization_member&per_page=100',
    )
  }
  const selected = new Set(
    arrayValue(source.config.selectedRepositories ?? source.config.selected_repositories).filter(
      (entry): entry is string => typeof entry === 'string',
    ),
  )
  const mappingValue = source.config.repositoryProjects ?? source.config.repository_projects
  const projectMapping =
    mappingValue && typeof mappingValue === 'object' && !Array.isArray(mappingValue)
      ? (mappingValue as Record<string, unknown>)
      : {}
  const now = new Date().toISOString()
  for (const repository of values) {
    const fullName = stringValue(repository.full_name)
    const externalId = stringValue(repository.id)
    const name = stringValue(repository.name)
    const owner = stringValue(asObject(repository.owner).login)
    if (!fullName || !externalId || !name || !owner) continue
    await env.DB.prepare(
      `INSERT INTO repositories
         (id, tenant_id, source_connection_id, project_id, external_id, owner, name,
          full_name, canonical_url, default_branch, selected, archived, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
       ON CONFLICT(tenant_id, source_connection_id, external_id) DO UPDATE SET
         project_id = COALESCE(excluded.project_id, repositories.project_id),
         owner = excluded.owner, name = excluded.name, full_name = excluded.full_name,
         canonical_url = excluded.canonical_url, default_branch = excluded.default_branch,
         selected = CASE WHEN repositories.selected = 1 THEN 1 ELSE excluded.selected END,
         archived = excluded.archived, updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        source.tenantId,
        source.id,
        typeof projectMapping[fullName] === 'string' ? projectMapping[fullName] : null,
        externalId,
        owner,
        name,
        fullName,
        stringValue(repository.html_url) ?? `https://github.com/${fullName}`,
        stringValue(repository.default_branch),
        Number(selected.has(fullName)),
        Number(repository.archived === true),
        now,
      )
      .run()
  }
}

export async function processGitHubWebhook(
  env: Env,
  source: SourceConnection,
  event: string,
  payload: JsonObject,
): Promise<SyncCounters> {
  const counters = emptyCounters()
  const repositoryPayload = asObject(payload.repository)
  const fullName = stringValue(repositoryPayload.full_name)
  if (!fullName)
    throw new SyncError('invalid_webhook', 'Webhook repository.full_name is missing', false)
  const repository = await findRepository(env, source, fullName)

  if (['pull_request', 'pull_request_review', 'pull_request_review_comment'].includes(event)) {
    const pullRequest = asObject(payload.pull_request)
    if (!numberValue(pullRequest.number))
      throw new SyncError('invalid_webhook', 'Webhook pull request is missing', false)
    addResult(counters, await ingestPullRequest(env, source, repository, pullRequest))
    return counters
  }
  if (event === 'push') {
    for (const value of arrayValue(payload.commits)) {
      const commit = asObject(value)
      counters.fetched += 1
      const result = await ingestCommit(env, source, repository, commit, null)
      increment(counters, result.state)
    }
    return counters
  }
  counters.skipped += 1
  return counters
}

async function ingestPullRequest(
  env: Env,
  source: SourceConnection,
  repository: RepositoryContext,
  partial: JsonObject,
): Promise<{ fetched: number; created: number; updated: number; skipped: number; failed: number }> {
  const number = numberValue(partial.number)
  if (!number) throw new SyncError('invalid_pull_request', 'Pull request number is missing', false)
  const [pullRequest, commits, reviews, reviewComments, files] = await Promise.all([
    githubRequest(env, source, `/repos/${repository.fullName}/pulls/${number}`),
    githubPaginate(
      env,
      source,
      `/repos/${repository.fullName}/pulls/${number}/commits?per_page=100`,
    ),
    githubPaginate(
      env,
      source,
      `/repos/${repository.fullName}/pulls/${number}/reviews?per_page=100`,
    ),
    githubPaginate(
      env,
      source,
      `/repos/${repository.fullName}/pulls/${number}/comments?per_page=100`,
    ),
    githubPaginate(
      env,
      source,
      `/repos/${repository.fullName}/pulls/${number}/files?per_page=100`,
      30,
    ),
  ])
  const pr = asObject(pullRequest)
  const labels = arrayValue(pr.labels)
    .map((label) => stringValue(asObject(label).name))
    .filter(Boolean)
  const fileSummary = files
    .map((value) => {
      const file = asObject(value)
      return [
        `### ${stringValue(file.filename) ?? 'unknown'} (${stringValue(file.status) ?? 'modified'})`,
        stringValue(file.patch) ?? '[patch omitted by GitHub]',
      ].join('\n')
    })
    .join('\n\n')
  const reviewSummary = [...reviews, ...reviewComments]
    .map((value) => {
      const review = asObject(value)
      const location = stringValue(review.path) ? ` on ${stringValue(review.path)}` : ''
      return `${stringValue(asObject(review.user).login) ?? 'unknown'} [${stringValue(review.state) ?? 'COMMENTED'}]${location}: ${stringValue(review.body) ?? ''}`
    })
    .join('\n')
  const content = [
    stringValue(pr.body) ?? '',
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    reviewSummary ? `Reviews:\n${reviewSummary}` : '',
    fileSummary ? `Changed files:\n${fileSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const revision =
    stringValue(asObject(pr.head).sha) ?? stringValue(pr.updated_at) ?? String(number)
  const prResult = await ingestDocument(env, {
    tenantId: source.tenantId,
    workspaceId: repository.workspaceId,
    projectId: repository.projectId,
    repositoryId: repository.id,
    sourceConnectionId: source.id,
    source: 'github',
    type: 'pull_request',
    externalId: `github:${repository.fullName}:pr:${number}`,
    canonicalUrl: stringValue(pr.html_url),
    title: stringValue(pr.title) ?? `Pull request #${number}`,
    content,
    authorId: stringValue(asObject(pr.user).login),
    createdAt: stringValue(pr.created_at),
    updatedAt: stringValue(pr.updated_at),
    metadata: {
      number,
      state: pr.merged_at ? 'merged' : stringValue(pr.state),
      merged_at: pr.merged_at ?? null,
      base: stringValue(asObject(pr.base).ref),
      head: stringValue(asObject(pr.head).ref),
      labels,
      changed_files: numberValue(pr.changed_files),
      files_truncated: files.length >= 3000,
    },
    visibilityScope: 'project',
    sourceRevision: revision,
    raw: { pull_request: pr, commits, reviews, review_comments: reviewComments, files },
  })
  const counters = emptyCounters()
  counters.fetched += 1
  increment(counters, prResult.state)

  for (const value of commits) {
    counters.fetched += 1
    const result = await ingestCommit(env, source, repository, asObject(value), prResult.documentId)
    increment(counters, result.state)
  }
  for (const value of reviews) {
    counters.fetched += 1
    const result = await ingestReview(
      env,
      source,
      repository,
      number,
      asObject(value),
      prResult.documentId,
    )
    increment(counters, result.state)
  }
  for (const value of reviewComments) {
    counters.fetched += 1
    const result = await ingestReview(
      env,
      source,
      repository,
      number,
      asObject(value),
      prResult.documentId,
    )
    increment(counters, result.state)
  }
  return counters
}

async function ingestCommit(
  env: Env,
  source: SourceConnection,
  repository: RepositoryContext,
  value: JsonObject,
  pullRequestId: string | null,
) {
  const commit = asObject(value.commit)
  const author = asObject(commit.author)
  const sha = stringValue(value.sha) ?? stringValue(value.id)
  if (!sha) throw new SyncError('invalid_commit', 'Commit SHA is missing', false)
  const message =
    stringValue(commit.message) ?? stringValue(value.message) ?? `Commit ${sha.slice(0, 8)}`
  const result = await ingestDocument(env, {
    tenantId: source.tenantId,
    workspaceId: repository.workspaceId,
    projectId: repository.projectId,
    repositoryId: repository.id,
    sourceConnectionId: source.id,
    source: 'github',
    type: 'commit',
    externalId: `github:${repository.fullName}:commit:${sha}`,
    canonicalUrl:
      stringValue(value.html_url) ?? `https://github.com/${repository.fullName}/commit/${sha}`,
    title: message.split('\n', 1)[0] ?? `Commit ${sha.slice(0, 8)}`,
    content: message,
    authorId: stringValue(asObject(value.author).login) ?? stringValue(author.email),
    createdAt: stringValue(author.date) ?? stringValue(value.timestamp),
    updatedAt: stringValue(author.date) ?? stringValue(value.timestamp),
    metadata: { sha },
    visibilityScope: 'project',
    sourceRevision: sha,
    raw: value,
  })
  if (pullRequestId)
    await upsertRelation(env, {
      tenantId: source.tenantId,
      fromDocumentId: pullRequestId,
      toDocumentId: result.documentId,
      relationType: 'pr_commit',
      linkMode: 'explicit',
      confidence: 1,
      evidence: { signal: 'github_pr_commits' },
    })
  return result
}

async function ingestReview(
  env: Env,
  source: SourceConnection,
  repository: RepositoryContext,
  pullNumber: number,
  review: JsonObject,
  pullRequestId: string,
) {
  const id = stringValue(review.id) ?? crypto.randomUUID()
  const state = stringValue(review.state) ?? 'COMMENTED'
  const occurredAt =
    stringValue(review.submitted_at) ??
    stringValue(review.created_at) ??
    stringValue(review.updated_at)
  const path = stringValue(review.path)
  const result = await ingestDocument(env, {
    tenantId: source.tenantId,
    workspaceId: repository.workspaceId,
    projectId: repository.projectId,
    repositoryId: repository.id,
    sourceConnectionId: source.id,
    source: 'github',
    type: 'review',
    externalId: `github:${repository.fullName}:review:${id}`,
    canonicalUrl: stringValue(review.html_url),
    title: path ? `Review comment on ${path}` : `${state} review on #${pullNumber}`,
    content: stringValue(review.body) ?? '',
    authorId: stringValue(asObject(review.user).login),
    createdAt: occurredAt,
    updatedAt: stringValue(review.updated_at) ?? occurredAt,
    metadata: { state, path, line: review.line ?? null, commit_id: review.commit_id ?? null },
    visibilityScope: 'project',
    sourceRevision: `${id}:${stringValue(review.updated_at) ?? occurredAt ?? 'pending'}`,
    raw: review,
  })
  await upsertRelation(env, {
    tenantId: source.tenantId,
    fromDocumentId: pullRequestId,
    toDocumentId: result.documentId,
    relationType: 'pr_review',
    linkMode: 'explicit',
    confidence: 1,
    evidence: { signal: 'github_pr_reviews' },
  })
  return result
}

async function findRepository(
  env: Env,
  source: SourceConnection,
  fullName: string,
): Promise<RepositoryContext> {
  const row = await env.DB.prepare(
    `SELECT r.id, r.full_name, r.project_id, p.workspace_id AS project_workspace_id,
            s.workspace_id AS source_workspace_id
       FROM repositories r
       JOIN source_connections s ON s.tenant_id = r.tenant_id AND s.id = r.source_connection_id
       LEFT JOIN projects p ON p.tenant_id = r.tenant_id AND p.id = r.project_id
      WHERE r.tenant_id = ?1 AND r.source_connection_id = ?2 AND r.full_name = ?3`,
  )
    .bind(source.tenantId, source.id, fullName)
    .first<GitHubRepositoryRow>()
  if (!row)
    throw new SyncError(
      'repository_not_selected',
      `Repository ${fullName} is not configured`,
      false,
    )
  return toRepositoryContext(row)
}

function toRepositoryContext(row: GitHubRepositoryRow): RepositoryContext {
  const workspaceId = row.project_workspace_id ?? row.source_workspace_id
  if (!workspaceId)
    throw new SyncError('workspace_missing', `Repository ${row.full_name} has no workspace`, false)
  return { id: row.id, fullName: row.full_name, projectId: row.project_id, workspaceId }
}

async function githubPaginate(
  env: Env,
  source: SourceConnection,
  path: string,
  maxPages = 100,
): Promise<JsonObject[]> {
  const results: JsonObject[] = []
  const separator = path.includes('?') ? '&' : '?'
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await githubRequest(env, source, `${path}${separator}page=${page}`)
    if (!Array.isArray(response))
      throw new SyncError('github_invalid_response', 'Expected a GitHub list response', true)
    results.push(...response.map(asObject))
    if (response.length < 100) break
  }
  return results
}

async function githubRequest(env: Env, source: SourceConnection, path: string): Promise<unknown> {
  const token = resolveSecret(env, source.secretRef, 'GITHUB_TOKEN')
  if (!token)
    throw new SyncError('github_credential_missing', 'GitHub credential is not configured', false)
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'context-connect/0.1',
      'x-github-api-version': env.GITHUB_API_VERSION ?? '2026-03-10',
    },
  })
  if (response.ok) return response.json()
  const retryAfter = Number(response.headers.get('retry-after') ?? '0') || undefined
  const retryable =
    response.status >= 500 ||
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  throw new SyncError(
    `github_http_${response.status}`,
    `GitHub request failed with HTTP ${response.status}`,
    retryable,
    retryAfter,
  )
}

export function resolveSecret(
  env: Env,
  secretRef: string | null,
  fallback: 'GITHUB_TOKEN' | 'NOTION_TOKEN',
): string | undefined {
  const candidate = secretRef ? env[secretRef] : undefined
  return typeof candidate === 'string' ? candidate : env[fallback]
}

function emptyCounters(): SyncCounters {
  return { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 }
}

function addResult(target: SyncCounters, source: SyncCounters): void {
  target.fetched += source.fetched
  target.created += source.created
  target.updated += source.updated
  target.skipped += source.skipped
  target.failed += source.failed
}

function increment(counters: SyncCounters, state: 'created' | 'updated' | 'skipped'): void {
  counters[state] += 1
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
