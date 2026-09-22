# News deployment and operations

## PR and merge integration

The existing `ci` workflow runs the news Node tests through the pnpm workspace. Those tests exercise the actual HTTP handler (`server.mjs`'s `createNewsHandler`) directly, assets, upstream outage handling and public-only boundary — no build step is involved, since the renderer's only deployment target is now the container image built from `apps/news/Dockerfile`. The `db` job creates a separate `leona_news_test` database, migrates it and runs the real PostgreSQL news integration tests. The existing migration job also tests the entire migration history up→down→up.

The existing `deploy` workflow on `dev` validates `infra/news.json` before migrations, applies migration 0061 through its normal Alembic step, and passes reviewed news settings into the existing API and Worker revisions using `--update-env-vars`. Before shifting API traffic, it checks that public news returns 404 when disabled or a valid listing when enabled. Existing API/Worker rollout and recovery checks still apply. No separate news queue or DB deployment is necessary.

`infra/news.json` owns the news feature flags, newsroom/editor IDs, model names and request limits. Initial flags are all false. To enable draft generation, fill in an existing workspace UUID and set `enabled=true` in a reviewed PR. Scheduling additionally needs an existing owner/admin user UUID. Enable `public`, `schedule_enabled` and `auto_publish` separately as launch checks pass. The deployment overwrites manual Cloud Run changes to these managed settings on the next merge; emergency console changes must also be recorded in the JSON before another deploy.

One-time credential setup (owner action): store the OpenAI key in Google Secret Manager, authorize the existing Worker's runtime service account to read that secret, and set the GitHub repository **variable** `LEONA_NEWS_OPENAI_SECRET_VERSION` to its name and numeric version, for example `LEONA_NEWS_OPENAI_API_KEY:1`. This variable contains a reference, never the key. Enabled configurations reject missing references or `:latest`. The workflow binds it to Worker `LEONA_NEWS_OPENAI_API_KEY` — deliberately not the existing Worker `OPENAI_API_KEY`, which the core product's own LLM calls already use and which this must never overwrite — preserving other existing secret bindings. Neither the API nor the renderer receive it. The local `.env` is neither uploaded nor automatically synchronized. No secret has been created or uploaded by this work. News generation requires `LEONA_NEWS_OPENAI_API_KEY` explicitly and never falls back to the core `OPENAI_API_KEY`. Keep the core key unchanged. If a local news environment file used the old variable name, register the news key under `LEONA_NEWS_OPENAI_API_KEY` before running the Worker locally; deployment does not rename or synchronize local credentials.

## Deployment plan: Cloud Run (built, dormant)

The renderer was originally planned as a separate Vercel project; Vercel is
retired as a host for the rest of this product (ADR-0033) and this app never
had a live Vercel project to begin with, so `.github/workflows/deploy-news.yml`
and `cloudbuild.news.yaml` build and deploy it on Cloud Run, in the same
dark-revision → smoke-test → shift-traffic → read-back shape
`docs/runbooks/web-cloud-run.md` and `deploy-web.yml` use for the main site.

**The workflow exists but does nothing on an ordinary merge.** It is a clean
no-op — one line saying why it skipped — unless `infra/news.json`'s
`renderer_deploy` is `true` (default `false`), and it refuses to let that flag
go true while `site_url` is still the placeholder it ships with
(`scripts/news-deploy-config.py`). Nobody has to remember not to deploy this;
the flag is the whole gate. The operator sequence is:

1. **Set the flags.** In a reviewed PR, set `infra/news.json`'s `site_url` to
   the real hostname (see step 2) and `renderer_deploy` to `true`. Merging
   builds the image, deploys it dark, smoke-tests `/healthz` and `/readyz`,
   and shifts traffic — but the service stays `--no-allow-unauthenticated`
   throughout, so "deployed" still does not mean "reachable by a visitor".

2. **Choose the hostname — DECIDED (ai-ops 354, owner ruling "option 1",
   2026-09-21): `news.leonaqt.com`, a separate subdomain through Cloudflare.**
   `leonaquantum.com` now redirects to `leonaqt.com` (2026-09-20 cutover), so
   the old plan of `news.leonaquantum.com` is stale; `infra/news.json`'s
   `site_url` is already set to `https://news.leonaqt.com` (this commit).

   **Routing mechanism: the existing load balancer (`infra/web-lb/`), not a
   Cloud Run domain mapping.** `gcloud run domain-mappings create` would ask
   Google to verify the hostname and serve its own Google-managed certificate,
   which needs a DNS TXT/CNAME verification record — exactly the conflict
   `docs/runbooks/cloudflare-origin-certificate.md` describes for the apex
   (Cloudflare already holds `_acme-challenge.leonaqt.com`, and a domain
   mapping would need the equivalent for `news`). Routing through the same
   load balancer that already serves `leonaqt.com` avoids that conflict
   entirely and keeps the same Cloud Armor origin-lock and Cloudflare-only
   posture the rest of the site has. See "Switch-on runbook" below for the
   exact commands.

   **The existing Cloudflare Origin Certificate already covers
   `news.leonaqt.com` — confirmed read-only, not assumed:**

   ```sh
   gcloud certificate-manager certificates describe majorana-web-origin-cert \
     --location=global --project=majorana-core --format='value(sanDnsnames)'
   # -> *.leonaqt.com, leonaqt.com
   ```

   and the certificate map already has a wildcard entry for it
   (`majorana-web-entry-wildcard`, created by
   `infra/web-lb/32-rehearsal-hostname.sh` and left in place — see that
   script's own comment). So no new certificate, no Cloudflare collaborator
   visit, and no new Certificate Manager work is needed for this hostname —
   only a new Cloud Run backend, a load-balancer host rule, and one Cloudflare
   DNS record.

3. **DNS**, once steps 1–2 and the load-balancer wiring below are done: one
   Cloudflare `news` record, **A**, at the load balancer's static IP
   (`gcloud compute addresses describe majorana-web-ip --global
   --format='value(address)'`), **Proxied** (orange cloud) — the same
   requirement `docs/runbooks/cloudflare-origin-certificate.md` explains for
   the apex: unproxied, a visitor's browser is handed the Origin Certificate
   directly and sees a full-page TLS warning, because that certificate is
   trusted by Cloudflare's edge and nothing else.

The `gcloud builds submit` / `gcloud run deploy` commands `deploy-news.yml`
runs are exactly what a by-hand debug of a single revision would use; see
that workflow file for the flags (image tag, sizing from `infra/fleet.env`,
env vars). No OpenAI key, admin bearer or DB credential belongs on this
service — see "Public renderer" below for the full variable list.

After launch, first confirm the backend (existing API/Worker) is already
serving news data and the renderer's own `/readyz` passes before attaching the
chosen hostname — the ordering constraint is the same one the old Vercel plan
named, only the mechanism changed. Later API changes must remain backward
compatible with the preceding renderer revision; use additive migrations and
separate removal releases. If a backend deploy fails, the renderer returns an
honest unavailable state, never sample news. Revert/promote renderer revisions
through Cloud Run's own revision traffic controls
(`gcloud run services update-traffic`), the same mechanism `deploys.md` uses
for the API and worker.

## Switch-on runbook: news.leonaqt.com (ai-ops 354)

This is the exact ordered procedure to take the hostname decision above from
"routed nowhere" to "live". Nothing in this section has been run — two
prerequisites only the owner can give have not been given yet (below), so
none of `enabled`, `public`, `renderer_deploy` or `workspace_id` change in
this commit. This section is what the next session runs once the owner has
supplied them.

### 0. Blocking prerequisites (owner-only, not yet given — ai-ops 354)

- **A news-only OpenAI key**, separate from the product's own key. Do not
  reuse `OPENAI_API_KEY` — see "One-time credential setup" above for why the
  code refuses to fall back to it.
- **Which workspace owns the newsroom** — an existing workspace UUID for
  `infra/news.json`'s `workspace_id`.

Stop here until both exist. Steps 1–5 below can run without them (they only
make the renderer reachable while still `--no-allow-unauthenticated` and
`public: false`); step 6 (`enabled: true`) needs the workspace UUID, and news
generation needs the key.

### 1. Owner: store the key and point the repo at it

1. Put the news-only key in Google Secret Manager as its own secret (any
   name — the code does not hardcode one). Example name used in the docs
   below: `LEONA_NEWS_OPENAI_API_KEY`.
2. Authorize the existing Worker's runtime service account to read that
   secret version (`roles/secretmanager.secretAccessor` on the secret).
3. Set the GitHub repository **variable** `LEONA_NEWS_OPENAI_SECRET_VERSION`
   to `<secret-name>:<numeric-version>`, e.g. `LEONA_NEWS_OPENAI_API_KEY:1` —
   never `:latest` (`scripts/news-deploy-config.py` rejects both a malformed
   reference and `:latest`).
4. **The code that reads it:** `deploy.yml` binds this reference onto the
   Worker's `LEONA_NEWS_OPENAI_API_KEY` environment variable via
   `--set-secrets` (`.github/workflows/deploy.yml`, the `worker_secrets`
   step) — that variable name is what `services/worker` actually reads, not
   the Secret Manager resource name, which can be anything. The API and the
   public renderer never receive it.

Never paste the key value into chat, a GitHub issue/PR, or `infra/news.json`
— it is a reviewed reference (`name:version`), not the key itself. If it
needs to move between people before it reaches Secret Manager, the handover
file is `/Users/Eshaan/Developer/projects/leona-secrets/llm-keys.txt`.

### 2. Reviewed PR: workspace and site_url

`site_url` is already `https://news.leonaqt.com` (this commit). In a
separate, later, reviewed PR: set `infra/news.json`'s `workspace_id` to the
UUID from step 0, and `enabled: true` (required before `workspace_id` is
accepted by `scripts/news-deploy-config.py`). Leave `public`,
`schedule_enabled`, `auto_publish` false until the checks below pass —
`enabled: true` alone only turns on draft generation into the editor, not
anything public.

### 3. Reviewed PR: deploy the renderer

Set `infra/news.json`'s `renderer_deploy` to `true`. Merging to `dev` runs
`.github/workflows/deploy-news.yml`: it builds the image, deploys
`majorana-news` to Cloud Run **dark** (`--no-traffic`), smoke-tests
`/healthz` and `/readyz` on the dark revision, then shifts traffic. The
service is created with no ingress restriction yet and stays
`--no-allow-unauthenticated` — "deployed" still does not mean "reachable by
a visitor". This is the first real deploy of `majorana-news`; as of
2026-09-21 the service does not exist yet (confirmed:
`gcloud run services describe majorana-news --region=us-west1
--project=majorana-core` → `Cannot find service`).

### 4. Wire the load balancer (new backend, same LB, same origin lock)

Run from `infra/web-lb/` so `common.sh` is on the path, after step 3's
deploy has created the `majorana-news` Cloud Run service:

```sh
PROJECT=majorana-core REGION=us-west1
NEG=majorana-news-neg
BACKEND=majorana-news-backend
ARMOR=majorana-web-origin-lock   # the existing Cloudflare-only origin lock — reused, not duplicated
URLMAP=majorana-web-urlmap       # the existing URL map — a host rule is added to it, not a new map

# Serverless NEG -> the news Cloud Run service (same shape as majorana-web-neg)
gcloud compute network-endpoint-groups create "$NEG" \
  --project="$PROJECT" --region="$REGION" \
  --network-endpoint-type=serverless --cloud-run-service=majorana-news

# Backend service, no --protocol (a serverless NEG rejects a port name)
gcloud compute backend-services create "$BACKEND" \
  --project="$PROJECT" --global --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend "$BACKEND" \
  --project="$PROJECT" --global \
  --network-endpoint-group="$NEG" --network-endpoint-group-region="$REGION"
gcloud compute backend-services update "$BACKEND" \
  --project="$PROJECT" --global --security-policy="$ARMOR"

# Host rule on the EXISTING url map — new-hosts + a path matcher whose
# default service is the news backend. This does not touch the
# majorana-web host rule (still the url map's --default-service).
gcloud compute url-maps add-path-matcher "$URLMAP" \
  --project="$PROJECT" \
  --path-matcher-name=news-matcher \
  --default-service="$BACKEND" \
  --new-hosts=news.leonaqt.com
```

No new static IP, no new HTTPS/HTTP proxy, no new forwarding rule, no new
certificate or certificate-map entry — all four already exist and already
cover any `*.leonaqt.com` name (see the hostname decision above).

### 5. Lock ingress, then unlock through the load balancer only — ORDER MATTERS

Same non-cosmetic ordering `infra/web-lb/40-serve.sh` uses for `majorana-web`,
for the same reason: between these two commands in the wrong order, the
service is a public `run.app` URL with no Cloudflare, no rate limit and no
Cloud Armor in front of it.

```sh
gcloud run services update majorana-news --project=majorana-core --region=us-west1 \
  --ingress=internal-and-cloud-load-balancing
gcloud run services add-iam-policy-binding majorana-news --project=majorana-core --region=us-west1 \
  --member=allUsers --role=roles/run.invoker
```

### 6. Cloudflare DNS (the collaborator who holds `leonaqt.com` access)

One record, no certificate work:

```
news   A   <majorana-web-ip's address>   Proxied (orange cloud)
```

Get the address with
`gcloud compute addresses describe majorana-web-ip --global --project=majorana-core --format='value(address)'`
— it is the same address `leonaqt.com` and `www` already use.

### 7. Verify

```sh
# Through Cloudflare, as a visitor would reach it
curl -sS -o /dev/null -w '%{http_code}\n' https://news.leonaqt.com/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://news.leonaqt.com/readyz

# Straight to the load balancer, bypassing DNS, to isolate LB config from Cloudflare
curl -sS -k -o /dev/null -w '%{http_code}\n' \
  --resolve news.leonaqt.com:443:$(gcloud compute addresses describe majorana-web-ip --global --project=majorana-core --format='value(address)') \
  https://news.leonaqt.com/healthz

# Confirm the origin certificate is what is actually served (expect Cloudflare's Origin CA)
openssl s_client -connect $(gcloud compute addresses describe majorana-web-ip --global --project=majorana-core --format='value(address)'):443 \
  -servername news.leonaqt.com </dev/null 2>/dev/null | openssl x509 -noout -issuer

# The bare run.app URL must now refuse (403) — proves the ingress lock, not just the route
curl -sS -o /dev/null -w '%{http_code}\n' \
  $(gcloud run services describe majorana-news --region=us-west1 --project=majorana-core --format='value(status.url)')
```

Only after `/healthz` and `/readyz` are both 200 through Cloudflare, and the
`run.app` URL is 403, is the renderer "live" in the sense of reachable. It
still serves no public news until `LEONA_NEWS_PUBLIC=true` is set on the API
("Public renderer" below) — routing and publication are separate switches on
purpose.

### 8. 05-security §1a items that apply

`~/Developer/ai-ops/desk/leona/plans/rebuild/05-security.md` §1a scopes that
document to "the execution/sandbox lane and any change that widens an
external boundary — a new anonymous route, a new credential, a new
provider...". `news.leonaqt.com` is a new anonymous (unauthenticated) route
and this switch-on adds a new credential (the news-only OpenAI key), so it is
in scope; it does **not** touch the sandbox/execution lane, so §2's
hostile-payload-suite and sandbox-egress-canary boxes do not apply here —
those gate `packages/py/sandbox`, which this change never touches. From §2,
what does apply before this goes fully public (`LEONA_NEWS_PUBLIC=true`):

- **No secret-shaped strings in client bundle or error responses.** The
  renderer holds no secret at all by design (§ "Public renderer": only
  `LEONA_NEWS_MODE`, `LEONA_NEWS_API_URL`, `SITE_URL`, `HOST`, `PORT`) — the
  step 5 ingress lock plus this design constraint is the control; there is no
  bundle-scanning check specific to `apps/news` today, so a manual check that
  `gcloud run services describe majorana-news --format=json` shows no secret
  env vars is worth doing once, and is cheap.
- **Rate limits / quota enforcement under abuse.** This is a new
  unauthenticated origin behind the same Cloud Armor origin lock as
  `leonaqt.com`, but Cloudflare's actual rate-limiting rule (ai-ops 318) is
  scoped to `/repository` on the `leonaqt.com` host, not this one — confirm
  whether that rule needs a `news.leonaqt.com` sibling before publishing, or
  whether the renderer's own bounded upstream calls (it only proxies to the
  existing API, never runs a provider call itself) make it low-risk enough to
  skip. Owner call, not a blocking default.
- **Dependency + code scanning (osv-scanner, semgrep) and gitleaks** already
  run repo-wide in `security.yml` and already cover `apps/news` — no new gate
  needed, just confirm the PRs that touch it stay green on those required
  checks.
- **Blast-radius / CODEOWNERS.** None of `infra/news.json`,
  `apps/news/`, or `infra/web-lb/` are in `.github/CODEOWNERS` today.
  `.github/workflows/` is — a PR that edits `deploy-news.yml` itself (not
  needed for steps 4–6 above, which are run by hand against existing
  infrastructure, not through a new workflow) would need a `Blast-radius:`
  line per `scripts/check-blast-radius.mjs`.
- Authz suite, MFA, secret rotation, restore drill: unaffected by this
  change, unchanged from their existing §2 status.

### 9. Undo

From ai-ops 354, the fast path:

1. Set `infra/news.json`'s `renderer_deploy` back to `false` in a reviewed
   PR. This stops future renderer deploys; it does **not** remove the
   already-deployed Cloud Run revision or the load-balancer route added in
   step 4 — those keep running until torn down separately.
2. Set `LEONA_NEWS_PUBLIC=false` on the API. Public reads 404 immediately
   (existing behavior, "Public renderer" above) — this is the actual
   "news is off" switch for a visitor, independent of whether the renderer
   process is still running.

Full teardown, if the lane itself should stop existing (not requested by
ai-ops 354, listed for completeness):

```sh
gcloud compute url-maps remove-path-matcher majorana-web-urlmap --project=majorana-core --path-matcher-name=news-matcher
gcloud compute backend-services delete majorana-news-backend --project=majorana-core --global
gcloud compute network-endpoint-groups delete majorana-news-neg --project=majorana-core --region=us-west1
gcloud run services delete majorana-news --project=majorana-core --region=us-west1
# and ask the Cloudflare collaborator to delete the `news` DNS record.
```

## Architecture and repository findings

`apps/web` remains the existing Leona product. `apps/news` is an independent Node renderer, not another database client. The existing API owns all new persistence, and the existing Worker dispatches `news.collect` through its fenced jobs queue. No new public authentication mechanism or database-connected application process is introduced.

The API's existing WorkOS scope is reused and restricted to `LEONA_NEWS_WORKSPACE_ID` plus owner/admin membership. Public reads derive a read-only scope from server configuration, never from an incoming workspace identifier. The editor renderer binds only to loopback; it is not an internet-facing admin console. Its server-side bearer expires according to existing WorkOS settings. Restart with a refreshed bearer when it expires. Do not expose this mode through a public proxy.

Migration `0061` follows `0060`, adds the three newsroom tables, enables RLS and grants the existing `app_rw` bundle access if that role exists. New transaction-scoped RLS context is `leona.news_workspace_id`. Composite foreign keys prevent cross-workspace image/article/batch associations. Normalized image bytes are initially stored in Postgres, up to 600 KB each. This is a deliberate initial storage choice: existing DB backups cover both content and media; monitor DB growth and move bytes behind the same API contract to object storage if volume warrants it.

## Configure the existing API and Worker

1. Select an existing workspace for the newsroom and its owner/admin editor. Do not invent identity UUIDs or reuse the platform's catalog/system authority. For manual API calls, the editor's active workspace must match this newsroom, as required by the existing scope dependency.
2. Use the existing database setup from `docs/runbooks/database.md`. API and Worker retain their existing database credentials/connection settings. News adds no new database role.
3. Apply migration with the migration credential, after the usual backup and release review:

   ```sh
   uv run --frozen alembic -c db/alembic.ini upgrade head
   ```

   `DATABASE_URL_DIRECT` is required. Do not run this against production until the release is authorized. Rolling back `0061` drops newsroom data; export/backup before rollback once any real content exists.
4. On API and Worker set `LEONA_NEWS_ENABLED=true`, `LEONA_NEWS_WORKSPACE_ID=<selected workspace UUID>`, and `LEONA_NEWS_DAILY_BATCH_LIMIT=3` (or the reviewed limit; hard maximum 20).
5. On Worker only set `LEONA_NEWS_OPENAI_API_KEY`, `LEONA_NEWS_MODEL`, and `LEONA_NEWS_IMAGE_MODEL`. The example values are documented models, but account access must be tested before launch. Loading `apps/news/.env` into the renderer does not configure the separately running Worker. For local commands, `uv run --frozen --env-file apps/news/.env ...` can load the same local file without printing its contents; the other existing Worker environment variables are still needed.
6. Deploy the existing API/Worker image through its normal release process. Keep `LEONA_NEWS_PUBLIC=false`, `LEONA_NEWS_AUTO_PUBLISH=false` and `LEONA_NEWS_SCHEDULE_ENABLED=false` during initial validation. News does not change existing circuit/notebook job kinds or sandbox permissions.

## Make and review the first draft

Configure the renderer with `LEONA_NEWS_MODE=editor`, `HOST=127.0.0.1`, `LEONA_NEWS_API_URL=<API origin>`, and `LEONA_NEWS_EDITOR_TOKEN=<existing WorkOS admin bearer>`. Keep this bearer in a local environment file; it never goes into browser JavaScript. Run `npm start` and open `/editor`.

The collection form incurs OpenAI charges. Agree a small test budget before submitting real calls. Each collection normally uses two search Responses calls, two structured Responses calls, and optionally one image call. The durable ceiling is 12 provider calls including failed/uncertain attempts and revisions. Each search call is capped at four tool calls, 6,500 output tokens; each structured call at 9,000 output tokens. This is an operational bound, not a currency-denominated invoice ceiling. There is no automatic provider retry inside the SDK; only the existing job queue retries classified transient failures, at most three attempts per job.

The collection status screen offers an idempotent retry for failed/held jobs once the old job has closed. It preserves the cumulative call budget. Each stored checkpoint survives a restart. A crash after provider execution but before checkpoint commit may incur a repeated call; the reservation remains charged against the local call budget. There is no claim of exactly-once external billing.

The UI shows the current collection status and links to its draft. Review every claim, title, lead, source link, date, and image. The model's review is a screening tool, not proof of factual truth. URLs absent from actual search evidence, unresolved review blockers, incomplete responses, and missing header images prevent publication.

For original imagery, upload a PNG/JPEG/WebP up to 550 KB in the editor. Provide source/terms URLs, credit, alt text and the permission basis. The API decodes and re-encodes images, removes metadata, bounds pixel dimensions and rejects active formats such as SVG. It never fetches a caller- or model-supplied image URL. Rights checking is an editorial attestation, not a model-inferred license.

Edits preserve the source identities, record the previous document/review, remove the old image and enqueue re-verification. To introduce new sources, start a new collection. A published article must be withdrawn before revision. Old public addresses remain stable for corrections. The API has full revision support; the editor form exposes title, lead, headings and paragraph text.

## Public renderer

The Cloud Run service described above, built from this folder's own
`Dockerfile`, is the only deployment path — `deploy-news.yml` runs it once
`infra/news.json`'s `renderer_deploy` is true. Build locally the same way CI
or Cloud Build would: `docker build -t leona-news:<revision> apps/news`. The
existing `services/api/Dockerfile` remains the API/Worker image; do not
deploy the Node renderer in its place.

Set only renderer variables in the public service:

```env
LEONA_NEWS_MODE=published
LEONA_NEWS_API_URL=https://YOUR_EXISTING_API_ORIGIN
SITE_URL=<the hostname chosen under "Deployment plan" step 2 — an owner decision, not yet made>
HOST=0.0.0.0
PORT=8080
```

`SITE_URL` above is `deploy-news.yml`'s own env var and comes straight from
`infra/news.json`'s `site_url` field — the two are never set independently.

No OpenAI key, admin bearer or DB credential is needed by this service. All API requests are server-to-server. Published article images are proxied through the API and cannot reveal draft images. Responses currently use `no-store`, including media, to make withdrawal immediate; do not add a CDN cache without an explicit purge/invalidation design. `/healthz` is process liveness; `/readyz` checks the API/DB/public-news configuration.

Enable `LEONA_NEWS_PUBLIC=true` on the API only when ready to serve approved articles. Attach the chosen hostname (Deployment plan step 2 — `news.leonaqt.com` or a `leonaqt.com/news` path, owner decision) to the renderer using the actual DNS or load-balancer routing that option needs, and verify HTTPS. Preserve existing apex records and confirm how any older news URLs will be retained or redirected before switching an existing news host.

The renderer provides canonical article URLs, RSS at `/feed.xml` (latest 50), and a sitemap at `/sitemap.xml` (latest 500). Older pages remain reachable through keyset pagination. Extend to sitemap indexes before the publication count materially exceeds 500. Search and category queries are bounded and executed in the API; error responses never fall back to sample articles. Development samples are only rendered in explicit `preview` mode.

## Scheduling and optional automatic publication

- Worker: `LEONA_NEWS_SCHEDULE_ENABLED=true`, `LEONA_NEWS_EDITOR_USER_ID=<current administrator UUID>`, `LEONA_NEWS_INTERVAL_HOURS=8`.
- Every Worker can tick; a UTC time-slot idempotency key plus the workspace lock prevents duplicate enqueues. Scheduler calls recheck the editor's membership. Keep a Worker instance active to run the schedule.
- Optional `LEONA_NEWS_ARXIV_ENABLED=true` reuses the existing bounded arXiv client for additional candidates. Its output is unverified research input, not a substitute for primary-source checking. A generic RSS collector is not implemented; the outward-facing RSS feed is.
- `LEONA_NEWS_AUTO_PUBLISH=true` enables automatic publication only after review and image gates. It rechecks the initiating editor's current admin role. Enable only after the owner accepts the observed quality and operating limits. Otherwise all generated articles remain drafts.

## Failure handling and monitoring

Existing job metrics/logs track `news.collect` claims, retries, failures and dead letters. Exhausted jobs close the collection as failed. Collection API responses show stage, safe error code and reserved call count. Watch the existing Worker alerts and add operational alerts for repeated news failures, held collections, no new published articles, API 5xx, DB storage growth, and provider usage. Outbound Slack/email notifications are not configured by this change.

To stop collection, disable scheduling. To stop automatic publication, disable `LEONA_NEWS_AUTO_PUBLISH`. To hide all public news immediately, disable `LEONA_NEWS_PUBLIC` on the API. Already queued jobs may still consume bounded API calls; disable `LEONA_NEWS_ENABLED` on Worker to stop them before provider invocation. Withdrawing an article removes it and its image from anonymous API reads. Do not reset call counts to bypass budget limits.

## Reproducible verification

Use a disposable Postgres database named **leona_news_test**, never production. The integration test refuses a different database name. Set `DATABASE_URL_DIRECT` and apply migrations, then run:

```sh
uv run --frozen alembic -c db/alembic.ini upgrade head
uv run --frozen alembic -c db/alembic.ini downgrade 0060
uv run --frozen alembic -c db/alembic.ini upgrade head
LEONA_NEWS_TEST_DATABASE_URL=<disposable async psycopg URL> uv run --frozen pytest services/api/tests/test_newsroom.py services/worker/tests/test_news_provider.py
npm --prefix apps/news run build
npm --prefix apps/news test
```

Tests include scoped persistence/RLS, duplicate/concurrent collection limits, stale lease refusal, restart/resume, actual Worker dispatch, revisions, publication/withdrawal, and real SDK calls through an HTTP mock. Browser QA uses deterministic fixture articles and raster images, not real published news.

Verified in this session: real PostgreSQL up→down→up, targeted tests, local API/renderer integration and desktop/mobile rendering. Unverified: a paid live OpenAI run, production database migration, container build (Docker daemon unavailable), cloud deployment, TLS/DNS, backup restore, and alert delivery. These remain release checks; do not label the deployment production-validated until completed.

## API references used

- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/image-generation
