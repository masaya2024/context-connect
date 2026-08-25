import { z } from 'zod'

export const APP_VERSION = '0.1.0'
export const SCHEMA_VERSION = '0001'
export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3'
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024

export const runtimeConfigSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
  PUBLIC_BASE_URL: z.string().url(),
  TENANT_SLUG: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  GITHUB_API_VERSION: z.string().default('2026-03-10'),
  NOTION_VERSION: z.string().default('2026-03-11'),
  EMBEDDING_MODEL: z.string().default(DEFAULT_EMBEDDING_MODEL),
  CHUNK_MAX_CHARS: z.coerce.number().int().min(200).max(12_000).default(1800),
  CHUNK_OVERLAP_CHARS: z.coerce.number().int().min(0).max(2000).default(200),
  MAX_MCP_RESULTS: z.coerce.number().int().min(1).max(20).default(20),
  MAX_CONTEXT_CHARS: z.coerce.number().int().min(1000).max(100_000).default(24_000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
})

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>

export const parseRuntimeConfig = (value: unknown): RuntimeConfig => {
  const config = runtimeConfigSchema.parse(value)
  if (config.CHUNK_OVERLAP_CHARS >= config.CHUNK_MAX_CHARS) {
    throw new Error('CHUNK_OVERLAP_CHARS must be smaller than CHUNK_MAX_CHARS')
  }
  return config
}
