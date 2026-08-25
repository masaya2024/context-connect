import { describe, expect, it } from 'vitest'
import type { KnowledgeDocument, Principal } from '@context-connect/contracts'
import { ForbiddenError, canAccessDocument, principalSearchFilters } from '../src/index'

const principal: Principal = {
  id: 'user-1',
  tenantId: 'tenant-a',
  role: 'developer',
  workspaceIds: ['workspace-1'],
  projectIds: ['project-1'],
  sourceConnectionIds: ['source-1'],
  scopes: ['knowledge:read'],
}

const document: KnowledgeDocument = {
  id: 'doc-1',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  sourceConnectionId: 'source-1',
  source: 'notion',
  type: 'task',
  externalId: 'task-1',
  canonicalUrl: 'https://www.notion.so/task-1',
  title: 'Task',
  contentRef: 'r2://task-1',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  metadata: {},
  visibilityScope: { workspaceIds: [], projectIds: [], sourceConnectionIds: [] },
  checksum: 'sum',
  sourceRevision: 'v1',
}

describe('ACL', () => {
  it('allows an explicitly permitted project and rejects cross-tenant data', () => {
    expect(canAccessDocument(principal, document)).toBe(true)
    expect(canAccessDocument(principal, { ...document, tenantId: 'tenant-b' })).toBe(false)
  })

  it('injects tenant and intersects requested project filters', () => {
    expect(principalSearchFilters(principal, { projectIds: ['project-1'] })).toMatchObject({
      tenantId: 'tenant-a',
      projectIds: ['project-1'],
    })
    expect(() => principalSearchFilters(principal, { projectIds: ['project-2'] })).toThrow(
      ForbiddenError,
    )
  })

  it('fails closed when a principal has no project assignment', () => {
    expect(() => principalSearchFilters({ ...principal, projectIds: [] }, {})).toThrow(
      ForbiddenError,
    )
  })
})
