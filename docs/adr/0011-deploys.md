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

> **Amendment, 2026-09-16 — the web app is moving to Cloud Run, and both stacks run
> at once.** The owner asked for the move off Vercel; the plan is `ai-ops`
> `desk/leona/plans/gcp-migration-20260912/PLAN.md`, and ai-ops 316 authorised running
> the builds. `majorana-web` now exists on Cloud Run in `us-west1` beside the api and
> worker, built by `cloudbuild.web.yaml` and deployed by
> `.github/workflows/deploy-web.yml` on every push to `dev` — dark revision,
> smoke-test, traffic shift, the same sequence `deploy.yml` uses.
>
> **This does not supersede the decision yet, and the ADR deliberately still says
> Vercel.** `leonaqt.com` resolves to Vercel, Vercel still builds every push, and both
> deploy lanes run on the same commit. That is the design, not an unfinished migration:
> the Google copy has to pass everything production passes for a week before DNS moves,
> and Vercel stays deployed for 30 days afterwards so a rollback is a DNS change. Rewrite
> this ADR when Vercel stops serving, not when Cloud Run starts.
>
> **The code sandbox is not moving with it.** It is the product's security boundary, a
> replacement is a new provider, and on Google the metadata server hands out credentials
> where Vercel's is empty — so it re-runs the whole gate in
> `plans/rebuild/05-security.md` §1a/§2 as a separate track. `MAJORANA_SANDBOX` still
> defaults to `vercel` and nothing here changes that.
>
> Two things that only break once Vercel is out of the path, both fixed in advance
> because neither produces an error: the contact limiter's client-address chain (it fell
> through to a caller-written header when Vercel's platform headers are absent —
> `apps/web/lib/contact-rate-limit.ts`), and the Atlas edge-cache header, which only
> Vercel reads (`CDN-Cache-Control` now sits beside it in `next.config.ts`).
