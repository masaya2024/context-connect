import type { Context, MiddlewareHandler } from 'hono'
import type { AppBindings, Principal } from './types'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export function requestIdMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const supplied = c.req.header('x-request-id')
    const requestId =
      supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID()
    c.set('requestId', requestId)
    await next()
    c.header('x-request-id', requestId)
  }
}

export function jsonOk(c: Context<AppBindings>, data: unknown, status = 200): Response {
  return c.json({ request_id: c.get('requestId'), data }, status as never)
}

export function requireRole(principal: Principal, roles: RoleLike[]): void {
  if (!roles.includes(principal.role)) {
    throw new HttpError(403, 'forbidden', 'The current role cannot perform this operation')
  }
}

type RoleLike = Principal['role']

export function requireScope(principal: Principal, scope: string): void {
  if (
    !principal.scopes.includes('*') &&
    !principal.scopes.includes(scope) &&
    !principal.scopes.includes(scope.replace(/:[^:]+$/, ':*'))
  ) {
    throw new HttpError(403, 'insufficient_scope', `Required scope: ${scope}`)
  }
}

export function onError(error: Error, c: Context<AppBindings>): Response {
  const safe =
    error instanceof HttpError
      ? error
      : new HttpError(500, 'internal_error', 'An unexpected error occurred')
  if (!(error instanceof HttpError)) {
    console.error(
      JSON.stringify({
        request_id: c.get('requestId'),
        event: 'unhandled_api_error',
        error: error.name,
        message: error.message,
      }),
    )
  }
  return c.json(
    {
      request_id: c.get('requestId'),
      error: {
        code: safe.code,
        message: safe.message,
        ...(safe.details === undefined ? {} : { details: safe.details }),
      },
    },
    safe.status as never,
  )
}

export function notFound(c: Context<AppBindings>): Response {
  return c.json(
    {
      request_id: c.get('requestId'),
      error: { code: 'not_found', message: 'Route not found' },
    },
    404,
  )
}
