import { createMiddleware } from 'hono/factory'
import { HttpError } from './http'
import type { AppBindings, Principal, Role } from './types'

const encoder = new TextEncoder()

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

export async function authenticate(
  request: Request,
  env: AppBindings['Bindings'],
): Promise<Principal> {
  if (env.ALLOW_DEV_AUTH === 'true') {
    const id = request.headers.get('x-dev-member-id')
    const tenantId = request.headers.get('x-dev-tenant-id')
    if (id && tenantId) {
      return {
        id,
        tenantId,
        role: (request.headers.get('x-dev-role') ?? 'developer') as Role,
        workspaceIds: splitHeader(request.headers.get('x-dev-workspace-ids')),
        projectIds: splitHeader(request.headers.get('x-dev-project-ids')),
        sourceConnectionIds: splitHeader(request.headers.get('x-dev-source-ids')),
        scopes: splitHeader(request.headers.get('x-dev-scopes') ?? '*'),
      }
    }
  }

  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'unauthorized', 'A bearer access token is required')
  }
  const token = authorization.slice(7).trim()
  if (token.length < 24) {
    throw new HttpError(401, 'invalid_token', 'The bearer access token is invalid')
  }
  const tokenHash = await sha256(token)
  const row = await env.DB.prepare(
    `SELECT t.member_id, t.scopes_json, m.tenant_id, m.role
       FROM oauth_access_tokens t
       JOIN members m ON m.id = t.member_id
      WHERE t.token_hash = ?1
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > ?2)
        AND m.status = 'active'
      LIMIT 1`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{
      member_id: string
      scopes_json: string
      tenant_id: string
      role: Role
    }>()
  if (!row)
    throw new HttpError(401, 'invalid_token', 'The bearer access token is invalid or expired')

  const [projectRows, sourceRows] = await Promise.all([
    env.DB.prepare(
      'SELECT project_id FROM member_project_acl WHERE tenant_id = ?1 AND member_id = ?2',
    )
      .bind(row.tenant_id, row.member_id)
      .all<{ project_id: string }>(),
    env.DB.prepare(
      'SELECT source_connection_id FROM member_source_acl WHERE tenant_id = ?1 AND member_id = ?2',
    )
      .bind(row.tenant_id, row.member_id)
      .all<{ source_connection_id: string }>(),
  ])
  const projectIds = projectRows.results.map((entry) => entry.project_id)
  const workspaceIds =
    projectIds.length === 0
      ? []
      : (
          await env.DB.prepare(
            `SELECT DISTINCT workspace_id FROM projects
        WHERE tenant_id = ?1 AND id IN (${projectIds.map(() => '?').join(',')})`,
          )
            .bind(row.tenant_id, ...projectIds)
            .all<{ workspace_id: string }>()
        ).results.map((entry) => entry.workspace_id)

  return {
    id: row.member_id,
    tenantId: row.tenant_id,
    role: row.role,
    workspaceIds,
    projectIds,
    sourceConnectionIds: sourceRows.results.map((entry) => entry.source_connection_id),
    scopes: parseJsonArray(row.scopes_json),
  }
}

function splitHeader(value: string | null): string[] {
  return (
    value
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  )
}

export const authMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  c.set('principal', await authenticate(c.req.raw, c.env))
  await next()
})

export const rateLimitMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  const principal = c.get('principal')
  const limit = Math.max(1, Number.parseInt(c.env.RATE_LIMIT_PER_MINUTE ?? '120', 10) || 120)
  const now = Date.now()
  const windowStart = Math.floor(now / 60_000) * 60_000
  const expiresAt = new Date(windowStart + 2 * 60_000).toISOString()
  const key = `${principal.tenantId}:${principal.id}:${c.req.method}:${new URL(c.req.url).pathname}`
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limit_buckets (key, window_start, count, expires_at)
     VALUES (?1, ?2, 1, ?3)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1, expires_at = excluded.expires_at
     RETURNING count`,
  )
    .bind(key, windowStart, expiresAt)
    .first<{ count: number }>()
  const count = row?.count ?? limit + 1
  c.header('x-ratelimit-limit', String(limit))
  c.header('x-ratelimit-remaining', String(Math.max(0, limit - count)))
  c.header('x-ratelimit-reset', String(Math.floor(now / 60_000) * 60 + 60))
  if (count > limit) {
    c.header('retry-after', '60')
    throw new HttpError(429, 'rate_limited', 'Rate limit exceeded')
  }
  await next()
})
