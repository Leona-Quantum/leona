# Secrets registry (NAMES ONLY — values never appear in this repo)

| Name | Store | Consumer | Created |
|---|---|---|---|
| SNYK_TOKEN | GitHub Actions secret (repo) | security.yml Snyk job | 2026-07-09 (UTC) |
| NEON_API_KEY | GitHub Actions secret (repo) | ci.yml db job (branch create/delete) — Neon org API key `gh-ci-majorana` | 2026-07-10 |
| DATABASE_URL | GCP Secret Manager (majorana-core) | Cloud Run api+worker — Neon pooled URL, default branch | 2026-07-10 |
| WORKOS_CLIENT_ID / WORKOS_API_KEY / WORKOS_COOKIE_PASSWORD | apps/web/.env.local (dev) + Vercel env Sensitive (deploy) | AuthKit (web); the API needs WORKOS_CLIENT_ID only. Vercel preview holds PLACEHOLDERS until the owner sets real values (step 5 browser test) | 2026-07-10 |

## Infrastructure projects (names only)

| Provider | Project | Notes |
|---|---|---|
| Neon | `majorana` (ID `twilight-wildflower-01313590`) | Postgres 17, aws-us-west-2, org `org-tiny-glade-89486766`, free tier |
| GCP | `majorana-core` (number 639400385957) | Secret Manager + Cloud Run APIs enabled; billing linked |
| WorkOS | `majorana` | AuthKit project, dashboard signup done 2026-07-10 (owner); API key + client ID pulled into env at Phase 1 step 5 |
| Snyk | org `eshmis` | free plan; personal API token used as SNYK_TOKEN |
| Vercel | account `eshmis` (team `majoranaq`) | project `web`, linked from apps/web 2026-07-10 |
| GCP Artifact Registry | `us-west1-docker.pkg.dev/majorana-core/majorana` | api/worker images; us-west1 = closest to Neon aws-us-west-2 |

Rules: plans/rebuild/05-security.md §1 "Secrets". Rotation runbook lives here too.
