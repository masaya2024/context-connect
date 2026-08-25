import type { KnowledgeDocument, KnowledgeRelation } from '@context-connect/contracts'
import { stableId } from './checksum'

const NOTION_URL = /https?:\/\/[^\s<>\[\]"']+/gi
const NOTION_ID_CANDIDATE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/gi

export function normalizeNotionPageId(value: string): string | null {
  const matches = value.match(NOTION_ID_CANDIDATE)
  const match = matches?.at(-1)
  return match ? match.replaceAll('-', '').toLowerCase() : null
}

export function extractNotionPageId(url: string): string | null {
  try {
    const parsed = new URL(url.replace(/[.,;:!?。、]+$/, ''))
    const hostname = parsed.hostname.toLowerCase()
    if (!(
      hostname === 'notion.so' ||
      hostname.endsWith('.notion.so') ||
      hostname.endsWith('.notion.site')
    )) {
      return null
    }
    return normalizeNotionPageId(`${decodeURIComponent(parsed.pathname)}${parsed.search}`)
  } catch {
    return null
  }
}

export function extractNotionPageIds(text: string): Array<{ pageId: string; url: string }> {
  const unique = new Map<string, string>()
  for (const candidate of text.match(NOTION_URL) ?? []) {
    const url = candidate.replace(/[),.;:!?。、]+$/, '')
    const pageId = extractNotionPageId(url)
    if (pageId && !unique.has(pageId)) unique.set(pageId, url)
  }
  return [...unique].map(([pageId, url]) => ({ pageId, url }))
}

function taskNotionId(task: KnowledgeDocument): string | null {
  return normalizeNotionPageId(task.externalId) ?? extractNotionPageId(task.canonicalUrl)
}

export async function buildExplicitTaskRelations(input: {
  pullRequest: KnowledgeDocument
  pullRequestBody: string
  tasks: readonly KnowledgeDocument[]
  now?: Date
}): Promise<KnowledgeRelation[]> {
  const { pullRequest, pullRequestBody, tasks } = input
  if (pullRequest.type !== 'pull_request')
    throw new TypeError('pullRequest must have pull_request type')

  const tasksByNotionId = new Map(
    tasks
      .filter((task) => task.type === 'task' && task.tenantId === pullRequest.tenantId)
      .map((task) => [taskNotionId(task), task] as const)
      .filter((entry): entry is readonly [string, KnowledgeDocument] => entry[0] !== null),
  )
  const createdAt = (input.now ?? new Date()).toISOString()
  const relations: KnowledgeRelation[] = []

  for (const link of extractNotionPageIds(pullRequestBody)) {
    const task = tasksByNotionId.get(link.pageId)
    if (!task) continue
    relations.push({
      id: await stableId('relation', {
        fromDocumentId: task.id,
        toDocumentId: pullRequest.id,
        relationType: 'task_pr',
        linkMode: 'explicit',
      }),
      tenantId: pullRequest.tenantId,
      fromDocumentId: task.id,
      toDocumentId: pullRequest.id,
      relationType: 'task_pr',
      linkMode: 'explicit',
      confidence: 1,
      reviewStatus: 'confirmed',
      evidence: { signal: 'notion_url_in_pr_body', notionPageId: link.pageId, url: link.url },
      createdAt,
      updatedAt: createdAt,
    })
  }
  return relations
}

/** Builds authoritative PR→Commit/Review edges from a single GitHub API snapshot. */
export async function buildGitHubHierarchyRelations(input: {
  pullRequest: KnowledgeDocument
  children: readonly KnowledgeDocument[]
  now?: Date
}): Promise<KnowledgeRelation[]> {
  if (input.pullRequest.type !== 'pull_request' || input.pullRequest.source !== 'github') {
    throw new TypeError('pullRequest must be a GitHub pull_request document')
  }
  const createdAt = (input.now ?? new Date()).toISOString()
  return Promise.all(
    input.children
      .filter(
        (child) =>
          child.tenantId === input.pullRequest.tenantId &&
          (child.type === 'commit' || child.type === 'review') &&
          child.metadata.parentPullRequestId === input.pullRequest.id,
      )
      .map(async (child): Promise<KnowledgeRelation> => {
        const relationType = child.type === 'commit' ? 'pr_commit' : 'pr_review'
        return {
          id: await stableId('relation', {
            fromDocumentId: input.pullRequest.id,
            toDocumentId: child.id,
            relationType,
            linkMode: 'explicit',
          }),
          tenantId: input.pullRequest.tenantId,
          fromDocumentId: input.pullRequest.id,
          toDocumentId: child.id,
          relationType,
          linkMode: 'explicit',
          confidence: 1,
          reviewStatus: 'confirmed',
          evidence: { signal: 'github_pr_api_membership', externalId: child.externalId },
          createdAt,
          updatedAt: createdAt,
        }
      }),
  )
}

export interface InferredRelationSignals {
  titleBodySimilarity: number
  dateProximity: number
  authorMatch: number
  projectRepositoryMatch: number
  keywordFileSimilarity: number
  commitMessageSimilarity: number
}

export const INFERRED_RELATION_WEIGHTS: Readonly<Record<keyof InferredRelationSignals, number>> = {
  titleBodySimilarity: 30,
  dateProximity: 20,
  authorMatch: 20,
  projectRepositoryMatch: 15,
  keywordFileSimilarity: 10,
  commitMessageSimilarity: 5,
}

function clampSignal(score: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0))
}

export function scoreInferredRelation(signals: InferredRelationSignals): {
  confidence: number
  band: 'high' | 'candidate' | 'reference' | 'hidden'
  weightedSignals: Record<keyof InferredRelationSignals, number>
} {
  const weightedSignals = Object.fromEntries(
    (Object.keys(INFERRED_RELATION_WEIGHTS) as Array<keyof InferredRelationSignals>).map((key) => [
      key,
      clampSignal(signals[key]) * INFERRED_RELATION_WEIGHTS[key],
    ]),
  ) as Record<keyof InferredRelationSignals, number>
  const confidence = Object.values(weightedSignals).reduce((sum, score) => sum + score, 0) / 100
  const rounded = Math.round(confidence * 10_000) / 10_000
  return {
    confidence: rounded,
    band:
      rounded >= 0.9
        ? 'high'
        : rounded >= 0.75
          ? 'candidate'
          : rounded >= 0.5
            ? 'reference'
            : 'hidden',
    weightedSignals,
  }
}

function comparableTokens(text: string): Set<string> {
  const normalized = text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  const words = normalized.split(/\s+/).filter(Boolean)
  const compact = normalized.replace(/\s+/g, '')
  const bigrams = Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) =>
    compact.slice(index, index + 2),
  )
  return new Set([...words, ...bigrams])
}

export function textSimilarity(left: string, right: string): number {
  const a = comparableTokens(left)
  const b = comparableTokens(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

export function dateProximity(left: string, right: string, maximumDays = 30): number {
  const delta = Math.abs(new Date(left).getTime() - new Date(right).getTime())
  if (!Number.isFinite(delta)) return 0
  return Math.max(0, 1 - delta / (maximumDays * 86_400_000))
}

function stringMetadata(document: KnowledgeDocument, key: string): string {
  const value = document.metadata[key]
  return typeof value === 'string' ? value : ''
}

function stringArrayMetadata(document: KnowledgeDocument, key: string): string[] {
  const value = document.metadata[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function inferTaskPrSignals(
  task: KnowledgeDocument,
  pullRequest: KnowledgeDocument,
): InferredRelationSignals {
  const prBody = stringMetadata(pullRequest, 'body')
  const taskContent = stringMetadata(task, 'content')
  const taskAssignee = stringMetadata(task, 'assignee')
  const prAuthor = pullRequest.authorId ?? stringMetadata(pullRequest, 'author')
  const mappedRepositoryId = stringMetadata(task, 'repositoryId')
  const changedFiles = stringArrayMetadata(pullRequest, 'changedFiles').join(' ')
  const commitMessages = stringArrayMetadata(pullRequest, 'commitMessages').join(' ')

  return {
    titleBodySimilarity: textSimilarity(
      `${task.title} ${taskContent}`,
      `${pullRequest.title} ${prBody}`,
    ),
    dateProximity: dateProximity(task.updatedAt, pullRequest.createdAt),
    authorMatch: taskAssignee && prAuthor && taskAssignee === prAuthor ? 1 : 0,
    projectRepositoryMatch:
      (task.projectId && task.projectId === pullRequest.projectId) ||
      (mappedRepositoryId && mappedRepositoryId === pullRequest.repositoryId)
        ? 1
        : 0,
    keywordFileSimilarity: textSimilarity(`${task.title} ${taskContent}`, changedFiles),
    commitMessageSimilarity: textSimilarity(`${task.title} ${taskContent}`, commitMessages),
  }
}

export async function buildInferredTaskRelation(input: {
  task: KnowledgeDocument
  pullRequest: KnowledgeDocument
  signals?: InferredRelationSignals
  now?: Date
}): Promise<KnowledgeRelation | null> {
  const signals = input.signals ?? inferTaskPrSignals(input.task, input.pullRequest)
  const scored = scoreInferredRelation(signals)
  if (scored.band === 'hidden') return null
  const createdAt = (input.now ?? new Date()).toISOString()
  return {
    id: await stableId('relation', {
      fromDocumentId: input.task.id,
      toDocumentId: input.pullRequest.id,
      relationType: 'task_pr',
      linkMode: 'inferred',
    }),
    tenantId: input.task.tenantId,
    fromDocumentId: input.task.id,
    toDocumentId: input.pullRequest.id,
    relationType: 'task_pr',
    linkMode: 'inferred',
    confidence: scored.confidence,
    reviewStatus: 'unreviewed',
    evidence: {
      band: scored.band,
      signals,
      weights: INFERRED_RELATION_WEIGHTS,
      weightedSignals: scored.weightedSignals,
    },
    createdAt,
    updatedAt: createdAt,
  }
}
