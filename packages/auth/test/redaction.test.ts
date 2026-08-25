import { describe, expect, it } from 'vitest'

import {
  REDACTED,
  redactHeaders,
  redactSecrets,
  redactString,
  safeJsonStringify,
} from '../src/redaction'

describe('secret redaction', () => {
  it('recursively redacts sensitive fields without mutating input', () => {
    const input = {
      authorization: 'Bearer abc.def.ghi',
      nested: { notion_token: 'secret_longnotioncredential', normal: 'visible' },
      secretHint: '…1234',
      secretRef: 'CONTEXT_CONNECT_NOTION_TOKEN',
      tokenEstimate: 42,
    }
    const output = redactSecrets(input)

    expect(output).toEqual({
      authorization: REDACTED,
      nested: { notion_token: REDACTED, normal: 'visible' },
      secretHint: '…1234',
      secretRef: 'CONTEXT_CONNECT_NOTION_TOKEN',
      tokenEstimate: 42,
    })
    expect(input.nested.notion_token).toBe('secret_longnotioncredential')
  })

  it('redacts credentials embedded in log messages', () => {
    expect(redactString('request failed: Bearer abc.def-123')).toBe(
      `request failed: Bearer ${REDACTED}`,
    )
    expect(redactString('using ghp_1234567890abcdefghijklmnop')).not.toContain('ghp_')
    expect(redactString('https://example.test/callback?token=unsafe&next=ok')).toBe(
      `https://example.test/callback?token=${REDACTED}&next=ok`,
    )
  })

  it('redacts authorization and cookies in Headers', () => {
    const output = redactHeaders(
      new Headers({ authorization: 'Bearer unsafe', cookie: 'sid=unsafe', 'x-request-id': 'r1' }),
    )
    expect(output).toEqual({ authorization: REDACTED, cookie: REDACTED, 'x-request-id': 'r1' })
  })

  it('handles cycles safely', () => {
    const cyclic: Record<string, unknown> = { apiKey: 'unsafe' }
    cyclic.self = cyclic
    expect(safeJsonStringify(cyclic)).toBe(JSON.stringify({ apiKey: REDACTED, self: '[CIRCULAR]' }))
  })
})
