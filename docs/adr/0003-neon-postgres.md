# ADR-0003: Neon Postgres (not Supabase)

**Date:** 2026-07-09 · **Status:** accepted
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
