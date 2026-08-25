import { describe, expect, it } from 'vitest'
import { KnowledgeDocumentSchema, PrincipalSchema, SearchKnowledgeInputSchema } from '../src/index'

describe('contracts', () => {
  it('applies safe search defaults and caps result counts', () => {
    const parsed = SearchKnowledgeInputSchema.parse({ query: '請求処理' })
    expect(parsed.limit).toBe(10)
    expect(parsed.filters).toEqual({})
    expect(() => SearchKnowledgeInputSchema.parse({ query: 'x', limit: 21 })).toThrow()
  })

  it('requires explicit tenant identity on a principal', () => {
    expect(() => PrincipalSchema.parse({ id: 'u1', role: 'developer' })).toThrow()
  })

  it('rejects a malformed canonical source URL', () => {
    const result = KnowledgeDocumentSchema.safeParse({
      id: 'd1',
      tenantId: 't1',
      workspaceId: 'w1',
      source: 'github',
      type: 'pull_request',
      externalId: 'org/repo#1',
      canonicalUrl: 'not a url',
      title: 'PR',
      contentRef: 'r2://raw/d1',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      visibilityScope: {},
      checksum: 'abc',
      sourceRevision: '1',
    })
    expect(result.success).toBe(false)
  })
})
