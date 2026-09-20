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
# Read from the Vercel usage console on 2026-08-14 (UTC), current billing
# cycle (Aug 11 -> Sep 11), four days in:
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

# ## Preview deployments are skipped by default
#
# Measured from Vercel's own deployment API over the seven days to 2026-09-16:
# 190 deployments on this project, of which **142 were previews** — 130 of the
# 184 wall-clock build minutes. Nothing consumes a preview: no workflow reads a
# preview URL, and since 2026-09-20 none reacts to a Vercel deployment event at
# all (`verify-web-cache.yml` follows `deploy-web`; `web-deploy-watch.yml`
# reads Production records only).
#
# The path rules below cannot get at this, and not by oversight. This repo
# keeps ~34 worktrees, one branch each, and a branch's FIRST deployment has no
# `VERCEL_GIT_PREVIOUS_SHA` — which the "fail open" rule is obliged to BUILD,
# because an unknown change set must never be skipped. So the diff-based rules
# are structurally unable to stop the preview builds that cost the most.
#
# Previews stay available on demand, two ways, both checked before the diff is
# computed because neither depends on it:
#
#   * set `LEONA_VERCEL_PREVIEWS=1` in the Vercel project's environment, or
#   * put `[preview]` anywhere in the commit message.
#
# Production is untouched. `VERCEL_ENV` is `production` for the `dev` branch,
# and — this is the part that has to stay true — any value this script does
# not recognise falls through to the path rules rather than skipping. The test
# for `preview` is positive and exact, so an empty or unexpected `VERCEL_ENV`
# builds, exactly as it did before this block existed.
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  if [ "${LEONA_VERCEL_PREVIEWS:-}" = "1" ]; then
    : # opted in for the whole project — fall through to the path rules
  elif grep -qiF '[preview]' <<<"${VERCEL_GIT_COMMIT_MESSAGE:-}"; then
    : # opted in for this commit — fall through to the path rules
  else
    skip "preview deployment, and nothing consumes previews (set LEONA_VERCEL_PREVIEWS=1, or put [preview] in the commit message, to build one)"
  fi
fi

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

if ! CHANGED="$(git diff --name-only "$BASE" "$HEAD_SHA" 2>/dev/null)" || [ -z "$CHANGED" ]; then
  build "could not compute a diff from $BASE to $HEAD_SHA"
fi

# Every `grep` below reads a HERE-STRING, never a pipe. `grep -q` exits at its
# first match, which can SIGPIPE a writer that is still going; under
# `pipefail` the pipeline then reports 141 rather than 0, and an `if` reads
# that as "no match". On a long enough change list that would silently skip
# the contracts guard immediately below — the one check that must never be
# missed. A here-string is not a pipeline, so the hazard does not exist.

# The one Python path the web build compiles against. Checked before the
# irrelevant-set test, and listed there by its siblings rather than by its
# parent, so this can never be shadowed.
if grep -qE '^packages/py/contracts/' <<<"$CHANGED"; then
  build "packages/py/contracts changed — contracts-gen regenerates the web app's types"
fi

# Paths that cannot affect the web bundle. Anything outside this set builds.
#
# The Python packages are listed INDIVIDUALLY rather than as `packages/py/`.
# The parent form was fail-CLOSED: a package added under `packages/py/` later
# that the web app did come to depend on would have been silently skipped
# until someone remembered to edit this line. Naming the nine that exist today
# means a tenth is simply unrecognised, and unrecognised means build.
IRRELEVANT='^(services/api/|services/worker/'
IRRELEVANT="${IRRELEVANT}|packages/py/(agent|estimation|frameworks|llm|openqasm|qpu|sandbox|verification)/"
IRRELEVANT="${IRRELEVANT}|evals/|infra/|db/|docs/|\.github/|[^/]*\.md$"
# The root uv workspace files. `uv.lock` is one lockfile for every Python
# package in this repo, and root `pyproject.toml` is uv's workspace manifest
# — neither is `packages/py/contracts`, both are anchored so a same-named
# file inside a package (already covered above) can't collide, and nothing
# under apps/web ever reads either one. Before this, EVERY python-only
# Dependabot bump built the web app anyway, because the version bump always
# touches uv.lock at root and the individual-package rule above only ever
# looked at the package's own pyproject.toml.
IRRELEVANT="${IRRELEVANT}|^uv\.lock$|^pyproject\.toml$)"

if grep -qvE "$IRRELEVANT" <<<"$CHANGED"; then
  build "$(grep -vE "$IRRELEVANT" <<<"$CHANGED" | head -3 | tr '\n' ' ')"
fi

skip "$(wc -l <<<"$CHANGED" | tr -d ' ') changed path(s), none of which the web app builds from"
