# Web app on Cloud Run — phase-1 spike

Phase-1 groundwork for the GCP migration plan
(`ai-ops` repo, `desk/leona/plans/gcp-migration-20260912/PLAN.md`, "Phases for the web
app", phase 1). This is the private spike, not a production deploy: a Cloud Run
service `majorana-web`, `--no-allow-unauthenticated`, min instances 0, region
`us-west1`, same project as the API (`majorana-core`), same Artifact Registry repo
(`majorana`). No DNS record points at it, no load balancer sits in front of it. The
only way to reach it is a signed request with a Google identity token, from someone
with `roles/run.invoker` on the service. Production keeps building and serving from
Vercel, unchanged — nothing in this branch touches `apps/web/middleware.ts` or
`.github/workflows/`.

This document assumes the reader has `roles/run.admin` (or the deploy service
account's permissions) on `majorana-core` and is running commands from the repo
root.

**Status, 2026-09-16: this is no longer hand-run, and the spike is no longer a spike.**
ai-ops 316 was answered "allow agent sessions to run `gcloud builds submit` and
`gcloud run deploy` in `majorana-core`", and both were run. The first image built in
2 minutes 26 seconds (Cloud Build `3b9548b4`), `majorana-web` serves every public page
privately, and the deploy is now wired into `.github/workflows/deploy-web.yml`, which
fires on every push to `dev`: build, deploy with no traffic, smoke-test the dark
revision, shift, read back that the shifted revision is the one serving. The commands
below still work by hand and are still the right thing to reach for when debugging a
single revision; they are no longer how a deploy happens.

Two settings the workflow adds that these hand-run commands do not:
`LEONA_XFF_TRUSTED_HOPS` (from `infra/fleet.env`, and **it changes to 1 in the same
commit that creates the load balancer**), and `SENTRY_DSN` from the `WEB_SENTRY_DSN`
secret — **not** from the secret called `SENTRY_DSN`, which is the api's Python DSN in a
different Sentry project.

The front door in front of this service — load balancer, fixed address, origin lock,
certificate — is `infra/web-lb/`, with its own README. It is built but not serving; it
is waiting on two DNS records (ai-ops 320).

## Build and deploy

```bash
# Build. Build args (deploy env, control-plane URL, release SHA) come from the
# substitutions block at the top of cloudbuild.web.yaml; override one with
# e.g. `_API_URL=...` if needed.
gcloud builds submit --project=majorana-core --region=us-west1 \
  --config cloudbuild.web.yaml \
  --ignore-file=.gcloudignore.web \
  --substitutions=_TAG=$(git rev-parse --short=8 HEAD),_SHA=$(git rev-parse HEAD) \
  .
```

```bash
# Deploy. No traffic without a Google identity token, and cold start is fine for a
# spike carrying no real traffic. LEONA_DEPLOY_ENV is set again at RUNTIME because
# server code (lib/lab-direction.ts, lib/public-demo.ts) reads it per request, not
# only at build time. NEXT_PUBLIC_* values are NOT runtime settings: they were
# inlined by the build above, so changing one means rebuilding.
gcloud run deploy majorana-web \
  --project=majorana-core \
  --region=us-west1 \
  --image=us-west1-docker.pkg.dev/majorana-core/majorana/web:$(git rev-parse --short=8 HEAD) \
  --no-allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --port=8080 \
  --set-env-vars="LEONA_DEPLOY_ENV=production"
  # No WORKOS_*, no SENTRY_DSN: the public pages render without them (see the env
  # table below), and sign-in cannot complete on a run.app host until its redirect
  # URI is registered in WorkOS, which is an owner step.
```

## Reaching it

```bash
URL=$(gcloud run services describe majorana-web --project=majorana-core \
  --region=us-west1 --format='value(status.url)')
TOKEN=$(gcloud auth print-identity-token)
curl -s -H "Authorization: Bearer ${TOKEN}" "${URL}/"
curl -s -H "Authorization: Bearer ${TOKEN}" "${URL}/repository"
curl -s -D - -o /dev/null -H "Authorization: Bearer ${TOKEN}" "${URL}/opengraph-image"
```

A request with no token, or from an account without `run.invoker`, gets a 403 from
Cloud Run's own IAM layer before the request reaches the container — that is the
access control, not an application-level check.

## Env table

Grep used: `process.env\.[A-Z_]+` under `apps/web`, excluding `*.test.ts` and
`lib/repository/` (measured request from the task, run against this branch).
"Public pages" means the landing page, `/repository` (default configuration —
`MAJORANA_PUBLIC_CATALOG_API` unset), `/pricing`, the 404 page, and the OG image
route.

| Var | File | Needed for public pages? | What happens if unset |
| --- | --- | --- | --- |
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, (`WORKOS_REDIRECT_URI` or `NEXT_PUBLIC_WORKOS_REDIRECT_URI`) | `lib/auth-config.ts`, read by `middleware.ts` | No | `isWorkosAuthConfigured()` is false. Middleware does **not** crash or 500 — it lets public paths through, returns a 503 JSON body for `/api/*`, and redirects everything else to `/`. Confirmed by reading `middleware.ts` lines 260-278, not inferred. |
| `NEXT_PUBLIC_API_URL` | `lib/control-plane.ts`, `lib/repository-source.ts`, `next.config.ts` (CSP `connect-src`) | No, in the current default config | `/repository` reads `MAJORANA_PUBLIC_CATALOG_API`; off by default (Slice D flag, not yet flipped in production), which makes `/repository` render entirely from the committed static corpus (`lib/public-repository.ts`) with no network call. Even with the flag on, a fetch failure falls back to the static corpus rather than 500ing (`lib/repository-source.ts`, "Fallback policy"). Sign-in, chat and run pages do need a reachable API. |
| `MAJORANA_PUBLIC_CATALOG_API` | `lib/public-catalog.ts` | No | Off by default; `/repository` serves the static corpus, not the API's catalog. |
| `LEONA_DEPLOY_ENV` | `lib/deploy-env.ts`, used by `next.config.ts`, `lib/lab-direction.ts`, `lib/public-demo.ts` | No — affects only the CSP's Vercel-Toolbar allowlist (irrelevant here, nothing serves `vercel.live`), `/lab`, and the public-demo showcase | Falls back to `VERCEL_ENV` (unset on Cloud Run), then behaves as an unrecognised/absent value — every allowlist comparison fails closed. |
| `LEONA_GIT_COMMIT_SHA`, `NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA` | `lib/deploy-env.ts`, read by `instrumentation.ts`/`instrumentation-client.ts` | No | Sentry `release` is `undefined`; Sentry treats that as "no release", not an error. |
| `SENTRY_DSN` | `instrumentation.ts` | No | `register()`'s `if (process.env.SENTRY_DSN)` guard skips `Sentry.init` entirely — no events, no error. |
| `NEXT_PUBLIC_SENTRY_DSN` | `instrumentation-client.ts`, `next.config.ts` (CSP `connect-src`) | No | Client SDK no-ops; CSP simply does not add the ingest origin, which costs nothing since nothing is trying to reach it. |
| `MAJORANA_ENV`, `NEXT_PUBLIC_MAJORANA_ENV` | `instrumentation.ts`, `instrumentation-client.ts` | No | Cosmetic — Sentry `environment` tag defaults to `"dev"`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `instrumentation.ts` | No | `registerOTel` is skipped; no traces exported. |
| `LEONA_PAGEVIEW_LOG` | `middleware.ts` / `lib/pageview-signal.ts` | No | Default is **on** (opt-out, not opt-in) — pageviews still get logged to stdout even on the spike unless explicitly turned off. Worth setting to `off` on a spike so its traffic does not pollute the real pageview count. |
| `LEONA_DEVELOPER_EMAILS`, `LEONA_TEAM_EMAILS`, `LEONA_PRO_EMAILS` | `lib/account-tier.ts` | No | Empty allowlists; only affects tier resolution for a signed-in account, which the spike cannot reach without WorkOS configured anyway. |
| `MAJORANA_TRUSTED_CALLER_TOKEN` | `lib/trusted-caller.ts` | No | Requests to the API go out without the trusted-caller header and are metered on the shared anonymous bucket instead of this renderer's own — a quota/observability concern, not a render failure. |
| `CONTACT_FALLBACK` | `app/api/contact/route.ts` | No | Only read on a contact-form POST when the primary path fails; unrelated to page render. |
| `MAJORANA_SENTRY_VERIFY`, `MAJORANA_UI_FIXTURES` | `app/dev/*`, `app/api/sentry-verify/route.ts` | No | Dev-only routes; `NODE_ENV=production` (set in the Dockerfile) makes them 404 regardless. |
| `MAJORANA_LOCAL_DEV_AUTH`, `VERCEL`, `CI` | `lib/local-dev-auth.ts` | No | The bypass additionally requires `NODE_ENV === "development"`, which a production container never has — "deliberately impossible in a production Next process" per that file's own comment. |
| `NEXT_DIST_DIR` | `next.config.ts` | No | Build-time only (local dev-server cache isolation); irrelevant to a container build. |
| `NEXT_OUTPUT` | `next.config.ts` | Build-time only | Gates `output: "standalone"`; must be `standalone` for this Dockerfile's build stage, set there already. |

**Conclusion: the private spike boots and serves every public page with zero
secrets set.** The only var worth setting even for a minimal spike is
`NEXT_PUBLIC_API_URL`, so `/repository` can be tested with
`MAJORANA_PUBLIC_CATALOG_API=true` later if that becomes part of the spike's
scope, and `LEONA_PAGEVIEW_LOG=off` so spike traffic does not land in the real
pageview log.

## Build-time findings

Answers to the questions phase 1 raised, from reading the source rather than
guessing (see the Dockerfile's own comments for the same findings closer to the
code):

- **No corpus or codegen step runs during `next build`.** Repository/Atlas
  content lives entirely in `apps/web/lib/repository/*.ts` as committed TypeScript
  — no `readFileSync`/`readFile` call exists anywhere under `apps/web` outside test
  files (checked with a repo-wide grep). `scripts/generate-catalog-bootstrap-manifest.mjs`
  is a `lint`-time check (`apps/web/package.json`'s `lint` script and
  `.github/workflows/ci.yml`), not something `next build` or `pnpm --filter
  @majorana/web build` invokes.
- **`@majorana/contracts-gen`'s generated types are a committed file**, not
  regenerated at build time: `packages/ts/contracts-gen/src/schema.d.ts` is tracked
  in git (confirmed with `git ls-files` / `git check-ignore`), not gitignored. Its
  `package.json` has no `build` script, only a manual `gen` script that reads
  `packages/py/contracts/openapi.json` — which is not even copied into the Docker
  build context.
- **`@majorana/ui` ships TS/TSX source directly** (`main`/`exports` point at
  `src/index.ts`), no build step of its own; `apps/web`'s `transpilePackages:
  ["@majorana/ui"]` is what makes Next compile it as part of the web build.
- **`sharp` is `next`'s own optional dependency**, not a direct dependency of
  `apps/web` — found in `pnpm-lock.yaml` under `next@16.3.5`'s `optionalDependencies`,
  pinned tree-wide to `0.35.4` by a `pnpm-workspace.yaml` override (a CVE fix, not
  related to this migration). A plain `pnpm install` (no `--no-optional` anywhere
  in the Dockerfile) resolves the platform-matched prebuilt binary automatically.
  Confirmed on the machine this was written on: `pnpm install` resolved
  `@img/sharp-darwin-arm64`. **Not confirmed for the container's actual
  linux/amd64 target** — that needs a real build, which this task could not run
  (`docker build` is banned on the local machine per the task's hard limits). If
  `next/image` 500s on the spike, check that `@img/sharp-linux-x64` (or
  `-linuxmusl-x64`, depending on the base image) actually landed in the image.
- **Standalone output layout**: `next.config.ts`'s `outputFileTracingRoot` points
  at the monorepo root, so `.next/standalone` mirrors root-relative paths —
  `apps/web/.next/standalone/apps/web/server.js`, with `node_modules` at the
  standalone root. `.next/static` and `public` are not part of the trace and are
  copied in separately by the Dockerfile, at the same repo-relative paths. This
  matches Next's documented monorepo standalone behaviour but has not been
  exercised end to end — confirm the exact paths on the first real build and fix
  the Dockerfile's `COPY` lines if they are off.

## Parity checklist (PLAN.md phase 1)

What phase 1 asks to prove, and what a private `run.app` URL alone can answer
versus what needs the load balancer + Cloud CDN (phase 2/3):

| Check | Checkable on `run.app` now? | Notes |
| --- | --- | --- |
| Middleware runs under Node, does not crash | Yes | No WorkOS secrets needed to prove this — see the env table: unset WorkOS vars degrade gracefully rather than crashing. |
| AuthKit sign-in round trip | Only with `WORKOS_*` set and a redirect URI registered for the `run.app` host | WorkOS redirect URIs are host-specific; the spike's `run.app` URL is not registered today. Either add it as a redirect URI for a real round-trip test, or defer full sign-in verification to phase 3 (`staging.leonaqt.com`). |
| SSE streaming (a live run) | Partially | Cloud Run itself streams and supports long-lived responses directly (independent of any load balancer); the load balancer's own timeout configuration and 24h hard cap (PLAN.md) can only be verified once the LB exists. |
| OG image renders | Yes | Direct request to `/opengraph-image` on the `run.app` URL. |
| `next/image` works | Yes, if the sharp finding above holds in the container | See "Build-time findings". |
| Atlas CDN cache HIT on repeat request, language via cookie | No — needs Cloud CDN | Cloud CDN sits in front of the load balancer, not Cloud Run directly; a `run.app` request never reaches it. What IS checkable now: that `/repository` renders the *correct* content per locale cookie (functional correctness), independent of whether it gets cached. |
| `Set-Cookie` never cached | No — the caching behaviour needs Cloud CDN | Checkable now only as "does the response carry `Set-Cookie` where expected", not "does a cache respect it". |
| Japanese via cookie | Yes | Functional, no CDN needed — set the locale cookie in the `curl` request and check the rendered `lang`/copy. |
| 404s | Yes | Request an unrouted path on the `run.app` URL. |
| Canonical-host redirects | Partially | The redirect *logic* (`lib/site-origin.ts`, exercised via `middleware.ts`) can be probed by sending a `Host:` header that names a non-canonical host to the `run.app` URL directly with `curl`. A genuine domain-level test — GoDaddy/Cloudflare actually resolving to this service — needs DNS, which phase 1 explicitly does not set up. |

## What this spike does not do

No DNS, no load balancer, no Cloud CDN, no Cloud Armor, no Cloud NAT, no
preview-per-PR automation, no deploy-integrity workflow. Those are phase 2 in
PLAN.md. This spike's only job is proving the standalone build runs correctly on
Cloud Run at all, from a hand-built image, reachable only by an authenticated
operator.

## The Cloudflare Cache Rule, which is not in this repository

`next.config.ts` sets `CDN-Cache-Control: max-age=300` on `/repository`,
`/repository/layers*`, and a year on `/media/*` and `/brand/*`. That header is
necessary and **not sufficient**, and the gap is the kind that reads as done:
the file is correct, the tests pass, and the Atlas is uncached.

Cloudflare does not cache HTML at all by default — it caches by file extension,
and a page has none. It needs a **Cache Rule** naming those paths, set to
*Eligible for cache*, respecting origin cache control. Until one exists,
`CDN-Cache-Control` is a header Cloudflare reads and then declines to act on,
because the response was never a cache candidate.

Two more things the rule has to get right, both of which have already caused a
production incident here:

- **The locale cookie has to be in the cache key**, or one visitor's Japanese
  page is served to the next English reader. `leona.locale.v2` is the cookie
  (`apps/web/lib/public-locale.ts`); `majorana.locale.v1` is the legacy one the
  middleware still honours, so it belongs in the key too.
- **`/repository/<slug>` must NOT be covered.** `/repository/layers` deliberately
  includes its subtree because every child there is equally public;
  `/repository` deliberately does not, because its own children are the
  personalised entry pages. A rule written as `/repository*` caches them anyway,
  silently, at the edge, whatever the route protection says. Write the rule as
  the exact path `/repository` plus the prefix `/repository/layers`.

**What settles whether it works**, once it exists: a repeat request reaching
`cf-cache-status: HIT`, the same way `x-vercel-cache: HIT` settles it on Vercel
today. `scripts/check-live-repository-cache.mjs` reads both headers and knows
Cloudflare's vocabulary — in particular that `DYNAMIC` means "never considered
cacheable", which is exactly what a missing Cache Rule produces:

```bash
LEONA_LIVE_ORIGIN=https://leonaqt.com node scripts/check-live-repository-cache.mjs
```

It warns rather than fails on a cold edge, deliberately: nothing should be gated
on a check that runs after the deploy it is checking.
