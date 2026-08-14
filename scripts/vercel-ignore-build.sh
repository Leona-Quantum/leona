#!/usr/bin/env bash
#
# Vercel's "Ignored Build Step". Decides whether this commit needs the web app
# rebuilt at all.
#
#   exit 1  ->  BUILD  (Vercel proceeds)
#   exit 0  ->  SKIP   (Vercel cancels the build and reuses the last deployment)
#
# ## Why this exists
#
# Read from the Vercel usage console on 2026-08-15, current billing cycle
# (Aug 11 -> Sep 11), four days in:
#
#   Build CPU Minutes    129 hours   $26.54   <- 57% of everything
#   Observability Events 7.64M       $9.16
#   Vercel Functions     (4 lines)   ~$10.61
#   ISR Reads / Writes   1.13K/1.21K $0
#   Fast Data Transfer   29 GB/1 TB  $0
#   Edge Requests        1.25M/10M   $0
#
# The included $20 credit was fully consumed and on-demand charges stood at
# $26.61. **Serving traffic is not what costs money here** — the CDN lines are
# comfortably inside the included allowances and ISR is literally zero. Builds
# are the bill.
#
# This is a monorepo. Every push to any branch triggered a full Next.js build,
# including pushes that touched only Python, only the worker, only CI config,
# or only documentation — none of which the web app compiles against.
#
# ## What the web build actually depends on
#
# `apps/web` has exactly two workspace dependencies, `@majorana/ui` and
# `@majorana/contracts-gen`, and imports nothing from `services/`. The one
# Python path that DOES reach it is `packages/py/contracts/openapi.json`:
# contracts-gen's `gen` script runs `openapi-typescript` over that file, so a
# schema change alters the types the web app compiles against. That path is
# checked FIRST below, before anything else, and always forces a build.
#
# ## Fail open, always
#
# The rule is a blacklist, not a whitelist: it skips only when EVERY changed
# path is in a set known not to reach the web build. Anything unrecognised
# builds. If the diff cannot be computed at all — a shallow clone, a missing
# base SHA, a first deployment — it builds. A wasted build costs cents; a
# skipped build that was needed ships a stale site, and that is not a trade
# worth making to save a few minutes of CPU.

set -uo pipefail

build() { echo "BUILD: $1"; exit 1; }
skip()  { echo "SKIP: $1";  exit 0; }

# Vercel runs this from the project's Root Directory, which is `apps/web`, not
# the repository root. Every path pattern below is repo-root-relative, and
# `git diff --name-only` only prints repo-root-relative paths when it is not
# asked for `--relative` — but the cd is cheap and makes the assumption
# explicit rather than inherited from git's defaults.
cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || build "not inside a git work tree"

BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
HEAD_SHA="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

# No usable base — first deployment, a force-push, or a rebuild. Build.
if [ -z "$BASE" ]; then
  build "no VERCEL_GIT_PREVIOUS_SHA, so the change set is unknown"
fi

CHANGED="$(git diff --name-only "$BASE" "$HEAD_SHA" 2>/dev/null)"
if [ $? -ne 0 ] || [ -z "$CHANGED" ]; then
  build "could not compute a diff from $BASE to $HEAD_SHA"
fi

# The one Python path the web build compiles against. Checked before the
# blacklist because `packages/py/` is inside it.
if printf '%s\n' "$CHANGED" | grep -qE '^packages/py/contracts/'; then
  build "packages/py/contracts changed — contracts-gen regenerates the web app's types"
fi

# Paths that cannot affect the web bundle. Anything outside this set builds.
IRRELEVANT='^(services/api/|services/worker/|packages/py/|evals/|infra/|db/|docs/|\.github/|[^/]*\.md$)'

if printf '%s\n' "$CHANGED" | grep -qvE "$IRRELEVANT"; then
  build "$(printf '%s\n' "$CHANGED" | grep -vE "$IRRELEVANT" | head -3 | tr '\n' ' ')"
fi

skip "$(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ') changed path(s), none of which the web app builds from"
