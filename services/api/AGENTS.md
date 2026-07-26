# AGENTS.md — services/api

FastAPI control plane. Owns the only Postgres repository layer; both the API and
Worker use it with role `app_rw`. No other process may talk to Postgres.

- Authz invariant: repository functions take `Scope` first-arg; no raw queries outside
  the repository layer (import-linter + CI grep enforce; authz suite is a required check).
- REST + SSE, URL-versioned /v1; errors are RFC 9457 problem+json; cursor pagination;
  idempotency keys on mutations.
- Auth: verify WorkOS-minted JWT via JWKS (issuer/audience pinned). Auth code is
  blast-radius (CODEOWNERS).
- Top-level run statuses use `majorana_contracts.lifecycle`; new circuit runs follow
  the fixed `majorana_agent.SimpleCircuitPipeline`, while durable step records are
  persisted only through the scoped repository layer.
Schema: plans/rebuild/04-database.md. Migrations live in /db/migrations (blast-radius).
