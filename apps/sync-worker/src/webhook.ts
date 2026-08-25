const encoder = new TextEncoder()

export async function githubSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return `sha256=${toHex(new Uint8Array(signature))}`
}

export async function verifyGitHubSignature(
  secret: string,
  body: string,
  supplied: string | null,
): Promise<boolean> {
  if (!supplied?.startsWith('sha256=') || supplied.length !== 71) return false
  const expected = await githubSignature(secret, body)
  return constantTimeEqual(expected, supplied.toLowerCase())
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
