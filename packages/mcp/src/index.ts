export const mcpToolNames = [
  'search_knowledge',
  'search_tasks',
  'get_task',
  'search_pull_requests',
  'get_pull_request',
  'find_related_history',
  'get_change_history',
  'get_project_context',
] as const

export type McpToolName = (typeof mcpToolNames)[number]

export interface McpToolPolicy {
  name: McpToolName
  scope: string
  detail: boolean
  readOnly: true
  maxResults: number
  maxCharacters: number
}

const searchPolicy = {
  detail: false,
  readOnly: true,
  maxResults: 20,
  maxCharacters: 12_000,
} as const
const detailPolicy = { detail: true, readOnly: true, maxResults: 1, maxCharacters: 24_000 } as const

export const mcpToolPolicies: Record<McpToolName, McpToolPolicy> = {
  search_knowledge: { name: 'search_knowledge', scope: 'knowledge:read', ...searchPolicy },
  search_tasks: { name: 'search_tasks', scope: 'knowledge:read', ...searchPolicy },
  get_task: { name: 'get_task', scope: 'knowledge:read', ...detailPolicy },
  search_pull_requests: { name: 'search_pull_requests', scope: 'knowledge:read', ...searchPolicy },
  get_pull_request: { name: 'get_pull_request', scope: 'knowledge:read', ...detailPolicy },
  find_related_history: { name: 'find_related_history', scope: 'knowledge:read', ...searchPolicy },
  get_change_history: { name: 'get_change_history', scope: 'knowledge:read', ...searchPolicy },
  get_project_context: { name: 'get_project_context', scope: 'projects:read', ...detailPolicy },
}

export const hasToolScope = (scopes: readonly string[], tool: McpToolName): boolean => {
  const required = mcpToolPolicies[tool].scope
  return (
    scopes.includes('*') ||
    scopes.includes(required) ||
    scopes.includes(required.replace(/:[^:]+$/, ':*'))
  )
}

export const boundedToolPayload = <T>(
  tool: McpToolName,
  value: T,
): { payload: T; truncated: boolean } => {
  const max = mcpToolPolicies[tool].maxCharacters
  const serialized = JSON.stringify(value)
  if (serialized.length <= max) return { payload: value, truncated: false }

  const payload = {
    truncated: true,
    character_limit: max,
    preview: serialized.slice(0, Math.max(0, max - 120)),
  } as T
  return { payload, truncated: true }
}
