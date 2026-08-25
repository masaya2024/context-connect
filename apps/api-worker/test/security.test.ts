import { describe, expect, it } from 'vitest'
import { sha256 } from '../src/security'

describe('access token hashing', () => {
  it('uses a deterministic SHA-256 digest without retaining the token', async () => {
    expect(await sha256('context-connect-token')).toBe(
      '47935d02bc1b32b6e744ed6ab98b9054feca4ee04886871ec271617805ddc9b8',
    )
  })
})
