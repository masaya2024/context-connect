import type {
  KnowledgeDocument,
  KnowledgeRelation,
  Principal,
  RelationReviewStatus,
  SearchFilters,
} from '@context-connect/contracts'

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super('not_found', `${resource} was not found`, { resource, id })
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'The principal cannot access this resource') {
    super('forbidden', message)
    this.name = 'ForbiddenError'
  }
}

export interface DocumentRepository {
  getById(tenantId: string, id: string): Promise<KnowledgeDocument | null>
  getByIds(tenantId: string, ids: readonly string[]): Promise<KnowledgeDocument[]>
}

export interface RelationRepository {
  getById(tenantId: string, id: string): Promise<KnowledgeRelation | null>
  listForDocument(tenantId: string, documentId: string): Promise<KnowledgeRelation[]>
  updateReview(input: {
    tenantId: string
    relationId: string
    reviewStatus: RelationReviewStatus
    reviewerId: string
    reviewedAt: string
  }): Promise<KnowledgeRelation>
}

export interface AuditLogPort {
  record(event: {
    tenantId: string
    principalId: string
    action: string
    targetType: string
    targetId: string
    metadata?: Record<string, unknown>
    occurredAt: string
  }): Promise<void>
}

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

const intersects = (allowed: readonly string[], requested: readonly string[]) =>
  requested.length === 0 || requested.some((id) => allowed.includes(id))

/**
 * Default-deny document policy. Owners and admins can access every document in
 * their tenant; all other roles must satisfy workspace, project and source
 * restrictions independently.
 */
export function canAccessDocument(principal: Principal, document: KnowledgeDocument): boolean {
  if (principal.tenantId !== document.tenantId) return false
  if (principal.role === 'owner' || principal.role === 'admin') return true

  if (!principal.workspaceIds.includes(document.workspaceId)) return false
  if (document.projectId && !principal.projectIds.includes(document.projectId)) return false
  if (
    document.sourceConnectionId &&
    principal.sourceConnectionIds.length > 0 &&
    !principal.sourceConnectionIds.includes(document.sourceConnectionId)
  ) {
    return false
  }

  const scope = document.visibilityScope
  return (
    intersects(principal.workspaceIds, scope.workspaceIds) &&
    intersects(principal.projectIds, scope.projectIds) &&
    intersects(principal.sourceConnectionIds, scope.sourceConnectionIds)
  )
}

export function assertDocumentAccess(principal: Principal, document: KnowledgeDocument): void {
  if (!canAccessDocument(principal, document)) throw new ForbiddenError()
}

/** Produces mandatory backend filters before any keyword/vector search occurs. */
export function principalSearchFilters(
  principal: Principal,
  requested: SearchFilters,
): SearchFilters {
  if (requested.tenantId && requested.tenantId !== principal.tenantId) throw new ForbiddenError()

  if (principal.role === 'owner' || principal.role === 'admin') {
    return { ...requested, tenantId: principal.tenantId }
  }

  if (principal.workspaceIds.length === 0 || principal.projectIds.length === 0) {
    throw new ForbiddenError('Principal has no searchable workspace/project assignment')
  }

  const requestedWorkspaces = requested.workspaceIds?.length
    ? requested.workspaceIds
    : principal.workspaceIds
  const requestedProjects = requested.projectIds?.length
    ? requested.projectIds
    : principal.projectIds
  const requestedSources = requested.sourceConnectionIds ?? principal.sourceConnectionIds

  if (!intersects(principal.workspaceIds, requestedWorkspaces)) throw new ForbiddenError()
  if (!intersects(principal.projectIds, requestedProjects)) throw new ForbiddenError()
  if (requestedSources.length > 0 && !intersects(principal.sourceConnectionIds, requestedSources)) {
    throw new ForbiddenError()
  }

  return {
    ...requested,
    tenantId: principal.tenantId,
    workspaceIds: requestedWorkspaces.filter((id) => principal.workspaceIds.includes(id)),
    projectIds: requestedProjects.filter((id) => principal.projectIds.includes(id)),
    sourceConnectionIds: requestedSources.filter((id) =>
      principal.sourceConnectionIds.includes(id),
    ),
  }
}

export class GetDocumentUseCase {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly relations: RelationRepository,
  ) {}

  async execute(
    principal: Principal,
    documentId: string,
  ): Promise<{
    document: KnowledgeDocument
    relations: KnowledgeRelation[]
  }> {
    const document = await this.documents.getById(principal.tenantId, documentId)
    if (!document) throw new NotFoundError('document', documentId)
    assertDocumentAccess(principal, document)

    const relations = await this.relations.listForDocument(principal.tenantId, documentId)
    const relatedIds = relations.map((relation) =>
      relation.fromDocumentId === documentId ? relation.toDocumentId : relation.fromDocumentId,
    )
    const relatedDocuments = await this.documents.getByIds(principal.tenantId, relatedIds)
    const allowedIds = new Set(
      relatedDocuments
        .filter((candidate) => canAccessDocument(principal, candidate))
        .map((candidate) => candidate.id),
    )

    return {
      document,
      relations: relations.filter((relation) => {
        const relatedId =
          relation.fromDocumentId === documentId ? relation.toDocumentId : relation.fromDocumentId
        return relation.reviewStatus !== 'rejected' && allowedIds.has(relatedId)
      }),
    }
  }
}

export class ReviewRelationUseCase {
  constructor(
    private readonly relations: RelationRepository,
    private readonly audit: AuditLogPort,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(
    principal: Principal,
    relationId: string,
    reviewStatus: 'confirmed' | 'rejected',
  ): Promise<KnowledgeRelation> {
    if (principal.role === 'viewer')
      throw new ForbiddenError('Viewer cannot review relation candidates')

    const relation = await this.relations.getById(principal.tenantId, relationId)
    if (!relation) throw new NotFoundError('relation', relationId)
    if (relation.tenantId !== principal.tenantId) throw new ForbiddenError()

    const reviewedAt = this.clock.now().toISOString()
    const updated = await this.relations.updateReview({
      tenantId: principal.tenantId,
      relationId,
      reviewStatus,
      reviewerId: principal.id,
      reviewedAt,
    })
    await this.audit.record({
      tenantId: principal.tenantId,
      principalId: principal.id,
      action: `relation.${reviewStatus}`,
      targetType: 'relation',
      targetId: relationId,
      metadata: { previousStatus: relation.reviewStatus },
      occurredAt: reviewedAt,
    })
    return updated
  }
}
