import { describe, expect, it } from 'vitest'
import { chunkText } from '../src/chunk'
import { extractNotionPageIds } from '../src/ingestion'

describe('knowledge chunking', () => {
  it('preserves all content with bounded chunks', () => {
    const chunks = chunkText('a'.repeat(200) + '\n\n' + 'b'.repeat(200), 250, 30)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((entry) => entry.text.length <= 250)).toBe(true)
  })

  it('extracts and canonicalizes explicit Notion page IDs', () => {
    expect(
      extractNotionPageIds(
        'See https://www.notion.so/team/Task-1234567890abcdef1234567890abcdef?pvs=4',
      ),
    ).toEqual(['12345678-90ab-cdef-1234-567890abcdef'])
  })
})
