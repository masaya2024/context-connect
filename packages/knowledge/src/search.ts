import type {
  KnowledgeDocument,
  KnowledgeRelation,
  Principal,
  SearchFilters,
  SearchHit,
  SearchKnowledgeInput,
  SearchKnowledgeOutput,
} from '@context-connect/contracts'
import { canAccessDocument, principalSearchFilters } from '@context-connect/core'

export interface SearchCandidate {
  document: KnowledgeDocument
  snippet?: string
  score: number
  relations?: KnowledgeRelation[]
}

export interface ExactSearchPort {
  searchExact(query: string, filters: SearchFilters, limit: number): Promise<SearchCandidate[]>
}

export interface KeywordSearchPort {
  searchKeyword(query: string, filters: SearchFilters, limit: number): Promise<SearchCandidate[]>
}

export interface SemanticSearchPort {
  searchSemantic(query: string, filters: SearchFilters, limit: number): Promise<SearchCandidate[]>
}

export interface RelationExpansionPort {
  expand(
    documentIds: readonly string[],
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchCandidate[]>
}

interface AccumulatedCandidate {
  document: KnowledgeDocument
  snippet: string
  exact: number
  keyword: number
  semantic: number
  relation: number
  relations: KnowledgeRelation[]
}

function recencyScore(updatedAt: string, now: Date): number {
  const age = Math.max(0, now.getTime() - new Date(updatedAt).getTime())
  return Math.exp(-age / (365 * 86_400_000))
}

function exactMatch(query: string, document: KnowledgeDocument): number {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return 0
  return [document.externalId, document.canonicalUrl, document.title]
    .map((value) => value.toLocaleLowerCase())
    .some((value) => value === normalized)
    ? 1
    : 0
}

export class HybridSearchEngine {
  constructor(
    private readonly ports: {
      exact: ExactSearchPort
      keyword: KeywordSearchPort
      semantic: SemanticSearchPort
      relations?: RelationExpansionPort
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(
    principal: Principal,
    rawInput: SearchKnowledgeInput,
  ): Promise<SearchKnowledgeOutput> {
    const filters = principalSearchFilters(principal, rawInput.filters)
    const requestedLimit = Math.min(rawInput.limit, 20)
    const candidateLimit = Math.max(20, requestedLimit * 3)
    const [exact, keyword, semantic] = await Promise.all([
      this.ports.exact.searchExact(rawInput.query, filters, candidateLimit),
      this.ports.keyword.searchKeyword(rawInput.query, filters, candidateLimit),
      this.ports.semantic.searchSemantic(rawInput.query, filters, candidateLimit),
    ])

    const merged = new Map<string, AccumulatedCandidate>()
    const merge = (
      candidate: SearchCandidate,
      channel: 'exact' | 'keyword' | 'semantic' | 'relation',
    ) => {
      if (!canAccessDocument(principal, candidate.document)) return
      const current = merged.get(candidate.document.id) ?? {
        document: candidate.document,
        snippet: candidate.snippet ?? '',
        exact: 0,
        keyword: 0,
        semantic: 0,
        relation: 0,
        relations: [],
      }
      current[channel] = Math.max(current[channel], Math.max(0, Math.min(1, candidate.score)))
      if (!current.snippet && candidate.snippet) current.snippet = candidate.snippet
      if (candidate.relations) {
        const byId = new Map(
          [...current.relations, ...candidate.relations].map((relation) => [relation.id, relation]),
        )
        current.relations = [...byId.values()].filter(
          (relation) => relation.reviewStatus !== 'rejected',
        )
      }
      current.exact = Math.max(current.exact, exactMatch(rawInput.query, candidate.document))
      merged.set(candidate.document.id, current)
    }
    exact.forEach((candidate) => merge(candidate, 'exact'))
    keyword.forEach((candidate) => merge(candidate, 'keyword'))
    semantic.forEach((candidate) => merge(candidate, 'semantic'))

    if (this.ports.relations && merged.size > 0) {
      const expanded = await this.ports.relations.expand(
        [...merged.keys()],
        filters,
        candidateLimit,
      )
      expanded.forEach((candidate) => merge(candidate, 'relation'))
    }

    const now = this.now()
    const hits: SearchHit[] = [...merged.values()].map((candidate) => {
      const explicitBoost = candidate.relations.some(
        (relation) => relation.linkMode === 'explicit' || relation.reviewStatus === 'confirmed',
      )
        ? 1
        : 0
      const relation = Math.max(candidate.relation, explicitBoost)
      const recency = recencyScore(candidate.document.updatedAt, now)
      const total =
        candidate.exact * 100 +
        candidate.keyword * 0.35 +
        candidate.semantic * 0.45 +
        relation * 0.15 +
        recency * 0.05
      return {
        document: candidate.document,
        snippet: candidate.snippet || candidate.document.title,
        relations: candidate.relations,
        score: {
          exact: candidate.exact,
          keyword: candidate.keyword,
          semantic: candidate.semantic,
          relation,
          recency,
          total,
        },
      }
    })

    hits.sort(
      (left, right) =>
        right.score.total - left.score.total ||
        right.document.updatedAt.localeCompare(left.document.updatedAt),
    )
    return { results: hits.slice(0, requestedLimit) }
  }
}
