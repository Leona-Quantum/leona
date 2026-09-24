#!/usr/bin/env bash
#
# The Atlas bulkhead: `/repository*` served by its own Cloud Run service, so a
# flood of Atlas renders can exhaust only the Atlas's instances.
#
# ## Why (2026-09-24)
#
# One Cloud Run service served every route, capped at four instances. A crawler
# walked the Atlas map's `?focus=&open=` permutations — every one a Cloudflare
# cache miss and ~1 s of server CPU — and pinned all four. Cloud Run then
# answered "429 Rate exceeded." to ~83% of everything, the home page and the
# JavaScript chunks included, from 04:40 until DNS went back to Vercel at 12:38
# UTC. The record is ai-ops/desk/leona/plans/incidents/2026-09-24-gcp-web-429.md.
#
# The Atlas is where the site's unbounded URL space lives (ten query parameters
# resolved on the server, by design), so it is the part that can be asked for
# faster than it can be rendered. Separating it means that when that happens
# the refusal lands on Atlas URLs and nowhere else, and Cloud Run's own
# queue-then-429 does the shedding with no code on the request path.
#
# ## What it does, in an order that is not cosmetic
#
# 1. Creates `majorana-web-atlas` if absent — as a copy of what `majorana-web`
#    serves right now (image, environment, secrets, identity), with ingress
#    restricted to the load balancer FROM CREATION. deploy-web.yml keeps both on
#    the same image from then on.
# 2. Only once ingress is restricted, lets the load balancer in (allUsers
#    invoker) — the same lock-then-unlock order as 40-serve.sh, for the same
#    reason: the other order is a public run.app URL with nothing in front.
# 3. A serverless NEG and a backend for it, carrying the origin lock and
#    request logging (both backends get logging; it was off on 2026-09-24, which
#    is why that incident has no load-balancer logs at all).
# 4. Only once the new service reports Ready, the url map rule that sends
#    `/repository*` to it. Everything else keeps going to `majorana-web`.
#
# Re-running it is how you check the shape; it changes nothing that is right.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

fleet="../fleet.env"
val() { grep -E "^$1=[0-9]+$" "$fleet" | cut -d= -f2; }
ATLAS_MIN=$(val WEB_ATLAS_MIN_INSTANCES); ATLAS_MAX=$(val WEB_ATLAS_MAX_INSTANCES)
ATLAS_CONC=$(val WEB_ATLAS_CONCURRENCY)
[ -n "$ATLAS_MIN" ] && [ -n "$ATLAS_MAX" ] && [ -n "$ATLAS_CONC" ] || {
  echo "WEB_ATLAS_MIN_INSTANCES / WEB_ATLAS_MAX_INSTANCES / WEB_ATLAS_CONCURRENCY missing from ${fleet}" >&2; exit 1; }

step "Cloud Run service ${ATLAS_SERVICE}"
if exists run services describe "$ATLAS_SERVICE" --region "$REGION"; then
  have "$ATLAS_SERVICE"
else
  # A copy of the serving revision's spec, not a rebuild from the workflow's
  # variables: this runs outside CI, and the one configuration known to serve
  # the site correctly is the one serving it.
  tmp=$(mktemp)
  g run services describe "$SERVICE" --region "$REGION" --format=export > "$tmp"
  python3 - "$tmp" "$ATLAS_SERVICE" "$ATLAS_MIN" "$ATLAS_MAX" "$ATLAS_CONC" <<'PY'
import sys, yaml
path, name, lo, hi, conc = sys.argv[1:]
d = yaml.safe_load(open(path))
d["metadata"] = {"name": name, "labels": {"cloud.googleapis.com/location": d["metadata"]["labels"]["cloud.googleapis.com/location"]},
                 "annotations": {"run.googleapis.com/ingress": "internal-and-cloud-load-balancing"}}
t = d["spec"]["template"]
t["metadata"].pop("name", None)
ann = t["metadata"].setdefault("annotations", {})
for k in [k for k in ann if k.startswith("run.googleapis.com/client") or k.startswith("serving.knative.dev/")]:
    ann.pop(k)
ann["autoscaling.knative.dev/minScale"] = lo
ann["autoscaling.knative.dev/maxScale"] = hi
t["spec"]["containerConcurrency"] = int(conc)
d["spec"].pop("traffic", None)
d.pop("status", None)
yaml.safe_dump(d, open(path, "w"), sort_keys=False)
PY
  grep -q 'run.googleapis.com/ingress: internal-and-cloud-load-balancing' "$tmp" || {
    echo "refusing: the copied spec does not restrict ingress" >&2; rm -f "$tmp"; exit 1; }
  g run services replace "$tmp" --region "$REGION" >/dev/null
  rm -f "$tmp"
  made "$ATLAS_SERVICE (copy of ${SERVICE}'s serving spec)"
fi

step "ingress: load balancer only (${ATLAS_SERVICE})"
ingress=$(g run services describe "$ATLAS_SERVICE" --region "$REGION" \
  --format='value(metadata.annotations."run.googleapis.com/ingress")')
if [ "$ingress" != "internal-and-cloud-load-balancing" ]; then
  g run services update "$ATLAS_SERVICE" --region "$REGION" \
    --ingress=internal-and-cloud-load-balancing >/dev/null
  ingress=$(g run services describe "$ATLAS_SERVICE" --region "$REGION" \
    --format='value(metadata.annotations."run.googleapis.com/ingress")')
fi
[ "$ingress" = "internal-and-cloud-load-balancing" ] || {
  echo "ingress on ${ATLAS_SERVICE} reads '${ingress}' — not opening it to allUsers" >&2; exit 1; }
echo "   ${ingress}"

step "allow unauthenticated (through the load balancer only, per the step above)"
g run services add-iam-policy-binding "$ATLAS_SERVICE" --region "$REGION" \
  --member=allUsers --role=roles/run.invoker >/dev/null
echo "   public via the load balancer"

step "serverless NEG ${ATLAS_NEG_NAME} -> Cloud Run ${ATLAS_SERVICE}"
if exists compute network-endpoint-groups describe "$ATLAS_NEG_NAME" --region "$REGION"; then
  have "$ATLAS_NEG_NAME"
else
  g compute network-endpoint-groups create "$ATLAS_NEG_NAME" \
    --region "$REGION" --network-endpoint-type=serverless --cloud-run-service "$ATLAS_SERVICE" >/dev/null
  made "$ATLAS_NEG_NAME"
fi

step "backend service ${ATLAS_BACKEND_NAME}"
if exists compute backend-services describe "$ATLAS_BACKEND_NAME" --global; then
  have "$ATLAS_BACKEND_NAME"
else
  # No --protocol: see 20-load-balancer.sh for why a serverless NEG refuses one.
  g compute backend-services create "$ATLAS_BACKEND_NAME" \
    --global --load-balancing-scheme=EXTERNAL_MANAGED >/dev/null
  made "$ATLAS_BACKEND_NAME"
  g compute backend-services add-backend "$ATLAS_BACKEND_NAME" \
    --global --network-endpoint-group "$ATLAS_NEG_NAME" --network-endpoint-group-region "$REGION" >/dev/null
  echo "   backend attached"
fi
retry_not_ready g compute backend-services update "$ATLAS_BACKEND_NAME" --global --security-policy "$ARMOR_NAME"
echo "   origin lock attached: ${ARMOR_NAME}"

step "request logging on both backends"
# Off on 2026-09-24, so the incident has no load-balancer record at all and
# Cloud Armor's decisions could not have been read even if it had made any.
for b in "$BACKEND_NAME" "$ATLAS_BACKEND_NAME"; do
  retry_not_ready g compute backend-services update "$b" --global \
    --enable-logging --logging-sample-rate=1.0
  echo "   ${b}: logging 1.0"
done

step "${ATLAS_SERVICE} is Ready before anything is routed to it"
ready=$(g run services describe "$ATLAS_SERVICE" --region "$REGION" \
  --format='value(status.conditions.filter("type:Ready").extract("status"))' | tr -d "[]' ")
[ "$ready" = "True" ] || { echo "${ATLAS_SERVICE} is not Ready (${ready:-unknown}); not routing to it" >&2; exit 1; }
echo "   Ready"

step "url map ${URLMAP_NAME}: /repository* -> ${ATLAS_BACKEND_NAME}"
# The whole map is written, not patched: it is small, and an import is the one
# form where "is it right" and "make it right" are the same command.
tmp=$(mktemp)
paths_yaml=$(for p in $ATLAS_PATHS; do printf '      - %s\n' "$p"; done)
backend_url() { echo "https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/backendServices/$1"; }
cat > "$tmp" <<YAML
name: ${URLMAP_NAME}
defaultService: $(backend_url "$BACKEND_NAME")
hostRules:
- hosts:
  - '*'
  pathMatcher: site
pathMatchers:
- name: site
  defaultService: $(backend_url "$BACKEND_NAME")
  pathRules:
  - paths:
${paths_yaml}
    service: $(backend_url "$ATLAS_BACKEND_NAME")
YAML
g compute url-maps import "$URLMAP_NAME" --source "$tmp" --global --quiet >/dev/null
rm -f "$tmp"
echo "   routed: ${ATLAS_PATHS}"

cat <<TXT

Check it through the rehearsal hostname (Cloudflare -> this load balancer):
  curl -sS -o /dev/null -w '%{http_code}\\n' https://gcp-preview.leonaqt.com/repository
and read which backend answered from the load balancer's own log:
  gcloud logging read 'resource.type="http_load_balancer" AND httpRequest.requestUrl:"/repository"' \\
    --project ${PROJECT} --limit 3 --format='value(resource.labels.backend_service_name,httpRequest.status)'
TXT
