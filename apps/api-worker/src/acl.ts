import { HttpError } from './http'
import type { Principal } from './types'

export interface SqlAcl {
  clause: string
  params: string[]
}

export function documentAcl(principal: Principal, alias = 'd'): SqlAcl {
  if (principal.role === 'owner' || principal.role === 'admin') return { clause: '', params: [] }
  const clauses: string[] = [
    `(${alias}.project_id IS NOT NULL OR ${alias}.source_connection_id IS NOT NULL)`,
  ]
  const params: string[] = []
  if (principal.workspaceIds.length > 0) {
    clauses.push(`${alias}.workspace_id IN (${principal.workspaceIds.map(() => '?').join(',')})`)
    params.push(...principal.workspaceIds)
  } else {
    // Non-administrators without an explicit workspace grant are denied by default.
    clauses.push('1 = 0')
  }
  if (principal.projectIds.length > 0) {
    clauses.push(
      `(${alias}.project_id IS NULL OR ${alias}.project_id IN (${principal.projectIds.map(() => '?').join(',')}))`,
    )
    params.push(...principal.projectIds)
  } else {
    clauses.push(`${alias}.project_id IS NULL`)
  }
  if (principal.sourceConnectionIds.length > 0) {
    clauses.push(
      `(${alias}.source_connection_id IS NULL OR ${alias}.source_connection_id IN (${principal.sourceConnectionIds.map(() => '?').join(',')}))`,
    )
    params.push(...principal.sourceConnectionIds)
  } else {
    clauses.push(`${alias}.source_connection_id IS NULL`)
  }
  return { clause: ` AND (${clauses.join(' AND ')})`, params }
}

export function assertProjectAccess(
  principal: Principal,
  projectId: string | null | undefined,
): void {
  if (!projectId || principal.role === 'owner' || principal.role === 'admin') return
  if (!principal.projectIds.includes(projectId)) {
    throw new HttpError(403, 'forbidden', 'Project access is not allowed')
  }
}

export function assertSourceAccess(principal: Principal, sourceId: string): void {
  if (principal.role === 'owner' || principal.role === 'admin') return
  if (!principal.sourceConnectionIds.includes(sourceId)) {
    throw new HttpError(403, 'forbidden', 'Source access is not allowed')
  }
}
