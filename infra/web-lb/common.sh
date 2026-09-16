# Shared settings and helpers. Sourced, not run.
set -euo pipefail

PROJECT="${PROJECT:-majorana-core}"
REGION="${REGION:-us-west1}"
SERVICE="${SERVICE:-majorana-web}"
DOMAINS="${DOMAINS:-leonaqt.com www.leonaqt.com}"

IP_NAME=majorana-web-ip
NEG_NAME=majorana-web-neg
BACKEND_NAME=majorana-web-backend
ARMOR_NAME=majorana-web-origin-lock
URLMAP_NAME=majorana-web-urlmap
REDIRECT_URLMAP_NAME=majorana-web-redirect
PROXY_NAME=majorana-web-https-proxy
HTTP_PROXY_NAME=majorana-web-http-proxy
CERT_MAP_NAME=majorana-web-certs

g() { gcloud --project="$PROJECT" "$@"; }

# `gcloud ... describe` writes its "not found" to stderr and exits non-zero, and
# every create below is guarded by one of these. Two things this must not do:
# swallow a PERMISSION_DENIED as "absent" and then try to create a resource that
# already exists, and print the describe output into the caller's stdout. So the
# exit status is read, stdout is discarded, and stderr is kept only when the
# failure was not a plain 404.
exists() { # <resource-kind-args...>
  local err rc
  err=$(gcloud --project="$PROJECT" "$@" --format='value(name)' 2>&1 >/dev/null) && return 0
  rc=$?
  case "$err" in
    # `security-policies rules describe` says neither "not found" nor NOT_FOUND
    # for an absent rule — it says the policy "does not contain a rule with
    # priority N". Without that third pattern this prints an alarming error line
    # on the ordinary create path, which trains its reader to ignore the one
    # case it exists to surface.
    *"was not found"*|*"NOT_FOUND"*|*"not found"*|*"does not contain a rule"*) return 1 ;;
    *) echo "  ! ${*}: ${err}" >&2; return "$rc" ;;
  esac
}

# A Compute resource is briefly "not ready" after a write while the change
# propagates, and the next write against it fails with exactly that phrase. It is
# the ordinary path, not a fault, so retry it rather than making a re-run of the
# script the remedy — a script that only works the second time teaches its reader
# to re-run on every failure, including the ones that mean something.
retry_not_ready() {
  local i
  for i in 1 2 3 4 5 6; do
    if err=$("$@" 2>&1 >/dev/null); then return 0; fi
    case "$err" in
      *"is not ready"*|*"resourceNotReady"*) sleep $(( i * 10 )) ;;
      *) echo "$err" >&2; return 1 ;;
    esac
  done
  echo "still not ready after retries: $*" >&2
  return 1
}

step() { printf '\n== %s\n' "$*"; }
have() { printf '   already there: %s\n' "$*"; }
made() { printf '   created: %s\n' "$*"; }
