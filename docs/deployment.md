# Customer deployment

## Prerequisites

- A Cloudflare account with Workers, D1, R2, Vectorize, Queues and Workers AI enabled.
- Bun 1.3.11 or newer for local setup.
- Node 22 or newer (see `.nvmrc`); the Nuxt 4 dashboard build fails on Node 20.
- An authenticated Wrangler session, or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` with least-privilege resource permissions.
- GitHub and Notion credentials for only the repositories/data sources the tenant chooses.

## Provision

```sh
bun install
bun run provision -- your-tenant-slug
```

Wrangler provisions draft bindings from the worker configurations, the bootstrap applies D1 migrations, then deploys the API, sync and MCP Workers. Set credentials after the resources exist:

```sh
bunx wrangler secret put GITHUB_TOKEN --config apps/sync-worker/wrangler.jsonc
bunx wrangler secret put GITHUB_WEBHOOK_SECRET --config apps/sync-worker/wrangler.jsonc
bunx wrangler secret put NOTION_TOKEN --config apps/sync-worker/wrangler.jsonc
bunx wrangler secret put DEV_AUTH_TOKEN --config apps/api-worker/wrangler.jsonc
```

For production authentication, put the MCP/API endpoints behind Cloudflare Access or configure the OAuth Provider integration described in `docs/security.md`. Do not use the development bearer token mode in production.

## Migrations and rollback

`app_version` and `schema_version` are independent. D1 records applied migrations and each migration is rerunnable through Wrangler guards. Before a destructive future migration, create a D1 Time Travel bookmark/checkpoint and deploy the new Worker as a version. If verification fails, route traffic to the preceding Worker version before restoring data.

## Re-index

With a scoped admin token in the environment:

```sh
CONTEXT_CONNECT_API_URL=https://context-connect-api.example.workers.dev \
CONTEXT_CONNECT_AUTH_TOKEN=... bun run reindex
```

The job reads retained R2 raw snapshots, regenerates stable chunks, and upserts vectors. It does not require GitHub or Notion to be available.
