import { describe, expect, it } from 'vitest'
import {
  GitHubConnector,
  type GitHubPullRequestSnapshot,
  type GitHubRepository,
} from '../src/index'

const repository: GitHubRepository = {
  id: 101,
  full_name: 'acme/billing',
  html_url: 'https://github.com/acme/billing',
  private: true,
  updated_at: '2026-08-25T00:00:00Z',
}

const snapshot: GitHubPullRequestSnapshot = {
  repository,
  pullRequest: {
    id: 10,
    number: 42,
    html_url: 'https://github.com/acme/billing/pull/42',
    title: '請求処理を修正',
    body: 'Task: https://notion.so/0123456789abcdef0123456789abcdef',
    state: 'closed',
    user: { id: 1, login: 'alice' },
    labels: [{ name: 'bug' }],
    base: { ref: 'main', repo: repository },
    head: { ref: 'fix', sha: 'head-sha' },
    created_at: '2026-08-24T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
    merged_at: '2026-08-25T00:00:00Z',
  },
  commits: [
    {
      sha: 'commit-sha',
      html_url: 'https://github.com/acme/billing/commit/commit-sha',
      author: { id: 1, login: 'alice' },
      commit: { message: 'Fix invoice', author: { name: 'Alice', date: '2026-08-25T00:00:00Z' } },
    },
  ],
  reviews: [],
  reviewComments: [],
  files: [
    {
      sha: 'file-sha',
      filename: 'src/billing.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      changes: 3,
      blob_url: 'https://github.com/acme/billing/blob/head/src/billing.ts',
      patch: '+fixed',
    },
  ],
}

const config = {
  token: 'secret-token',
  scope: {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    projectId: 'project-a',
    sourceConnectionId: 'github-a',
    visibilityScope: { workspaceIds: [], projectIds: [], sourceConnectionIds: [] },
  },
  repositories: ['acme/billing'],
  repositoryProjects: { 'acme/billing': 'project-a' },
  apiBaseUrl: 'https://api.github.test',
  pageSize: 50,
}

describe('GitHubConnector', () => {
  it('normalizes a PR and its commits with stable parent metadata', async () => {
    const connector = new GitHubConnector(config)
    const documents = await connector.normalize(snapshot)
    expect(documents.map((document) => document.type)).toEqual(['pull_request', 'commit'])
    expect(documents[0]).toMatchObject({
      externalId: 'github:acme/billing:pr:42',
      repositoryId: '101',
      authorId: 'alice',
    })
    expect(documents[0]?.metadata.changedFiles).toEqual(['src/billing.ts'])
    expect(documents[1]?.metadata.parentPullRequestId).toBe(documents[0]?.id)
  })

  it('fetches a complete PR snapshot through the HTTP adapter', async () => {
    const requests: string[] = []
    const connector = new GitHubConnector(config, async (input, init) => {
      const url = String(input)
      requests.push(url)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token')
      if (url.endsWith('/pulls/42')) return Response.json(snapshot.pullRequest)
      if (url.includes('/commits')) return Response.json(snapshot.commits)
      if (url.includes('/reviews')) return Response.json([])
      if (url.includes('/comments')) return Response.json([])
      if (url.includes('/files')) return Response.json(snapshot.files)
      return new Response('not found', { status: 404 })
    })
    const fetched = await connector.fetchById('acme/billing#42')
    expect(fetched?.files[0]?.filename).toBe('src/billing.ts')
    expect(requests).toHaveLength(5)
  })
})
