# ADR-0011: Deploys — web on Vercel, api+worker on Cloud Run gen2

**Date:** 2026-07-09 · **Status:** accepted
**Context:** Three deployables (web, api, worker) from one monorepo; GCP already in use;
previews needed per PR for an agent-driven workflow.
**Decision:** Web → Vercel, monorepo Root Directory = `apps/web`. API + worker → Cloud
Run gen2 containers (same image, different entrypoints). Previews per PR: Vercel preview
(web) + a disposable database + a dark API revision.
**Consequences:** Buys zero-ops deploys and full-stack preview envs. Costs/constraints:
Vercel Hobby is non-commercial — the moment Leona Quantum takes users or money, web moves to
Vercel Pro (~$20/mo; first recurring cost, owner-gated in Phase 4). Reversal trigger:
none at this scale; Cloud Run→GKE only with infra headcount.

> **Amendment, 2026-08-04 — the preview clause.** As written on 2026-07-09 it read
> "Vercel preview (web) + Neon branch (db) + Cloud Run revision tag (api)". Two of the
> three mechanisms are gone and one of them was a hazard:
>
> - **Neon branch (db)** — the database is Cloud SQL since 2026-07-27 (ADR-0024) and has
>   no branching. CI's `db` job and `bench.yml` run a `postgres:17` service container
>   instead, on the same major version as production.
> - **Cloud Run revision tag (api)** — **removed 2026-07-31 as a public-URL hazard.** The
>   service grants `roles/run.invoker` to `allUsers` because it is the public API, so any
>   named tag serves its pinned revision to anyone, at 0% traffic, indefinitely — with
>   that revision's own environment as it was on the day it was deployed. Two orphan tags
>   (`catalog` on rev 00017, `sqlverify` on rev 00192) were found trusting the *staging*
>   WorkOS issuer and referencing `DATABASE_URL` at `:latest`. Only `--tag verify` remains,
>   and it is reassigned to the newest revision on every deploy, so it never pins.
>   `deploy.yml` uses it to smoke-test the API dark before shifting traffic, then shifts.
>
> The decision — three deployables, web on Vercel, api+worker on Cloud Run gen2 — is
> unchanged. See `docs/runbooks/deploys.md § A tag is a public URL` and
> `docs/runbooks/database.md § Rollback`.
