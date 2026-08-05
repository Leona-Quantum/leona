# ADR-0003: Neon Postgres (not Supabase)

**Date:** 2026-07-09 · **Status:** superseded-by-0024 (2026-07-27)

> **Superseded by ADR-0024.** Production has run on **Cloud SQL for PostgreSQL 17**
> (`majorana-core:us-west1:majorana-pg`) since 2026-07-27. The reversal trigger written
> below is not what fired: the free plan's transfer and compute-hour allowances did,
> against a 47 MB database, because an always-on polling worker and a per-second-billed
> serverless database are the wrong shape for each other. The Neon project is retained
> as the rollback path and is not yet decommissioned — see `docs/runbooks/database.md`.
> Everything below is the decision as written in Phase 0 and is left unedited.

**Context:** Need serverless Postgres at $0 idle for an agent-driven, pre-revenue build;
Supabase's bundled Auth/RLS/Realtime are wasted in a control-plane architecture (single
trusted DB caller, ADR-0002/0004).
**Decision:** Neon Postgres. Branch-per-PR/agent-task is the killer feature (10 free
branches, scale-to-zero ≈ $0 idle); vanilla Postgres gives the cleanest exit to RDS/Cloud
SQL; widest extension set; PITR without Supabase's $100/mo add-on. Alembic owns the single
migration history.
**Consequences:** Buys preview DBs per PR and cheap experiments. Costs: no bundled
realtime (SSE from control plane covers it, ADR-0007). Migration trigger: sustained
high-throughput OLTP beyond serverless autoscale ceiling → dedicated Postgres via
pg_dump/logical replication.
