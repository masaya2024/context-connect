import type { KnowledgeChunk } from '@context-connect/contracts'

export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3'
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024

export interface EmbeddingProvider {
  readonly model: string
  readonly dimensions: number
  embed(texts: readonly string[]): Promise<number[][]>
}

export interface WorkersAiBinding {
  run(model: string, input: { text: string[] }): Promise<unknown>
}

function readEmbeddingRows(result: unknown): number[][] {
  if (!result || typeof result !== 'object' || !('data' in result)) {
    throw new TypeError('Workers AI embedding response does not contain data')
  }
  const data = (result as { data: unknown }).data
  if (!Array.isArray(data)) throw new TypeError('Workers AI embedding data must be an array')
  if (data.length === 0) return []
  if (typeof data[0] === 'number') return [data as number[]]
  if (!data.every((row) => Array.isArray(row) && row.every((value) => typeof value === 'number'))) {
    throw new TypeError('Workers AI returned an invalid embedding matrix')
  }
  return data as number[][]
}

export class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly ai: WorkersAiBinding,
    public readonly model = DEFAULT_EMBEDDING_MODEL,
    public readonly dimensions = DEFAULT_EMBEDDING_DIMENSIONS,
  ) {}

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const rows = readEmbeddingRows(await this.ai.run(this.model, { text: [...texts] }))
    if (rows.length !== texts.length) {
      throw new Error(`Embedding count mismatch: expected ${texts.length}, received ${rows.length}`)
    }
    for (const row of rows) {
      if (row.length !== this.dimensions) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimensions}, received ${row.length}`,
        )
      }
    }
    return rows
  }
}

export type VectorMetadataValue = string | number | boolean | string[]

export interface VectorRecord {
  id: string
  values: number[]
  metadata: Record<string, VectorMetadataValue>
}

export interface VectorMatch {
  id: string
  score: number
  metadata?: Record<string, VectorMetadataValue>
}

export interface VectorQuery {
  vector: number[]
  topK: number
  filter: Record<string, string | number | boolean | { $in: Array<string | number> }>
}

export interface VectorIndexPort {
  upsert(records: readonly VectorRecord[]): Promise<void>
  deleteByIds(ids: readonly string[]): Promise<void>
  query(input: VectorQuery): Promise<VectorMatch[]>
}

export async function indexChunks(
  chunks: readonly KnowledgeChunk[],
  embeddings: EmbeddingProvider,
  index: VectorIndexPort,
  batchSize = 32,
): Promise<number> {
  if (batchSize < 1) throw new RangeError('batchSize must be positive')
  let indexed = 0
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize)
    const vectors = await embeddings.embed(batch.map((chunk) => chunk.text))
    const records = batch.map((chunk, indexInBatch): VectorRecord => ({
      id: chunk.embeddingId,
      values: vectors[indexInBatch]!,
      metadata: {
        tenantId: chunk.tenantId,
        workspaceId: chunk.workspaceId,
        documentId: chunk.documentId,
        ...(chunk.projectId ? { projectId: chunk.projectId } : {}),
      },
    }))
    await index.upsert(records)
    indexed += records.length
  }
  return indexed
}
