export type Role = 'owner' | 'admin' | 'developer' | 'viewer'

export interface Principal {
  id: string
  tenantId: string
  role: Role
  workspaceIds: string[]
  projectIds: string[]
  sourceConnectionIds: string[]
  scopes: string[]
  clientId: string
  expiresAt: string | null
}

export interface Env {
  DB: D1Database
  RAW_BUCKET: R2Bucket
  VECTOR_INDEX: VectorizeIndex
  AI: Ai
  ENVIRONMENT: string
  ALLOW_DEV_AUTH?: string
  EMBEDDING_MODEL?: string
  MAX_MCP_RESULTS?: string
  MAX_CONTEXT_CHARS?: string
  MCP_ALLOWED_HOSTNAMES?: string
  MCP_ALLOWED_ORIGINS?: string
  OAUTH_ISSUER?: string
}

export interface SearchFilters {
  project_id?: string
  repository_id?: string
  source?: 'github' | 'notion' | 'csv' | 'markdown'
  type?: 'task' | 'pull_request' | 'commit' | 'review' | 'document' | 'incident'
  author_id?: string
  date_from?: string
  date_to?: string
}

export interface SearchHit extends Record<string, unknown> {
  id: string
  type: string
  title: string
  external_id: string
  canonical_url: string | null
  score: number
  match_mode: string[]
}
