import { z } from 'zod'
import type { NormalizedKnowledgeDocument } from '@context-connect/contracts'
import {
  asIsoTimestamp,
  parseJsonResponse,
  type Connector,
  type ConnectorBatch,
  type ConnectorScope,
  type ConnectorValidation,
  type DiscoveredSource,
  type FetchLike,
  type IncrementalSyncInput,
} from '@context-connect/connectors'
import { stableChecksum, stableId } from '@context-connect/knowledge'

export const GitHubConnectorConfigSchema = z.object({
  token: z.string().min(1),
  scope: z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    sourceConnectionId: z.string().min(1),
    visibilityScope: z.object({
      workspaceIds: z.array(z.string()).default([]),
      projectIds: z.array(z.string()).default([]),
      sourceConnectionIds: z.array(z.string()).default([]),
    }),
  }),
  repositories: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).default([]),
  repositoryProjects: z.record(z.string()).default({}),
  apiBaseUrl: z.string().url().default('https://api.github.com'),
  pageSize: z.number().int().min(1).max(100).default(50),
})
export type GitHubConnectorConfig = z.infer<typeof GitHubConnectorConfigSchema>

export interface GitHubUser {
  id: number
  login: string
}

export interface GitHubRepository {
  id: number
  full_name: string
  html_url: string
  private: boolean
  updated_at: string
}

export interface GitHubPullRequest {
  id: number
  number: number
  html_url: string
  title: string
  body: string | null
  state: string
  user: GitHubUser | null
  labels: Array<{ name: string }>
  base: { ref: string; repo: GitHubRepository }
  head: { ref: string; sha: string }
  created_at: string
  updated_at: string
  merged_at: string | null
}

export interface GitHubCommit {
  sha: string
  html_url: string
  author: GitHubUser | null
  commit: {
    message: string
    author: { name: string; email?: string; date: string } | null
  }
}

export interface GitHubReview {
  id: number
  html_url: string
  body: string | null
  state: string
  user: GitHubUser | null
  commit_id: string
  submitted_at: string | null
}

export interface GitHubReviewComment {
  id: number
  html_url: string
  body: string
  path: string
  line?: number | null
  user: GitHubUser | null
  commit_id: string
  created_at: string
  updated_at: string
}

export interface GitHubChangedFile {
  sha: string
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  blob_url: string
  patch?: string
}

export interface GitHubPullRequestSnapshot {
  repository: GitHubRepository
  pullRequest: GitHubPullRequest
  commits: GitHubCommit[]
  reviews: GitHubReview[]
  reviewComments: GitHubReviewComment[]
  files: GitHubChangedFile[]
}

interface SyncCursor {
  repositoryIndex: number
  page: number
}

function parseCursor(cursor?: string): SyncCursor {
  if (!cursor) return { repositoryIndex: 0, page: 1 }
  const [repositoryIndex, page] = cursor.split(':').map(Number)
  if (
    !Number.isInteger(repositoryIndex) ||
    !Number.isInteger(page) ||
    repositoryIndex! < 0 ||
    page! < 1
  ) {
    throw new TypeError('Invalid GitHub sync cursor')
  }
  return { repositoryIndex: repositoryIndex!, page: page! }
}

function encodeCursor(cursor: SyncCursor): string {
  return `${cursor.repositoryIndex}:${cursor.page}`
}

function splitRepository(fullName: string): [string, string] {
  const [owner, repository, extra] = fullName.split('/')
  if (!owner || !repository || extra) throw new TypeError(`Invalid repository name: ${fullName}`)
  return [owner, repository]
}

export class GitHubConnector implements Connector<
  GitHubConnectorConfig,
  GitHubPullRequestSnapshot
> {
  private readonly config: GitHubConnectorConfig

  constructor(
    config: GitHubConnectorConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.config = GitHubConnectorConfigSchema.parse(config)
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.fetcher(new URL(path, this.config.apiBaseUrl), {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.config.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'context-connect',
      },
    })
    return parseJsonResponse<T>(response, `GitHub ${path.split('?')[0]}`)
  }

  async validateConfig(): Promise<ConnectorValidation> {
    try {
      await this.request<GitHubUser>('/user')
      return { valid: true, errors: [] }
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            code: 'github_auth_failed',
            message: error instanceof Error ? error.message : 'GitHub validation failed',
          },
        ],
      }
    }
  }

  async discover(cursor?: string): Promise<ConnectorBatch<DiscoveredSource>> {
    const page = cursor ? Number(cursor) : 1
    if (!Number.isInteger(page) || page < 1) throw new TypeError('Invalid GitHub discovery cursor')
    const repositories = await this.request<GitHubRepository[]>(
      `/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=${this.config.pageSize}&page=${page}`,
    )
    const hasMore = repositories.length === this.config.pageSize
    return {
      items: repositories.map((repository) => ({
        id: String(repository.id),
        name: repository.full_name,
        kind: 'github_repository',
        canonicalUrl: repository.html_url,
        metadata: { private: repository.private, updatedAt: repository.updated_at },
      })),
      cursor: hasMore ? String(page + 1) : undefined,
      hasMore,
      fetchedAt: new Date().toISOString(),
    }
  }

  fullSync(cursor?: string): AsyncIterable<ConnectorBatch<GitHubPullRequestSnapshot>> {
    return this.sync(undefined, cursor)
  }

  incrementalSync(
    input: IncrementalSyncInput,
  ): AsyncIterable<ConnectorBatch<GitHubPullRequestSnapshot>> {
    return this.sync(input.since, input.cursor)
  }

  private async *sync(
    since?: string,
    encodedCursor?: string,
  ): AsyncIterable<ConnectorBatch<GitHubPullRequestSnapshot>> {
    const cursor = parseCursor(encodedCursor)
    for (
      let repositoryIndex = cursor.repositoryIndex;
      repositoryIndex < this.config.repositories.length;
      repositoryIndex += 1
    ) {
      const fullName = this.config.repositories[repositoryIndex]!
      const [owner, repository] = splitRepository(fullName)
      let page = repositoryIndex === cursor.repositoryIndex ? cursor.page : 1
      let complete = false
      while (!complete) {
        const pulls = await this.request<GitHubPullRequest[]>(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?state=all&sort=updated&direction=desc&per_page=${this.config.pageSize}&page=${page}`,
        )
        const inWindow = since
          ? pulls.filter((pull) => new Date(pull.updated_at) > new Date(since))
          : pulls
        const snapshots = await Promise.all(
          inWindow.map((pull) => this.fetchSnapshot(owner, repository, pull)),
        )
        const reachedSince = Boolean(
          since && pulls.some((pull) => new Date(pull.updated_at) <= new Date(since)),
        )
        complete = pulls.length < this.config.pageSize || reachedSince
        const next = complete
          ? { repositoryIndex: repositoryIndex + 1, page: 1 }
          : { repositoryIndex, page: page + 1 }
        if (snapshots.length > 0) {
          yield {
            items: snapshots,
            cursor:
              next.repositoryIndex < this.config.repositories.length
                ? encodeCursor(next)
                : undefined,
            hasMore: next.repositoryIndex < this.config.repositories.length || !complete,
            fetchedAt: new Date().toISOString(),
          }
        }
        page += 1
      }
    }
  }

  async fetchById(id: string): Promise<GitHubPullRequestSnapshot | null> {
    const match = id.match(/(?:github:)?([^/:]+)\/([^#:]+)(?::pr:|#|:)(\d+)$/)
    if (!match) throw new TypeError('GitHub PR id must be owner/repository#number')
    const [, owner, repository, number] = match
    try {
      const pull = await this.request<GitHubPullRequest>(
        `/repos/${owner}/${repository}/pulls/${number}`,
      )
      return this.fetchSnapshot(owner!, repository!, pull)
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404)
        return null
      throw error
    }
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const results: T[] = []
    for (let page = 1; ; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const items = await this.request<T[]>(`${path}${separator}per_page=100&page=${page}`)
      results.push(...items)
      if (items.length < 100) return results
    }
  }

  private async fetchSnapshot(
    owner: string,
    repository: string,
    pull: GitHubPullRequest,
  ): Promise<GitHubPullRequestSnapshot> {
    const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
    const [commits, reviews, reviewComments, files] = await Promise.all([
      this.paginate<GitHubCommit>(`${prefix}/pulls/${pull.number}/commits`),
      this.paginate<GitHubReview>(`${prefix}/pulls/${pull.number}/reviews`),
      this.paginate<GitHubReviewComment>(`${prefix}/pulls/${pull.number}/comments`),
      this.paginate<GitHubChangedFile>(`${prefix}/pulls/${pull.number}/files`),
    ])
    return {
      repository: pull.base.repo,
      pullRequest: pull,
      commits,
      reviews,
      reviewComments,
      files,
    }
  }

  async normalize(snapshot: GitHubPullRequestSnapshot): Promise<NormalizedKnowledgeDocument[]> {
    const { pullRequest: pull, repository, commits, reviews, reviewComments, files } = snapshot
    const scope: ConnectorScope = this.config.scope
    const projectId = this.config.repositoryProjects[repository.full_name] ?? scope.projectId
    const prExternalId = `github:${repository.full_name}:pr:${pull.number}`
    const prId = await stableId('document', {
      tenantId: scope.tenantId,
      source: 'github',
      externalId: prExternalId,
    })
    const changedFiles = files.map((file) => file.filename)
    const content = [
      pull.body ?? '',
      ...files.map(
        (file) =>
          `File: ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})\n${file.patch ?? ''}`,
      ),
    ]
      .filter(Boolean)
      .join('\n\n')
    const pr: NormalizedKnowledgeDocument = {
      id: prId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      projectId,
      sourceConnectionId: scope.sourceConnectionId,
      repositoryId: String(repository.id),
      source: 'github',
      type: 'pull_request',
      externalId: prExternalId,
      canonicalUrl: pull.html_url,
      title: pull.title,
      content,
      authorId: pull.user?.login,
      createdAt: asIsoTimestamp(pull.created_at),
      updatedAt: asIsoTimestamp(pull.updated_at),
      metadata: {
        body: pull.body ?? '',
        repository: repository.full_name,
        number: pull.number,
        state: pull.state,
        labels: pull.labels.map((label) => label.name),
        base: pull.base.ref,
        head: pull.head.ref,
        headSha: pull.head.sha,
        mergedAt: pull.merged_at,
        changedFiles,
        commitMessages: commits.map((commit) => commit.commit.message),
      },
      visibilityScope: scope.visibilityScope,
      checksum: await stableChecksum({ pull, files }),
      sourceRevision: pull.updated_at,
    }

    const commitDocuments = await Promise.all(
      commits.map(async (commit): Promise<NormalizedKnowledgeDocument> => {
        const externalId = `github:${repository.full_name}:commit:${commit.sha}`
        return {
          id: await stableId('document', {
            tenantId: scope.tenantId,
            source: 'github',
            externalId,
          }),
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          projectId,
          sourceConnectionId: scope.sourceConnectionId,
          repositoryId: String(repository.id),
          source: 'github',
          type: 'commit',
          externalId,
          canonicalUrl: commit.html_url,
          title: commit.commit.message.split('\n')[0] ?? commit.sha,
          content: commit.commit.message,
          authorId: commit.author?.login ?? commit.commit.author?.name,
          createdAt: asIsoTimestamp(commit.commit.author?.date, pull.created_at),
          updatedAt: asIsoTimestamp(commit.commit.author?.date, pull.updated_at),
          metadata: {
            sha: commit.sha,
            parentPullRequestId: prId,
            parentPullRequestExternalId: prExternalId,
          },
          visibilityScope: scope.visibilityScope,
          checksum: await stableChecksum(commit),
          sourceRevision: commit.sha,
        }
      }),
    )

    const reviewDocuments = await Promise.all(
      [...reviews, ...reviewComments].map(async (review): Promise<NormalizedKnowledgeDocument> => {
        const isComment = 'path' in review
        const externalId = `github:${repository.full_name}:review:${review.id}`
        const occurredAt = isComment ? review.created_at : (review.submitted_at ?? pull.updated_at)
        return {
          id: await stableId('document', {
            tenantId: scope.tenantId,
            source: 'github',
            externalId,
          }),
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          projectId,
          sourceConnectionId: scope.sourceConnectionId,
          repositoryId: String(repository.id),
          source: 'github',
          type: 'review',
          externalId,
          canonicalUrl: review.html_url,
          title: isComment ? `Review comment on ${review.path}` : `Review ${review.state}`,
          content: review.body ?? '',
          authorId: review.user?.login,
          createdAt: asIsoTimestamp(occurredAt, pull.updated_at),
          updatedAt: asIsoTimestamp(isComment ? review.updated_at : occurredAt, pull.updated_at),
          metadata: {
            kind: isComment ? 'review_comment' : 'review',
            state: isComment ? undefined : review.state,
            path: isComment ? review.path : undefined,
            line: isComment ? review.line : undefined,
            commitId: review.commit_id,
            parentPullRequestId: prId,
            parentPullRequestExternalId: prExternalId,
          },
          visibilityScope: scope.visibilityScope,
          checksum: await stableChecksum(review),
          sourceRevision: isComment ? review.updated_at : `${review.id}:${review.state}`,
        }
      }),
    )

    return [pr, ...commitDocuments, ...reviewDocuments]
  }
}
