# AGENTS.md — services/api

FastAPI control plane. Owns the only Postgres repository layer; both the API and
Worker use it as `majorana_api`, a LOGIN role whose sole membership is the
`app_rw` privilege bundle — live since 2026-08-17, so this is a description and
no longer a plan. No other process may talk to Postgres. `majorana_app` owns the
tables and is the migration credential only; see
`docs/runbooks/database.md` § *Connecting as `app_rw`*.

- Authz invariant: repository functions take `Scope` first-arg; no raw queries outside
  the repository layer (import-linter + CI grep enforce; authz suite is a required check).
- REST + SSE, URL-versioned /v1; errors are RFC 9457 problem+json; cursor pagination;
  idempotency keys on mutations.
- Auth: verify WorkOS-minted JWT via JWKS (issuer/audience pinned). Auth code is
  blast-radius (CODEOWNERS).
- Top-level run statuses use `majorana_contracts.lifecycle`; new circuit runs follow
  the fixed `majorana_agent.SimpleCircuitPipeline`, while durable step records are
  persisted only through the scoped repository layer.
Schema: majorana/docs/runbooks/database.md (live authority; the original
plans/archive/rebuild/04-database.md is archived history). Migrations live in
/db/migrations (blast-radius).
