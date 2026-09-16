#!/usr/bin/env bash
#
# A Google-managed certificate for leonaqt.com, authorised by DNS.
#
# ## Why DNS authorisation and not the simpler kind
#
# The default managed certificate proves control by answering an HTTP challenge
# on the load balancer's own address, which means the domain has to point at the
# load balancer before the certificate can be issued. At cutover that is a race
# the visitor loses: DNS moves, the certificate is not yet valid, and every
# request fails TLS until it is. DNS authorisation proves control with a CNAME
# instead, so the certificate is ACTIVE days before anything moves and the
# cutover is a switch rather than an outage.
#
# The cost is one record somebody has to add by hand, which this script prints.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

for domain in $DOMAINS; do
  auth="majorana-web-auth-$(printf '%s' "$domain" | tr '.' '-')"
  step "DNS authorization for ${domain}"
  if exists certificate-manager dns-authorizations describe "$auth" --location=global; then
    have "$auth"
  else
    g certificate-manager dns-authorizations create "$auth" --domain="$domain" --location=global >/dev/null
    made "$auth"
  fi
done

step "certificate"
authargs=$(for domain in $DOMAINS; do printf 'majorana-web-auth-%s,' "$(printf '%s' "$domain" | tr '.' '-')"; done | sed 's/,$//')
domainargs=$(printf '%s' "$DOMAINS" | tr ' ' ',')
if exists certificate-manager certificates describe majorana-web-cert --location=global; then
  have majorana-web-cert
else
  g certificate-manager certificates create majorana-web-cert \
    --domains="$domainargs" --dns-authorizations="$authargs" --location=global >/dev/null
  made majorana-web-cert
fi

step "certificate map"
if exists certificate-manager maps describe "$CERT_MAP_NAME" --location=global; then
  have "$CERT_MAP_NAME"
else
  g certificate-manager maps create "$CERT_MAP_NAME" --location=global >/dev/null; made "$CERT_MAP_NAME"
fi
for domain in $DOMAINS; do
  entry="majorana-web-entry-$(printf '%s' "$domain" | tr '.' '-')"
  if exists certificate-manager maps entries describe "$entry" --map="$CERT_MAP_NAME" --location=global; then
    have "$entry"
  else
    g certificate-manager maps entries create "$entry" --map="$CERT_MAP_NAME" \
      --certificates=majorana-web-cert --hostname="$domain" --location=global >/dev/null
    made "$entry"
  fi
done

cat <<'TXT'

------------------------------------------------------------------
ADD THESE DNS RECORDS. Nothing else in the migration can proceed
until the certificate reports ACTIVE, and it cannot until they exist.
They are CNAMEs to a Google validation host, they carry no traffic,
and adding them changes nothing a visitor sees.
------------------------------------------------------------------
TXT
for domain in $DOMAINS; do
  auth="majorana-web-auth-$(printf '%s' "$domain" | tr '.' '-')"
  g certificate-manager dns-authorizations describe "$auth" --location=global \
    --format='value[separator="  "](dnsResourceRecord.name, dnsResourceRecord.type, dnsResourceRecord.data)'
done
cat <<'TXT'

Then watch it, from here:
  gcloud certificate-manager certificates describe majorana-web-cert \
    --location=global --project=majorana-core \
    --format='value(managed.state, managed.domainStatus)'
ACTIVE usually arrives within an hour of the records resolving.
TXT
