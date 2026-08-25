import { and, desc, eq, inArray, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'

import {
  auditLogs,
  chunks,
  documents,
  memberProjectAcl,
  memberSourceAcl,
  members,
  relations,
  schema,
  sourceConnections,
  syncCursors,
  syncJobs,
  type AuditLogRow,
  type ChunkRow,
  type DocumentRow,
  type MemberProjectAclRow,
  type MemberRow,
  type MemberSourceAclRow,
  type RelationRow,
  type SyncCursorRow,
  type SyncJobRow,
} from './schema'

export type ContextConnectDatabase = DrizzleD1Database<typeof schema>

export function createDatabase(binding: D1Database): ContextConnectDatabase {
  return drizzle(binding, { schema })
}

export type ProjectVisibility = '*' | readonly string[]
export type SourceVisibility = '*' | readonly string[]
export type DocumentInsert = Omit<typeof documents.$inferInsert, 'tenantId'>
export type ChunkInsert = Omit<typeof chunks.$inferInsert, 'tenantId'>
export type RelationInsert = Omit<typeof relations.$inferInsert, 'tenantId'>
export type SyncJobInsert = Omit<typeof syncJobs.$inferInsert, 'tenantId'>
export type AuditLogInsert = Omit<typeof auditLogs.$inferInsert, 'tenantId'>

export interface Page<T> {
  items: T[]
  nextCursor?: string
}

export interface DocumentListQuery {
  projectIds: ProjectVisibility
  sourceConnectionIds: SourceVisibility
  source?: DocumentRow['source']
  type?: DocumentRow['type']
  repositoryId?: string
  authorId?: string
  query?: string
  cursor?: string
  limit?: number
}

export interface DocumentRepository {
  upsert(input: DocumentInsert): Promise<DocumentRow>
  findById(
    id: string,
    projectIds: ProjectVisibility,
    sourceConnectionIds: SourceVisibility,
  ): Promise<DocumentRow | null>
  list(query: DocumentListQuery): Promise<Page<DocumentRow>>
  replaceChunks(documentId: string, values: readonly ChunkInsert[]): Promise<ChunkRow[]>
}

export interface RelationRepository {
  upsert(input: RelationInsert): Promise<RelationRow>
  listForDocument(
    documentId: string,
    projectIds: ProjectVisibility,
    sourceConnectionIds: SourceVisibility,
  ): Promise<RelationRow[]>
  review(
    id: string,
    decision: 'confirmed' | 'rejected',
    reviewedBy: string,
    projectIds: ProjectVisibility,
    sourceConnectionIds: SourceVisibility,
  ): Promise<RelationRow | null>
}

export interface SyncRepository {
  create(input: SyncJobInsert): Promise<SyncJobRow>
  findById(id: string): Promise<SyncJobRow | null>
  updateStatus(
    id: string,
    status: SyncJobRow['status'],
    patch?: Partial<Pick<SyncJobRow, 'errorCode' | 'errorMessage' | 'errorJson' | 'finishedAt'>>,
  ): Promise<SyncJobRow | null>
  getCursor(sourceConnectionId: string, scope?: string): Promise<SyncCursorRow | null>
  saveCursor(
    sourceConnectionId: string,
    scope: string,
    cursor: string | null,
    sourceUpdatedAt?: string | null,
  ): Promise<SyncCursorRow>
}

export interface AccessRepository {
  findActiveMember(memberId: string): Promise<MemberRow | null>
  listProjectAcl(memberId: string): Promise<MemberProjectAclRow[]>
  listSourceAcl(memberId: string): Promise<MemberSourceAclRow[]>
}

export interface AuditRepository {
  append(input: AuditLogInsert): Promise<AuditLogRow>
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 100)
}

function encodeCursor(value: { updatedAt: string; id: string }): string {
  return btoa(JSON.stringify(value))
}

function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  try {
    const value = JSON.parse(atob(cursor)) as unknown
    if (
      typeof value !== 'object' ||
      value === null ||
      !('updatedAt' in value) ||
      !('id' in value) ||
      typeof value.updatedAt !== 'string' ||
      typeof value.id !== 'string'
    ) {
      throw new Error('Unexpected cursor shape')
    }
    return { updatedAt: value.updatedAt, id: value.id }
  } catch (cause) {
    throw new RepositoryInputError('INVALID_CURSOR', 'The pagination cursor is invalid', cause)
  }
}

function projectPredicate(
  projectIds: ProjectVisibility,
  column: typeof documents.projectId,
): SQL | undefined {
  if (projectIds === '*') return undefined
  if (projectIds.length === 0) return sql`0 = 1`
  return inArray(column, [...projectIds])
}

function sourcePredicate(sourceIds: SourceVisibility): SQL | undefined {
  if (sourceIds === '*') return undefined
  if (sourceIds.length === 0) return sql`0 = 1`
  return inArray(documents.sourceConnectionId, [...sourceIds])
}

export class RepositoryInputError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'RepositoryInputError'
    this.code = code
    this.cause = cause
  }
}

abstract class TenantScopedRepository {
  constructor(
    protected readonly db: ContextConnectDatabase,
    protected readonly tenantId: string,
  ) {
    if (tenantId.trim() === '') {
      throw new RepositoryInputError('TENANT_REQUIRED', 'A non-empty tenant id is required')
    }
  }
}

export class DrizzleDocumentRepository
  extends TenantScopedRepository
  implements DocumentRepository
{
  async upsert(input: DocumentInsert): Promise<DocumentRow> {
    const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updates } = input
    await this.db
      .insert(documents)
      .values({ ...input, tenantId: this.tenantId })
      .onConflictDoUpdate({
        target: [documents.tenantId, documents.source, documents.type, documents.externalId],
        set: { ...updates, updatedAt: sql`CURRENT_TIMESTAMP` },
      })

    const row = await this.db.query.documents.findFirst({
      where: and(
        eq(documents.tenantId, this.tenantId),
        eq(documents.source, input.source),
        eq(documents.type, input.type),
        eq(documents.externalId, input.externalId),
      ),
    })
    if (!row) throw new Error('Document upsert completed without a readable row')
    return row
  }

  async findById(
    id: string,
    projectIds: ProjectVisibility,
    sourceConnectionIds: SourceVisibility,
  ): Promise<DocumentRow | null> {
    const allowedProject = projectPredicate(projectIds, documents.projectId)
    const allowedSource = sourcePredicate(sourceConnectionIds)
    const row = await this.db.query.documents.findFirst({
      where: and(
        eq(documents.tenantId, this.tenantId),
        eq(documents.id, id),
        allowedProject,
        allowedSource,
      ),
    })
    return row ?? null
  }

  async list(query: DocumentListQuery): Promise<Page<DocumentRow>> {
    const limit = clampLimit(query.limit)
    const conditions: Array<SQL | undefined> = [
      eq(documents.tenantId, this.tenantId),
      projectPredicate(query.projectIds, documents.projectId),
      sourcePredicate(query.sourceConnectionIds),
      query.source ? eq(documents.source, query.source) : undefined,
      query.type ? eq(documents.type, query.type) : undefined,
      query.repositoryId ? eq(documents.repositoryId, query.repositoryId) : undefined,
      query.authorId ? eq(documents.authorId, query.authorId) : undefined,
      query.query
        ? or(
            eq(documents.externalId, query.query),
            eq(documents.canonicalUrl, query.query),
            like(documents.title, `%${query.query}%`),
          )
        : undefined,
      isNull(documents.deletedAt),
    ]

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor)
      conditions.push(
        or(
          lt(documents.updatedAt, cursor.updatedAt),
          and(eq(documents.updatedAt, cursor.updatedAt), lt(documents.id, cursor.id)),
        ),
      )
    }

    const rows = await this.db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(limit + 1)
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return {
      items,
      ...(hasNext && last
        ? { nextCursor: encodeCursor({ updatedAt: last.updatedAt, id: last.id }) }
        : {}),
    }
  }

  async replaceChunks(documentId: string, values: readonly ChunkInsert[]): Promise<ChunkRow[]> {
    const document = await this.db.query.documents.findFirst({
      where: and(eq(documents.tenantId, this.tenantId), eq(documents.id, documentId)),
      columns: { id: true },
    })
    if (!document) {
      throw new RepositoryInputError(
        'DOCUMENT_NOT_FOUND',
        'Cannot replace chunks for this document',
      )
    }

    await this.db
      .delete(chunks)
      .where(and(eq(chunks.tenantId, this.tenantId), eq(chunks.documentId, documentId)))
    if (values.length === 0) return []
    await this.db.insert(chunks).values(
      values.map((value) => ({
        ...value,
        tenantId: this.tenantId,
        documentId,
      })),
    )
    return this.db
      .select()
      .from(chunks)
      .where(and(eq(chunks.tenantId, this.tenantId), eq(chunks.documentId, documentId)))
      .orderBy(chunks.ordinal)
  }
}

export class DrizzleRelationRepository
  extends TenantScopedRepository
  implements RelationRepository
{
  async upsert(input: RelationInsert): Promise<RelationRow> {
    const sourceDocuments = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, this.tenantId),
          inArray(documents.id, [input.fromDocumentId, input.toDocumentId]),
        ),
      )
    if (new Set(sourceDocuments.map(({ id }) => id)).size !== 2) {
      throw new RepositoryInputError(
        'RELATION_DOCUMENT_NOT_FOUND',
        'Both relation documents must exist in the tenant',
      )
    }

    const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...updates } = input
    await this.db
      .insert(relations)
      .values({ ...input, tenantId: this.tenantId })
      .onConflictDoUpdate({
        target: [
          relations.tenantId,
          relations.fromDocumentId,
          relations.toDocumentId,
          relations.relationType,
        ],
        set: { ...updates, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
    const row = await this.db.query.relations.findFirst({
      where: and(
        eq(relations.tenantId, this.tenantId),
        eq(relations.fromDocumentId, input.fromDocumentId),
        eq(relations.toDocumentId, input.toDocumentId),
        eq(relations.relationType, input.relationType),
      ),
    })
    if (!row) throw new Error('Relation upsert completed without a readable row')
    return row
  }

  async listForDocument(
    documentId: string,
    projectIds: ProjectVisibility,
    sourceConnectionIds: SourceVisibility,
  ): Promise<RelationRow[]> {
    const candidates = await this.db
      .select()
      .from(relations)
      .where(
        and(
          eq(relations.tenantId, this.tenantId),
          or(eq(relations.fromDocumentId, documentId), eq(relations.toDocumentId, documentId)),
        ),
      )
      .orderBy(desc(relations.confidence), desc(relations.createdAt))
    return this.filterAuthorizedRelations(candidates, projectIds, sourceConnectionIds)
  }

  async review(
    id: string,
    decision: 'confirmed' | 'rejected',
    reviewedBy: string,
    projectIds: ProjectVisibility,
    sourceConnectionIds: SourceVisibility,
  ): Promise<RelationRow | null> {
    const candidate = await this.db.query.relations.findFirst({
      where: and(eq(relations.tenantId, this.tenantId), eq(relations.id, id)),
    })
    if (!candidate) return null
    const authorized = await this.filterAuthorizedRelations(
      [candidate],
      projectIds,
      sourceConnectionIds,
    )
    if (authorized.length === 0) return null
    await this.db
      .update(relations)
      .set({
        status: decision,
        linkMode: 'manual',
        reviewedBy,
        reviewedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(relations.tenantId, this.tenantId), eq(relations.id, id)))
    return (
      (await this.db.query.relations.findFirst({
        where: and(eq(relations.tenantId, this.tenantId), eq(relations.id, id)),
      })) ?? null
    )
  }

  private async filterAuthorizedRelations(
    candidates: readonly RelationRow[],
    projectIds: ProjectVisibility,
    sourceConnectionIds: SourceVisibility,
  ): Promise<RelationRow[]> {
    if (candidates.length === 0) return []
    const endpointIds = [
      ...new Set(
        candidates.flatMap((relation) => [relation.fromDocumentId, relation.toDocumentId]),
      ),
    ]
    const allowedDocuments = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, this.tenantId),
          inArray(documents.id, endpointIds),
          projectPredicate(projectIds, documents.projectId),
          sourcePredicate(sourceConnectionIds),
          isNull(documents.deletedAt),
        ),
      )
    const allowedIds = new Set(allowedDocuments.map(({ id }) => id))
    return candidates.filter(
      (relation) =>
        allowedIds.has(relation.fromDocumentId) && allowedIds.has(relation.toDocumentId),
    )
  }
}

export class DrizzleSyncRepository extends TenantScopedRepository implements SyncRepository {
  async create(input: SyncJobInsert): Promise<SyncJobRow> {
    await this.assertSource(input.sourceConnectionId)
    await this.db.insert(syncJobs).values({ ...input, tenantId: this.tenantId })
    const row = await this.findById(input.id)
    if (!row) throw new Error('Sync job insert completed without a readable row')
    return row
  }

  async findById(id: string): Promise<SyncJobRow | null> {
    return (
      (await this.db.query.syncJobs.findFirst({
        where: and(eq(syncJobs.tenantId, this.tenantId), eq(syncJobs.id, id)),
      })) ?? null
    )
  }

  async updateStatus(
    id: string,
    status: SyncJobRow['status'],
    patch: Partial<
      Pick<SyncJobRow, 'errorCode' | 'errorMessage' | 'errorJson' | 'finishedAt'>
    > = {},
  ): Promise<SyncJobRow | null> {
    await this.db
      .update(syncJobs)
      .set({ ...patch, status, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(syncJobs.tenantId, this.tenantId), eq(syncJobs.id, id)))
    return this.findById(id)
  }

  async getCursor(sourceConnectionId: string, scope = 'default'): Promise<SyncCursorRow | null> {
    return (
      (await this.db.query.syncCursors.findFirst({
        where: and(
          eq(syncCursors.tenantId, this.tenantId),
          eq(syncCursors.sourceConnectionId, sourceConnectionId),
          eq(syncCursors.scope, scope),
        ),
      })) ?? null
    )
  }

  async saveCursor(
    sourceConnectionId: string,
    scope: string,
    cursor: string | null,
    sourceUpdatedAt?: string | null,
  ): Promise<SyncCursorRow> {
    await this.assertSource(sourceConnectionId)
    const existing = await this.getCursor(sourceConnectionId, scope)
    const id = existing?.id ?? crypto.randomUUID()
    await this.db
      .insert(syncCursors)
      .values({
        id,
        tenantId: this.tenantId,
        sourceConnectionId,
        scope,
        cursor,
        ...(sourceUpdatedAt !== undefined ? { sourceUpdatedAt } : {}),
        lastSucceededAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: [syncCursors.tenantId, syncCursors.sourceConnectionId, syncCursors.scope],
        set: {
          cursor,
          ...(sourceUpdatedAt !== undefined ? { sourceUpdatedAt } : {}),
          lastSucceededAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
    const saved = await this.getCursor(sourceConnectionId, scope)
    if (!saved) throw new Error('Cursor upsert completed without a readable row')
    return saved
  }

  private async assertSource(sourceConnectionId: string): Promise<void> {
    const source = await this.db.query.sourceConnections.findFirst({
      where: and(
        eq(sourceConnections.tenantId, this.tenantId),
        eq(sourceConnections.id, sourceConnectionId),
      ),
      columns: { id: true },
    })
    if (!source) {
      throw new RepositoryInputError('SOURCE_NOT_FOUND', 'The source does not exist in this tenant')
    }
  }
}

export class DrizzleAccessRepository extends TenantScopedRepository implements AccessRepository {
  async findActiveMember(memberId: string): Promise<MemberRow | null> {
    return (
      (await this.db.query.members.findFirst({
        where: and(
          eq(members.tenantId, this.tenantId),
          eq(members.id, memberId),
          eq(members.status, 'active'),
        ),
      })) ?? null
    )
  }

  listProjectAcl(memberId: string): Promise<MemberProjectAclRow[]> {
    return this.db
      .select()
      .from(memberProjectAcl)
      .where(
        and(eq(memberProjectAcl.tenantId, this.tenantId), eq(memberProjectAcl.memberId, memberId)),
      )
  }

  listSourceAcl(memberId: string): Promise<MemberSourceAclRow[]> {
    return this.db
      .select()
      .from(memberSourceAcl)
      .where(
        and(eq(memberSourceAcl.tenantId, this.tenantId), eq(memberSourceAcl.memberId, memberId)),
      )
  }
}

export class DrizzleAuditRepository extends TenantScopedRepository implements AuditRepository {
  async append(input: AuditLogInsert): Promise<AuditLogRow> {
    await this.db.insert(auditLogs).values({ ...input, tenantId: this.tenantId })
    const row = await this.db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.tenantId, this.tenantId), eq(auditLogs.id, input.id)),
    })
    if (!row) throw new Error('Audit log insert completed without a readable row')
    return row
  }
}

export interface TenantRepositories {
  documents: DocumentRepository
  relations: RelationRepository
  sync: SyncRepository
  access: AccessRepository
  audit: AuditRepository
}

export function createTenantRepositories(
  db: ContextConnectDatabase,
  tenantId: string,
): TenantRepositories {
  return {
    documents: new DrizzleDocumentRepository(db, tenantId),
    relations: new DrizzleRelationRepository(db, tenantId),
    sync: new DrizzleSyncRepository(db, tenantId),
    access: new DrizzleAccessRepository(db, tenantId),
    audit: new DrizzleAuditRepository(db, tenantId),
  }
}
