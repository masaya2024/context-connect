# MVP acceptance map

| Criterion                            | Implementation                                                                        | Automated/local verification                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| AC-001 customer Cloudflare deploy    | Draft bindings in each `wrangler.jsonc`, bootstrap deployment and D1 migration script | Worker dry-run builds; a real account smoke test is required before production   |
| AC-002 GitHub PR/commit/review sync  | GitHub connector and sync-worker webhook/full/incremental pipeline                    | Connector fixtures, HMAC and ingestion tests                                     |
| AC-003 Notion data source/page sync  | Version-pinned 2026-03-11 data-source and recursive block adapter                     | Connector normalization/pagination fixtures                                      |
| AC-004 duplicate-free CSV import     | UTF-8/BOM parser, column mapping, stable external IDs/checksums and idempotency key   | CSV quoted/newline/stable-ID tests                                               |
| AC-005 Notion URL Task ↔ PR relation | URL/UUID normalization and explicit relation with confidence 1.0                      | Explicit relation tests, including URL variations                                |
| AC-006 Japanese cross-source search  | Structured/exact/keyword/semantic/relation retrieval with multilingual bge-m3 port    | Deterministic hybrid ranking tests; staging quality set remains operational work |
| AC-007 Remote MCP search/detail      | Stateless Streamable HTTP endpoint with eight read-only tools                         | Tool catalog and Worker tests; MCP Inspector staging smoke test required         |
| AC-008 Project ACL                   | Tenant/workspace/project/source checks before search, detail and relation expansion   | Cross-project/tenant negative tests                                              |
| AC-009 no credential exposure        | Worker Secret bindings, config secret rejection and recursive log redaction           | Secret-canary/redaction tests                                                    |
| AC-010 inspect/retry failed sync     | Sync job states, reason/count fields, retry endpoint and dashboard                    | Job transition/idempotency tests                                                 |
| AC-011 rebuild Vectorize from R2     | Re-index queue job reads raw snapshots and upserts stable chunk/vector IDs            | Adapter-backed re-index tests; remote Vectorize smoke test required              |

## Release gates

The repository gate is formatting, lint, TypeScript, unit/integration tests, Worker dry-run builds, Nuxt build, migration double-apply and the required-path validator. Vectorize and Workers AI require a staging remote binding for their final smoke tests; CI uses deterministic adapters because those products do not provide complete local simulation.
