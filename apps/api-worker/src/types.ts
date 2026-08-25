export type Role = 'owner' | 'admin' | 'developer' | 'viewer'

export interface Principal {
  id: string
  tenantId: string
  role: Role
  workspaceIds: string[]
  projectIds: string[]
  sourceConnectionIds: string[]
  scopes: string[]
}

export interface SyncMessage {
  jobId: string
  tenantId: string
  sourceConnectionId?: string
  kind:
    | 'full_sync'
    | 'incremental_sync'
    | 'github_webhook'
    | 'import_csv'
    | 'import_markdown'
    | 'reindex'
  payload?: Record<string, unknown>
  requestedBy?: string
  requestId: string
}

export interface Env {
  DB: D1Database
  RAW_BUCKET: R2Bucket
  SYNC_QUEUE: Queue<SyncMessage>
  ENVIRONMENT: string
  ALLOW_DEV_AUTH?: string
  RATE_LIMIT_PER_MINUTE?: string
  MAX_PAGE_SIZE?: string
}

export type AppVariables = {
  requestId: string
  principal: Principal
}

export type AppBindings = {
  Bindings: Env
  Variables: AppVariables
}
