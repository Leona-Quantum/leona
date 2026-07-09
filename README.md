# Majorana

A verified quantum algorithm workbench: an AI execution agent (Run) that plans,
generates, simulates, and verifies quantum code, and a durable library (Library) of
verified artifacts with full provenance and run records.

**Status:** rebuild in progress. Plan: `~/Documents/Projects/Majorana/plans/rebuild/`.

## Stack
Next.js (Vercel) · FastAPI control plane + worker (Cloud Run) · Neon Postgres (Alembic)
· WorkOS AuthKit · Vercel Sandbox (deny-all egress) for untrusted code · OTel → Sentry +
Grafana Cloud.

## Quickstart (Phase 1+)
```bash
pnpm install && uv sync
pnpm turbo run dev        # web
uv run fastapi dev services/api/app/main.py
```
