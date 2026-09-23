#!/usr/bin/env bash
#
# Decides whether a commit on `dev` needs the website rebuilt and redeployed.
# `.github/workflows/deploy-web.yml` runs it before building the Cloud Run image.
#
#   WEB_BUILD_BASE=<sha before the push> WEB_BUILD_HEAD=<sha after> bash scripts/web-build-needed.sh
#
#   exit 1  ->  BUILD
#   exit 0  ->  SKIP   (nothing the web app builds from changed)
#
# The inverted exit codes are inherited from Vercel's "Ignored Build Step",
# which this script was until Vercel was retired on 2026-09-21. They are kept
# so the deploy workflow's `if ...; then SKIP` reads the same as it always has.
#
# ## Why this exists
#
# This is a monorepo, and most pushes touch only Python, the worker, CI config
# or documentation, none of which the web app compiles against. On Vercel,
# builds were 57% of the bill (read 2026-08-14); on Cloud Build they cost build
# minutes and a deploy that changes nothing a visitor sees.
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

# Every path pattern below is repo-root-relative, and `git diff --name-only`
# only prints repo-root-relative paths when it is not asked for `--relative` —
# but the cd is cheap and makes the assumption explicit rather than inherited
# from git's defaults (Vercel used to run this from `apps/web`).
cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || build "not inside a git work tree"

BASE="${WEB_BUILD_BASE:-}"
HEAD_SHA="${WEB_BUILD_HEAD:-HEAD}"

# No usable base — first deployment, a force-push, or a rebuild. Build.
if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
  build "no WEB_BUILD_BASE, so the change set is unknown"
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
# until someone remembered to edit this line. Naming the ones known not to reach
# the web build means a new one is simply unrecognised, and unrecognised means build.
# (`notebooks` is deliberately absent; see deploy-web.yml. `mcp` and `client` are
# the stdio MCP server and the HTTP client it and `notebooks` share — both
# standalone clients of the public API that nothing in apps/web imports.)
IRRELEVANT='^(services/api/|services/worker/'
IRRELEVANT="${IRRELEVANT}|packages/py/(agent|client|estimation|frameworks|llm|mcp|openqasm|qpu|sandbox|verification)/"
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
