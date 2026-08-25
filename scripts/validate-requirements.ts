import { readJsoncFile } from './lib/jsonc'

const requiredPaths = [
  'apps/dashboard/app/pages/setup.vue',
  'apps/dashboard/app/pages/sources.vue',
  'apps/dashboard/app/pages/repositories.vue',
  'apps/dashboard/app/pages/knowledge.vue',
  'apps/dashboard/app/pages/relations.vue',
  'apps/dashboard/app/pages/sync.vue',
  'apps/dashboard/app/pages/members.vue',
  'apps/dashboard/app/pages/mcp.vue',
  'apps/dashboard/app/pages/audit.vue',
  'apps/dashboard/app/pages/system.vue',
  'apps/api-worker/src/index.ts',
  'apps/mcp-worker/src/index.ts',
  'apps/sync-worker/src/index.ts',
  'packages/contracts/src/index.ts',
  'packages/core/src/index.ts',
  'packages/db/src/index.ts',
  'packages/knowledge/src/index.ts',
  'packages/auth/src/index.ts',
  'packages/connectors/github/src/index.ts',
  'packages/connectors/notion/src/index.ts',
  'packages/connectors/csv/src/index.ts',
  'packages/connectors/markdown/src/index.ts',
  'infrastructure/migrations/0001_initial.sql',
]

const missing: string[] = []
for (const path of requiredPaths) {
  if (!(await Bun.file(path).exists())) missing.push(path)
}

if (missing.length > 0) {
  console.error(
    `Missing MVP implementation paths:\n${missing.map((path) => `- ${path}`).join('\n')}`,
  )
  process.exit(1)
}

// D1 マイグレーションは infrastructure/migrations に集約しているため、wrangler の
// D1 バインディングが必ずそのディレクトリを指すことを検証する。設定が漏れると
// `wrangler d1 migrations apply` とプロビジョニングが既定の ./migrations を探して失敗する。
type WranglerD1Config = {
  d1_databases?: { binding: string; migrations_dir?: string }[]
}

const wranglerConfigPath = 'apps/api-worker/wrangler.jsonc'
const wranglerConfig = await readJsoncFile<WranglerD1Config>(wranglerConfigPath)
const dbBinding = wranglerConfig.d1_databases?.find((database) => database.binding === 'DB')

if (!dbBinding) {
  console.error(`Missing D1 binding "DB" in ${wranglerConfigPath}.`)
  process.exit(1)
}

if (!dbBinding.migrations_dir) {
  console.error(
    `D1 binding "DB" in ${wranglerConfigPath} must set "migrations_dir" so migrations resolve to infrastructure/migrations.`,
  )
  process.exit(1)
}

const resolvedMigrationsDir = new URL(
  dbBinding.migrations_dir + '/',
  new URL(wranglerConfigPath, `file://${process.cwd()}/`),
)
const expectedMigrationsDir = new URL('infrastructure/migrations/', `file://${process.cwd()}/`)

if (resolvedMigrationsDir.pathname !== expectedMigrationsDir.pathname) {
  console.error(
    `D1 "migrations_dir" resolves to ${resolvedMigrationsDir.pathname} but must resolve to ${expectedMigrationsDir.pathname}.`,
  )
  process.exit(1)
}

console.info(`MVP structure validated (${requiredPaths.length} required paths, D1 migrations_dir).`)
