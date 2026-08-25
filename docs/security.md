# Security operations

## Authentication modes

- Local development may use an explicit development bearer token from `.dev.vars`.
- Production API/MCP traffic must be authenticated by OAuth 2.1 or Cloudflare Access. The authenticated identity is mapped to a member and reduced to tenant/workspace/project/source scopes.
- GitHub/Notion source credentials are separate from MCP user authorization and are never sent to an AI client.

## Secret handling

Never put real values in Wrangler vars, D1, source configuration JSON, audit payloads, tests or screenshots. Use Worker Secrets/Secrets Store and rotate per connector. The dashboard may display only a non-sensitive suffix. Authorization and Cookie headers are excluded from logs.

## Required negative tests

- Cross-tenant, cross-workspace, cross-project and cross-source search/detail/relation access returns no content.
- An unauthorized vector match is discarded before context assembly.
- Secret canaries do not appear in logs, D1, R2 response objects, audit data, errors, MCP output or rendered dashboard data.
- Duplicate webhook deliveries/imports do not create duplicate documents, chunks or vectors.
- Missing scopes, expired tokens and malformed webhook signatures fail closed.

## Incident response

Revoke the affected Connector or MCP client, rotate the binding secret, inspect audit events by request ID, and enqueue a scoped re-index only if source content changed. Avoid copying raw payloads into tickets or chat systems.
