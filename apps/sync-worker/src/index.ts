import { Hono } from 'hono'
import { processJob, markJobFailure, retryDelay } from './jobs'
import type { Env, SourceConnection, SyncMessage } from './types'
import { ConnectorError } from './types'
import { verifyGitHubSignature } from './webhook'

const app = new Hono<{ Bindings: Env }>()

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'sync-worker', request_id: crypto.randomUUID() }),
)

app.post('/webhooks/github', async (c) => {
  const requestId = crypto.randomUUID()
  const event = c.req.header('x-github-event')
  const delivery = c.req.header('x-github-delivery')
  if (!event || !delivery || !/^[A-Za-z0-9-]{8,128}$/.test(delivery)) {
    return c.json({ request_id: requestId, error: { code: 'invalid_webhook_headers' } }, 400)
  }
  const raw = await c.req.text()
  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw)
    payload =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
  } catch {
    return c.json({ request_id: requestId, error: { code: 'invalid_json' } }, 400)
  }
  const repository = objectValue(payload.repository)
  const fullName = stringValue(repository.full_name)
  if (!fullName)
    return c.json({ request_id: requestId, error: { code: 'repository_missing' } }, 400)
  const source = await findGitHubSource(c.env, fullName)
  if (!source) return c.json({ request_id: requestId, error: { code: 'source_not_found' } }, 404)
  const configuredRef = stringValue(
    source.config.webhookSecretRef ?? source.config.webhook_secret_ref,
  )
  const secretValue = configuredRef ? c.env[configuredRef] : c.env.GITHUB_WEBHOOK_SECRET
  const secret = typeof secretValue === 'string' ? secretValue : undefined
  if (
    !secret ||
    !(await verifyGitHubSignature(secret, raw, c.req.header('x-hub-signature-256') ?? null))
  ) {
    return c.json({ request_id: requestId, error: { code: 'invalid_signature' } }, 401)
  }

  const jobId = crypto.randomUUID()
  const rawKey = `webhooks/${source.tenantId}/github/${delivery}.json`
  const now = new Date().toISOString()
  await c.env.RAW_BUCKET.put(rawKey, raw, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { event, delivery },
  })
  const insert = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO sync_jobs
       (id, tenant_id, source_connection_id, job_type, status, idempotency_key,
        request_id, payload_json, max_attempts, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'webhook', 'queued', ?4, ?5, ?6, 5, ?7, ?7)`,
  )
    .bind(
      jobId,
      source.tenantId,
      source.id,
      `github:${delivery}`,
      requestId,
      JSON.stringify({ event, delivery, rawKey }),
      now,
    )
    .run()
  if (!insert.meta.changes) {
    return c.json({ request_id: requestId, data: { accepted: true, duplicate: true } }, 202)
  }
  try {
    await c.env.SYNC_QUEUE.send({
      jobId,
      tenantId: source.tenantId,
      sourceConnectionId: source.id,
      kind: 'github_webhook',
      payload: { event, delivery, rawKey },
      requestId,
    })
  } catch {
    await c.env.DB.prepare(
      `UPDATE sync_jobs SET status = 'failed', error_code = 'queue_send_failed',
              error_message = 'Unable to enqueue webhook', finished_at = ?1, updated_at = ?1
        WHERE tenant_id = ?2 AND id = ?3`,
    )
      .bind(new Date().toISOString(), source.tenantId, jobId)
      .run()
    return c.json({ request_id: requestId, error: { code: 'queue_unavailable' } }, 503)
  }
  return c.json({ request_id: requestId, data: { accepted: true, job_id: jobId } }, 202)
})

async function queue(batch: MessageBatch<SyncMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processJob(env, message.body)
      message.ack()
    } catch (error) {
      const delay = retryDelay(error, message.attempts)
      const final = delay === 0 || message.attempts >= 5
      await markJobFailure(env, message.body, error, final)
      console.error(
        JSON.stringify({
          request_id: message.body.requestId,
          job_id: message.body.jobId,
          event: 'sync_job_error',
          code: error instanceof ConnectorError ? error.code : 'internal_sync_error',
          retry: !final,
        }),
      )
      if (final) message.ack()
      else message.retry({ delaySeconds: delay })
    }
  }
}

async function scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
  const sources = await env.DB.prepare(
    `SELECT id, tenant_id, type FROM source_connections
      WHERE status = 'active' AND type IN ('github', 'notion')`,
  ).all<{ id: string; tenant_id: string; type: string }>()
  for (const source of sources.results) {
    const active = await env.DB.prepare(
      `SELECT id FROM sync_jobs WHERE tenant_id = ?1 AND source_connection_id = ?2
        AND job_type = 'incremental' AND status IN ('queued', 'running') LIMIT 1`,
    )
      .bind(source.tenant_id, source.id)
      .first()
    if (active) continue
    const jobId = crypto.randomUUID()
    const requestId = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO sync_jobs
         (id, tenant_id, source_connection_id, job_type, status, request_id,
          payload_json, max_attempts, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'incremental', 'queued', ?4, '{}', 5, ?5, ?5)`,
    )
      .bind(jobId, source.tenant_id, source.id, requestId, now)
      .run()
    await env.SYNC_QUEUE.send({
      jobId,
      tenantId: source.tenant_id,
      sourceConnectionId: source.id,
      kind: 'incremental_sync',
      requestId,
    })
  }
}

async function findGitHubSource(env: Env, fullName: string): Promise<SourceConnection | null> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.tenant_id, s.workspace_id, s.type, s.config_json, s.secret_ref
       FROM source_connections s
       JOIN repositories r ON r.tenant_id = s.tenant_id AND r.source_connection_id = s.id
      WHERE s.type = 'github' AND s.status = 'active' AND r.selected = 1 AND r.full_name = ?1
      LIMIT 1`,
  )
    .bind(fullName)
    .first<{
      id: string
      tenant_id: string
      workspace_id: string | null
      type: 'github'
      config_json: string
      secret_ref: string | null
    }>()
  if (!row) return null
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
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export { app, queue, scheduled }
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx)
  },
  queue,
  scheduled,
}
