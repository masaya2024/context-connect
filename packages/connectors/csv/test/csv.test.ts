import { describe, expect, it } from 'vitest'
import { normalizeCsv, parseCsv } from '../src/index'

const config = {
  scope: {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    projectId: 'project-a',
    sourceConnectionId: 'csv-a',
    visibilityScope: { workspaceIds: [], projectIds: [], sourceConnectionIds: [] },
  },
  mapping: {
    externalId: 'ID',
    title: 'Title',
    content: 'Body',
    authorId: 'Assignee',
    createdAt: 'Created',
    metadata: { status: 'Status' },
  },
  delimiter: ',',
  defaultType: 'task' as const,
  canonicalBaseUrl: 'https://context-connect.invalid/imports/',
}

describe('CSV normalizer', () => {
  it('parses BOM, escaped quotes and multiline fields', () => {
    const parsed = parseCsv('\uFEFFID,Title,Body\r\n1,"Invoice, fix","line 1\nline ""2"""')
    expect(parsed.rows[0]).toMatchObject({
      ID: '1',
      Title: 'Invoice, fix',
      Body: 'line 1\nline "2"',
    })
  })

  it('creates stable IDs for duplicate-safe re-import', async () => {
    const csv = 'ID,Title,Body,Assignee,Created,Status\n42,請求処理,詳細,alice,2026-08-25,Done'
    const first = await normalizeCsv(
      { fileName: 'tasks.csv', content: csv, importedAt: '2026-08-25T00:00:00Z' },
      config,
    )
    const second = await normalizeCsv(
      { fileName: 'tasks.csv', content: csv, importedAt: '2026-08-26T00:00:00Z' },
      config,
    )
    expect(first[0]?.id).toBe(second[0]?.id)
    expect(first[0]).toMatchObject({
      externalId: 'csv:42',
      authorId: 'alice',
      createdAt: '2026-08-25T00:00:00.000Z',
    })
    expect(first[0]?.metadata.status).toBe('Done')
  })
})
