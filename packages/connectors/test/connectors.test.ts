import { describe, expect, it } from 'vitest'
import { asIsoTimestamp, parseJsonResponse } from '../src/index'

describe('connector primitives', () => {
  it('normalizes source timestamps', () => {
    expect(asIsoTimestamp('2026-08-25T09:00:00+09:00')).toBe('2026-08-25T00:00:00.000Z')
  })

  it('turns non-success responses into retry-aware errors', async () => {
    const response = new Response('rate limited', { status: 429, headers: { 'retry-after': '30' } })
    await expect(parseJsonResponse(response, 'sync')).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 30,
    })
  })
})
