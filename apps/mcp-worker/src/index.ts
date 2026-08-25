import { createMcpHandler } from 'agents/mcp/server'
import { authenticate, AuthError } from './auth'
import { createContextServer } from './server'
import type { Env } from './types'

async function fetchHandler(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const requestId = validRequestId(request.headers.get('x-request-id')) ?? crypto.randomUUID()
  if (url.pathname === '/health') {
    return json({ request_id: requestId, status: 'ok', service: 'mcp-worker' }, 200, requestId)
  }
  if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
    return json(
      {
        resource: `${url.origin}/mcp`,
        authorization_servers: [env.OAUTH_ISSUER ?? url.origin],
        scopes_supported: [
          'knowledge:read',
          'tasks:read',
          'pull_requests:read',
          'history:read',
          'projects:read',
        ],
        bearer_methods_supported: ['header'],
      },
      200,
      requestId,
    )
  }
  if (url.pathname !== '/mcp')
    return json({ request_id: requestId, error: { code: 'not_found' } }, 404, requestId)
  if (!hostAllowed(url.hostname, env.MCP_ALLOWED_HOSTNAMES)) {
    return json({ request_id: requestId, error: { code: 'invalid_host' } }, 403, requestId)
  }
  if (request.method === 'OPTIONS') return preflight(request, env, requestId)

  try {
    const { principal, token } = await authenticate(request, env)
    const handler = createMcpHandler(() => createContextServer(env, principal), {
      route: '/mcp',
      legacy: 'reject',
      responseMode: 'json',
      corsOptions: false,
      allowedOriginHostnames: splitConfig(env.MCP_ALLOWED_ORIGINS),
      onerror(error) {
        console.error(
          JSON.stringify({ request_id: requestId, event: 'mcp_error', error: error.name }),
        )
      },
    })
    const response = await handler.fetch(request, {
      authInfo: {
        token,
        clientId: principal.clientId,
        scopes: principal.scopes,
        ...(principal.expiresAt
          ? { expiresAt: Math.floor(new Date(principal.expiresAt).valueOf() / 1000) }
          : {}),
        extra: { memberId: principal.id, tenantId: principal.tenantId },
      },
    })
    const headers = new Headers(response.headers)
    headers.set('x-request-id', requestId)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return json(
        { request_id: requestId, error: { code: error.code, message: error.message } },
        error.code === 'insufficient_scope' ? 403 : 401,
        requestId,
        {
          'www-authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      )
    }
    console.error(
      JSON.stringify({
        request_id: requestId,
        event: 'mcp_unhandled_error',
        error: error instanceof Error ? error.name : 'unknown',
      }),
    )
    return json({ request_id: requestId, error: { code: 'internal_error' } }, 500, requestId)
  }
}

function preflight(request: Request, env: Env, requestId: string): Response {
  const origin = request.headers.get('origin')
  if (!origin)
    return json({ request_id: requestId, error: { code: 'origin_required' } }, 403, requestId)
  const hostname = new URL(origin).hostname
  if (!hostAllowed(hostname, env.MCP_ALLOWED_ORIGINS)) {
    return json({ request_id: requestId, error: { code: 'origin_not_allowed' } }, 403, requestId)
  }
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers':
        'authorization, content-type, mcp-protocol-version, x-request-id',
      'access-control-max-age': '86400',
      vary: 'Origin',
      'x-request-id': requestId,
    },
  })
}

function hostAllowed(hostname: string, configured: string | undefined): boolean {
  const allowed = splitConfig(configured)
  return (
    allowed.length === 0 ||
    allowed.includes(hostname) ||
    (hostname.endsWith('.workers.dev') && allowed.includes('*.workers.dev'))
  )
}

function splitConfig(value: string | undefined): string[] {
  return (
    value
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  )
}

function validRequestId(value: string | null): string | null {
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : null
}

function json(
  body: unknown,
  status: number,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
      ...extraHeaders,
    },
  })
}

export { fetchHandler }
export default { fetch: fetchHandler }
