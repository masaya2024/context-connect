# Context Connect

Context Connect turns a company's GitHub, Notion, CSV and Markdown development history into authorized, searchable context for existing AI clients. It is designed as a customer-owned Cloudflare data plane: D1 stores metadata and relations, R2 retains rebuildable raw snapshots, Vectorize provides multilingual semantic retrieval, Queues drive ingestion, and a stateless Remote MCP endpoint exposes read-only tools.

The original Japanese requirements document is maintained internally and is not part of this repository.

## Prerequisites

- **Bun 1.3.11** — pinned through `packageManager`; CI installs exactly this version.
- **Node.js 22+** — required by `engines` and `.nvmrc`. The Nuxt 4 dashboard runs `nuxt prepare` on install and fails to build on Node 20, so run `nvm use` before `bun install`.
- **Wrangler** — a dev dependency, invoked as `bunx --bun wrangler`. No global install needed.
- **A Cloudflare account** with Workers, D1, R2, Queues, Vectorize and Workers AI enabled, plus either an authenticated `wrangler login` session or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

| Resource                                             | Binding        | Used by                                   |
| ---------------------------------------------------- | -------------- | ----------------------------------------- |
| D1 `cc-default-db`                                   | `DB`           | api-worker, mcp-worker, sync-worker       |
| R2 `cc-default-raw`                                  | `RAW_BUCKET`   | api-worker, mcp-worker, sync-worker       |
| Queues `cc-default-sync` (DLQ `cc-default-sync-dlq`) | `SYNC_QUEUE`   | api-worker (producer), sync-worker (both) |
| Vectorize `cc-default-vectors` (1024-dim, cosine)    | `VECTOR_INDEX` | mcp-worker, sync-worker                   |
| Workers AI (`@cf/baai/bge-m3`)                       | `AI`           | mcp-worker, sync-worker                   |

Vectorize and Workers AI are declared `"remote": true`, so **even local development calls your real Cloudflare account for those two bindings**. D1, R2 and Queues run against Wrangler's local simulation. The api-worker has no Vectorize or AI binding and works fully offline.

## Repository

```text
apps/
  dashboard/       Nuxt 4 management UI
  api-worker/      Hono REST API
  mcp-worker/      stateless Streamable HTTP MCP
  sync-worker/     webhooks, schedules and queue consumption
packages/
  contracts/       Zod HTTP, sync-job and MCP contracts
  core/            provider-independent domain/use cases
  db/              D1/Drizzle schema and repositories
  auth/            role, scope, ACL and redaction
  knowledge/       chunk, relation, ranking and context packs
  connectors/      GitHub, Notion, CSV and Markdown adapters
  config/          runtime configuration schema and shared constants
  mcp/             MCP tool policies, scopes and payload budgets
infrastructure/
  migrations/      D1 migrations
docs/              architecture, deployment, security and acceptance notes
examples/          demo tenant sample data
scripts/           provisioning, re-index and requirement checks
```

## Local development

```sh
nvm use
for app in api-worker mcp-worker sync-worker; do cp .dev.vars.example "apps/$app/.dev.vars"; done
bun install
bun run db:migrate:local
bun run dev
```

Wrangler resolves `.dev.vars` relative to each worker's configuration directory, so the file belongs in `apps/<worker>/`, not the repository root. Every `.dev.vars` is untracked.

None of the example values are required to boot `bun run dev`: `ENVIRONMENT`, `GITHUB_API_VERSION` and `NOTION_VERSION` are already supplied through `wrangler.jsonc` vars, and the connector credentials are only read when you exercise a real connector. Real credentials must stay in the untracked `.dev.vars` file and in Cloudflare Worker Secrets.

No worker declares a dev port, so the three `wrangler dev` processes compete for the default 8787. The dashboard expects the API at `http://localhost:8787/api/v1`; assign ports explicitly if they collide.

## Connecting an AI client

The MCP endpoint is stateless Streamable HTTP and speaks **only** MCP revision `2026-07-28`. The legacy `initialize` handshake is rejected with HTTP 400 (`-32022`), so a client that only speaks 2025-era revisions cannot connect.

| Path                                        | Method    | Purpose                           |
| ------------------------------------------- | --------- | --------------------------------- |
| `/mcp`                                      | `POST`    | the only MCP entry point          |
| `/mcp`                                      | `OPTIONS` | CORS preflight, needs an `Origin` |
| `/health`                                   | `GET`     | liveness probe                    |
| `/.well-known/oauth-protected-resource/mcp` | `GET`     | OAuth protected-resource metadata |

Every request needs `Authorization: Bearer <token>` (tokens shorter than 24 characters are rejected), `Content-Type: application/json`, an `Mcp-Method` header, and the protocol envelope inside `params._meta`. `tools/call` additionally needs `Mcp-Name`. Discovery uses `server/discover` rather than `initialize`.

```sh
curl -s -X POST https://<host>/mcp \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -H 'mcp-method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list",
       "params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
                          "io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Access tokens are matched against SHA-256 hashes in the `oauth_access_tokens` table. This repository contains no authorization or token endpoint, so tokens must come from the OAuth provider or Cloudflare Access deployment described in [security operations](docs/security.md).

Set `MCP_ALLOWED_HOSTNAMES` in production: an empty value allows every hostname. `MCP_ALLOWED_ORIGINS` behaves the other way around — requests without an `Origin` header always pass, but when the variable is unset every `POST /mcp` that carries one is rejected with `-32000`, while the `OPTIONS` preflight is checked separately and still passes. Successful responses carry no `Access-Control-Allow-Origin` header, so browser-based clients are not supported.

`ALLOW_DEV_AUTH` defaults to `"false"` and must stay that way outside local development. When enabled, sending `x-dev-member-id` and `x-dev-tenant-id` bypasses token verification entirely — any caller can claim an arbitrary tenant, member and `owner` role, which disables all ACL filtering.

## Implemented MCP tools

A tool is only registered when the caller's scopes allow it, so `tools/list` differs per principal. `knowledge:read` implies every read-only tool scope below.

| Tool                                        | Scope                | Required input              |
| ------------------------------------------- | -------------------- | --------------------------- |
| `search_knowledge`                          | `knowledge:read`     | `query`                     |
| `search_tasks` / `get_task`                 | `tasks:read`         | `query` / `task_id`         |
| `search_pull_requests` / `get_pull_request` | `pull_requests:read` | `query` / `pr_id`           |
| `find_related_history`                      | `history:read`       | `document_id` or `query`    |
| `get_change_history`                        | `history:read`       | none (all filters optional) |
| `get_project_context`                       | `projects:read`      | `project_id`                |

All tools are read-only, return the source URL, external ID, confidence and link mode, and apply the same tenant/workspace/project/source ACL as the REST API before ranking or relation expansion. Responses are truncated to `MAX_CONTEXT_CHARS` (default 30000).

## Verification

```sh
bun run format:check
bun run lint
bun run lint:root
bun run typecheck
bun run test
bun run test:root
bun run build
bun run validate:requirements
```

CI runs the same list, then applies the D1 migrations twice to prove they are idempotent. Vectorize and Workers AI have no complete local emulation, so unit and integration tests use the ports in `packages/knowledge`; staging smoke tests should use remote bindings.

## Deployment

See [customer deployment](docs/deployment.md), [architecture](docs/architecture.md), [security operations](docs/security.md) and the [acceptance map](docs/acceptance.md). The production flow deploys the API owner first for automatic resource provisioning, applies D1 migrations, and deploys the sync and MCP workers against the tenant resources.

## License

[Apache License 2.0](LICENSE).
