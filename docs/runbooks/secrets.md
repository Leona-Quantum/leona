# Secrets registry (NAMES ONLY — values never appear in this repo)

| Name | Store | Consumer | Created |
|---|---|---|---|
| SNYK_TOKEN | GitHub Actions secret (repo) | security.yml Snyk job | 2026-07-09 (UTC) |
| NEON_API_KEY | GitHub Actions secret (repo) | ci.yml db job (branch create/delete) — Neon org API key `gh-ci-majorana` | 2026-07-10 |
| DATABASE_URL | GCP Secret Manager (majorana-core) | Cloud Run api+worker — Neon pooled URL, default branch | 2026-07-10 |
| DATABASE_URL_DIRECT | approved migration environment only; not API/Worker/Vercel | Alembic — Neon direct URL; not used by runtime applications; store, redact, and rotate as a database credential under the same requirements as DATABASE_URL | pending owner setup |
| WORKOS_CLIENT_ID / WORKOS_API_KEY / WORKOS_COOKIE_PASSWORD | apps/web/.env.local (dev) + Vercel env Sensitive (deploy) | AuthKit (web); the API needs WORKOS_CLIENT_ID only. Vercel preview holds PLACEHOLDERS until the owner sets real values (step 5 browser test) | 2026-07-10 |
| SENTRY_DSN (per service) + NEXT_PUBLIC_SENTRY_DSN | local secrets store (dev); GCP Secret Manager + Vercel env at deploy (pending) | api/worker (Sentry project `python`), web (project `web`), org `majorana-ms` — DSNs are client keys, not strict secrets | 2026-07-11 |
| OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS | local secrets store (dev); GCP Secret Manager + Vercel env at deploy (pending) | all services → Grafana Cloud OTLP gateway (stack `yellowwildebeest692`); the header embeds token `majorana-otlp` (otlp-write scope) — treat as secret | 2026-07-11 |

## Infrastructure projects (names only)

| Provider | Project | Notes |
|---|---|---|
| Neon | `majorana` (ID `twilight-wildflower-01313590`) | Postgres 17, aws-us-west-2, org `org-tiny-glade-89486766`, free tier |
| GCP | `majorana-core` (number 639400385957) | Secret Manager + Cloud Run APIs enabled; billing linked |
| WorkOS | `majorana` | AuthKit project, dashboard signup done 2026-07-10 (owner); API key + client ID pulled into env at Phase 1 step 5 |
| Snyk | org `eshmis` | free plan; personal API token used as SNYK_TOKEN |
| Vercel | account `eshmis` (team `majoranaq`) | project `web`, linked from apps/web 2026-07-10 |
| GCP Artifact Registry | `us-west1-docker.pkg.dev/majorana-core/majorana` | api/worker images; us-west1 = closest to Neon aws-us-west-2 |
| Sentry | org `majorana-ms`, projects `python` + `web` | US region, free dev tier; errors only (AD-10) |
| Grafana Cloud | org `yellowwildebeest692`, stack `yellowwildebeest692` (ID 1718943) | OTLP gateway prod-us-west-0; free tier after 14-day trial window (started ~2026-07-11) |

Rules: plans/rebuild/05-security.md §1 "Secrets". Rotation runbook lives here too.
