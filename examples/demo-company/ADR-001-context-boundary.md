# ADR-001: Context retrieval boundary

Status: Accepted

All retrieval starts with the authenticated tenant and project/source ACL. Ranking and relation expansion operate only on authorized document identifiers. This duplicates the customer-owned Cloudflare resource boundary at the application row level and prevents vector similarity from becoming an authorization decision.

Connector credentials are referenced through Worker Secrets or Secrets Store and never become Knowledge documents.
