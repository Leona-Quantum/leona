# Cloud Run spike for the web app (ai-ops gcp-migration-20260912 PLAN.md,
# "Hosting and build" row). NOT wired into any deploy path yet — nothing
# currently builds or references this image. Build context is the REPO ROOT,
# same convention as services/api/Dockerfile, because pnpm workspaces need the
# whole monorepo's package manifests and lockfile to resolve:
#   docker build -f apps/web/Dockerfile -t majorana-web .
#
# UNTESTED. `docker build` is banned on the machine this was written on
# (CPU-heavy jobs go to Cloud Build, not the laptop). Everything below was
# checked by reading the source and the lockfile, not by building — see
# docs/runbooks/web-cloud-run.md "Build-time findings" for what was verified
# and how, and confirm this actually produces a working image on the first
# real Cloud Build run before relying on it.
#
# Node version and package manager version are read from the repo's own pins
# rather than hardcoded twice: .nvmrc says 24, root package.json's
# "packageManager" says pnpm@11.10.0.
FROM node:24-bookworm-slim AS build
WORKDIR /app

# corepack ships with Node 24 but is opt-in; `enable` wires up the `pnpm`
# shim, `prepare --activate` pins the exact version so a future bump to the
# root package.json's packageManager field is what changes this build, not a
# corepack default drifting underneath it.
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

# Every workspace package's manifest, so pnpm can resolve the full workspace
# graph and verify it against the lockfile (--frozen-lockfile below fails
# closed on any mismatch). None of these have a node_modules yet, so this
# layer is cheap and caches well: it only invalidates when a package.json
# anywhere in the monorepo changes, not when application source does.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/news/package.json apps/news/package.json
COPY packages/ts/ui/package.json packages/ts/ui/package.json
COPY packages/ts/ui-visual/package.json packages/ts/ui-visual/package.json
COPY packages/ts/contracts-gen/package.json packages/ts/contracts-gen/package.json

# Scoped to @majorana/web and its workspace dependencies only (the trailing
# `...` means "this package plus what it depends on", not "plus its
# dependents") — @majorana/ui and @majorana/contracts-gen, per apps/web's own
# "dependencies". apps/news and packages/ts/ui-visual stay unresolved: their
# manifests are present so the workspace graph is complete and the lockfile
# check passes, but pnpm does not fetch or link their dependencies.
# --frozen-lockfile: fail the build rather than silently resolve a drifted
# lockfile, the same contract services/api's `uv sync --frozen` has.
RUN pnpm install --frozen-lockfile --filter "@majorana/web..."

# Now the actual source. @majorana/ui ships TS/TSX source directly (no build
# step of its own — apps/web's transpilePackages handles it via Next).
# @majorana/contracts-gen's `schema.d.ts` is a committed, checked-in generated
# file (packages/ts/contracts-gen/src/schema.d.ts, tracked in git, not
# gitignored) — there is no `pnpm gen` step here because nothing regenerates
# it at build time; the OpenAPI source it was generated from
# (packages/py/contracts/openapi.json) is not even in this image.
COPY apps/web apps/web
COPY packages/ts/ui packages/ts/ui
COPY packages/ts/contracts-gen packages/ts/contracts-gen

# Build-time inputs. NEXT_PUBLIC_* vars are inlined into the client bundle at
# build time, not read at request time, so they have to be set here rather
# than as a Cloud Run runtime env var. LEONA_DEPLOY_ENV and
# NEXT_PUBLIC_API_URL matter even more than usual: next.config.ts computes
# the CSP (including the control-plane connect-src origin) at
# module-evaluation time, and Next bakes headers()'s result into
# routes-manifest.json during `next build` — so setting these only as
# runtime env on the Cloud Run service would ship a CSP built against
# whatever (or nothing) was set here instead.
#
# WORKOS_*, SENTRY_DSN (server) and OTEL_EXPORTER_OTLP_ENDPOINT are
# deliberately NOT build args: they are read at request/process-start time by
# server code (middleware.ts, instrumentation.ts), never by next.config.ts,
# so they belong as Cloud Run runtime env vars / Secret Manager references —
# baking a secret into an image layer is not something ARG/ENV should ever do
# even when the value is not itself secret.
ARG LEONA_DEPLOY_ENV
ARG LEONA_GIT_COMMIT_SHA
ARG NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_MAJORANA_ENV
ARG NEXT_PUBLIC_WORKOS_REDIRECT_URI
ENV LEONA_DEPLOY_ENV=${LEONA_DEPLOY_ENV} \
    LEONA_GIT_COMMIT_SHA=${LEONA_GIT_COMMIT_SHA} \
    NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA=${NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_MAJORANA_ENV=${NEXT_PUBLIC_MAJORANA_ENV} \
    NEXT_PUBLIC_WORKOS_REDIRECT_URI=${NEXT_PUBLIC_WORKOS_REDIRECT_URI} \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone

RUN pnpm --filter @majorana/web build

# --- runtime ---
# Next's own optionalDependency, not apps/web's: `next`'s package.json lists
# `sharp` as optional, pinned tree-wide to 0.35.4 by the override in
# pnpm-workspace.yaml (a CVE fix — see that file). A plain `pnpm install`
# (no --no-optional anywhere in this file) resolves the platform build for
# whatever OS/arch pnpm runs on, so on this linux/amd64 base it resolves
# @img/sharp-linux-x64, matching next/image's optimizer without any extra
# step here. Confirmed only that pnpm resolves a *platform-matched* optional
# build (checked on this Mac: pnpm installed @img/sharp-darwin-arm64 there);
# the linux resolution itself has not been exercised, since that requires an
# actual container build.
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN useradd --uid 1001 --create-home appuser

# Standalone output layout in a monorepo: `output: "standalone"` +
# outputFileTracingRoot (next.config.ts, pointed at this repo's root) traces
# apps/web's runtime dependencies from the workspace root down, so the
# standalone tree mirrors that root-relative path. server.js therefore lands
# at apps/web/server.js under the standalone directory, not at its own root
# — matched by the final CMD below. `.next/static` and `public` are NOT part
# of the standalone trace (Next's own documented behaviour) and have to be
# copied in separately, at the same repo-relative paths the server expects
# to find them at when it starts.
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/standalone ./
COPY --from=build --chown=appuser:appuser /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=appuser:appuser /app/apps/web/public ./apps/web/public

USER appuser
# Cloud Run injects PORT; the standalone server reads it directly. HOSTNAME
# must be 0.0.0.0 — the standalone server defaults to binding localhost only,
# which is unreachable from outside the container.
ENV PORT=8080 HOSTNAME=0.0.0.0 NODE_ENV=production
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
