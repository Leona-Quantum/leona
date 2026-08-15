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
for 45s and fail the deploy if anything appears** → run a real job end-to-end on the
deployed stack → **sync the published catalog**. The worker-log step is the one that
would have caught all three incidents; Cloud Run itself reports a crash-looping
worker as healthy.

It does not roll back automatically. On failure it prints the recent revisions and
the `update-traffic --to-revisions` command to run.

**`sync the published catalog` is last, and after the rollback advice, on purpose.**
It imports, attests and publishes the pinned catalog manifest so a merged corpus
content change reaches `/repository` (see `system-catalog.md § Updating the published
corpus`). Because it runs after the stack is verified live, **a failure there means the
rollout succeeded and only the catalog did not move** — it is not a reason to roll back
traffic, and no record is left partially published. It also runs on every deploy rather
than only when the manifest changed, so a missed trigger cannot leave the catalog stale
forever; a no-change run writes nothing.

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
curl -s .../v1/catalog/entries | jq length            # the manifest's item_count
gcloud run services update-traffic majorana-api \
  --project majorana-core --region us-west1 --to-latest
```

Rollback is `update-traffic --to-revisions <previous>=100`.

### A tag is a public URL, and it outlives the deploy that made it

`--tag verify` is reassigned to the new revision on every deploy, so it stays
current by itself. **Any other tag does not.** It pins one revision forever, and
because the service grants `roles/run.invoker` to `allUsers` — it has to, it is
the public API — that tag's URL serves that revision to anyone, at 0% traffic,
indefinitely.

What the pinned revision serves is its own environment as it was on the day it
was deployed. On 2026-07-31 two orphan tags were found doing exactly this:

| tag | revision | built | issuer it trusted |
|---|---|---|---|
| `catalog` | 00017 | 2026-07-19 | the **staging** WorkOS client |
| `sqlverify` | 00192 | 2026-07-27 | the **staging** WorkOS client |

Both predated the 2026-07-29 production cutover, so both would have accepted a
staging-issued token; and both referenced `DATABASE_URL` at `:latest`, which
resolves to whatever that secret points at **now**, not at deploy time. Neither
worked when probed, but only by accident — 00017 has no Cloud SQL socket because
it predates the move, 00192 references a secret since deleted.

So, two rules:

1. **List the tags before you assume the service has one entrance.**

   ```bash
   gcloud run services describe majorana-api --project majorana-core \
     --region us-west1 --format=json | jq '.status.traffic[] | {revisionName, tag, url, percent}'
   ```

   Anything with a `tag` that is not `verify` should be removed once it has served
   its purpose:

   ```bash
   gcloud run services update-traffic majorana-api --project majorana-core \
     --region us-west1 --remove-tags=NAME
   ```

   Read the traffic block back afterwards — the command's own output narrates the
   `verify` tag as "Adding"/"Deleting" while it re-applies it, which reads like it
   is being removed and is not.

2. **Check the tags before a database rollback.** See
   `database.md § Rollback` — a stale tagged revision reading `DATABASE_URL:latest`
   comes back to life the moment that secret points somewhere it can reach.

Untagged revisions are safe to leave: at 0% traffic with no tag, nothing routes to
them. There are ~127 of each service and they cost nothing. It is the tag, not the
revision, that opens the door.

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

**Converting a hand-set literal to a secret reference needs `--remove-env-vars`
first, in the same command.** `gcloud run deploy --update-secrets KEY=SECRET:latest`
refuses to change an existing key's backing type in place:
`ERROR: (gcloud.run.deploy) Cannot update environment variable [KEY] to the
given type because it has already been set with a different type.` This bit
`SENTRY_DSN` for real (2026-08-15, ai-ops#97/PR 609→ PR 615): the value had
been set by hand as a literal, formalizing it into Secret Manager and adding
`--update-secrets` alone failed every deploy until `--remove-env-vars KEY` was
added ahead of it. Removing a key that is not currently set is a documented
no-op, so the pattern below is safe to leave in permanently rather than
reverting once a given key's type is fixed:

```bash
gcloud run deploy ... \
  --remove-env-vars SENTRY_DSN \
  --update-secrets SENTRY_DSN=SENTRY_DSN:latest \
  ...
```

The failure is contained if the deploy step it happens in is `--no-traffic`
(the api step always is): no traffic shifts, so it is a failed dark deploy,
not an outage. The real cost is that the failure is deterministic and lives
in the workflow, so it blocks every later deploy — not just the one that
first hit it — until fixed.

| Variable | api | worker |
|---|---|---|
| `DATABASE_URL` (secret, pooled) | ✔ | ✔ |
| `WORKOS_CLIENT_ID`, `WORKOS_JWT_ISSUER`, `WEB_ORIGIN` | ✔ | — |
| `SYSTEM_CATALOG_ENABLED` + the three `SYSTEM_CATALOG_*_ID`s | ✔ | ✔ |
| `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `VERCEL_TOKEN` (secrets) | — | ✔ |
| `LEONA_DEVELOPER_EMAILS` | ✔ | ✔ |
| `LEONA_TEAM_EMAILS` | ✔ | ✔ |
| `LEONA_PRO_EMAILS` | ✔ | ✔ |
| `DEPLOY_PROBE_TOKEN` (secret) | ✔ | — |
| `SENTRY_DSN` (secret) | ✔ | ✔ |
| `MAJORANA_ENV` (`production`, hardcoded in `deploy.yml` — this workflow only ever deploys `dev`) | ✔ | ✔ |
| `MAJORANA_RELEASE` (short git SHA — `steps.tag.outputs.tag`) | ✔ | ✔ |

The three `LEONA_*_EMAILS` lists are tier allowlists, named after the internal
tier ids rather than the plan names on the pricing page: `pro` is sold as
**Plus** and `team` as **Professional**. `TIER_ALLOWLIST_ENV` in
`services/api/src/majorana_api/tiers.py` is the one table both services read
them from. Each must be set on the api service, the worker, AND Vercel, or an
account is metered at one tier by the surface that displays and another by the
surface that refuses.

### The production WorkOS pair

The table above says *which* service carries these; this is *what they are*. Both are
public identifiers, not credentials — the client id is visible in every AuthKit URL the
browser follows, and the issuer is derived from it. The secret in this system is
`WORKOS_API_KEY`, which lives in Secret Manager and is never written down here.

| Variable | Production value |
|---|---|
| `WORKOS_CLIENT_ID` (Vercel + `majorana-api`) | `client_01KX3TN2Y37QDVCWG1M7M5WRG8` |
| `WORKOS_JWT_ISSUER` (`majorana-api`) | `https://api.workos.com/user_management/client_01KX3TN2Y37QDVCWG1M7M5WRG8` |

**The issuer does not follow the client id.** It defaults to being derived from it, but
`majorana-api` pins it explicitly, so changing only `WORKOS_CLIENT_ID` leaves token
validation aimed at the environment you just left: every request 403s, sign-in included,
while the service reports itself healthy. `settings._validate_workos_client_consistency`
now refuses to start on that combination, and fires only on WorkOS-shaped URLs so a
custom auth domain stays a deliberate override. The worker has no WorkOS variables at
all and needs none. The one-time staging→production cutover log, including the previous
staging pair, is `docs/archive/one-time-cutovers/workos-cutover.md`.

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

### The public catalog flag — `MAJORANA_PUBLIC_CATALOG_API`

**Set on Vercel, not on Cloud Run.** It is read by the Next.js server
(`apps/web/lib/public-catalog.ts`), and it is the single switch that decides where
`/repository` gets its content:

| Value | What `/repository` serves |
|---|---|
| `"true"` | the API's published system catalog — `GET /v1/catalog/entries` (+ `/{slug}`) |
| anything else, including unset | the committed static corpus, `apps/web/lib/repository/entries-*.ts` |

**It is `true` in production.** It was documented in no runbook until 2026-08-04, which
is why the operational consequence below kept surprising people.

**There is a whole-corpus fallback and it is deliberate.** If the API is unreachable,
returns nothing usable, or fails the page-completeness check, `repository-source.ts`
serves the static corpus anyway rather than 500 the public site, and logs
`[repository-source] falling back to the static corpus`. **Grep the Vercel logs for that
line before concluding the cutover is healthy** — a silent fallback makes a broken
cutover look like a working one, which is exactly why it is logged loudly.

This used to say the fallback was safe "for as long as both sides really are the same
283 records". The conditional was right and the premise has stopped holding: the two
sides now differ routinely, because the database is one catalog sync behind the
committed corpus and the corpus is edited every day. What makes the fallback tolerable
is not that they are identical but that the corpus is the source the database is synced
*from* — a fallback serves content at worst one sync AHEAD of what is published, never
behind. Since 2026-08-12 the sync runs on every deploy (ADR-0019), so that window is one
deploy rather than unbounded.

**The consequence that surprises everyone: editing the TypeScript corpus does not
change the site.** With the flag on, the entries files are the *editing* surface and
the *fallback* surface, but not the *serving* surface. A content fix reaches visitors
only after the full loop:

```bash
# 1. Regenerate the pinned manifest from the entries at the current commit.
#    --check verifies the committed manifest matches without rewriting it.
node scripts/generate-catalog-bootstrap-manifest.mjs --check
node scripts/generate-catalog-bootstrap-manifest.mjs   # → services/api/catalog_bootstrap/manifest.json
# 2. Re-import, re-attest, re-publish against production.
#    Full procedure, including the SYSTEM_CATALOG_ENABLED shell trap and the
#    fail-closed attestation policy: docs/runbooks/system-catalog.md
```

Steps 1 and 2 are a deliberate, reviewed action — there is no automatic sync, by design
(ADR-0019). Until they run, the database keeps serving the previous manifest and the
repository keeps showing the fix.

**Turning the flag off is not free.** It is a Vercel config change and a redeploy of the
same code, and it takes effect immediately — but it changes *what the site serves*, not
just where it reads from:

| Flag | `/repository` serves | What is lost |
|---|---|---|
| on (production today) | the published system catalog in Cloud SQL | nothing — the database is the authority |
| off | the committed corpus in `apps/web/lib/repository/entries-*.ts` | **every record or field that exists only in the database** |

The corpus is a snapshot of the manifest that was last imported. Anything published to
the catalog since then — a new record, a corrected field, a re-attested entry — lives in
the database only, and turning the flag off deletes it from the public pages until it is
round-tripped back into the entries files and a new manifest is generated. **The two
sides are not interchangeable and have not been since the deploy-time sync went live** —
the database holds everything published up to the last sync, the corpus holds everything
committed, and each can lead the other on a different record. Do not reason from a
record count: equal totals do not mean equal content.

That is also the precondition the automatic fallback assumes and cannot check. Before
flipping the flag off deliberately, confirm the database holds nothing extra:

```bash
# what the API is publishing (the list route sets x-catalog-total)
curl -sI "$API_URL/v1/catalog/entries?limit=1" | rg -i '^x-catalog-total'
# what the committed manifest — and therefore the corpus — holds
python3 -c "import json; print(json.load(open('services/api/catalog_bootstrap/manifest.json'))['item_count'])"
```

Equal counts are necessary, not sufficient: a same-count corpus can still differ slug by
slug or field by field. A total *above* the manifest's is positive proof that turning the
flag off will drop content.

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
