import type { NormalizedKnowledgeDocument, VisibilityScope } from '@context-connect/contracts'

export interface ConnectorScope {
  tenantId: string
  workspaceId: string
  projectId?: string
  sourceConnectionId: string
  visibilityScope: VisibilityScope
}

export interface ConnectorValidation {
  valid: boolean
  errors: Array<{ field?: string; code: string; message: string }>
}

export interface DiscoveredSource {
  id: string
  name: string
  kind: string
  canonicalUrl?: string
  metadata: Record<string, unknown>
}

export interface ConnectorBatch<TRaw, TCursor = string> {
  items: TRaw[]
  cursor?: TCursor
  hasMore: boolean
  fetchedAt: string
}

export interface IncrementalSyncInput<TCursor = string> {
  since?: string
  cursor?: TCursor
}

export interface Connector<TConfig, TRaw, TCursor = string> {
  validateConfig(): Promise<ConnectorValidation>
  discover(cursor?: TCursor): Promise<ConnectorBatch<DiscoveredSource, TCursor>>
  fullSync(cursor?: TCursor): AsyncIterable<ConnectorBatch<TRaw, TCursor>>
  incrementalSync(
    input: IncrementalSyncInput<TCursor>,
  ): AsyncIterable<ConnectorBatch<TRaw, TCursor>>
  fetchById(id: string): Promise<TRaw | null>
  normalize(raw: TRaw): Promise<NormalizedKnowledgeDocument[]>
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class ConnectorHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'ConnectorHttpError'
  }
}

export async function parseJsonResponse<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after')
    const body = (await response.text()).slice(0, 2_000)
    throw new ConnectorHttpError(
      response.status,
      `connector_http_${response.status}`,
      `${operation} failed (${response.status}): ${body || response.statusText}`,
      retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined,
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function asIsoTimestamp(
  value: string | undefined,
  fallback = new Date(0).toISOString(),
): string {
  const date = new Date(value ?? fallback)
  if (!Number.isFinite(date.getTime())) return new Date(0).toISOString()
  return date.toISOString()
}

export async function collectSync<TRaw, TCursor>(
  batches: AsyncIterable<ConnectorBatch<TRaw, TCursor>>,
): Promise<TRaw[]> {
  const output: TRaw[] = []
  for await (const batch of batches) output.push(...batch.items)
  return output
}
