import { sql } from 'drizzle-orm'
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
}

export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'suspended', 'deleted'] })
      .notNull()
      .default('active'),
    ...timestamps,
  },
  (table) => [uniqueIndex('tenants_slug_uq').on(table.slug)],
)

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspaces_tenant_slug_uq').on(table.tenantId, table.slug),
    uniqueIndex('workspaces_tenant_id_uq').on(table.tenantId, table.id),
    index('workspaces_tenant_idx').on(table.tenantId),
  ],
)

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.tenantId, workspaces.id],
      name: 'projects_workspace_tenant_fk',
    }).onDelete('cascade'),
    uniqueIndex('projects_workspace_slug_uq').on(table.workspaceId, table.slug),
    uniqueIndex('projects_tenant_id_uq').on(table.tenantId, table.id),
    index('projects_tenant_workspace_idx').on(table.tenantId, table.workspaceId),
  ],
)

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    role: text('role', { enum: ['owner', 'admin', 'developer', 'viewer'] })
      .notNull()
      .default('viewer'),
    status: text('status', { enum: ['invited', 'active', 'suspended'] })
      .notNull()
      .default('invited'),
    lastLoginAt: text('last_login_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('members_tenant_subject_uq').on(table.tenantId, table.subject),
    uniqueIndex('members_tenant_email_uq').on(table.tenantId, table.email),
    uniqueIndex('members_tenant_id_uq').on(table.tenantId, table.id),
    index('members_tenant_role_idx').on(table.tenantId, table.role),
  ],
)

export const memberProjectAcl = sqliteTable(
  'member_project_acl',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(),
    projectId: text('project_id').notNull(),
    permission: text('permission', { enum: ['viewer', 'developer', 'admin'] })
      .notNull()
      .default('viewer'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.memberId],
      foreignColumns: [members.tenantId, members.id],
      name: 'member_project_acl_member_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'member_project_acl_project_tenant_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.tenantId, table.memberId, table.projectId],
      name: 'member_project_acl_pk',
    }),
    index('member_project_acl_project_idx').on(table.tenantId, table.projectId),
  ],
)

export const sourceConnections = sqliteTable(
  'source_connections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id'),
    type: text('type', { enum: ['github', 'notion', 'csv', 'markdown'] }).notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['pending', 'active', 'error', 'disabled'] })
      .notNull()
      .default('pending'),
    configJson: text('config_json').notNull().default('{}'),
    secretRef: text('secret_ref'),
    secretHint: text('secret_hint'),
    lastValidatedAt: text('last_validated_at'),
    lastErrorCode: text('last_error_code'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.tenantId, workspaces.id],
      name: 'source_connections_workspace_tenant_fk',
    }).onDelete('restrict'),
    uniqueIndex('source_connections_tenant_id_uq').on(table.tenantId, table.id),
    index('source_connections_tenant_type_idx').on(table.tenantId, table.type),
  ],
)

export const memberSourceAcl = sqliteTable(
  'member_source_acl',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(),
    sourceConnectionId: text('source_connection_id').notNull(),
    permission: text('permission', { enum: ['viewer', 'developer', 'admin'] })
      .notNull()
      .default('viewer'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.memberId],
      foreignColumns: [members.tenantId, members.id],
      name: 'member_source_acl_member_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id],
      name: 'member_source_acl_source_tenant_fk',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.tenantId, table.memberId, table.sourceConnectionId],
      name: 'member_source_acl_pk',
    }),
    index('member_source_acl_source_idx').on(table.tenantId, table.sourceConnectionId),
  ],
)

export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceConnectionId: text('source_connection_id').notNull(),
    projectId: text('project_id'),
    externalId: text('external_id').notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    defaultBranch: text('default_branch'),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(false),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id],
      name: 'repositories_source_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'repositories_project_tenant_fk',
    }).onDelete('restrict'),
    uniqueIndex('repositories_source_external_uq').on(
      table.tenantId,
      table.sourceConnectionId,
      table.externalId,
    ),
    uniqueIndex('repositories_tenant_id_uq').on(table.tenantId, table.id),
    index('repositories_tenant_project_idx').on(table.tenantId, table.projectId),
  ],
)

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id'),
    repositoryId: text('repository_id'),
    sourceConnectionId: text('source_connection_id'),
    source: text('source', { enum: ['github', 'notion', 'csv', 'markdown'] }).notNull(),
    type: text('type', {
      enum: ['task', 'pull_request', 'commit', 'review', 'document', 'incident'],
    }).notNull(),
    externalId: text('external_id').notNull(),
    canonicalUrl: text('canonical_url'),
    title: text('title').notNull(),
    contentRef: text('content_ref'),
    contentText: text('content_text'),
    authorId: text('author_id'),
    sourceCreatedAt: text('source_created_at'),
    sourceUpdatedAt: text('source_updated_at'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    visibilityScope: text('visibility_scope').notNull().default('project'),
    checksum: text('checksum').notNull(),
    sourceRevision: text('source_revision').notNull(),
    indexedAt: text('indexed_at'),
    deletedAt: text('deleted_at'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.tenantId, workspaces.id],
      name: 'documents_workspace_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'documents_project_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.repositoryId],
      foreignColumns: [repositories.tenantId, repositories.id],
      name: 'documents_repository_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id],
      name: 'documents_source_tenant_fk',
    }).onDelete('restrict'),
    uniqueIndex('documents_source_object_uq').on(
      table.tenantId,
      table.source,
      table.type,
      table.externalId,
    ),
    uniqueIndex('documents_tenant_id_uq').on(table.tenantId, table.id),
    index('documents_project_updated_idx').on(
      table.tenantId,
      table.projectId,
      table.sourceUpdatedAt,
    ),
    index('documents_repository_created_idx').on(
      table.tenantId,
      table.repositoryId,
      table.sourceCreatedAt,
    ),
    index('documents_author_created_idx').on(table.tenantId, table.authorId, table.sourceCreatedAt),
  ],
)

export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
    embeddingId: text('embedding_id'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    checksum: text('checksum').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'chunks_document_tenant_fk',
    }).onDelete('cascade'),
    uniqueIndex('chunks_document_ordinal_uq').on(table.tenantId, table.documentId, table.ordinal),
    uniqueIndex('chunks_embedding_id_uq').on(table.tenantId, table.embeddingId),
    index('chunks_tenant_document_idx').on(table.tenantId, table.documentId),
  ],
)

export const relations = sqliteTable(
  'relations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fromDocumentId: text('from_document_id').notNull(),
    toDocumentId: text('to_document_id').notNull(),
    relationType: text('relation_type', {
      enum: [
        'task_pr',
        'pr_commit',
        'pr_review',
        'task_task',
        'document_project',
        'supersedes',
        'related',
      ],
    }).notNull(),
    linkMode: text('link_mode', { enum: ['explicit', 'inferred', 'manual'] }).notNull(),
    confidence: real('confidence').notNull(),
    status: text('status', { enum: ['active', 'candidate', 'confirmed', 'rejected'] })
      .notNull()
      .default('active'),
    evidenceJson: text('evidence_json').notNull().default('{}'),
    createdBy: text('created_by'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: text('reviewed_at'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.fromDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'relations_from_document_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.toDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'relations_to_document_tenant_fk',
    }).onDelete('cascade'),
    uniqueIndex('relations_edge_uq').on(
      table.tenantId,
      table.fromDocumentId,
      table.toDocumentId,
      table.relationType,
    ),
    uniqueIndex('relations_tenant_id_uq').on(table.tenantId, table.id),
    index('relations_from_idx').on(table.tenantId, table.fromDocumentId),
    index('relations_to_idx').on(table.tenantId, table.toDocumentId),
    index('relations_status_confidence_idx').on(table.tenantId, table.status, table.confidence),
  ],
)

export const syncJobs = sqliteTable(
  'sync_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceConnectionId: text('source_connection_id').notNull(),
    jobType: text('job_type', {
      enum: ['full', 'incremental', 'webhook', 'reindex', 'import'],
    }).notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled'],
    })
      .notNull()
      .default('queued'),
    idempotencyKey: text('idempotency_key'),
    requestId: text('request_id'),
    cursor: text('cursor'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    retryOf: text('retry_of'),
    payloadJson: text('payload_json').notNull().default('{}'),
    fetchedCount: integer('fetched_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    errorJson: text('error_json'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id],
      name: 'sync_jobs_source_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.retryOf],
      foreignColumns: [table.tenantId, table.id],
      name: 'sync_jobs_retry_tenant_fk',
    }).onDelete('restrict'),
    uniqueIndex('sync_jobs_tenant_id_uq').on(table.tenantId, table.id),
    uniqueIndex('sync_jobs_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    index('sync_jobs_status_created_idx').on(table.tenantId, table.status, table.createdAt),
    index('sync_jobs_source_created_idx').on(
      table.tenantId,
      table.sourceConnectionId,
      table.createdAt,
    ),
  ],
)

export const syncCursors = sqliteTable(
  'sync_cursors',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceConnectionId: text('source_connection_id').notNull(),
    scope: text('scope').notNull().default('default'),
    cursor: text('cursor'),
    sourceUpdatedAt: text('source_updated_at'),
    lastSucceededAt: text('last_succeeded_at'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id],
      name: 'sync_cursors_source_tenant_fk',
    }).onDelete('cascade'),
    uniqueIndex('sync_cursors_source_scope_uq').on(
      table.tenantId,
      table.sourceConnectionId,
      table.scope,
    ),
    uniqueIndex('sync_cursors_tenant_id_uq').on(table.tenantId, table.id),
  ],
)

export const imports = sqliteTable(
  'imports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceConnectionId: text('source_connection_id'),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id'),
    type: text('type', { enum: ['csv', 'markdown'] }).notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled'],
    })
      .notNull()
      .default('queued'),
    fileName: text('file_name').notNull(),
    rawR2Key: text('raw_r2_key').notNull(),
    checksum: text('checksum').notNull(),
    mappingJson: text('mapping_json').notNull().default('{}'),
    idempotencyKey: text('idempotency_key').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id],
      name: 'imports_source_tenant_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.tenantId, workspaces.id],
      name: 'imports_workspace_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: 'imports_project_tenant_fk',
    }).onDelete('restrict'),
    uniqueIndex('imports_idempotency_uq').on(table.tenantId, table.idempotencyKey),
    uniqueIndex('imports_tenant_id_uq').on(table.tenantId, table.id),
    index('imports_status_created_idx').on(table.tenantId, table.status, table.createdAt),
  ],
)

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorMemberId: text('actor_member_id'),
    actorSubject: text('actor_subject'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome', { enum: ['success', 'denied', 'failure'] })
      .notNull()
      .default('success'),
    requestId: text('request_id').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.actorMemberId],
      foreignColumns: [members.tenantId, members.id],
      name: 'audit_logs_actor_tenant_fk',
    }).onDelete('restrict'),
    index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('audit_logs_resource_idx').on(table.tenantId, table.resourceType, table.resourceId),
    index('audit_logs_request_idx').on(table.tenantId, table.requestId),
  ],
)

export const oauthAccessTokens = sqliteTable(
  'oauth_access_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(),
    clientId: text('client_id').notNull(),
    scopesJson: text('scopes_json').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.memberId],
      foreignColumns: [members.tenantId, members.id],
      name: 'oauth_access_tokens_member_tenant_fk',
    }).onDelete('cascade'),
    index('oauth_access_tokens_member_idx').on(table.tenantId, table.memberId),
    index('oauth_access_tokens_expiry_idx').on(table.expiresAt, table.revokedAt),
  ],
)

export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseJson: text('response_json'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.key], name: 'idempotency_keys_pk' }),
    index('idempotency_keys_expiry_idx').on(table.expiresAt),
  ],
)

export const rateLimitBuckets = sqliteTable(
  'rate_limit_buckets',
  {
    key: text('key').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart], name: 'rate_limit_buckets_pk' }),
    index('rate_limit_buckets_expiry_idx').on(table.expiresAt),
  ],
)

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: text('version').primaryKey(),
  name: text('name').notNull(),
  checksum: text('checksum').notNull(),
  appliedAt: text('applied_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})

export const schema = {
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
}

/** @deprecated Use memberProjectAcl. */
export const projectMemberships = memberProjectAcl

export type TenantRow = typeof tenants.$inferSelect
export type WorkspaceRow = typeof workspaces.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type MemberRow = typeof members.$inferSelect
export type ProjectMembershipRow = typeof memberProjectAcl.$inferSelect
export type MemberProjectAclRow = typeof memberProjectAcl.$inferSelect
export type MemberSourceAclRow = typeof memberSourceAcl.$inferSelect
export type SourceConnectionRow = typeof sourceConnections.$inferSelect
export type RepositoryRow = typeof repositories.$inferSelect
export type DocumentRow = typeof documents.$inferSelect
export type ChunkRow = typeof chunks.$inferSelect
export type RelationRow = typeof relations.$inferSelect
export type SyncJobRow = typeof syncJobs.$inferSelect
export type SyncCursorRow = typeof syncCursors.$inferSelect
export type ImportRow = typeof imports.$inferSelect
export type AuditLogRow = typeof auditLogs.$inferSelect
export type OAuthAccessTokenRow = typeof oauthAccessTokens.$inferSelect
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect
export type RateLimitBucketRow = typeof rateLimitBuckets.$inferSelect
