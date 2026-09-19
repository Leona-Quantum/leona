#!/usr/bin/env bash
#
# The external Application Load Balancer, up to but not including the parts that
# need a certificate or a DNS record.
#
# Cloud CDN is deliberately NOT enabled on the backend — see README.md. If you
# are here because the Atlas is slow, the cache that is supposed to hold it is a
# Cloudflare Cache Rule, and the check is `cf-cache-status: HIT` on a repeat
# request, not a setting in here.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

step "global static address ${IP_NAME}"
if exists compute addresses describe "$IP_NAME" --global; then have "$IP_NAME"; else
  g compute addresses create "$IP_NAME" --global --ip-version IPV4 >/dev/null; made "$IP_NAME"
fi
IP=$(g compute addresses describe "$IP_NAME" --global --format='value(address)')
echo "   address: ${IP}"

step "serverless NEG ${NEG_NAME} -> Cloud Run ${SERVICE}"
if exists compute network-endpoint-groups describe "$NEG_NAME" --region "$REGION"; then
  have "$NEG_NAME"
else
  g compute network-endpoint-groups create "$NEG_NAME" \
    --region "$REGION" --network-endpoint-type=serverless --cloud-run-service "$SERVICE" >/dev/null
  made "$NEG_NAME"
fi

step "backend service ${BACKEND_NAME}"
if exists compute backend-services describe "$BACKEND_NAME" --global; then
  have "$BACKEND_NAME"
else
  # No --protocol. Passing one makes gcloud derive a port_name from it, and a
  # serverless NEG rejects any port name at all ("Port name is not supported for
  # a backend service with Serverless network endpoint groups") — at
  # add-backend time, one command AFTER the create that caused it, which is why
  # this reads as a backend problem rather than a protocol one. The NEG connects
  # to a Google-managed Cloud Run endpoint; there is no port to name.
  g compute backend-services create "$BACKEND_NAME" \
    --global --load-balancing-scheme=EXTERNAL_MANAGED >/dev/null
  made "$BACKEND_NAME"
  g compute backend-services add-backend "$BACKEND_NAME" \
    --global --network-endpoint-group "$NEG_NAME" --network-endpoint-group-region "$REGION" >/dev/null
  echo "   backend attached"
fi
retry_not_ready g compute backend-services update "$BACKEND_NAME" --global --security-policy "$ARMOR_NAME"
echo "   origin lock attached: ${ARMOR_NAME}"

step "url map ${URLMAP_NAME}"
if exists compute url-maps describe "$URLMAP_NAME"; then have "$URLMAP_NAME"; else
  g compute url-maps create "$URLMAP_NAME" --default-service "$BACKEND_NAME" >/dev/null; made "$URLMAP_NAME"
fi

step "port 80 redirect to HTTPS"
# A separate url map whose only job is a 301. Without it, port 80 is simply
# closed, and a visitor who types the bare hostname gets a connection error
# rather than the site.
if exists compute url-maps describe "$REDIRECT_URLMAP_NAME"; then
  have "$REDIRECT_URLMAP_NAME"
else
  tmp=$(mktemp)
  cat > "$tmp" <<YAML
name: ${REDIRECT_URLMAP_NAME}
defaultUrlRedirect:
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
  httpsRedirect: true
  stripQuery: false
YAML
  g compute url-maps import "$REDIRECT_URLMAP_NAME" --source "$tmp" --quiet >/dev/null
  rm -f "$tmp"
  made "$REDIRECT_URLMAP_NAME"
fi

printf '\nLoad balancer address: %s\n' "$IP"
printf 'Next: ./30-certificate.sh, then add the DNS record it prints.\n'
