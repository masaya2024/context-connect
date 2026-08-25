import { describe, expect, it } from 'vitest'
import { truncatePack } from '../src/search'

describe('MCP context pack', () => {
  it('enforces the configured output budget', () => {
    const output = truncatePack({ content: 'a'.repeat(1000) }, 300)
    expect(output.length).toBeLessThanOrEqual(300)
    expect(JSON.parse(output)).toMatchObject({ truncated: true, max_chars: 300 })
  })
})
