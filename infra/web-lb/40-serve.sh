#!/usr/bin/env bash
#
# Attach the certificate, open the ports, and put Cloud Run behind the load
# balancer. This is the step that starts costing money (a forwarding rule is
# about $18 a month) and the step that makes the site reachable, so it refuses
# to run until the certificate is actually ACTIVE.
#
# It does NOT move any DNS. After this, leonaqt.com still resolves wherever it
# resolved before; the load balancer serves the same site at its own address,
# which is what phase 3's week of parallel running is for.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

state=$(g certificate-manager certificates describe majorana-web-cert --location=global \
  --format='value(managed.state)' 2>/dev/null || true)
if [ "$state" != "ACTIVE" ]; then
  echo "certificate majorana-web-cert is ${state:-absent}, not ACTIVE." >&2
  echo "Run ./30-certificate.sh and add the DNS records it prints." >&2
  exit 1
fi
echo "certificate ACTIVE"

step "HTTPS proxy ${PROXY_NAME}"
if exists compute target-https-proxies describe "$PROXY_NAME"; then have "$PROXY_NAME"; else
  g compute target-https-proxies create "$PROXY_NAME" \
    --url-map "$URLMAP_NAME" \
    --certificate-map "$CERT_MAP_NAME" >/dev/null
  made "$PROXY_NAME"
fi

step "HTTP proxy (the 301)"
if exists compute target-http-proxies describe "$HTTP_PROXY_NAME"; then have "$HTTP_PROXY_NAME"; else
  g compute target-http-proxies create "$HTTP_PROXY_NAME" --url-map "$REDIRECT_URLMAP_NAME" >/dev/null
  made "$HTTP_PROXY_NAME"
fi

IP=$(g compute addresses describe "$IP_NAME" --global --format='value(address)')
step "forwarding rules on ${IP}"
for spec in "majorana-web-fr-443:443:--target-https-proxy=${PROXY_NAME}" \
            "majorana-web-fr-80:80:--target-http-proxy=${HTTP_PROXY_NAME}"; do
  name="${spec%%:*}"; rest="${spec#*:}"; port="${rest%%:*}"; target="${rest#*:}"
  if exists compute forwarding-rules describe "$name" --global; then have "$name"; else
    g compute forwarding-rules create "$name" --global \
      --address "$IP_NAME" --ports "$port" \
      --load-balancing-scheme=EXTERNAL_MANAGED $target >/dev/null
    made "$name"
  fi
done

# ---------------------------------------------------------------------------
# ORDER MATTERS AND IS NOT COSMETIC.
#
# The service is private today. A public website cannot be: the load balancer
# reaches Cloud Run as an ordinary unauthenticated caller. So both of the next
# two commands are needed — but between them, in the wrong order, the entire site
# is a public run.app URL with no Cloudflare, no rate limit and no Cloud Armor in
# front of it. Lock the door first, then unlock the lock we are replacing.
# ---------------------------------------------------------------------------
step "ingress: load balancer only"
g run services update "$SERVICE" --region "$REGION" \
  --ingress=internal-and-cloud-load-balancing >/dev/null
echo "   ingress restricted"

step "allow unauthenticated (through the load balancer only, per the step above)"
g run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member=allUsers --role=roles/run.invoker >/dev/null
echo "   public via the load balancer"

cat <<TXT

Serving at https://${IP}/ (SNI must be a name on the certificate).
Check it without moving any DNS:
  curl -sS -o /dev/null -w '%{http_code}\\n' --resolve leonaqt.com:443:${IP} https://leonaqt.com/

The bare run.app URL should now refuse:
  curl -sS -o /dev/null -w '%{http_code}\\n' \$(gcloud run services describe ${SERVICE} \\
    --region ${REGION} --project ${PROJECT} --format='value(status.url)')
403 is correct there — that is the ingress restriction, and it is the thing that
makes the Cloudflare-only origin lock meaningful.
TXT
