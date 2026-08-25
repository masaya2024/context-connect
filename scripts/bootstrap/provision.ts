const tenantSlug = Bun.argv[2] ?? process.env.TENANT_SLUG ?? 'demo-company'

if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(tenantSlug)) {
  throw new Error('tenant slug must be 3-63 lowercase letters, numbers, or hyphens')
}

const run = async (args: string[]) => {
  const process = Bun.spawn(['bunx', '--bun', 'wrangler', ...args], {
    cwd: import.meta.dir + '/../..',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...Bun.env, TENANT_SLUG: tenantSlug },
  })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`wrangler ${args[0]} failed with ${exitCode}`)
}

console.info(`Provisioning the customer-owned data plane for ${tenantSlug}`)

// The API deployment owns initial resource provisioning. Current Wrangler reads
// draft bindings and creates D1/R2/Queues automatically. The remaining workers
// bind the same explicitly named tenant resources.
await run(['deploy', '--config', 'apps/api-worker/wrangler.jsonc'])
await run([
  'd1',
  'migrations',
  'apply',
  'DB',
  '--remote',
  '--config',
  'apps/api-worker/wrangler.jsonc',
])
await run(['deploy', '--config', 'apps/sync-worker/wrangler.jsonc'])
await run(['deploy', '--config', 'apps/mcp-worker/wrangler.jsonc'])

console.info(
  'Provisioning complete. Add connector and auth credentials with `wrangler secret put`.',
)
