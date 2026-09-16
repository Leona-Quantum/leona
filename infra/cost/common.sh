# Shared settings for the cost scripts. Sourced, not run.
set -euo pipefail

PROJECT="${PROJECT:-majorana-core}"
REGION="${REGION:-us-west1}"
REPO="${REPO:-majorana}"

# Every script here defaults to reporting and takes --enforce to act. The
# default is the safe one because the opposite default is unrecoverable: a
# deleted container image cannot be un-deleted, and the run that deletes the
# wrong thing looks exactly like the run that deletes the right thing until
# something tries to start.
ENFORCE=0
for a in "$@"; do [ "$a" = "--enforce" ] && ENFORCE=1; done

g() { gcloud --project="$PROJECT" "$@"; }

step() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
would() { if [ "$ENFORCE" = 1 ]; then printf '   DOING: %s\n' "$*"; else printf '   would: %s\n' "$*"; fi; }

# `gcloud` output reaches this project through an `rtk` shell hook that
# truncates long listings and mangles `--format=json`, which turns a 732-row
# answer into a 1-row answer with no error. Anything that has to be counted or
# summed is read from the REST API through this helper instead, with an
# explicit token, so the count is the service's own.
api() { # <url>
  local tok; tok=$(gcloud auth print-access-token 2>/dev/null | tail -1)
  curl -fsS -H "Authorization: Bearer ${tok}" "$1"
}
