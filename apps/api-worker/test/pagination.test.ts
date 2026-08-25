import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http'
import { decodeCursor, encodeCursor, parseLimit } from '../src/pagination'

describe('cursor pagination', () => {
  it('round-trips unicode-safe cursor values', () => {
    const value = { sort: '2026-08-25T12:00:00.000Z', id: '資料-1' }
    expect(decodeCursor(encodeCursor(value))).toEqual(value)
  })

  it('rejects malformed cursors', () => {
    expect(() => decodeCursor('not-json')).toThrow(HttpError)
  })

  it('bounds limits', () => {
    expect(parseLimit(undefined, 100)).toBe(20)
    expect(parseLimit('100', 100)).toBe(100)
    expect(() => parseLimit('101', 100)).toThrow(HttpError)
  })
})
