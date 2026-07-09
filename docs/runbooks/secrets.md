# Secrets registry (NAMES ONLY — values never appear in this repo)

| Name | Store | Consumer | Created |
|---|---|---|---|
| SNYK_TOKEN | GitHub Actions secret (repo) | security.yml Snyk job | 2026-07-10 |

## Infrastructure projects (names only)

| Provider | Project | Notes |
|---|---|---|
| Neon | `majorana` (ID `twilight-wildflower-01313590`) | Postgres 17, aws-us-west-2, org `org-tiny-glade-89486766`, free tier |
| GCP | `majorana-core` (number 639400385957) | Secret Manager + Cloud Run APIs enabled; billing linked |
| WorkOS | pending (owner — dashboard signup, no CLI) | AuthKit project, Phase 1 |
| Snyk | org `eshmis` | free plan; personal API token used as SNYK_TOKEN |
| Vercel | account `eshmis` | project created in Phase 1 (web deploy) |

Rules: plans/rebuild/05-security.md §1 "Secrets". Rotation runbook lives here too.
