const baseUrl = process.env.CONTEXT_CONNECT_API_URL
const authToken = process.env.CONTEXT_CONNECT_AUTH_TOKEN

if (!baseUrl || !authToken) {
  throw new Error('CONTEXT_CONNECT_API_URL and CONTEXT_CONNECT_AUTH_TOKEN are required')
}

const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/reindex`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({ source: 'r2', mode: 'resume' }),
})

if (!response.ok) {
  const error = (await response.json().catch(() => ({ code: 'UNKNOWN_ERROR' }))) as {
    code?: string
  }
  throw new Error(`re-index request failed (${response.status}, ${error.code ?? 'UNKNOWN_ERROR'})`)
}

const result = (await response.json()) as { data?: { job_id?: string } }
console.info(`Re-index queued: ${result.data?.job_id ?? 'job accepted'}`)
