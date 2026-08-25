export const REDACTED = '[REDACTED]'

const safeSensitiveMetadataKeys = new Set(['secrethint', 'secretref', 'tokenestimate'])
const sensitiveKeys = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'password',
  'passwd',
  'passphrase',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'secret',
  'clientsecret',
  'privatekey',
  'credential',
  'credentials',
])
const sensitiveKeySuffixes = [
  'authorization',
  'cookie',
  'password',
  'passwd',
  'passphrase',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'token',
  'apikey',
  'clientsecret',
  'privatekey',
  'credential',
] as const

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key)
  if (safeSensitiveMetadataKeys.has(normalized)) return false
  return (
    sensitiveKeys.has(normalized) ||
    sensitiveKeySuffixes.some((suffix) => normalized.endsWith(suffix))
  )
}

/** Redacts common credential formats embedded in otherwise useful log messages. */
export function redactString(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, REDACTED)
    .replace(/\b(?:ntn|secret)_[A-Za-z0-9_=-]{12,}\b/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /\b((?:access_token|refresh_token|api_key|token|secret|password)=)[^&\s]+/gi,
      `$1${REDACTED}`,
    )
}

function visit(value: unknown, seen: WeakSet<object>, depth: number, maxDepth: number): unknown {
  if (typeof value === 'string') return redactString(value)
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'undefined'
  ) {
    return value
  }
  if (depth >= maxDepth) return '[MAX_DEPTH]'
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return redactString(value.toString())
  if (Array.isArray(value)) {
    return value.map((item) => visit(item, seen, depth + 1, maxDepth))
  }
  if (value instanceof Headers) {
    return redactHeaders(value)
  }

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : visit(nested, seen, depth + 1, maxDepth)
  }
  return result
}

export interface RedactionOptions {
  maxDepth?: number
}

/** Returns a redacted clone and never mutates the caller's data. */
export function redactSecrets(value: unknown, options: RedactionOptions = {}): unknown {
  return visit(value, new WeakSet<object>(), 0, options.maxDepth ?? 20)
}

export function redactHeaders(
  headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  const entries: Array<[string, string | readonly string[] | undefined]> =
    headers instanceof Headers ? [...headers.entries()] : Object.entries(headers)
  for (const [key, value] of entries) {
    if (value === undefined) continue
    if (isSensitiveKey(key)) {
      result[key] = REDACTED
    } else if (Array.isArray(value)) {
      result[key] = value.map(redactString)
    } else {
      result[key] = redactString(value as string)
    }
  }
  return result
}

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(redactSecrets(value))
}
