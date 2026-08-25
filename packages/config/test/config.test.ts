import { describe, expect, it } from 'vitest'
import { parseRuntimeConfig } from '../src'

describe('parseRuntimeConfig', () => {
  it('uses the version-pinned external API defaults', () => {
    const config = parseRuntimeConfig({
      PUBLIC_BASE_URL: 'https://context.example.com',
      TENANT_SLUG: 'example-company',
    })
    expect(config.GITHUB_API_VERSION).toBe('2026-03-10')
    expect(config.NOTION_VERSION).toBe('2026-03-11')
    expect(config.MAX_MCP_RESULTS).toBe(20)
  })

  it('rejects an overlap that cannot advance the chunk window', () => {
    expect(() =>
      parseRuntimeConfig({
        PUBLIC_BASE_URL: 'https://context.example.com',
        TENANT_SLUG: 'example-company',
        CHUNK_MAX_CHARS: 500,
        CHUNK_OVERLAP_CHARS: 500,
      }),
    ).toThrow(/overlap/i)
  })
})
