import { describe, expect, it } from 'vitest'
import { normalizeMarkdown, parseFrontMatter } from '../src/index'

const config = {
  scope: {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    projectId: 'project-a',
    sourceConnectionId: 'markdown-a',
    visibilityScope: { workspaceIds: [], projectIds: [], sourceConnectionIds: [] },
  },
  canonicalBaseUrl: 'https://context-connect.invalid/markdown/',
  defaultType: 'document' as const,
}

describe('Markdown normalizer', () => {
  it('parses scalar and list front matter', () => {
    const parsed = parseFrontMatter(
      '---\ntitle: Billing ADR\ntags:\n  - billing\n  - security\n---\n# Body',
    )
    expect(parsed.attributes).toMatchObject({ title: 'Billing ADR', tags: ['billing', 'security'] })
    expect(parsed.body).toBe('# Body')
  })

  it('uses front matter and creates stable path identity', async () => {
    const input = {
      sourcePath: 'docs/adr/billing.md',
      modifiedAt: '2026-08-25T00:00:00Z',
      content:
        '---\ntitle: Billing ADR\nauthor: alice\ntype: document\n---\n# Decision\nUse idempotency keys.',
    }
    const first = await normalizeMarkdown(input, config)
    const second = await normalizeMarkdown(
      { ...input, content: `${input.content}\nMore detail.` },
      config,
    )
    expect(first.id).toBe(second.id)
    expect(first).toMatchObject({
      title: 'Billing ADR',
      authorId: 'alice',
      canonicalUrl: 'https://context-connect.invalid/markdown/docs/adr/billing.md',
    })
    expect(first.content).toContain('Use idempotency keys')
  })
})
