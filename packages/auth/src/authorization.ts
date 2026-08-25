export const ROLES = ['owner', 'admin', 'developer', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const SCOPES = [
  'profile:read',
  'knowledge:read',
  'connector:read',
  'connector:write',
  'sources:read',
  'sources:write',
  'import:write',
  'imports:write',
  'sync:read',
  'sync:write',
  'relation:read',
  'relation:write',
  'relations:read',
  'relations:write',
  'member:read',
  'member:write',
  'members:read',
  'members:write',
  'audit:read',
  'system:read',
  'system:write',
  'mcp:connect',
] as const
export type Scope = (typeof SCOPES)[number]
export type GrantedScope = Scope | '*'

export const PROJECT_PERMISSIONS = ['viewer', 'developer', 'admin'] as const
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number]

export const ROLE_SCOPES: Readonly<Record<Role, readonly GrantedScope[]>> = {
  owner: ['*'],
  admin: [
    'profile:read',
    'knowledge:read',
    'connector:read',
    'connector:write',
    'import:write',
    'sync:read',
    'sync:write',
    'relation:read',
    'relation:write',
    'member:read',
    'member:write',
    'audit:read',
    'system:read',
    'mcp:connect',
  ],
  developer: [
    'profile:read',
    'knowledge:read',
    'connector:read',
    'sync:read',
    'sync:write',
    'import:write',
    'relation:read',
    'relation:write',
    'mcp:connect',
  ],
  viewer: ['profile:read', 'knowledge:read', 'connector:read', 'sync:read', 'relation:read'],
}

export interface Principal {
  tenantId: string
  memberId: string
  subject: string
  role: Role
  status: 'active' | 'suspended'
  /** OAuth scopes narrow role permissions; they can never expand them. */
  tokenScopes?: readonly GrantedScope[]
  workspaceIds?: readonly string[]
  projectPermissions?: Readonly<Record<string, ProjectPermission>>
  sourcePermissions?: Readonly<Record<string, ProjectPermission>>
}

export interface AuthorizationRequest {
  tenantId: string
  scope: Scope
  workspaceId?: string
  projectId?: string
  sourceConnectionId?: string
  minimumProjectPermission?: ProjectPermission
  minimumSourcePermission?: ProjectPermission
}

export type AuthorizationDenialCode =
  | 'PRINCIPAL_INACTIVE'
  | 'TENANT_MISMATCH'
  | 'ROLE_SCOPE_DENIED'
  | 'TOKEN_SCOPE_DENIED'
  | 'WORKSPACE_DENIED'
  | 'PROJECT_DENIED'
  | 'SOURCE_DENIED'

export type AuthorizationDecision =
  { allowed: true } | { allowed: false; code: AuthorizationDenialCode; reason: string }

const permissionRank: Readonly<Record<ProjectPermission, number>> = {
  viewer: 1,
  developer: 2,
  admin: 3,
}

const scopeAliases: Partial<Record<Scope, Scope>> = {
  'sources:read': 'connector:read',
  'sources:write': 'connector:write',
  'imports:write': 'import:write',
  'relations:read': 'relation:read',
  'relations:write': 'relation:write',
  'members:read': 'member:read',
  'members:write': 'member:write',
}

function canonicalScope(scope: Scope): Scope {
  return scopeAliases[scope] ?? scope
}

function includesScope(scopes: readonly GrantedScope[], scope: Scope): boolean {
  const requested = canonicalScope(scope)
  return scopes.some((granted) => granted === '*' || canonicalScope(granted) === requested)
}

function isTenantAdministrator(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}

function hasMinimumPermission(
  actual: ProjectPermission | undefined,
  minimum: ProjectPermission,
): boolean {
  return actual !== undefined && permissionRank[actual] >= permissionRank[minimum]
}

/**
 * Default-deny authorization. Role permissions are the ceiling, an OAuth token
 * may narrow them, and resource ACLs are applied last.
 */
export function authorize(
  principal: Principal,
  request: AuthorizationRequest,
): AuthorizationDecision {
  if (principal.status !== 'active') {
    return {
      allowed: false,
      code: 'PRINCIPAL_INACTIVE',
      reason: 'The principal is not active',
    }
  }
  if (principal.tenantId !== request.tenantId) {
    return {
      allowed: false,
      code: 'TENANT_MISMATCH',
      reason: 'Cross-tenant access is not permitted',
    }
  }
  if (!includesScope(ROLE_SCOPES[principal.role], request.scope)) {
    return {
      allowed: false,
      code: 'ROLE_SCOPE_DENIED',
      reason: 'The role does not grant the requested scope',
    }
  }
  if (principal.tokenScopes && !includesScope(principal.tokenScopes, request.scope)) {
    return {
      allowed: false,
      code: 'TOKEN_SCOPE_DENIED',
      reason: 'The access token does not grant the requested scope',
    }
  }

  if (!isTenantAdministrator(principal.role)) {
    if (
      request.workspaceId &&
      !request.projectId &&
      !principal.workspaceIds?.includes(request.workspaceId)
    ) {
      return {
        allowed: false,
        code: 'WORKSPACE_DENIED',
        reason: 'The principal has no access to the workspace',
      }
    }
    if (
      request.projectId &&
      !hasMinimumPermission(
        principal.projectPermissions?.[request.projectId],
        request.minimumProjectPermission ?? 'viewer',
      )
    ) {
      return {
        allowed: false,
        code: 'PROJECT_DENIED',
        reason: 'The principal has insufficient project access',
      }
    }
    if (
      request.sourceConnectionId &&
      !hasMinimumPermission(
        principal.sourcePermissions?.[request.sourceConnectionId],
        request.minimumSourcePermission ?? 'viewer',
      )
    ) {
      return {
        allowed: false,
        code: 'SOURCE_DENIED',
        reason: 'The principal has insufficient source access',
      }
    }
  }

  return { allowed: true }
}

export function can(principal: Principal, request: AuthorizationRequest): boolean {
  return authorize(principal, request).allowed
}

export class AuthorizationError extends Error {
  readonly code: AuthorizationDenialCode
  readonly status = 403

  constructor(code: AuthorizationDenialCode, message: string) {
    super(message)
    this.name = 'AuthorizationError'
    this.code = code
  }
}

export function assertAuthorized(
  principal: Principal,
  request: AuthorizationRequest,
): asserts principal is Principal {
  const decision = authorize(principal, request)
  if (!decision.allowed) {
    throw new AuthorizationError(decision.code, decision.reason)
  }
}

export function authorizedProjectIds(principal: Principal): '*' | string[] {
  if (isTenantAdministrator(principal.role)) return '*'
  return Object.keys(principal.projectPermissions ?? {})
}

export function authorizedSourceIds(principal: Principal): '*' | string[] {
  if (isTenantAdministrator(principal.role)) return '*'
  return Object.keys(principal.sourcePermissions ?? {})
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value)
}
