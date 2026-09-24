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

# The Atlas bulkhead (2026-09-24 incident, plans/incidents/2026-09-24-gcp-web-429.md).
# Same image as SERVICE, its own Cloud Run service, reached through its own
# backend by a path rule on the url map, so a flood of Atlas renders can use up
# only the Atlas's instances and never the home page's. See 25-atlas-bulkhead.sh.
ATLAS_SERVICE="${ATLAS_SERVICE:-majorana-web-atlas}"
ATLAS_NEG_NAME=majorana-web-atlas-neg
ATLAS_BACKEND_NAME=majorana-web-atlas-backend
# Every public spelling of the Atlas. The middleware rewrites the unprefixed
# form to /en internally, but the load balancer routes on what the visitor
# asked for, so all three prefixes are listed.
ATLAS_PATHS="/repository /repository/* /en/repository /en/repository/* /ja/repository /ja/repository/*"

# Both web services, for the checks that must hold for each (ingress, identity,
# public-only-through-the-load-balancer).
WEB_SERVICES="${SERVICE} ${ATLAS_SERVICE}"

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
    # `gcloud run services describe` says "Cannot find service" — a fourth
    # spelling of absent, met the first time a script here created a service.
    *"was not found"*|*"NOT_FOUND"*|*"not found"*|*"does not contain a rule"*|*"Cannot find"*) return 1 ;;
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

# Which certificate the HTTPS proxy would actually serve, and whether it is
# ready, printed as "<name> <state>".
#
# There are two kinds in play and they report readiness in completely different
# places (ai-ops 325). A Google-managed certificate carries `managed.state`, and
# is only usable at ACTIVE. A self-managed one — the Cloudflare Origin
# Certificate — carries no `managed` block at all, so reading `managed.state` on
# it returns an empty string, which is byte-identical to what an ABSENT
# certificate returns. That is why this looks the resource up first and reports
# SELF_MANAGED rather than letting a caller compare an empty string with
# "ACTIVE": the caller that did exactly that refused to run forever against a
# certificate that was in place and fine.
#
# The map ENTRY is the thing consulted rather than a certificate name, because
# the entry is what the proxy reads per hostname; a certificate can exist and be
# attached to nothing.
serving_certificate() {
  local entry ref name state
  entry="majorana-web-entry-$(printf '%s' "${DOMAINS%% *}" | tr '.' '-')"
  ref=$(g certificate-manager maps entries describe "$entry" --map="$CERT_MAP_NAME" \
        --location=global --format='value(certificates)' 2>/dev/null | tr ',' '\n' | head -1)
  name="${ref##*/}"
  [ -n "$name" ] || { echo "none ABSENT"; return 0; }
  if ! gcloud --project="$PROJECT" certificate-manager certificates describe "$name" \
       --location=global --format='value(name)' >/dev/null 2>&1; then
    echo "$name ABSENT"; return 0
  fi
  state=$(g certificate-manager certificates describe "$name" --location=global \
          --format='value(managed.state)' 2>/dev/null)
  echo "$name ${state:-SELF_MANAGED}"
}

# The gate 40-serve.sh runs before its first write: refuse unless the certificate
# the map points at is one a visitor can actually be served.
#
# It lives here rather than inline in 40-serve.sh so that test-gates.sh can drive
# it with each state in turn. A gate nobody has watched refuse is a gate nobody
# has tested, and this one decides whether the site goes public holding a
# certificate no browser trusts.
require_servable_certificate() {
  local cert_name cert_state attached
  read -r cert_name cert_state <<EOF
$(serving_certificate)
EOF
  case "$cert_state" in
    ACTIVE)
      echo "certificate ${cert_name} ACTIVE (Google-managed)"
      ;;
    SELF_MANAGED)
      # A Cloudflare Origin Certificate is trusted by Cloudflare and by nothing
      # else, so serving it is correct only where Cloudflare is the sole route
      # in. The origin lock is what makes that true on this side, so it is a
      # precondition here rather than a later step: without it this would publish
      # a site that every browser reaching it directly refuses.
      attached=$(g compute backend-services describe "$BACKEND_NAME" --global \
        --format='value(securityPolicy)' 2>/dev/null || true)
      case "$attached" in
        *"$ARMOR_NAME") : ;;
        *) echo "certificate ${cert_name} is a Cloudflare Origin Certificate, but the" >&2
           echo "backend has no origin lock (${attached:-none}). Run ./10-origin-lock.sh" >&2
           echo "and ./20-load-balancer.sh first — see 31-origin-certificate.sh." >&2
           return 1 ;;
      esac
      echo "certificate ${cert_name} in place (Cloudflare Origin, ai-ops 325), origin lock attached"
      ;;
    *)
      echo "certificate ${cert_name} is ${cert_state}, which is not servable." >&2
      echo "Either ./30-certificate.sh plus the DNS records it prints (Google-managed)," >&2
      echo "or ./31-origin-certificate.sh with a Cloudflare Origin Certificate." >&2
      return 1
      ;;
  esac
}

step() { printf '\n== %s\n' "$*"; }
have() { printf '   already there: %s\n' "$*"; }
made() { printf '   created: %s\n' "$*"; }
