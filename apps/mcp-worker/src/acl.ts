import type { Principal } from './types'

export function documentAcl(principal: Principal, alias = 'd'): { sql: string; params: string[] } {
  if (principal.role === 'owner' || principal.role === 'admin') return { sql: '', params: [] }
  const clauses = [`(${alias}.project_id IS NOT NULL OR ${alias}.source_connection_id IS NOT NULL)`]
  const params: string[] = []
  if (principal.workspaceIds.length > 0) {
    clauses.push(`${alias}.workspace_id IN (${principal.workspaceIds.map(() => '?').join(',')})`)
    params.push(...principal.workspaceIds)
  } else clauses.push('1 = 0')
  if (principal.projectIds.length > 0) {
    clauses.push(
      `(${alias}.project_id IS NULL OR ${alias}.project_id IN (${principal.projectIds.map(() => '?').join(',')}))`,
    )
    params.push(...principal.projectIds)
  } else clauses.push(`${alias}.project_id IS NULL`)
  if (principal.sourceConnectionIds.length > 0) {
    clauses.push(
      `(${alias}.source_connection_id IS NULL OR ${alias}.source_connection_id IN (${principal.sourceConnectionIds.map(() => '?').join(',')}))`,
    )
    params.push(...principal.sourceConnectionIds)
  } else clauses.push(`${alias}.source_connection_id IS NULL`)
  return { sql: ` AND (${clauses.join(' AND ')})`, params }
}

export function canAccessProject(principal: Principal, projectId: string): boolean {
  return (
    principal.role === 'owner' ||
    principal.role === 'admin' ||
    principal.projectIds.includes(projectId)
  )
}
