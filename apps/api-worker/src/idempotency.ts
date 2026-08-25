import type { Context } from 'hono'
import { HttpError } from './http'
import { sha256 } from './security'
import type { AppBindings, Principal } from './types'

export interface OperationResult {
  status: number
  data: unknown
}

export async function executeIdempotent(
  c: Context<AppBindings>,
  principal: Principal,
  operation: string,
  payload: unknown,
  execute: () => Promise<OperationResult>,
): Promise<OperationResult> {
  const key = c.req.header('idempotency-key')
  if (!key) return execute()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new HttpError(
      400,
      'invalid_idempotency_key',
      'Idempotency-Key must be 8-128 safe characters',
    )
  }
  const requestHash = await sha256(JSON.stringify({ operation, payload }))
  const stored = await c.env.DB.prepare(
    `SELECT request_hash, response_status, response_json
       FROM idempotency_keys
      WHERE tenant_id = ?1 AND key = ?2 AND expires_at > ?3`,
  )
    .bind(principal.tenantId, key, new Date().toISOString())
    .first<{
      request_hash: string
      response_status: number
      response_json: string
    }>()
  if (stored) {
    if (stored.request_hash !== requestHash) {
      throw new HttpError(
        409,
        'idempotency_conflict',
        'The key was already used with a different request',
      )
    }
    return { status: stored.response_status, data: JSON.parse(stored.response_json) as unknown }
  }

  const result = await execute()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO idempotency_keys
       (tenant_id, key, request_hash, response_status, response_json, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      principal.tenantId,
      key,
      requestHash,
      result.status,
      JSON.stringify(result.data),
      expiresAt,
      new Date().toISOString(),
    )
    .run()
  return result
}
