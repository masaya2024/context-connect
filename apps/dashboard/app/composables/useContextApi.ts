export interface ApiEnvelope<T> {
  data: T
  request_id: string
  next_cursor?: string
}

export interface ApiError {
  code: string
  message: string
  request_id?: string
}

export const useContextApi = () => {
  const config = useRuntimeConfig()
  const token = useState('context-connect-token', () => '')

  const request = async <T>(path: string, options: Parameters<typeof $fetch<T>>[1] = {}) => {
    const headers = new Headers(options.headers as HeadersInit | undefined)
    if (token.value) headers.set('Authorization', `Bearer ${token.value}`)
    return await $fetch<ApiEnvelope<T>>(`${config.public.apiBase}${path}`, {
      ...options,
      headers,
    })
  }

  return { request, token }
}
