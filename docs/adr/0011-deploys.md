# ADR-0011: Deploys — web on Vercel, api+worker on Cloud Run gen2

**Date:** 2026-07-09 · **Status:** accepted
**Context:** Three deployables (web, api, worker) from one monorepo; GCP already in use;
previews needed per PR for an agent-driven workflow.
**Decision:** Web → Vercel, monorepo Root Directory = `apps/web`. API + worker → Cloud
Run gen2 containers (same image, different entrypoints). Previews per PR: Vercel preview
(web) + Neon branch (db) + Cloud Run revision tag (api).
**Consequences:** Buys zero-ops deploys and full-stack preview envs. Costs/constraints:
Vercel Hobby is non-commercial — the moment Leona Quantum takes users or money, web moves to
Vercel Pro (~$20/mo; first recurring cost, owner-gated in Phase 4). Reversal trigger:
none at this scale; Cloud Run→GKE only with infra headcount.
