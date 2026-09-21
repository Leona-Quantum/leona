#!/usr/bin/env bash
#
# GO or NO-GO for pointing leonaqt.com at Google Cloud. Changes nothing.
#
# The collaborator who holds Cloudflare asked for one explicit sentence before
# he moves the records: "GO for Cloudflare cutover". This is what stands behind
# that sentence. It exists because every item below is something that renders a
# perfectly healthy public page while being wrong, so none of them would stop
# anybody by itself:
#
#   sign-in off          every public page is 200 and nobody can sign in
#   the old identity     the site works, and runs as roles/editor
#   min-instances 0      the site works, and the first visitor waits for a boot
#   a stale revision     the site works, and is last week's
#
# 90-verify.sh reads the front door back; this reads whether what is behind it is
# production. It ends in the word GO or the word NO-GO and exits accordingly.
#
#   ./80-cutover-preflight.sh                       # everything that can be read without Cloudflare
#   PREVIEW_HOST=gcp-preview.leonaqt.com ./80-cutover-preflight.sh
#
# PREVIEW_HOST is the rehearsal: a proxied Cloudflare record on any other name
# under leonaqt.com, pointing at the load balancer. The Origin Certificate is a
# wildcard, the site answers on a host it has not been told to redirect, and so
# that one record exercises the whole real path — Cloudflare's edge, Full
# (strict) against our certificate, the origin lock, Cloud Run — before a single
# visitor is moved. Without it the first request through Cloudflare is a real
# visitor's.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

nogo=0
ok()   { printf '  OK     %s\n' "$*"; }
warn() { printf '  WARN   %s\n' "$*"; }
no()   { printf '  NO-GO  %s\n' "$*"; nogo=1; }

echo "== the front door (90-verify.sh)"
if ./90-verify.sh > /tmp/.verify.$$ 2>&1; then
  ok "every check passed"
  grep -E '^\s+WARN' /tmp/.verify.$$ | sed 's/^/        /' || true
else
  no "90-verify.sh reports failures:"
  grep -E '^\s+FAIL' /tmp/.verify.$$ | sed 's/^/        /' || true
fi
if grep -q 'not serving yet' /tmp/.verify.$$; then no "the load balancer is not serving (./40-serve.sh)"; fi
rm -f /tmp/.verify.$$

echo "== infra/fleet.env says what a production front door needs"
fleet="../fleet.env"
val() { grep -E "^$1=[0-9]+$" "$fleet" | cut -d= -f2; }
[ "$(val WEB_SIGN_IN)" = 1 ]        && ok "WEB_SIGN_IN=1"        || no "WEB_SIGN_IN is $(val WEB_SIGN_IN) — nobody could sign in"
[ "$(val WEB_XFF_TRUSTED_HOPS)" = 1 ] && ok "WEB_XFF_TRUSTED_HOPS=1" || no "WEB_XFF_TRUSTED_HOPS is $(val WEB_XFF_TRUSTED_HOPS)"
[ "$(val WEB_MIN_INSTANCES)" -ge 1 ] 2>/dev/null && ok "WEB_MIN_INSTANCES=$(val WEB_MIN_INSTANCES)" \
  || no "WEB_MIN_INSTANCES is $(val WEB_MIN_INSTANCES) — the first visitor after a quiet spell waits for a cold start"

echo "== the serving revision carries them"
g run services describe "$SERVICE" --region "$REGION" --format=json > /tmp/.svc.$$
python3 - /tmp/.svc.$$ <<'PY' > /tmp/.svcfacts.$$
import json, sys
d = json.load(open(sys.argv[1]))
t = d["spec"]["template"]
c = t["spec"]["containers"][0]
env = {e["name"]: e for e in c.get("env", [])}
print("env=" + ",".join(sorted(env)))
print("sha=" + env.get("LEONA_GIT_COMMIT_SHA", {}).get("value", ""))
print("min=" + t["metadata"].get("annotations", {}).get("autoscaling.knative.dev/minScale", "0"))
serving = [x.get("revisionName") for x in d["status"].get("traffic", []) if (x.get("percent") or 0) > 0]
print("serving=" + ",".join(serving))
print("latest=" + d["status"].get("latestReadyRevisionName", ""))
PY
fact() { grep -E "^$1=" /tmp/.svcfacts.$$ | cut -d= -f2-; }
have_env=",$(fact env),"
for name in WORKOS_CLIENT_ID WORKOS_API_KEY WORKOS_COOKIE_PASSWORD WORKOS_REDIRECT_URI LEONA_DEVELOPER_EMAILS CONTACT_FALLBACK; do
  case "$have_env" in *",${name},"*) ok "${name} is set on the service";; *) no "${name} is NOT set on the service";; esac
done
[ "$(fact min)" -ge 1 ] 2>/dev/null && ok "min instances $(fact min) on the live service" || no "the live service still has min instances $(fact min)"
[ "$(fact serving)" = "$(fact latest)" ] && ok "traffic is on the latest ready revision ($(fact latest))" \
  || no "traffic is on $(fact serving), the latest ready revision is $(fact latest)"

# Which commit is serving, against what dev holds. Not every commit builds the
# website (scripts/web-build-needed.sh), so "differs from dev's tip" is
# ordinary — it is printed for a human to read against the log, not judged.
live_sha=$(fact sha)
tip=$(git rev-parse origin/dev 2>/dev/null || echo "?")
if [ "$live_sha" = "$tip" ]; then ok "serving dev's tip ${tip:0:8}"; else
  warn "serving ${live_sha:0:8}; origin/dev is ${tip:0:8} — fine if nothing since built the website:"
  git log --oneline "${live_sha}..origin/dev" 2>/dev/null | head -5 | sed 's/^/        /' || true
fi
rm -f /tmp/.svc.$$ /tmp/.svcfacts.$$

echo "== every secret the deploy mounts exists and has a live version"
for s in WEB_SENTRY_DSN TRUSTED_CALLER_TOKEN WEB_DEVELOPER_EMAILS WEB_CONTACT_FALLBACK WEB_WORKOS_API_KEY WEB_WORKOS_COOKIE_PASSWORD; do
  n=$(g secrets versions list "$s" --filter='state=ENABLED' --format='value(name)' 2>/dev/null | grep -c . || true)
  [ "${n:-0}" -ge 1 ] && ok "$s" || no "$s has no enabled version"
done

echo "== where leonaqt.com points today"
apex=$(dig +short leonaqt.com A 2>/dev/null | grep -E '^[0-9]' | tr '\n' ' ')
IP=$(g compute addresses describe "$IP_NAME" --global --format='value(address)')
case " $apex" in
  *" 76.76.21."*) ok "still Vercel (${apex}) — this is the state to say GO from";;
  *" $IP "*)      no "leonaqt.com resolves STRAIGHT to the load balancer (${apex}) — unproxied, every visitor gets a certificate warning";;
  *)              warn "resolves to ${apex:-nothing} — a Cloudflare address means the cutover has already happened";;
esac

if [ -n "${PREVIEW_HOST:-}" ]; then
  echo "== the rehearsal through Cloudflare: https://${PREVIEW_HOST}/"
  hdr=$(mktemp); body=$(mktemp)
  code=$(curl -sS --max-time 30 -D "$hdr" -o "$body" -w '%{http_code}' "https://${PREVIEW_HOST}/" || echo 000)
  via=$(grep -i '^server:' "$hdr" | tr -d '\r' | head -1)
  case "$via" in *cloudflare*) ok "answered by Cloudflare's edge";; *) no "not answered through Cloudflare (${via:-no server header}) — is the record proxied?";; esac
  case "$code" in
    200) grep -q '<title>' "$body" && ok "200 with a rendered page — edge, certificate, origin lock and Cloud Run all agree" \
           || no "200 but no <title> — something other than the site answered";;
    526) no "526: Cloudflare rejected our certificate under Full (strict) — wrong certificate on the map, or a hostname it does not cover";;
    525) no "525: the TLS handshake with the load balancer failed — no certificate map entry matches ${PREVIEW_HOST}";;
    403) no "403: the origin lock refused Cloudflare — a published range is missing (./10-origin-lock.sh), or a Cloudflare rule blocked this machine";;
    *)   no "returned ${code}";;
  esac
  loc=$(curl -sS --max-time 30 -o /dev/null -w '%{redirect_url}' "https://${PREVIEW_HOST}/auth/sign-in" || true)
  case "$loc" in
    https://api.workos.com/*client_id=*) ok "sign-in redirects to WorkOS";;
    *) no "sign-in does not reach WorkOS (redirects to '${loc:-nothing}') — WEB_SIGN_IN, or a missing WORKOS_* value";;
  esac
  rm -f "$hdr" "$body"
else
  warn "no PREVIEW_HOST given — the path through Cloudflare has never carried a request. Ask for the rehearsal record first."
fi

echo
if [ "$nogo" -eq 0 ]; then
  echo "GO — everything a visitor and a signed-in user need is in place behind ${IP}."
else
  echo "NO-GO — the lines above say why."
  exit 1
fi
