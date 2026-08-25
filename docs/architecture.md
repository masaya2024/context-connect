# Architecture

Context Connect is a customer-owned Cloudflare data plane. The vendor does not host or resell an AI model and never receives a user's Claude or other AI-provider credentials.

```text
GitHub / Notion / CSV / Markdown
              │
       sync-worker ─── Queue / DLQ
              │
       R2 raw snapshot
              │
       normalize + relation + chunk
              │
        D1 metadata ── Vectorize
              │
       hybrid retrieval
          ┌───┴────┐
      REST API   Remote MCP
          │          │
      Dashboard   AI clients
```

## Security boundaries

Every request is resolved to a `Principal`. Authorization is default-deny and checks tenant, workspace, project, source and MCP scope. Data-plane resources are deployed into a customer's account, while every database row still carries a tenant identifier as a second isolation boundary. Retrieval filters unauthorized documents before keyword or vector ranking and repeats the check before relation expansion and detail output.

Connector credentials, webhook secrets and auth secrets are Worker Secrets or Secrets Store bindings. Connector records contain only configuration metadata and a masked credential hint. Structured logging uses an allowlist and redacts authorization, cookie, token, key and secret fields recursively.

## Ingestion and idempotency

Source revisions use stable document keys. Webhook delivery IDs, import idempotency keys, `(source, external_id, revision)` and stable chunk checksums prevent duplicates. Raw payloads are retained in R2 before normalization so D1 metadata and R2 snapshots can rebuild Vectorize without calling the source API.

Queue messages transition through `queued`, `running`, `partial`, `succeeded`, `failed` and `cancelled`. A dead-letter queue receives messages that exceed the configured retry limit.

## Retrieval

The retrieval engine combines structured D1 filters, exact ID/URL/PR matching, keyword matches, multilingual semantic matches and authorized relation graph expansion. `@cf/baai/bge-m3` is the default embedding adapter and the Vectorize index uses 1,024 dimensions with cosine distance. Both ports are replaceable for deterministic local tests.

MCP outputs are context packs with bounded result counts and text sizes. Every item carries its canonical source URL, external ID and relation confidence/link mode so inferred history is never presented as confirmed history.
