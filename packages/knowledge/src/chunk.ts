import type { KnowledgeChunk, NormalizedKnowledgeDocument } from '@context-connect/contracts'
import { stableChecksum, stableId } from './checksum'

export interface ChunkOptions {
  maxTokens?: number
  overlapTokens?: number
}

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(Array.from(text).length / 4)
}

function chooseBoundary(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) return text.length
  const minimum = start + Math.floor((hardEnd - start) * 0.6)
  for (const marker of ['\n\n', '\n', '。', '. ', ' ']) {
    const boundary = text.lastIndexOf(marker, hardEnd)
    if (boundary >= minimum) return boundary + marker.length
  }
  return hardEnd
}

export async function chunkDocument(
  document: NormalizedKnowledgeDocument,
  options: ChunkOptions = {},
): Promise<KnowledgeChunk[]> {
  const maxTokens = options.maxTokens ?? 800
  const overlapTokens = options.overlapTokens ?? 100
  if (maxTokens < 1) throw new RangeError('maxTokens must be positive')
  if (overlapTokens < 0 || overlapTokens >= maxTokens) {
    throw new RangeError('overlapTokens must be non-negative and smaller than maxTokens')
  }

  const text = document.content.trim()
  if (!text) return []
  const maxCharacters = maxTokens * 4
  const overlapCharacters = overlapTokens * 4
  const chunks: KnowledgeChunk[] = []
  let start = 0

  while (start < text.length) {
    const end = chooseBoundary(text, start, Math.min(start + maxCharacters, text.length))
    const chunkText = text.slice(start, end).trim()
    if (chunkText) {
      const checksum = await stableChecksum(chunkText)
      const ordinal = chunks.length
      const id = await stableId('chunk', { documentId: document.id, ordinal, checksum })
      chunks.push({
        id,
        tenantId: document.tenantId,
        workspaceId: document.workspaceId,
        projectId: document.projectId,
        documentId: document.id,
        ordinal,
        text: chunkText,
        tokenEstimate: estimateTokens(chunkText),
        embeddingId: id,
        metadata: {
          source: document.source,
          type: document.type,
          externalId: document.externalId,
          sourceConnectionId: document.sourceConnectionId,
          repositoryId: document.repositoryId,
        },
        checksum,
      })
    }
    if (end >= text.length) break
    const next = end - overlapCharacters
    start = next > start ? next : end
  }
  return chunks
}
