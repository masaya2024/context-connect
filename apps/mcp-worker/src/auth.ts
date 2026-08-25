import type { Env, Principal, Role } from './types'

const encoder = new TextEncoder()

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function authenticate(
  request: Request,
  env: Env,
): Promise<{ principal: Principal; token: string }> {
  if (env.ALLOW_DEV_AUTH === 'true') {
    const id = request.headers.get('x-dev-member-id')
    const tenantId = request.headers.get('x-dev-tenant-id')
    if (id && tenantId) {
      return {
        token: 'development-token-not-for-production',
        principal: {
          id,
          tenantId,
          role: (request.headers.get('x-dev-role') ?? 'developer') as Role,
          workspaceIds: split(request.headers.get('x-dev-workspace-ids')),
          projectIds: split(request.headers.get('x-dev-project-ids')),
          sourceConnectionIds: split(request.headers.get('x-dev-source-ids')),
          scopes: split(request.headers.get('x-dev-scopes') ?? '*'),
          clientId: 'local-development',
          expiresAt: null,
        },
      }
    }
  }
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer '))
    throw new AuthError('unauthorized', 'Bearer access token required')
  const token = authorization.slice(7).trim()
  if (token.length < 24) throw new AuthError('invalid_token', 'Invalid access token')
  const tokenHash = await sha256(token)
  const row = await env.DB.prepare(
    `SELECT t.member_id, t.client_id, t.scopes_json, t.expires_at, m.tenant_id, m.role
       FROM oauth_access_tokens t
       JOIN members m ON m.tenant_id = t.tenant_id AND m.id = t.member_id
      WHERE t.token_hash = ?1 AND t.revoked_at IS NULL AND t.expires_at > ?2
        AND m.status = 'active' LIMIT 1`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{
      member_id: string
      client_id: string
      scopes_json: string
      expires_at: string
      tenant_id: string
      role: Role
    }>()
  if (!row) throw new AuthError('invalid_token', 'Invalid or expired access token')
  const [projects, sources] = await Promise.all([
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
  const projectIds = projects.results.map((entry) => entry.project_id)
  const workspaceIds =
    projectIds.length > 0
      ? (
          await env.DB.prepare(
            `SELECT DISTINCT workspace_id FROM projects WHERE tenant_id = ?1
        AND id IN (${projectIds.map(() => '?').join(',')})`,
          )
            .bind(row.tenant_id, ...projectIds)
            .all<{ workspace_id: string }>()
        ).results.map((entry) => entry.workspace_id)
      : []
  return {
    token,
    principal: {
      id: row.member_id,
      tenantId: row.tenant_id,
      role: row.role,
      workspaceIds,
      projectIds,
      sourceConnectionIds: sources.results.map((entry) => entry.source_connection_id),
      scopes: parseArray(row.scopes_json),
      clientId: row.client_id,
      expiresAt: row.expires_at,
    },
  }
}

export function scopeAllows(principal: Principal, scope: string): boolean {
  if (principal.scopes.includes('*') || principal.scopes.includes(scope)) return true
  const namespace = scope.split(':', 1)[0]
  if (principal.scopes.includes(`${namespace}:*`)) return true
  // knowledge:read implies every read-only MCP tool scope, including projects:read.
  const knowledgeSubscopes = new Set([
    'tasks:read',
    'pull_requests:read',
    'history:read',
    'projects:read',
  ])
  return knowledgeSubscopes.has(scope) && principal.scopes.includes('knowledge:read')
}

export function requireScope(principal: Principal, scope: string): void {
  if (!scopeAllows(principal, scope))
    throw new AuthError('insufficient_scope', `Required scope: ${scope}`)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function split(value: string | null): string[] {
  return (
    value
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  )
}
function parseArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}
