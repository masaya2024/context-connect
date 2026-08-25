function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cannot checksum a non-finite number')
    return value
  }
  if (typeof value === 'undefined') return { $undefined: true }
  if (typeof value === 'bigint') return { $bigint: value.toString() }
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen))
  if (typeof value !== 'object') throw new TypeError(`Unsupported checksum value: ${typeof value}`)
  if (seen.has(value)) throw new TypeError('Cannot checksum a circular value')

  seen.add(value)
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    output[key] = canonicalize((value as Record<string, unknown>)[key], seen)
  }
  seen.delete(value)
  return output
}

export function stableSerialize(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value, new WeakSet()))
  if (serialized === undefined) throw new TypeError('Checksum value could not be serialized')
  return serialized
}

export async function stableChecksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableSerialize(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function stableId(prefix: string, value: unknown): Promise<string> {
  return `${prefix}_${(await stableChecksum(value)).slice(0, 32)}`
}
