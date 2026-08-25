import type { Context } from 'hono'
import type { AppBindings, Principal } from './types'

export async function writeAudit(
  c: Context<AppBindings>,
  principal: Principal,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await c.env.DB.prepare(
    `INSERT INTO audit_logs
       (id, tenant_id, actor_member_id, action, resource_type, resource_id, outcome,
        request_id, ip_address, user_agent, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'success', ?7, ?8, ?9, ?10, ?11)`,
  )
    .bind(
      crypto.randomUUID(),
      principal.tenantId,
      principal.id,
      action,
      resourceType,
      resourceId,
      c.get('requestId'),
      c.req.header('cf-connecting-ip') ?? null,
      (c.req.header('user-agent') ?? '').slice(0, 512),
      JSON.stringify(metadata),
      new Date().toISOString(),
    )
    .run()
}
