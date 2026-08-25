import { describe, expect, it } from 'vitest'
import type {
  KnowledgeDocument,
  NormalizedKnowledgeDocument,
  Principal,
  SearchHit,
} from '@context-connect/contracts'
import {
  HybridSearchEngine,
  WorkersAiEmbeddingProvider,
  buildContextPack,
  buildExplicitTaskRelations,
  buildGitHubHierarchyRelations,
  chunkDocument,
  extractNotionPageId,
  scoreInferredRelation,
  stableChecksum,
} from '../src/index'

const timestamp = '2026-08-25T00:00:00.000Z'

function document(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: 'doc-1',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    projectId: 'project-a',
    sourceConnectionId: 'source-a',
    source: 'notion',
    type: 'task',
    externalId: '0123456789abcdef0123456789abcdef',
    canonicalUrl: 'https://www.notion.so/Task-0123456789abcdef0123456789abcdef',
    title: '請求処理',
    contentRef: 'r2://doc-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {},
    visibilityScope: { workspaceIds: [], projectIds: [], sourceConnectionIds: [] },
    checksum: 'checksum',
    sourceRevision: 'revision',
    ...overrides,
  }
}

describe('stable knowledge primitives', () => {
  it('hashes objects independent of key order', async () => {
    expect(await stableChecksum({ b: 2, a: 1 })).toBe(await stableChecksum({ a: 1, b: 2 }))
  })

  it('creates stable, bounded chunks', async () => {
    const normalized = {
      ...document(),
      contentRef: undefined,
      content: '請求処理の設計。'.repeat(300),
    } satisfies NormalizedKnowledgeDocument
    const first = await chunkDocument(normalized, { maxTokens: 50, overlapTokens: 5 })
    const second = await chunkDocument(normalized, { maxTokens: 50, overlapTokens: 5 })
    expect(first.length).toBeGreaterThan(1)
    expect(first.map((chunk) => chunk.id)).toEqual(second.map((chunk) => chunk.id))
    expect(Math.max(...first.map((chunk) => chunk.tokenEstimate))).toBeLessThanOrEqual(50)
  })
})

describe('relations', () => {
  it('extracts a Notion page id and creates a confirmed explicit relation', async () => {
    const url = 'https://www.notion.so/acme/Task-0123456789abcdef0123456789abcdef?pvs=4'
    expect(extractNotionPageId(url)).toBe('0123456789abcdef0123456789abcdef')
    const relations = await buildExplicitTaskRelations({
      pullRequest: document({
        id: 'pr-1',
        source: 'github',
        type: 'pull_request',
        externalId: 'acme/repo#12',
        canonicalUrl: 'https://github.com/acme/repo/pull/12',
      }),
      pullRequestBody: `Implements ${url}`,
      tasks: [document()],
      now: new Date(timestamp),
    })
    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({
      confidence: 1,
      linkMode: 'explicit',
      reviewStatus: 'confirmed',
    })
  })

  it('uses the documented 30/20/20/15/10/5 scoring weights', () => {
    const result = scoreInferredRelation({
      titleBodySimilarity: 1,
      dateProximity: 1,
      authorMatch: 1,
      projectRepositoryMatch: 1,
      keywordFileSimilarity: 0,
      commitMessageSimilarity: 0,
    })
    expect(result.confidence).toBe(0.85)
    expect(result.band).toBe('candidate')
  })

  it('creates authoritative PR-to-commit history edges', async () => {
    const pullRequest = document({ id: 'pr-1', source: 'github', type: 'pull_request' })
    const commit = document({
      id: 'commit-1',
      source: 'github',
      type: 'commit',
      metadata: { parentPullRequestId: 'pr-1' },
    })
    const relations = await buildGitHubHierarchyRelations({
      pullRequest,
      children: [commit],
      now: new Date(timestamp),
    })
    expect(relations[0]).toMatchObject({
      relationType: 'pr_commit',
      confidence: 1,
      reviewStatus: 'confirmed',
    })
  })
})

describe('embedding adapter', () => {
  it('defaults to multilingual bge-m3 and validates dimensions', async () => {
    const provider = new WorkersAiEmbeddingProvider({
      async run() {
        return { data: [Array.from({ length: 1024 }, () => 0.25)] }
      },
    })
    expect(provider.model).toBe('@cf/baai/bge-m3')
    expect((await provider.embed(['日本語']))[0]).toHaveLength(1024)
  })
})

describe('hybrid retrieval', () => {
  const principal: Principal = {
    id: 'user',
    tenantId: 'tenant-a',
    role: 'developer',
    workspaceIds: ['workspace-a'],
    projectIds: ['project-a'],
    sourceConnectionIds: ['source-a'],
    scopes: ['knowledge:read'],
  }

  it('applies ACL and makes exact identifiers outrank semantic matches', async () => {
    const exact = document({ externalId: 'TASK-42', title: 'Exact' })
    const semantic = document({ id: 'doc-2', externalId: 'TASK-2', title: 'Semantic' })
    const forbidden = document({ id: 'doc-3', projectId: 'secret', externalId: 'TASK-3' })
    const engine = new HybridSearchEngine(
      {
        exact: {
          async searchExact() {
            return [{ document: exact, score: 1 }]
          },
        },
        keyword: {
          async searchKeyword() {
            return [{ document: forbidden, score: 1 }]
          },
        },
        semantic: {
          async searchSemantic() {
            return [{ document: semantic, score: 1 }]
          },
        },
      },
      () => new Date(timestamp),
    )
    const output = await engine.search(principal, { query: 'TASK-42', filters: {}, limit: 10 })
    expect(output.results.map((hit) => hit.document.id)).toEqual(['doc-1', 'doc-2'])
  })

  it('builds a bounded context pack with source provenance', () => {
    const hit: SearchHit = {
      document: document(),
      snippet: 'a'.repeat(100),
      relations: [],
      score: { exact: 0, keyword: 1, semantic: 0, relation: 0, recency: 1, total: 1 },
    }
    const pack = buildContextPack('query', [hit], { maxCharacters: 20, maxCharactersPerItem: 20 })
    expect(pack.characterCount).toBe(20)
    expect(pack.truncated).toBe(true)
    expect(pack.items[0]?.sourceUrl).toBe(document().canonicalUrl)
  })
})
