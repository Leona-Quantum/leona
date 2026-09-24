#!/usr/bin/env bash
#
# Alerts for the website on Google Cloud refusing people, and uptime checks on
# the rehearsal hostname so the Google stack is watched even while production
# DNS points elsewhere.
#
# ## What 2026-09-24 showed about the alerting we had
#
# The uptime policy "Leona is not answering" (made by hand, not in this repo)
# DID fire: "leonaqt.com home is down" from 05:18 UTC, then about a dozen
# ALERT/RESOLVED pairs until 12:42 — by email only, overnight in PDT, in the same
# inbox as an "IAM change" alert that fires on every deploy. Uptime checks see a
# symptom from outside, every five minutes, from six places. What they cannot say
# is WHY, and an intermittent 429 makes them flap. So these alert on the cause,
# counted by Cloud Run itself:
#
# - the site service answering 429 at all. Cloud Run only says "Rate exceeded."
#   when it has no instance to give a request to; on `majorana-web` that means
#   visitors to the home page are being turned away, which is never expected.
# - the Atlas service shedding for more than ten minutes. Expected under a
#   flood — it is the bulkhead working — but worth a human look, and the one
#   signal that a crawler is back.
# - 5xx from either.
#
# Everything notifies the channels named in CHANNEL_NAMES (the owner's email
# today). Adding a phone is the owner's to do in the Cloud console app, and the
# first thing worth doing: the 09-24 alert reached an inbox nobody was reading.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

PREVIEW_HOST="${PREVIEW_HOST:-gcp-preview.leonaqt.com}"
CHANNEL_NAMES="${CHANNEL_NAMES:-Eshaan (owner)}"

step "notification channels"
channels=$(g alpha monitoring channels list --format=json | python3 -c '
import json,sys
want=[w.strip() for w in sys.argv[1].split(",") if w.strip()]
have={c["displayName"]:c["name"] for c in json.load(sys.stdin)}
missing=[w for w in want if w not in have]
if missing: sys.exit("no notification channel named: "+", ".join(missing))
print(",".join(have[w] for w in want))' "$CHANNEL_NAMES")
echo "   ${channels}"

step "uptime checks on ${PREVIEW_HOST}"
# `/` is served by majorana-web and Cloudflare does not cache it, so this reaches
# the origin every time. The node page is served by majorana-web-atlas.
for spec in "gcp-preview home:/" "gcp-preview Atlas node page:/repository/layers/block-encoding"; do
  name="${spec%%:*}"; path="${spec#*:}"
  if g monitoring uptime list-configs --format='value(displayName)' | grep -Fxq "$name"; then
    have "$name"
  else
    g monitoring uptime create "$name" --resource-type=uptime-url \
      --resource-labels="host=${PREVIEW_HOST},project_id=${PROJECT}" \
      --path="$path" --protocol=https --period=5 --timeout=30 \
      --status-classes=2xx >/dev/null
    made "$name"
  fi
done

policy() { # <display-name> <json>
  local name="$1" body="$2" existing tmp
  tmp=$(mktemp)
  printf '%s' "$body" | python3 -c '
import json,sys
d=json.load(sys.stdin); d["notificationChannels"]=sys.argv[1].split(","); print(json.dumps(d))' "$channels" > "$tmp"
  existing=$(g alpha monitoring policies list --format=json | python3 -c '
import json,sys
print(next((p["name"] for p in json.load(sys.stdin) if p["displayName"]==sys.argv[1]),""))' "$name")
  if [ -n "$existing" ]; then
    g alpha monitoring policies update "$existing" --policy-from-file="$tmp" >/dev/null
    echo "   updated: ${name}"
  else
    g alpha monitoring policies create --policy-from-file="$tmp" >/dev/null
    echo "   created: ${name}"
  fi
  rm -f "$tmp"
}

# A Cloud Run request_count condition. ALIGN_DELTA over the window, summed
# across revisions (a deploy splits one service across two for a minute).
cond() { # <display> <service> <code-filter> <threshold-per-window> <window-s> <duration-s>
  cat <<JSON
{"displayName": "$1",
 "conditionThreshold": {
   "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$2\" AND metric.type=\"run.googleapis.com/request_count\" AND $3",
   "aggregations": [{"alignmentPeriod": "${5}s", "perSeriesAligner": "ALIGN_DELTA",
                     "crossSeriesReducer": "REDUCE_SUM", "groupByFields": ["resource.labels.service_name"]}],
   "comparison": "COMPARISON_GT", "thresholdValue": $4, "duration": "${6}s",
   "trigger": {"count": 1}}}
JSON
}

step "alert policies"
policy "Leona web is turning visitors away (429)" "$(cat <<JSON
{"displayName": "Leona web is turning visitors away (429)",
 "combiner": "OR",
 "documentation": {"mimeType": "text/markdown", "content": "Cloud Run answered **429 Rate exceeded** on the website: it had no instance to give requests to. On majorana-web that is the home page, static chunks and the workspace, which is never expected; on majorana-web-atlas it is the Atlas shedding a flood. Read ai-ops/desk/leona/plans/incidents/2026-09-24-gcp-web-429.md, then the load balancer log for who is asking: gcloud logging read 'resource.type=\"http_load_balancer\"' --freshness=15m. Rollback: infra/web-lb/README.md, 'Rolling back'."},
 "alertStrategy": {"autoClose": "3600s"},
 "conditions": [
   $(cond "majorana-web (home, pages, static) answered 429" "$SERVICE" 'metric.labels.response_code=\"429\"' 5 300 120),
   $(cond "majorana-web-atlas shedding for 10 minutes" "$ATLAS_SERVICE" 'metric.labels.response_code=\"429\"' 300 300 600)
 ]}
JSON
)"
policy "Leona web is failing (5xx)" "$(cat <<JSON
{"displayName": "Leona web is failing (5xx)",
 "combiner": "OR",
 "documentation": {"mimeType": "text/markdown", "content": "The website's Cloud Run services returned server errors. Read the service's stderr and Sentry; if a deploy just shifted, deploy-web.yml's rollback step or 'gcloud run services update-traffic <service> --to-revisions <previous>=100'."},
 "alertStrategy": {"autoClose": "3600s"},
 "conditions": [
   $(cond "majorana-web 5xx" "$SERVICE" 'metric.labels.response_code_class=\"5xx\"' 10 300 120),
   $(cond "majorana-web-atlas 5xx" "$ATLAS_SERVICE" 'metric.labels.response_code_class=\"5xx\"' 10 300 120)
 ]}
JSON
)"
# The two uptime checks above, alerted the same way the hand-made
# "Leona is not answering" policy alerts on leonaqt.com's: more than one of the
# six checking regions failing. On the rehearsal hostname this is the only
# outside view of the Google stack while production DNS points elsewhere.
uptime_cond() { # <display> <check display name>
  local id
  id=$(g monitoring uptime list-configs --format=json | python3 -c '
import json,sys
print(next((c["name"].rsplit("/",1)[-1] for c in json.load(sys.stdin) if c["displayName"]==sys.argv[1]),""))' "$2")
  [ -n "$id" ] || { echo "no uptime check named $2" >&2; exit 1; }
  cat <<JSON
{"displayName": "$1",
 "conditionThreshold": {
   "filter": "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id = \"${id}\"",
   "aggregations": [{"alignmentPeriod": "1200s", "perSeriesAligner": "ALIGN_NEXT_OLDER",
                     "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.host"]}],
   "comparison": "COMPARISON_GT", "thresholdValue": 1, "duration": "60s", "trigger": {"count": 1}}}
JSON
}
policy "gcp-preview is not answering" "$(cat <<JSON
{"displayName": "gcp-preview is not answering",
 "combiner": "OR",
 "documentation": {"mimeType": "text/markdown", "content": "gcp-preview.leonaqt.com goes Cloudflare -> the Google load balancer -> Cloud Run, the same path production takes after the cutover. If this fires, the Google stack is failing from outside; read ./90-verify.sh and the two web services' logs."},
 "alertStrategy": {"autoClose": "1800s"},
 "conditions": [
   $(uptime_cond "gcp-preview home is down" "gcp-preview home"),
   $(uptime_cond "gcp-preview Atlas is down" "gcp-preview Atlas node page")
 ]}
JSON
)"

echo
echo "Done. The existing 'Leona is not answering' uptime policy is untouched."
