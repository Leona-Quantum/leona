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
| `LEONA_DEVELOPER_EMAILS` | ✔ | ✔ |
| `DEPLOY_PROBE_TOKEN` (secret) | ✔ | — |

A service's environment is **not** the repository's environment. The worker has
never had `WORKOS_CLIENT_ID`, and #164 shipped worker code that built a settings
object validating it — green in local tests and in CI, because both of those
environments do have it. Read the live service before assuming a variable exists:

```bash
gcloud run services describe majorana-worker --region us-west1 \
  --project majorana-core --format=json | jq '.spec.template.spec.containers[0].env'
```

`DATABASE_URL` is the Cloud SQL **Unix socket** URL, and it is the only database
URL either service should ever get. Full detail in
[database.md](database.md) — including why the URL has no host in it.

Alembic uses a different URL. Two names are involved and they are easy to
confuse:

- **`DATABASE_URL_DIRECT`** is the *environment variable* Alembic reads (see
  `.env.example`). It exists only in a migration shell, never on a service.
- **`DATABASE_URL_SECRET`** is the *GCP Secret Manager entry* that stores that
  value in production. The name is unfortunate — it is not "the secret for
  `DATABASE_URL`", it is the direct URL. Since the Cloud SQL move (2026-07-27)
  it holds a `127.0.0.1:5432` URL that only resolves while this workflow's Cloud
  SQL Auth Proxy step is running.

So a migration run reads the `DATABASE_URL_SECRET` entry into the
`DATABASE_URL_DIRECT` variable. Never wire either to a Cloud Run service. The
`migrate database` step in `deploy.yml` does exactly this translation, and it is
the only automated consumer of that secret.

Because migrations run *before* the new image rolls out, every migration must
remain readable by the revision still serving traffic for the length of the
deploy: expand in one release, contract in a later one. Dropping or renaming
something the live code still touches breaks production in the window between the
migration and the traffic shift.

## Post-deploy synthetic run

The last step of `deploy.yml` submits one real run against the freshly deployed
stack and fails the workflow if it does not finish. Everything before it proves
the pieces are *up*; only this proves they work *together*.

It exists because two production defects in one month lived exactly in that gap:
a worker crash-looping against a schema its image predated (Cloud Run reported a
healthy service throughout), and #164's allowance check constructing the API's
settings inside the worker, which raised on every AUTO run that resolved to
EXECUTE. Local tests, CI and the dark-revision smoke test were all green for
both.

**The run is submitted as `mode: auto`, on purpose.** An explicit mode is
passthrough in the worker's resolver and never reaches `_assert_execute_allowance`
— the line #164 broke. AUTO is the path a real message takes.

**Success is two conditions, not one:** the run reached `succeeded` *and* it
resolved to `execute`. A conversational answer also reports `succeeded` without
entering the sandbox, so status alone would let a chat reply certify a broken
execution path.

### The credential

`DEPLOY_PROBE_TOKEN` — a Secret Manager entry, read by the workflow at deploy
time and set as an environment variable on the **api** service. It is not a
GitHub secret: one copy, in one place.

It may reach exactly three routes — `POST /v1/runs`, `GET /v1/runs/{run_id}`,
`GET /v1/runs/{run_id}/events`. Everything else answers 403. The allowlist is
`DEPLOY_PROBE_ROUTES` in `services/api/src/majorana_api/auth/deps.py`, and
`services/api/tests/test_deploy_probe_credential.py` enumerates the live OpenAPI
document to prove no other route accepts it, so a route added later is refused by
default.

The identity is `deploy-probe@leonaquantum.com`, listed in `OPERATOR_IDENTITIES`
(`tiers.py`) rather than in `LEONA_DEVELOPER_EMAILS`. A gate that stops working
when an environment variable is mistyped is not a gate — and that variable was
found set-but-empty on Vercel in session 34.

### Rotating or provisioning it

```bash
# 32+ characters; a shorter or placeholder value fails API startup rather than
# quietly becoming a weak credential.
python3 -c 'import secrets; print(secrets.token_urlsafe(48))' \
  | gcloud secrets versions add DEPLOY_PROBE_TOKEN --project majorana-core --data-file=-

gcloud run services update majorana-api --region us-west1 --project majorana-core \
  --update-secrets DEPLOY_PROBE_TOKEN=DEPLOY_PROBE_TOKEN:latest
```

The deploy service account needs `roles/secretmanager.secretAccessor` on the
secret, the same grant `DATABASE_URL_SECRET` has.

### When it fails

- **`resolved to mode 'chat', not 'execute'`** — the stack is probably fine and
  the intent router classified the probe prompt as conversation. Check the run in
  the probe's own workspace before assuming an outage.
- **`ended 'failed'`** — read the events the step prints. They are the whole
  input to a diagnosis, which is why the step dumps the events verbatim rather
  than a summary.
- **`no terminal status before the deadline`** — the worker is not picking work
  up. Check `worker is actually running` above it, and the revision's logs.

**Do not delete the step to make a deploy green.** The credential missing is a
hard failure for the same reason: a gate that skips itself when its credential
disappears is not a gate.
