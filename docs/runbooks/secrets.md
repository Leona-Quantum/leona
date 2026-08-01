# Secrets registry (NAMES ONLY — values never appear in this repo)

| Name | Store | Consumer | Created |
|---|---|---|---|
| ~~SNYK_TOKEN~~ | — | **retired 2026-07-20**: the Snyk account ran out of quota permanently and the job 403'd on every PR. Replaced by the `osv` + `semgrep` jobs in security.yml, neither of which needs a token or an account. Delete the repo secret if it is still set | 2026-07-09 (UTC) |
| ~~NEON_API_KEY~~ | GitHub Actions secret (repo) | **unused since 2026-07-27**: ci.yml and bench.yml ran on throwaway Neon branches and now run on a `postgres:17` service container. No workflow reads it. Delete the repo secret once Neon itself is decommissioned (docs/runbooks/database.md § Decommissioning Neon) — until then it is the rollback | 2026-07-10 |
| DATABASE_URL | GCP Secret Manager (majorana-core) | Cloud Run api+worker. **Version 3+ is Cloud SQL** (`majorana-pg`, Unix socket through the connector); versions 1–2 are the old Neon pooled URL and are the rollback path. docs/runbooks/database.md | 2026-07-10, repointed 2026-07-27 |
| DATABASE_URL_SECRET | GCP Secret Manager (majorana-core) | Alembic — a **direct** (never pooled) URL, because DDL through a transaction pooler is not safe. Read by `deploy.yml`'s `migrate database` step into the env var `DATABASE_URL_DIRECT` (the entry name and the variable name differ — see docs/runbooks/deploys.md § Environment). **Version 2+ points at 127.0.0.1:5432**, which resolves only while that workflow's Cloud SQL Auth Proxy step is running. Never wired to a Cloud Run service or Vercel; store, redact, and rotate as a database credential under the same requirements as DATABASE_URL. Readable by the deploy SA via a per-secret `roles/secretmanager.secretAccessor` grant | 2026-07-19, repointed 2026-07-27 |
| WORKOS_CLIENT_ID / WORKOS_API_KEY / WORKOS_COOKIE_PASSWORD | apps/web/.env.local (dev) + Vercel env Sensitive (deploy) | AuthKit (web); the API needs WORKOS_CLIENT_ID only. Vercel preview holds PLACEHOLDERS until the owner sets real values (step 5 browser test) | 2026-07-10 |
| SENTRY_DSN (per service) + NEXT_PUBLIC_SENTRY_DSN | local secrets store (dev); GCP Secret Manager + Vercel env at deploy (pending) | api/worker (Sentry project `python`), web (project `web`), org `majorana-ms` — DSNs are client keys, not strict secrets | 2026-07-11 |
| OPENAI_API_KEY / DEEPSEEK_API_KEY | GCP Secret Manager (majorana-core) + GitHub Actions secrets (repo) | Cloud Run **worker only** — the API never calls a model. Both wired at `:latest`, which Cloud Run resolves when a container STARTS: the worker runs continuously, so a rotation is not live until a new revision replaces the instance. The repo secrets are a separate copy, read by bench.yml and the eval harness, and a rotation has to reach them too. `DEEPSEEK_API_KEY` rotated to version 3 on 2026-08-01 (version 2 left enabled as the rollback) | 2026-07-14 |
| OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS | local secrets store (dev); GCP Secret Manager + Vercel env at deploy (pending) | all services → Grafana Cloud OTLP gateway (stack `yellowwildebeest692`); the header embeds token `majorana-otlp` (otlp-write scope) — treat as secret | 2026-07-11 |

## Infrastructure projects (names only)

| Provider | Project | Notes |
|---|---|---|
| GCP Cloud SQL | `majorana-core:us-west1:majorana-pg` | **The production database since 2026-07-27.** Postgres 17, db-g1-small, no authorized networks. docs/runbooks/database.md |
| Neon | `majorana` (ID `twilight-wildflower-01313590`) | Postgres 17, aws-us-west-2, org `org-tiny-glade-89486766` (owned by `emistry@berkeley.edu`), free tier. **No longer serving traffic** — retained as the rollback, still holds the pre-cutover data |
| GCP | `majorana-core` (number 639400385957) | Secret Manager + Cloud Run APIs enabled; billing linked |
| WorkOS | `majorana` | AuthKit project, dashboard signup done 2026-07-10 (owner); API key + client ID pulled into env at Phase 1 step 5 |
| ~~Snyk~~ | org `eshmis` | **abandoned 2026-07-20** — free-plan quota exhausted, no longer used by CI. Nothing depends on this account |
| Vercel | account `eshmis` (team `majoranaq`) | project `web`, linked from apps/web 2026-07-10 |
| GCP Artifact Registry | `us-west1-docker.pkg.dev/majorana-core/majorana` | api/worker images; us-west1 — the same region as Cloud Run and, since 2026-07-27, the database |
| Sentry | org `majorana-ms`, projects `python` + `web` | US region, free dev tier; errors only (AD-10) |
| Grafana Cloud | org `yellowwildebeest692`, stack `yellowwildebeest692` (ID 1718943) | OTLP gateway prod-us-west-0; free tier after 14-day trial window (started ~2026-07-11) |

Rules: plans/rebuild/05-security.md §1 "Secrets". Rotation runbook lives here too.
