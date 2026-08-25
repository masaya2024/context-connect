import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { requireScope, scopeAllows } from './auth'
import {
  findRelatedHistory,
  getChangeHistory,
  getDocument,
  getProjectContext,
  searchKnowledge,
  truncatePack,
} from './search'
import type { Env, Principal, SearchFilters } from './types'

const filtersSchema = z.object({
  project_id: z.string().optional(),
  repository_id: z.string().optional(),
  source: z.enum(['github', 'notion', 'csv', 'markdown']).optional(),
  type: z.enum(['task', 'pull_request', 'commit', 'review', 'document', 'incident']).optional(),
  author_id: z.string().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
})

const dateRangeSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .optional()

export function createContextServer(env: Env, principal: Principal): McpServer {
  const server = new McpServer({ name: 'context-connect', version: '0.1.0' })

  register(
    'search_knowledge',
    'knowledge:read',
    {
      description:
        'Search authorized engineering knowledge across tasks, pull requests, reviews, commits and documents.',
      inputSchema: {
        query: z.string().min(1).max(500),
        filters: filtersSchema.optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, filters, limit }) =>
      searchKnowledge(env, principal, query, filters as SearchFilters | undefined, limit),
  )

  register(
    'search_tasks',
    'tasks:read',
    {
      description:
        'Find authorized task records. Returns small summaries with source URLs and external IDs.',
      inputSchema: {
        query: z.string().min(1).max(500),
        project: z.string().optional(),
        date_range: dateRangeSchema,
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, project, date_range, limit }) =>
      searchKnowledge(
        env,
        principal,
        query,
        {
          type: 'task',
          ...(project ? { project_id: project } : {}),
          ...(date_range?.from ? { date_from: date_range.from } : {}),
          ...(date_range?.to ? { date_to: date_range.to } : {}),
        },
        limit,
      ),
  )

  register(
    'get_task',
    'tasks:read',
    {
      description: 'Get one authorized task with its explicit, inferred or manual relations.',
      inputSchema: { task_id: z.string().min(1).max(500) },
    },
    async ({ task_id }) => {
      const task = await getDocument(env, principal, task_id, 'task')
      return task ?? { found: false, task_id }
    },
  )

  register(
    'search_pull_requests',
    'pull_requests:read',
    {
      description: 'Find authorized pull requests by text, repository and date range.',
      inputSchema: {
        query: z.string().min(1).max(500),
        repo: z.string().optional(),
        date_range: dateRangeSchema,
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, repo, date_range, limit }) => {
      const repositoryId = repo ? await resolveRepository(env, principal, repo) : undefined
      return searchKnowledge(
        env,
        principal,
        query,
        {
          type: 'pull_request',
          ...(repositoryId ? { repository_id: repositoryId } : {}),
          ...(date_range?.from ? { date_from: date_range.from } : {}),
          ...(date_range?.to ? { date_to: date_range.to } : {}),
        },
        limit,
      )
    },
  )

  register(
    'get_pull_request',
    'pull_requests:read',
    {
      description:
        'Get one authorized pull request with reviews, changed-file metadata and task relations.',
      inputSchema: { pr_id: z.string().min(1).max(500) },
    },
    async ({ pr_id }) => {
      const pullRequest = await getDocument(env, principal, pr_id, 'pull_request')
      return pullRequest ?? { found: false, pr_id }
    },
  )

  register(
    'find_related_history',
    'history:read',
    {
      description: 'Traverse authorized Task↔PR↔Commit↔Review relations up to three hops.',
      inputSchema: {
        document_id: z.string().min(1).max(500).optional(),
        query: z.string().min(1).max(500).optional(),
      },
    },
    async ({ document_id, query }) => {
      let rootId = document_id
      if (!rootId && query) rootId = (await searchKnowledge(env, principal, query, {}, 1))[0]?.id
      if (!rootId) return { found: false, reason: 'document_id or a matching query is required' }
      return { root_document_id: rootId, history: await findRelatedHistory(env, principal, rootId) }
    },
  )

  register(
    'get_change_history',
    'history:read',
    {
      description:
        'Return an authorized chronological change history for a project, path or query.',
      inputSchema: {
        project: z.string().optional(),
        path: z.string().min(1).max(1000).optional(),
        query: z.string().min(1).max(500).optional(),
      },
    },
    async ({ project, path, query }) => ({
      history: await getChangeHistory(env, principal, {
        ...(project ? { project_id: project } : {}),
        ...(path ? { path } : {}),
        ...(query ? { query } : {}),
      }),
    }),
  )

  register(
    'get_project_context',
    'projects:read',
    {
      description: 'Get an authorized project overview, key documents and recent changes.',
      inputSchema: { project_id: z.string().min(1).max(200) },
    },
    async ({ project_id }) => {
      const project = await getProjectContext(env, principal, project_id)
      return project ?? { found: false, project_id }
    },
  )

  return server

  function register(
    name: string,
    scope: string,
    definition: { description: string; inputSchema: Record<string, z.ZodType> },
    handler: (input: Record<string, any>) => Promise<unknown>,
  ): void {
    if (!scopeAllows(principal, scope)) return
    server.registerTool(name, definition, async (input) => {
      requireScope(principal, scope)
      const value = await handler(input as Record<string, any>)
      const text = truncatePack(value, maxContextChars(env))
      return { content: [{ type: 'text' as const, text }] }
    })
  }
}

async function resolveRepository(
  env: Env,
  principal: Principal,
  value: string,
): Promise<string | undefined> {
  const params: unknown[] = [principal.tenantId, value, value]
  let acl = ''
  if (principal.role !== 'owner' && principal.role !== 'admin') {
    const clauses: string[] = []
    if (principal.projectIds.length > 0) {
      clauses.push(
        `(project_id IS NULL OR project_id IN (${principal.projectIds.map(() => '?').join(',')}))`,
      )
      params.push(...principal.projectIds)
    } else clauses.push('project_id IS NULL')
    if (principal.sourceConnectionIds.length > 0) {
      clauses.push(
        `source_connection_id IN (${principal.sourceConnectionIds.map(() => '?').join(',')})`,
      )
      params.push(...principal.sourceConnectionIds)
    } else clauses.push('1 = 0')
    acl = ` AND ${clauses.join(' AND ')}`
  }
  const row = await env.DB.prepare(
    `SELECT id FROM repositories WHERE tenant_id = ?1 AND (id = ?2 OR full_name = ?3)${acl} LIMIT 1`,
  )
    .bind(...params)
    .first<{ id: string }>()
  return row?.id
}

function maxContextChars(env: Env): number {
  const parsed = Number.parseInt(env.MAX_CONTEXT_CHARS ?? '30000', 10)
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(100_000, parsed)) : 30_000
}
