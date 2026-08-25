export type SourceType = 'github' | 'notion' | 'csv' | 'markdown'
export type DocumentType = 'task' | 'pull_request' | 'commit' | 'review' | 'document' | 'incident'

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

export interface SourceConnection {
  id: string
  tenantId: string
  workspaceId: string | null
  type: SourceType
  config: Record<string, unknown>
  secretRef: string | null
}

export interface RepositoryContext {
  id: string | null
  fullName: string
  projectId: string | null
  workspaceId: string
}

export interface NormalizedDocument {
  tenantId: string
  workspaceId: string
  projectId: string | null
  repositoryId: string | null
  sourceConnectionId: string
  source: SourceType
  type: DocumentType
  externalId: string
  canonicalUrl: string | null
  title: string
  content: string
  authorId: string | null
  createdAt: string | null
  updatedAt: string | null
  metadata: Record<string, unknown>
  visibilityScope: string
  sourceRevision: string
  raw: unknown
}

export interface IngestionResult {
  documentId: string
  state: 'created' | 'updated' | 'skipped'
}

export interface SyncCounters {
  fetched: number
  created: number
  updated: number
  skipped: number
  failed: number
}

export interface Env {
  DB: D1Database
  RAW_BUCKET: R2Bucket
  VECTOR_INDEX: VectorizeIndex
  AI: Ai
  SYNC_QUEUE: Queue<SyncMessage>
  ENVIRONMENT: string
  GITHUB_API_VERSION?: string
  NOTION_VERSION?: string
  EMBEDDING_MODEL?: string
  CHUNK_MAX_CHARS?: string
  CHUNK_OVERLAP_CHARS?: string
  MAX_SYNC_OBJECTS?: string
  GITHUB_TOKEN?: string
  GITHUB_WEBHOOK_SECRET?: string
  NOTION_TOKEN?: string
  SYNC_INTERNAL_TOKEN?: string
  [binding: string]: unknown
}

export class ConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}
