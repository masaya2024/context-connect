# Context Connect contributor guide

- Preserve tenant isolation: every data access must be constrained by `tenant_id`, then by workspace/project/source ACL.
- Secrets belong in Cloudflare Worker Secrets or Secrets Store. Never persist or log credential values.
- Keep Cloudflare services behind ports/adapters so unit tests do not require remote resources.
- Search must apply authorization before ranking or relation expansion.
- MCP tools are read-only in the MVP and must return source URL, external ID, confidence, and link mode.
- Use stable IDs and checksums for ingestion, chunks, webhook delivery, imports, and vector upserts.
- Add a regression test for every security or idempotency change.
