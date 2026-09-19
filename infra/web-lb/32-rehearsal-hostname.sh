#!/usr/bin/env bash
#
# Let the load balancer answer for any name under leonaqt.com, so the path
# through Cloudflare can be rehearsed on a name no visitor uses.
#
# ## Why
#
# The certificate map has one entry per served hostname, and the HTTPS proxy
# picks a certificate by the name in the TLS handshake. A request for
# `gcp-preview.leonaqt.com` matches no entry, the load balancer has no
# certificate to offer, and Cloudflare reports 525 — which would read as "the
# move does not work" when it means "nobody told the map about this name".
#
# The Origin Certificate already covers `*.leonaqt.com`, so one wildcard entry is
# enough, and it grants nothing the origin lock has not already bounded: the only
# caller that can reach this address at all is Cloudflare's edge, and Cloudflare
# only sends traffic for names somebody has created a proxied record for.
#
# The site itself answers on a name it has not been told to redirect
# (apps/web/lib/site-origin.ts lists the hosts it redirects, deliberately, rather
# than redirecting everything that is not canonical), so the rehearsal gets real
# pages, not a 308.
#
# Harmless to leave in place after the cutover; delete it if the list of things
# this load balancer answers for should be exactly two names again:
#   gcloud certificate-manager maps entries delete majorana-web-entry-wildcard \
#     --map=majorana-web-certs --location=global --project=majorana-core
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

CERT_NAME=majorana-web-origin-cert
ENTRY=majorana-web-entry-wildcard
apex="${DOMAINS%% *}"

exists certificate-manager certificates describe "$CERT_NAME" --location=global || {
  echo "no ${CERT_NAME} — run ./31-origin-certificate.sh first" >&2; exit 1; }

step "map entry *.${apex} -> ${CERT_NAME}"
if exists certificate-manager maps entries describe "$ENTRY" --map="$CERT_MAP_NAME" --location=global; then
  have "$ENTRY"
else
  g certificate-manager maps entries create "$ENTRY" --map="$CERT_MAP_NAME" \
    --certificates="$CERT_NAME" --hostname="*.${apex}" --location=global >/dev/null
  made "$ENTRY"
fi

IP=$(g compute addresses describe "$IP_NAME" --global --format='value(address)')
cat <<TXT

Ask for one Cloudflare record, PROXIED (orange cloud), on any unused name:

    gcp-preview   A   ${IP}   Proxied

then:   PREVIEW_HOST=gcp-preview.${apex} ./80-cutover-preflight.sh
TXT
