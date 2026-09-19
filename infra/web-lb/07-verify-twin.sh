#!/usr/bin/env bash
#
# The private twin the deploy workflow smoke-tests, because the real service can
# no longer be reached from CI once it is behind the load balancer.
#
# ## The collision this resolves
#
# deploy-web.yml used to deploy a dark revision of `majorana-web` and probe its
# tagged run.app URL with an identity token. 40-serve.sh restricts that service's
# ingress to `internal-and-cloud-load-balancing`, and ingress is a property of
# the SERVICE, not of a revision or a tag: from that moment every run.app URL it
# has refuses a request from a GitHub runner, token or no token. The smoke test
# would have failed on the first deploy after the load balancer went live, the
# traffic shift would never have run, and the website would have been frozen at
# whatever revision was serving — with a red workflow as the only symptom.
#
# The load balancer is no way in either: the origin lock refuses everything that
# is not Cloudflare, which is its job.
#
# So the same image, with the same settings and the same identity, is deployed
# first to a second service that stays private (IAM-gated, never public, scales
# to zero, costs nothing idle). The smoke test runs there. What it cannot see is
# anything that differs between the two services, which is why the workflow
# composes the settings ONCE and hands the same strings to both deploys.
#
# This script creates the twin ahead of the first workflow run, so that run finds
# it in place with the deploy account already allowed to call it.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

TWIN="${TWIN:-majorana-web-verify}"
RUNTIME_SA="majorana-web-runtime@${PROJECT}.iam.gserviceaccount.com"
DEPLOY_SA="majorana-deploy@${PROJECT}.iam.gserviceaccount.com"

step "twin service ${TWIN}"
if exists run services describe "$TWIN" --region "$REGION"; then have "$TWIN"; else
  image=$(g run services describe "$SERVICE" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].image)')
  [ -n "$image" ] || { echo "  ! cannot read the image ${SERVICE} is serving" >&2; exit 1; }
  # No settings beyond what makes it boot: the workflow's first deploy replaces
  # them all. --no-allow-unauthenticated is correct HERE and wrong on the public
  # service, where it strips the binding the load balancer depends on.
  g run deploy "$TWIN" --region "$REGION" --image "$image" \
    --no-allow-unauthenticated --ingress all \
    --service-account "$RUNTIME_SA" --port 8080 \
    --min-instances 0 --max-instances 2 \
    --set-env-vars "LEONA_DEPLOY_ENV=production" \
    --set-custom-audiences "$TWIN" >/dev/null
  made "$TWIN"
fi

step "only the deploy account may call it"
g run services add-iam-policy-binding "$TWIN" --region "$REGION" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/run.invoker >/dev/null
members=$(g run services get-iam-policy "$TWIN" --region "$REGION" \
  --flatten='bindings[].members' --format='value(bindings.members)')
case "$members" in
  *allUsers*|*allAuthenticatedUsers*)
    echo "  ! ${TWIN} is public. It must never be: it serves the site with no" >&2
    echo "  ! Cloudflare, no rate limit and no origin lock in front of it." >&2
    exit 1 ;;
esac
printf '   %s\n' $members
