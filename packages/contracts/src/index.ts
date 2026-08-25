import { z } from 'zod'

export const RoleSchema = z.enum(['owner', 'admin', 'developer', 'viewer'])
export type Role = z.infer<typeof RoleSchema>

export const DocumentSourceSchema = z.enum(['github', 'notion', 'csv', 'markdown'])
export type DocumentSource = z.infer<typeof DocumentSourceSchema>

export const DocumentTypeSchema = z.enum([
  'task',
  'pull_request',
  'commit',
  'review',
  'document',
  'incident',
])
export type DocumentType = z.infer<typeof DocumentTypeSchema>

export const RelationTypeSchema = z.enum([
  'task_pr',
  'pr_commit',
  'pr_review',
  'task_task',
  'document_project',
  'supersedes',
  'related',
])
export type RelationType = z.infer<typeof RelationTypeSchema>

export const RelationLinkModeSchema = z.enum(['explicit', 'inferred', 'manual'])
export type RelationLinkMode = z.infer<typeof RelationLinkModeSchema>

export const RelationReviewStatusSchema = z.enum(['unreviewed', 'confirmed', 'rejected'])
export type RelationReviewStatus = z.infer<typeof RelationReviewStatusSchema>

export const JsonObjectSchema = z.record(z.unknown())

export const VisibilityScopeSchema = z.object({
  workspaceIds: z.array(z.string().min(1)).default([]),
  projectIds: z.array(z.string().min(1)).default([]),
  sourceConnectionIds: z.array(z.string().min(1)).default([]),
})
export type VisibilityScope = z.infer<typeof VisibilityScopeSchema>

export const PrincipalSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  role: RoleSchema,
  workspaceIds: z.array(z.string().min(1)).default([]),
  projectIds: z.array(z.string().min(1)).default([]),
  sourceConnectionIds: z.array(z.string().min(1)).default([]),
  scopes: z.array(z.string().min(1)).default([]),
})
export type Principal = z.infer<typeof PrincipalSchema>

export const KnowledgeDocumentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  sourceConnectionId: z.string().min(1).optional(),
  repositoryId: z.string().min(1).optional(),
  source: DocumentSourceSchema,
  type: DocumentTypeSchema,
  externalId: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string(),
  contentRef: z.string().min(1),
  authorId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: JsonObjectSchema.default({}),
  visibilityScope: VisibilityScopeSchema,
  checksum: z.string().min(1),
  sourceRevision: z.string().min(1),
})
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>

/** A normalized document before its body is persisted to D1 or R2. */
export const NormalizedKnowledgeDocumentSchema = KnowledgeDocumentSchema.omit({
  contentRef: true,
}).extend({
  content: z.string(),
  contentRef: z.string().min(1).optional(),
})
export type NormalizedKnowledgeDocument = z.infer<typeof NormalizedKnowledgeDocumentSchema>

export const KnowledgeRelationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  fromDocumentId: z.string().min(1),
  toDocumentId: z.string().min(1),
  relationType: RelationTypeSchema,
  linkMode: RelationLinkModeSchema,
  confidence: z.number().min(0).max(1),
  reviewStatus: RelationReviewStatusSchema.default('unreviewed'),
  evidence: JsonObjectSchema.default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
})
export type KnowledgeRelation = z.infer<typeof KnowledgeRelationSchema>

export const KnowledgeChunkSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  documentId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  text: z.string(),
  tokenEstimate: z.number().int().nonnegative(),
  embeddingId: z.string().min(1),
  metadata: JsonObjectSchema.default({}),
  checksum: z.string().min(1),
})
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>

export const DateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const SearchFiltersSchema = z.object({
  tenantId: z.string().min(1).optional(),
  workspaceIds: z.array(z.string().min(1)).optional(),
  projectIds: z.array(z.string().min(1)).optional(),
  sourceConnectionIds: z.array(z.string().min(1)).optional(),
  repositoryIds: z.array(z.string().min(1)).optional(),
  sources: z.array(DocumentSourceSchema).optional(),
  types: z.array(DocumentTypeSchema).optional(),
  authorIds: z.array(z.string().min(1)).optional(),
  dateRange: DateRangeSchema.optional(),
})
export type SearchFilters = z.infer<typeof SearchFiltersSchema>

export const SearchKnowledgeInputSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  filters: SearchFiltersSchema.default({}),
  limit: z.number().int().min(1).max(20).default(10),
  cursor: z.string().optional(),
})
export type SearchKnowledgeInput = z.infer<typeof SearchKnowledgeInputSchema>

export const SearchScoreSchema = z.object({
  exact: z.number().min(0).max(1).default(0),
  keyword: z.number().min(0).max(1).default(0),
  semantic: z.number().min(0).max(1).default(0),
  relation: z.number().min(0).max(1).default(0),
  recency: z.number().min(0).max(1).default(0),
  total: z.number().nonnegative(),
})

export const SearchHitSchema = z.object({
  document: KnowledgeDocumentSchema,
  snippet: z.string(),
  score: SearchScoreSchema,
  relations: z.array(KnowledgeRelationSchema).default([]),
})
export type SearchHit = z.infer<typeof SearchHitSchema>

export const SearchKnowledgeOutputSchema = z.object({
  results: z.array(SearchHitSchema),
  nextCursor: z.string().optional(),
  total: z.number().int().nonnegative().optional(),
})
export type SearchKnowledgeOutput = z.infer<typeof SearchKnowledgeOutputSchema>

export const ContextPackItemSchema = z.object({
  documentId: z.string(),
  type: DocumentTypeSchema,
  title: z.string(),
  summary: z.string(),
  sourceUrl: z.string().url(),
  externalId: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  linkMode: RelationLinkModeSchema.optional(),
  changedFiles: z.array(z.string()).optional(),
})

export const ContextPackSchema = z.object({
  query: z.string(),
  items: z.array(ContextPackItemSchema),
  truncated: z.boolean(),
  characterCount: z.number().int().nonnegative(),
})
export type ContextPack = z.infer<typeof ContextPackSchema>

export const SyncJobStatusSchema = z.enum([
  'queued',
  'running',
  'partial',
  'succeeded',
  'failed',
  'cancelled',
])
export type SyncJobStatus = z.infer<typeof SyncJobStatusSchema>

export const SyncJobSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  sourceConnectionId: z.string().min(1),
  status: SyncJobStatusSchema,
  cursor: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  fetched: z.number().int().nonnegative().default(0),
  created: z.number().int().nonnegative().default(0),
  updated: z.number().int().nonnegative().default(0),
  skipped: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  failureCode: z.string().optional(),
  failureReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type SyncJob = z.infer<typeof SyncJobSchema>

export const GetTaskInputSchema = z.object({ taskId: z.string().min(1) })
export const GetPullRequestInputSchema = z.object({ prId: z.string().min(1) })
export const FindRelatedHistoryInputSchema = z
  .object({ documentId: z.string().min(1).optional(), query: z.string().min(1).optional() })
  .refine((value) => value.documentId || value.query, 'documentId or query is required')
export const GetChangeHistoryInputSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.projectId || value.path || value.query,
    'one search criterion is required',
  )
export const GetProjectContextInputSchema = z.object({ projectId: z.string().min(1) })

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: JsonObjectSchema.optional(),
})

export const ApiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    requestId: z.string().min(1),
    data: data.optional(),
    error: ApiErrorSchema.optional(),
  })

export type ApiResponse<T> = {
  requestId: string
  data?: T
  error?: z.infer<typeof ApiErrorSchema>
}
