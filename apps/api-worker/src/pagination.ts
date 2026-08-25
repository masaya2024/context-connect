import { HttpError } from './http'

export interface CursorValue {
  sort: string
  id: string
}

export function encodeCursor(value: CursorValue): string {
  const json = JSON.stringify(value)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeCursor(value: string | undefined): CursorValue | undefined {
  if (!value) return undefined
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorValue).sort === 'string' &&
      typeof (parsed as CursorValue).id === 'string'
    )
      return parsed as CursorValue
  } catch {
    // Converted to a stable client error below.
  }
  throw new HttpError(400, 'invalid_cursor', 'The pagination cursor is invalid')
}

export function parseLimit(value: string | undefined, max: number, fallback = 20): number {
  if (value === undefined) return Math.min(fallback, max)
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new HttpError(400, 'invalid_limit', `limit must be an integer between 1 and ${max}`)
  }
  return limit
}
