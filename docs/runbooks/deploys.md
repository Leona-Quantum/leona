# Runbook: deploying api + worker to Cloud Run

Web deploys itself — Vercel builds every push to `dev` and aliases production
(ADR-0011). **api and worker do not.** There is no deploy workflow for them; the
Cloud Run services keep serving whatever image was last pushed by hand.

That gap caused a real outage on 2026-07-19: both services were still running
`api:125044bb-amd64` (PR #65), twelve commits behind `dev`. The API therefore had
no `/v1/catalog/entries` route at all, and the worker crash-looped every 10s
against `ck_jobs_lease_shape` — a constraint added by migration 0012, which the
old code predates. **After any migration, redeploy api and worker.** A green CI
run says nothing about what production is running.

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
`DATABASE_URL_DIRECT` variable. Never wire either to a Cloud Run service.
