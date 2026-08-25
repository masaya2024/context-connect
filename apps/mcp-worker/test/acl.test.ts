import { describe, expect, it } from 'vitest'
import { documentAcl } from '../src/acl'
import type { Principal } from '../src/types'

describe('MCP ACL', () => {
  it('combines source and project as independent restrictions', () => {
    const principal: Principal = {
      id: 'm',
      tenantId: 't',
      role: 'developer',
      workspaceIds: ['w'],
      projectIds: ['p'],
      sourceConnectionIds: ['s'],
      scopes: ['knowledge:read'],
      clientId: 'c',
      expiresAt: null,
    }
    const acl = documentAcl(principal)
    expect(acl.sql).toContain('project_id IS NULL OR d.project_id IN (?)')
    expect(acl.sql).toContain('source_connection_id IS NULL OR d.source_connection_id IN (?)')
    expect(acl.params).toEqual(['w', 'p', 's'])
  })
})
