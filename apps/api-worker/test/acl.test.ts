import { describe, expect, it } from 'vitest'
import { documentAcl } from '../src/acl'
import type { Principal } from '../src/types'

const principal: Principal = {
  id: 'member-1',
  tenantId: 'tenant-1',
  role: 'developer',
  workspaceIds: ['workspace-1'],
  projectIds: ['project-1'],
  sourceConnectionIds: ['source-1'],
  scopes: ['knowledge:read'],
}

describe('document ACL', () => {
  it('requires project and source constraints independently', () => {
    const acl = documentAcl(principal)
    expect(acl.clause).toContain('project_id IS NULL OR d.project_id IN (?)')
    expect(acl.clause).toContain('source_connection_id IS NULL OR d.source_connection_id IN (?)')
    expect(acl.clause).toContain(' AND ')
    expect(acl.params).toEqual(['workspace-1', 'project-1', 'source-1'])
  })
})
