-- Context Connect MVP schema for Cloudflare D1 (SQLite).
-- Every content-bearing and ACL table carries tenant_id. Composite foreign keys
-- prevent a relation from pointing at a row owned by a different tenant.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_uq ON tenants(slug);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspaces_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_tenant_slug_uq ON workspaces(tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_tenant_id_uq ON workspaces(tenant_id, id);
CREATE INDEX IF NOT EXISTS workspaces_tenant_idx ON workspaces(tenant_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT projects_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT projects_workspace_tenant_fk FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES workspaces(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_workspace_slug_uq ON projects(workspace_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_id_uq ON projects(tenant_id, id);
CREATE INDEX IF NOT EXISTS projects_tenant_workspace_idx ON projects(tenant_id, workspace_id);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT members_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS members_tenant_subject_uq ON members(tenant_id, subject);
CREATE UNIQUE INDEX IF NOT EXISTS members_tenant_email_uq ON members(tenant_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS members_tenant_id_uq ON members(tenant_id, id);
CREATE INDEX IF NOT EXISTS members_tenant_role_idx ON members(tenant_id, role);

CREATE TABLE IF NOT EXISTS member_project_acl (
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'developer', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT member_project_acl_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT member_project_acl_member_tenant_fk FOREIGN KEY (tenant_id, member_id)
    REFERENCES members(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT member_project_acl_project_tenant_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT member_project_acl_pk PRIMARY KEY (tenant_id, member_id, project_id)
);
CREATE INDEX IF NOT EXISTS member_project_acl_project_idx ON member_project_acl(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS source_connections (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('github', 'notion', 'csv', 'markdown')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'disabled')),
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_ref TEXT,
  secret_hint TEXT,
  last_validated_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT source_connections_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT source_connections_workspace_tenant_fk FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES workspaces(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS source_connections_tenant_id_uq ON source_connections(tenant_id, id);
CREATE INDEX IF NOT EXISTS source_connections_tenant_type_idx ON source_connections(tenant_id, type);

CREATE TABLE IF NOT EXISTS member_source_acl (
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'developer', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT member_source_acl_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT member_source_acl_member_tenant_fk FOREIGN KEY (tenant_id, member_id)
    REFERENCES members(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT member_source_acl_source_tenant_fk FOREIGN KEY (tenant_id, source_connection_id)
    REFERENCES source_connections(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT member_source_acl_pk PRIMARY KEY (tenant_id, member_id, source_connection_id)
);
CREATE INDEX IF NOT EXISTS member_source_acl_source_idx
  ON member_source_acl(tenant_id, source_connection_id);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  project_id TEXT,
  external_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  default_branch TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT repositories_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT repositories_source_tenant_fk FOREIGN KEY (tenant_id, source_connection_id)
    REFERENCES source_connections(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT repositories_project_tenant_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS repositories_source_external_uq
  ON repositories(tenant_id, source_connection_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS repositories_tenant_id_uq ON repositories(tenant_id, id);
CREATE INDEX IF NOT EXISTS repositories_tenant_project_idx ON repositories(tenant_id, project_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  repository_id TEXT,
  source_connection_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('github', 'notion', 'csv', 'markdown')),
  type TEXT NOT NULL CHECK (type IN ('task', 'pull_request', 'commit', 'review', 'document', 'incident')),
  external_id TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT NOT NULL,
  content_ref TEXT,
  content_text TEXT,
  author_id TEXT,
  source_created_at TEXT,
  source_updated_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  visibility_scope TEXT NOT NULL DEFAULT 'project',
  checksum TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  indexed_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT documents_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT documents_workspace_tenant_fk FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES workspaces(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT documents_project_tenant_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT documents_repository_tenant_fk FOREIGN KEY (tenant_id, repository_id)
    REFERENCES repositories(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT documents_source_tenant_fk FOREIGN KEY (tenant_id, source_connection_id)
    REFERENCES source_connections(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS documents_source_object_uq
  ON documents(tenant_id, source, type, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_id_uq ON documents(tenant_id, id);
CREATE INDEX IF NOT EXISTS documents_project_updated_idx
  ON documents(tenant_id, project_id, source_updated_at);
CREATE INDEX IF NOT EXISTS documents_repository_created_idx
  ON documents(tenant_id, repository_id, source_created_at);
CREATE INDEX IF NOT EXISTS documents_author_created_idx
  ON documents(tenant_id, author_id, source_created_at);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  embedding_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chunks_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT chunks_document_tenant_fk FOREIGN KEY (tenant_id, document_id)
    REFERENCES documents(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS chunks_document_ordinal_uq ON chunks(tenant_id, document_id, ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS chunks_embedding_id_uq ON chunks(tenant_id, embedding_id);
CREATE INDEX IF NOT EXISTS chunks_tenant_document_idx ON chunks(tenant_id, document_id);

CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  from_document_id TEXT NOT NULL,
  to_document_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN ('task_pr', 'pr_commit', 'pr_review', 'task_task', 'document_project', 'supersedes', 'related')
  ),
  link_mode TEXT NOT NULL CHECK (link_mode IN ('explicit', 'inferred', 'manual')),
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'candidate', 'confirmed', 'rejected')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT relations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT relations_from_document_tenant_fk FOREIGN KEY (tenant_id, from_document_id)
    REFERENCES documents(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT relations_to_document_tenant_fk FOREIGN KEY (tenant_id, to_document_id)
    REFERENCES documents(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT relations_no_self_link CHECK (from_document_id <> to_document_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS relations_edge_uq
  ON relations(tenant_id, from_document_id, to_document_id, relation_type);
CREATE UNIQUE INDEX IF NOT EXISTS relations_tenant_id_uq ON relations(tenant_id, id);
CREATE INDEX IF NOT EXISTS relations_from_idx ON relations(tenant_id, from_document_id);
CREATE INDEX IF NOT EXISTS relations_to_idx ON relations(tenant_id, to_document_id);
CREATE INDEX IF NOT EXISTS relations_status_confidence_idx ON relations(tenant_id, status, confidence);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('full', 'incremental', 'webhook', 'reindex', 'import')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled')),
  idempotency_key TEXT,
  request_id TEXT,
  cursor TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  retry_of TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  error_code TEXT,
  error_message TEXT,
  error_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sync_jobs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT sync_jobs_source_tenant_fk FOREIGN KEY (tenant_id, source_connection_id)
    REFERENCES source_connections(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT sync_jobs_retry_tenant_fk FOREIGN KEY (tenant_id, retry_of)
    REFERENCES sync_jobs(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_tenant_id_uq ON sync_jobs(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_idempotency_uq ON sync_jobs(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS sync_jobs_status_created_idx ON sync_jobs(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS sync_jobs_source_created_idx
  ON sync_jobs(tenant_id, source_connection_id, created_at);

CREATE TABLE IF NOT EXISTS sync_cursors (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  source_connection_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'default',
  cursor TEXT,
  source_updated_at TEXT,
  last_succeeded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sync_cursors_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT sync_cursors_source_tenant_fk FOREIGN KEY (tenant_id, source_connection_id)
    REFERENCES source_connections(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_cursors_source_scope_uq
  ON sync_cursors(tenant_id, source_connection_id, scope);
CREATE UNIQUE INDEX IF NOT EXISTS sync_cursors_tenant_id_uq ON sync_cursors(tenant_id, id);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  source_connection_id TEXT,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('csv', 'markdown')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled')),
  file_name TEXT NOT NULL,
  raw_r2_key TEXT NOT NULL,
  checksum TEXT NOT NULL,
  mapping_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT imports_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT imports_source_tenant_fk FOREIGN KEY (tenant_id, source_connection_id)
    REFERENCES source_connections(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT imports_workspace_tenant_fk FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES workspaces(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT imports_project_tenant_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES projects(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS imports_idempotency_uq ON imports(tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS imports_tenant_id_uq ON imports(tenant_id, id);
CREATE INDEX IF NOT EXISTS imports_status_created_idx ON imports(tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_member_id TEXT,
  actor_subject TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'denied', 'failure')),
  request_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_logs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT audit_logs_actor_tenant_fk FOREIGN KEY (tenant_id, actor_member_id)
    REFERENCES members(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx
  ON audit_logs(tenant_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_logs_request_idx ON audit_logs(tenant_id, request_id);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT oauth_access_tokens_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT oauth_access_tokens_member_tenant_fk FOREIGN KEY (tenant_id, member_id)
    REFERENCES members(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_member_idx ON oauth_access_tokens(tenant_id, member_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_expiry_idx ON oauth_access_tokens(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT idempotency_keys_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT idempotency_keys_pk PRIMARY KEY (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expiry_idx ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at TEXT NOT NULL,
  CONSTRAINT rate_limit_buckets_pk PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx ON rate_limit_buckets(expires_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO schema_migrations(version, name, checksum)
VALUES ('0001', 'initial', 'context-connect-0001-v1');
