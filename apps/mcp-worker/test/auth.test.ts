import { describe, expect, it } from 'vitest'
import { scopeAllows } from '../src/auth'
import type { Principal } from '../src/types'

const principal: Principal = {
  id: 'm',
  tenantId: 't',
  role: 'developer',
  workspaceIds: [],
  projectIds: [],
  sourceConnectionIds: [],
  scopes: ['knowledge:read'],
  clientId: 'c',
  expiresAt: null,
}

const viewer: Principal = { ...principal, role: 'viewer' }
const owner: Principal = { ...principal, role: 'owner', scopes: ['*'] }
const profileOnly: Principal = { ...principal, scopes: ['profile:read'] }

describe('MCP scopes', () => {
  it('lets the broad read scope cover all read-only tools', () => {
    expect(scopeAllows(principal, 'tasks:read')).toBe(true)
    expect(scopeAllows(principal, 'history:read')).toBe(true)
    expect(scopeAllows(principal, 'relations:write')).toBe(false)
  })

  // Regression: get_project_context requires projects:read, which is absent from the
  // auth SCOPES list and from every role grant. Without the implication below, any
  // principal other than an owner lost one of the eight read-only tools.
  it('covers get_project_context for non-owner principals', () => {
    expect(scopeAllows(principal, 'projects:read')).toBe(true)
    expect(scopeAllows(viewer, 'projects:read')).toBe(true)
    expect(scopeAllows(owner, 'projects:read')).toBe(true)
  })

  it('keeps every read-only MCP tool scope reachable from knowledge:read', () => {
    for (const scope of ['tasks:read', 'pull_requests:read', 'history:read', 'projects:read']) {
      expect(scopeAllows(principal, scope)).toBe(true)
    }
  })

  it('does not widen scopes beyond the read-only tool set', () => {
    expect(scopeAllows(profileOnly, 'projects:read')).toBe(false)
    expect(scopeAllows(profileOnly, 'knowledge:read')).toBe(false)
    expect(scopeAllows(principal, 'projects:write')).toBe(false)
    expect(scopeAllows(principal, 'system:write')).toBe(false)
  })
})
