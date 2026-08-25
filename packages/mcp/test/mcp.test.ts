import { describe, expect, it } from 'vitest'
import { boundedToolPayload, hasToolScope, mcpToolNames, mcpToolPolicies } from '../src'

describe('MCP tool policy', () => {
  it('defines all eight read-only MVP tools', () => {
    expect(mcpToolNames).toHaveLength(8)
    expect(Object.values(mcpToolPolicies).every((policy) => policy.readOnly)).toBe(true)
  })

  it('fails closed without the required scope', () => {
    expect(hasToolScope(['profile:read'], 'search_knowledge')).toBe(false)
    expect(hasToolScope(['knowledge:read'], 'search_knowledge')).toBe(true)
  })

  it('bounds serialized tool output', () => {
    const value = { text: 'x'.repeat(30_000) }
    expect(boundedToolPayload('get_task', value).truncated).toBe(true)
  })
})
