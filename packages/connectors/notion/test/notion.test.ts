import { describe, expect, it } from 'vitest'
import { NotionConnector, type NotionPageSnapshot } from '../src/index'

const pageId = '01234567-89ab-cdef-0123-456789abcdef'
const page = {
  object: 'page' as const,
  id: pageId,
  url: 'https://www.notion.so/Task-0123456789abcdef0123456789abcdef',
  created_time: '2026-08-24T00:00:00Z',
  last_edited_time: '2026-08-25T00:00:00Z',
  created_by: { id: 'user-1' },
  last_edited_by: { id: 'user-2' },
  parent: { type: 'database_id', database_id: 'fedcba98-7654-3210-fedc-ba9876543210' },
  properties: {
    Name: { id: 'title', type: 'title', title: [{ plain_text: '請求タスク' }] },
    Status: { id: 'status', type: 'status', status: { name: 'In progress' } },
    Assignee: { id: 'people', type: 'people', people: [{ id: 'user-2', name: 'Alice' }] },
  },
}

const snapshot: NotionPageSnapshot = {
  page,
  sourceKind: 'database',
  configuredSourceId: 'fedcba98-7654-3210-fedc-ba9876543210',
  blocks: [
    {
      object: 'block',
      id: 'block-1',
      type: 'paragraph',
      has_children: false,
      paragraph: { rich_text: [{ plain_text: '請求処理の仕様です。' }] },
    },
  ],
}

const config = {
  token: 'notion-secret',
  scope: {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    sourceConnectionId: 'notion-a',
    visibilityScope: { workspaceIds: [], projectIds: [], sourceConnectionIds: [] },
  },
  sources: [
    { id: 'fedcba98-7654-3210-fedc-ba9876543210', kind: 'database' as const, projectId: 'billing' },
  ],
  apiBaseUrl: 'https://api.notion.test',
  notionVersion: '2022-06-28',
  pageSize: 50,
}

describe('NotionConnector', () => {
  it('maps generic properties and blocks into a task document', async () => {
    const connector = new NotionConnector(config)
    const [document] = await connector.normalize(snapshot)
    expect(document).toMatchObject({
      externalId: 'notion:0123456789abcdef0123456789abcdef',
      title: '請求タスク',
      type: 'task',
      projectId: 'billing',
      authorId: 'user-2',
      content: '請求処理の仕様です。',
    })
    expect(document?.metadata.status).toBe('In progress')
    expect(document?.metadata.assignee).toEqual(['Alice'])
  })

  it('fetches page metadata and block content through the HTTP adapter', async () => {
    const connector = new NotionConnector(config, async (input, init) => {
      const url = String(input)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer notion-secret')
      if (url.includes('/v1/pages/')) return Response.json(page)
      if (url.includes('/children')) {
        return Response.json({ results: snapshot.blocks, has_more: false, next_cursor: null })
      }
      return new Response('not found', { status: 404 })
    })
    const fetched = await connector.fetchById(pageId)
    expect(fetched?.blocks).toHaveLength(1)
  })
})
