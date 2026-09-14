# News deployment and operations

## PR and merge integration

The existing `ci` workflow runs the news Node tests through the pnpm workspace. Those tests build the actual Vercel function in a temporary directory and exercise its HTTP handler, assets, upstream outage handling and public-only boundary. The `db` job creates a separate `leona_news_test` database, migrates it and runs the real PostgreSQL news integration tests. The existing migration job also tests the entire migration history up→down→up.

The existing `deploy` workflow on `dev` validates `infra/news.json` before migrations, applies migration 0061 through its normal Alembic step, and passes reviewed news settings into the existing API and Worker revisions using `--update-env-vars`. Before shifting API traffic, it checks that public news returns 404 when disabled or a valid listing when enabled. Existing API/Worker rollout and recovery checks still apply. No separate news queue or DB deployment is necessary.

`infra/news.json` owns the news feature flags, newsroom/editor IDs, model names and request limits. Initial flags are all false. To enable draft generation, fill in an existing workspace UUID and set `enabled=true` in a reviewed PR. Scheduling additionally needs an existing owner/admin user UUID. Enable `public`, `schedule_enabled` and `auto_publish` separately as launch checks pass. The deployment overwrites manual Cloud Run changes to these managed settings on the next merge; emergency console changes must also be recorded in the JSON before another deploy.

One-time credential setup (owner action): store the OpenAI key in Google Secret Manager, authorize the existing Worker's runtime service account to read that secret, and set the GitHub repository **variable** `LEONA_NEWS_OPENAI_SECRET_VERSION` to its name and numeric version, for example `LEONA_NEWS_OPENAI_API_KEY:1`. This variable contains a reference, never the key. Enabled configurations reject missing references or `:latest`. The workflow binds it to Worker `LEONA_NEWS_OPENAI_API_KEY` — deliberately not the existing Worker `OPENAI_API_KEY`, which the core product's own LLM calls already use and which this must never overwrite — preserving other existing secret bindings. API and Vercel do not receive it. The local `.env` is neither uploaded nor automatically synchronized. No secret has been created or uploaded by this work.

## One-time Vercel setup

Create a separate project named `leona-news` in the existing Vercel team, connected to the **same GitHub repository**:

| Setting | Value |
|---|---|
| Root Directory | `apps/news` |
| Framework Preset | Other |
| Production Branch | `dev` (set explicitly; do not use `prod`) |
| Node.js | 24.x |
| Build Command | from this folder's `vercel.json`: `node build-vercel.mjs` |
| Install Command | from `vercel.json`; no dependencies to install |
| Output Directory | leave the dashboard override disabled; Build Output API is used |
| `LEONA_NEWS_API_URL` | existing production API HTTPS origin |
| `SITE_URL` | `https://news.leonaquantum.com` |

The build writes `.vercel/output` using an explicit file allowlist; `.env` and local artifacts are excluded. The function always uses published mode, even if someone supplies an editor/preview mode environment variable. It never forwards an admin token. Preview deployments use `X-Robots-Tag: noindex, nofollow`; also keep Vercel's preview deployment protection enabled. Preview points to published API data only, or to an explicitly configured test API origin.

After this initial project connection, Git integration updates the news renderer on commits to `dev`, while the existing GitHub workflow updates API/Worker. These are independent deployments, not an atomic release. First launch must wait for the backend deploy and the renderer's `/readyz` to pass before adding the custom domain. Later API changes must remain backward compatible with the preceding renderer revision; use additive migrations and separate removal releases. If a backend deploy fails, the renderer returns an honest unavailable state, never sample news. Revert/promote renderer revisions through Vercel and follow the existing backend recovery runbook independently.

## DNS: Cloudflare → Vercel

Read-only DNS lookup on 2026-09-14 returned `julian.ns.cloudflare.com` and `lisa.ns.cloudflare.com` for `leonaquantum.com`. No public A or CNAME answer for `news.leonaquantum.com` was returned. This does not prove that the Cloudflare dashboard has no pending or differently typed records; inspect its `news` entries before editing.

1. Once the new renderer passes `/readyz`, add **news.leonaquantum.com** under the new Vercel project's Settings → Domains.
2. Copy the exact CNAME destination shown there. It is project-specific; do not substitute a remembered generic Vercel hostname.
3. In Cloudflare → `leonaquantum.com` → DNS → Records, add:

   | Field | Value |
   |---|---|
   | Type | CNAME |
   | Name | `news` |
   | Target | exact value from Vercel Domains |
   | Proxy status | DNS only (gray cloud) |
   | TTL | Auto |

4. If Vercel asks for ownership verification, also add its exact TXT name/value. Resolve any existing A/AAAA/CNAME for the **same news hostname** before adding a conflicting record. Preserve apex, `www`, email records and nameservers.
5. Wait for Vercel to show valid configuration and an issued certificate. Check `https://news.leonaquantum.com/readyz`, article/citation/image pages, `/feed.xml` and `/sitemap.xml`. Confirm any old news URLs have agreed redirects before replacing an existing publication.

The CNAME destination cannot be finalized until the Vercel project/domain has been created. A CNAME alone does not register the domain with Vercel. Existing Leona hosting does not need to be replaced to add this subdomain.

References: [Vercel monorepos](https://vercel.com/docs/monorepos), [Git integration](https://vercel.com/docs/git), [Build Output API](https://vercel.com/docs/build-output-api/primitives), [custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [Cloudflare DNS-only setup](https://vercel.com/kb/guide/migrate-to-vercel-from-cloudflare).

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

The primary deployment is a separate Vercel project described below. A container remains available for local or alternative hosting. Build with `docker build -t leona-news:<revision> apps/news`. The existing `services/api/Dockerfile` remains the API/Worker image; do not deploy the Node renderer in its place.

Set only renderer variables in the public service:

```env
LEONA_NEWS_MODE=published
LEONA_NEWS_API_URL=https://YOUR_EXISTING_API_ORIGIN
SITE_URL=https://news.leonaquantum.com
HOST=0.0.0.0
PORT=8080
```

No OpenAI key, admin bearer or DB credential is needed by this service. All API requests are server-to-server. Published article images are proxied through the API and cannot reveal draft images. Responses currently use `no-store`, including media, to make withdrawal immediate; do not add a CDN cache without an explicit purge/invalidation design. `/healthz` is process liveness; `/readyz` checks the API/DB/public-news configuration.

Enable `LEONA_NEWS_PUBLIC=true` on the API only when ready to serve approved articles. Attach `news.leonaquantum.com` to the new renderer using the actual DNS records supplied by its hosting service, and verify HTTPS. Preserve existing apex records and confirm how any older news URLs will be retained or redirected before switching an existing news host.

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
