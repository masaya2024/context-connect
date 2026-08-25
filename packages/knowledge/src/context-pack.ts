import type { ContextPack, SearchHit } from '@context-connect/contracts'

export interface ContextPackOptions {
  maxItems?: number
  maxCharacters?: number
  maxCharactersPerItem?: number
}

function changedFiles(hit: SearchHit): string[] | undefined {
  const value = hit.document.metadata.changedFiles
  if (!Array.isArray(value)) return undefined
  const files = value.filter((item): item is string => typeof item === 'string')
  return files.length > 0 ? files : undefined
}

function bestRelation(hit: SearchHit) {
  return [...hit.relations].sort((left, right) => {
    const leftExplicit = left.linkMode === 'explicit' || left.reviewStatus === 'confirmed' ? 1 : 0
    const rightExplicit =
      right.linkMode === 'explicit' || right.reviewStatus === 'confirmed' ? 1 : 0
    return rightExplicit - leftExplicit || right.confidence - left.confidence
  })[0]
}

export function buildContextPack(
  query: string,
  hits: readonly SearchHit[],
  options: ContextPackOptions = {},
): ContextPack {
  const maxItems = Math.min(options.maxItems ?? 10, 20)
  const maxCharacters = options.maxCharacters ?? 12_000
  const maxCharactersPerItem = options.maxCharactersPerItem ?? 2_000
  if (maxItems < 1 || maxCharacters < 1 || maxCharactersPerItem < 1) {
    throw new RangeError('Context pack limits must be positive')
  }

  let remaining = maxCharacters
  let truncated = hits.length > maxItems
  const items: ContextPack['items'] = []

  for (const hit of hits.slice(0, maxItems)) {
    if (remaining <= 0) {
      truncated = true
      break
    }
    const sourceSummary = hit.snippet || hit.document.title
    const allowed = Math.min(maxCharactersPerItem, remaining)
    const summary = sourceSummary.slice(0, allowed)
    if (summary.length < sourceSummary.length) truncated = true
    const relation = bestRelation(hit)
    items.push({
      documentId: hit.document.id,
      type: hit.document.type,
      title: hit.document.title,
      summary,
      sourceUrl: hit.document.canonicalUrl,
      externalId: hit.document.externalId,
      confidence: relation?.confidence,
      linkMode: relation?.linkMode,
      changedFiles: changedFiles(hit),
    })
    remaining -= summary.length
  }

  return {
    query,
    items,
    truncated,
    characterCount: maxCharacters - remaining,
  }
}
