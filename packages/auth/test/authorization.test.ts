import { describe, expect, it } from 'vitest'

import {
  AuthorizationError,
  assertAuthorized,
  authorize,
  authorizedProjectIds,
  can,
  type Principal,
} from '../src/authorization'

const developer: Principal = {
  tenantId: 'tenant-a',
  memberId: 'member-1',
  subject: 'user-1',
  role: 'developer',
  status: 'active',
  tokenScopes: ['knowledge:read', 'relation:write', 'mcp:connect'],
  projectPermissions: { 'project-a': 'developer', 'project-readonly': 'viewer' },
  sourcePermissions: { github: 'viewer' },
}

describe('authorization', () => {
  it('requires tenant, role, token scope, and project ACL to all pass', () => {
    expect(
      can(developer, {
        tenantId: 'tenant-a',
        scope: 'relation:write',
        projectId: 'project-a',
        minimumProjectPermission: 'developer',
      }),
    ).toBe(true)
  })

  it('denies cross-tenant access before resource ACL evaluation', () => {
    expect(
      authorize(developer, {
        tenantId: 'tenant-b',
        scope: 'knowledge:read',
        projectId: 'project-a',
      }),
    ).toEqual({
      allowed: false,
      code: 'TENANT_MISMATCH',
      reason: 'Cross-tenant access is not permitted',
    })
  })

  it('does not let an OAuth token expand the role', () => {
    const viewerWithForgedScope: Principal = {
      ...developer,
      role: 'viewer',
      tokenScopes: ['member:write'],
    }
    expect(
      authorize(viewerWithForgedScope, { tenantId: 'tenant-a', scope: 'member:write' }),
    ).toMatchObject({ allowed: false, code: 'ROLE_SCOPE_DENIED' })
  })

  it('uses token scopes to narrow an otherwise permitted role', () => {
    expect(authorize(developer, { tenantId: 'tenant-a', scope: 'connector:read' })).toMatchObject({
      allowed: false,
      code: 'TOKEN_SCOPE_DENIED',
    })
  })

  it('normalizes REST scope aliases without expanding permissions', () => {
    const restPrincipal: Principal = {
      ...developer,
      tokenScopes: ['relations:write', 'sources:read', 'imports:write'],
    }
    expect(
      can(restPrincipal, {
        tenantId: 'tenant-a',
        scope: 'relation:write',
        projectId: 'project-a',
        minimumProjectPermission: 'developer',
      }),
    ).toBe(true)
    expect(can(restPrincipal, { tenantId: 'tenant-a', scope: 'imports:write' })).toBe(true)
    expect(can(restPrincipal, { tenantId: 'tenant-a', scope: 'sources:write' })).toBe(false)
  })

  it('enforces minimum project permission', () => {
    expect(
      authorize(developer, {
        tenantId: 'tenant-a',
        scope: 'relation:write',
        projectId: 'project-readonly',
        minimumProjectPermission: 'developer',
      }),
    ).toMatchObject({ allowed: false, code: 'PROJECT_DENIED' })
  })

  it('applies default deny when a project ACL is missing', () => {
    expect(
      authorize(developer, {
        tenantId: 'tenant-a',
        scope: 'knowledge:read',
        projectId: 'unknown',
      }),
    ).toMatchObject({ allowed: false, code: 'PROJECT_DENIED' })
  })

  it('lets tenant admins access same-tenant projects but not system writes', () => {
    const admin: Principal = {
      tenantId: 'tenant-a',
      memberId: 'admin-1',
      subject: 'admin',
      role: 'admin',
      status: 'active',
    }
    expect(
      can(admin, {
        tenantId: 'tenant-a',
        scope: 'knowledge:read',
        projectId: 'any-same-tenant-project',
      }),
    ).toBe(true)
    expect(can(admin, { tenantId: 'tenant-a', scope: 'system:write' })).toBe(false)
  })

  it('throws a machine-readable authorization error', () => {
    expect(() =>
      assertAuthorized(developer, { tenantId: 'tenant-a', scope: 'member:write' }),
    ).toThrowError(AuthorizationError)
  })

  it('returns explicit project filters for non-admin principals', () => {
    expect(authorizedProjectIds(developer)).toEqual(['project-a', 'project-readonly'])
  })
})
