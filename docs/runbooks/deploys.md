# Runbook: deploying api + worker to Cloud Run

Web deploys itself — Vercel builds every push to `dev` and aliases production
(ADR-0011). **api and worker historically did not**, and the Cloud Run services
kept serving whatever image was last pushed by hand.

That gap caused three incidents. On 2026-07-19 both services were still running
`api:125044bb-amd64` (PR #65), twelve commits behind `dev`: the API had no
`/v1/catalog/entries` route at all, and the worker crash-looped every 10s against
`ck_jobs_lease_shape` — a constraint added by migration 0012, which the old code
predates. It recurred the same day, 11:31–11:55 UTC, from the same cause. A green
CI run says nothing about what production is running.

`.github/workflows/deploy.yml` now does this automatically on every merge to
`dev`. **The manual procedure below is still the fallback.**

## Automated deploy — how auth is wired

Provisioned 2026-07-19 in project `majorana-core`. No service-account key exists;
GitHub authenticates by Workload Identity Federation and receives a short-lived
token. Recorded here so it can be audited or rebuilt — you should not need to
touch any of it again.

| Resource | Value |
|---|---|
| Deploy SA | `majorana-deploy@majorana-core.iam.gserviceaccount.com` |
| WIF pool | `github` (global) |
| WIF provider | `github-dev` |
| Repo secret `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/639400385957/locations/global/workloadIdentityPools/github/providers/github-dev` |
| Repo secret `GCP_DEPLOY_SERVICE_ACCOUNT` | the deploy SA above |

The SA holds `roles/run.admin`, `roles/cloudbuild.builds.editor`,
`roles/artifactregistry.writer` and `roles/logging.viewer` on the project, plus
`roles/iam.serviceAccountUser` on the runtime SA
(`639400385957-compute@developer.gserviceaccount.com`).

It also needs to read one secret, so the workflow can migrate the database before
it rolls anything out. Granted per-secret, never project-wide:

```bash
gcloud secrets add-iam-policy-binding DATABASE_URL_SECRET \
  --project=majorana-core \
  --member="serviceAccount:majorana-deploy@majorana-core.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Without it the `migrate database` step fails the deploy with that command in the
error output. It fails rather than skips on purpose: a deploy that silently
declines to migrate is the exact failure this workflow was added to prevent.

**Branch scoping lives in the provider's attribute condition, not in the IAM
binding:**

```
assertion.repository=='EshMis/majorana' && assertion.ref=='refs/heads/dev'
```

The `principalSet` binding can only filter on one attribute, so filtering there
by repository alone would let *any* branch of this repo deploy production. The
attribute condition is what enforces both, and it is evaluated at token exchange
— a run from any other ref cannot obtain a token at all.

The practical consequence: **`workflow_dispatch` only works from `dev`.**
Dispatching the workflow from any other branch fails at the auth step, by design.
If you ever need a deploy from another branch, change the condition rather than
loosening the binding.

What the workflow does, in order: **apply migrations to the production database**
→ build the image from the merge commit → deploy
the API dark under `--tag verify` → smoke-test that tag URL (`/health` is 200,
unauthenticated `/v1/me` is still 401, the catalog is non-empty) → shift traffic →
deploy the worker with `--command majorana-worker` → **read the worker's error log
for 45s and fail the deploy if anything appears**. That last step is the one that
would have caught all three incidents; Cloud Run itself reports a crash-looping
worker as healthy.

It does not roll back automatically. On failure it prints the recent revisions and
the `update-traffic --to-revisions` command to run.

## Manual deploy (fallback)

Check what is actually deployed before assuming:

```bash
gcloud run services describe majorana-api --project majorana-core \
  --region us-west1 --format="value(spec.template.spec.containers[0].image)"
git log --oneline <tag>..origin/dev   # commits the deployed image is missing
```

## Build

One image serves both services; the entrypoint differs. Build from a **clean
tree of the exact commit**, not the working copy — `packages/py/*` is a uv
workspace glob, so a local untracked directory there (e.g. `baselines/`, `ir/`,
`pipeline/`) fails the build with "missing a `pyproject.toml`".

```bash
TAG=$(git rev-parse --short=7 origin/dev)
git worktree add --detach /tmp/majorana-build "$TAG"
cp .gcloudignore cloudbuild.api.yaml /tmp/majorana-build/
cd /tmp/majorana-build
gcloud builds submit --config cloudbuild.api.yaml \
  --substitutions=_TAG="$TAG" --project majorana-core --region us-west1
cd - && git worktree remove /tmp/majorana-build --force
```

`.gcloudignore` restricts the upload to what `services/api/Dockerfile` actually
copies (~4 MiB). Without it `gcloud builds submit` uploads `apps/` too — 732 MB
of `node_modules` and `.next`.

## Deploy the API — tagged revision first

Never point traffic at an unverified revision. Deploy with `--no-traffic
--tag`, verify against the tag URL, then shift.

```bash
gcloud run deploy majorana-api --project majorana-core --region us-west1 \
  --image us-west1-docker.pkg.dev/majorana-core/majorana/api:$TAG \
  --no-traffic --tag verify
# → https://verify---majorana-api-nikekeixtq-uw.a.run.app
curl -s .../health                       # 200
curl -s .../v1/me -o /dev/null -w '%{http_code}\n'   # 401 — auth still closed
curl -s .../v1/catalog/entries | jq length            # 283
gcloud run services update-traffic majorana-api \
  --project majorana-core --region us-west1 --to-latest
```

Rollback is `update-traffic --to-revisions <previous>=100`.

## Deploy the worker

The worker takes no traffic, so there is no tagged-revision step — but it does
need `--command majorana-worker` preserved, and it reads `CatalogAuthority`
config for `catalog.import` jobs, so it needs the same `SYSTEM_CATALOG_*`
variables as the API.

```bash
gcloud run deploy majorana-worker --project majorana-core --region us-west1 \
  --image us-west1-docker.pkg.dev/majorana-core/majorana/api:$TAG \
  --command majorana-worker
```

Then confirm it is not crash-looping — an unhealthy worker still reports as a
healthy Cloud Run service, because the failure is inside the poll loop:

```bash
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="majorana-worker"' \
  --project majorana-core --freshness=10m --limit 40 \
  --format="value(severity,textPayload)"
```

Expect `worker <id> started (poll 2.0s)` and no repeated tracebacks.

## Environment

Secrets come from GCP Secret Manager (`docs/runbooks/secrets.md`); the catalog
identity UUIDs are plain config, not secrets. `--update-env-vars` merges, so it
does not disturb secret-backed variables already on the service.

| Variable | api | worker |
|---|---|---|
| `DATABASE_URL` (secret, pooled) | ✔ | ✔ |
| `WORKOS_CLIENT_ID`, `WORKOS_JWT_ISSUER`, `WEB_ORIGIN` | ✔ | — |
| `SYSTEM_CATALOG_ENABLED` + the three `SYSTEM_CATALOG_*_ID`s | ✔ | ✔ |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `VERCEL_TOKEN` (secrets) | — | ✔ |

`DATABASE_URL` is the **pooled** Neon hostname, and it is the only database URL
either service should ever get.

The **direct** (non-pooled) hostname is for Alembic only. Two different names are
involved and they are easy to confuse:

- **`DATABASE_URL_DIRECT`** is the *environment variable* Alembic reads (see
  `.env.example`). It exists only in a migration shell, never on a service.
- **`DATABASE_URL_SECRET`** is the *GCP Secret Manager entry* that stores that
  value in production. The name is unfortunate — it is not "the secret for
  `DATABASE_URL`", it is the direct URL. Verified 2026-07-19: the `DATABASE_URL`
  entry holds the `-pooler` hostname, `DATABASE_URL_SECRET` holds the same host
  without `-pooler`.

So a migration run reads the `DATABASE_URL_SECRET` entry into the
`DATABASE_URL_DIRECT` variable. Never wire either to a Cloud Run service. The
`migrate database` step in `deploy.yml` does exactly this translation, and it is
the only automated consumer of that secret.

Because migrations run *before* the new image rolls out, every migration must
remain readable by the revision still serving traffic for the length of the
deploy: expand in one release, contract in a later one. Dropping or renaming
something the live code still touches breaks production in the window between the
migration and the traffic shift.
