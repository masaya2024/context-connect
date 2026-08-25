import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './format'

describe('formatRelativeTime', () => {
  it('formats elapsed time deterministically', () => {
    const now = Date.parse('2026-08-25T03:00:00Z')
    expect(formatRelativeTime('2026-08-25T02:45:00Z', now)).toBe('15分前')
    expect(formatRelativeTime('2026-08-23T03:00:00Z', now)).toBe('2日前')
  })
})
