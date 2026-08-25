import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import {
  auditLogs,
  chunks,
  documents,
  idempotencyKeys,
  imports,
  memberProjectAcl,
  memberSourceAcl,
  members,
  oauthAccessTokens,
  projects,
  rateLimitBuckets,
  relations,
  repositories,
  schemaMigrations,
  sourceConnections,
  syncCursors,
  syncJobs,
  tenants,
  workspaces,
} from '../src/schema'
import { RepositoryInputError, createTenantRepositories } from '../src/repositories'

describe('D1 schema', () => {
  it('exports every durable MVP table', () => {
    const tables = [
      tenants,
      workspaces,
      projects,
      members,
      memberProjectAcl,
      memberSourceAcl,
      sourceConnections,
      repositories,
      documents,
      chunks,
      relations,
      syncJobs,
      syncCursors,
      imports,
      auditLogs,
      oauthAccessTokens,
      idempotencyKeys,
      rateLimitBuckets,
      schemaMigrations,
    ]

    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      'tenants',
      'workspaces',
      'projects',
      'members',
      'member_project_acl',
      'member_source_acl',
      'source_connections',
      'repositories',
      'documents',
      'chunks',
      'relations',
      'sync_jobs',
      'sync_cursors',
      'imports',
      'audit_logs',
      'oauth_access_tokens',
      'idempotency_keys',
      'rate_limit_buckets',
      'schema_migrations',
    ])
  })

  it('puts a tenant boundary on all content and access tables', () => {
    for (const table of [
      workspaces,
      projects,
      members,
      memberProjectAcl,
      memberSourceAcl,
      sourceConnections,
      repositories,
      documents,
      chunks,
      relations,
      syncJobs,
      syncCursors,
      imports,
      auditLogs,
      oauthAccessTokens,
      idempotencyKeys,
    ]) {
      const columnNames = getTableConfig(table).columns.map((column) => column.name)
      expect(columnNames, getTableConfig(table).name).toContain('tenant_id')
    }
  })

  it('uses composite primary keys for idempotency and ACL boundaries', () => {
    expect(
      getTableConfig(idempotencyKeys).primaryKeys[0]?.columns.map((column) => column.name),
    ).toEqual(['tenant_id', 'key'])
    expect(
      getTableConfig(memberProjectAcl).primaryKeys[0]?.columns.map((column) => column.name),
    ).toEqual(['tenant_id', 'member_id', 'project_id'])
    expect(
      getTableConfig(memberSourceAcl).primaryKeys[0]?.columns.map((column) => column.name),
    ).toEqual(['tenant_id', 'member_id', 'source_connection_id'])
    expect(
      getTableConfig(rateLimitBuckets).primaryKeys[0]?.columns.map((column) => column.name),
    ).toEqual(['key', 'window_start'])
  })
})

describe('tenant-scoped repositories', () => {
  it('rejects an empty tenant before any query can run', () => {
    expect(() => createTenantRepositories({} as never, '')).toThrowError(RepositoryInputError)
  })
})
