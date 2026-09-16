#!/usr/bin/env bash
#
# Put a Cloudflare Origin Certificate on the load balancer, instead of a
# Google-managed certificate (ai-ops 325, option 2).
#
# ## Why this exists beside 30-certificate.sh
#
# 30-certificate.sh asks Google to issue a certificate and prove control of the
# domain by reading a CNAME at `_acme-challenge.leonaqt.com`. That name is
# already taken: Cloudflare put its own validation record there automatically
# when it took the domain on, a name holds one CNAME, and the two cannot sit
# side by side. Rather than displace Cloudflare's record, this removes the need
# for Google's: a Cloudflare Origin Certificate is issued by Cloudflare, needs no
# DNS validation at all, and is free.
#
# ## What that certificate is, and the one thing it is not
#
# An Origin Certificate is trusted by Cloudflare's edge and BY NOTHING ELSE. No
# browser has Cloudflare's Origin CA in its trust store, and that is the design:
# it secures the hop from Cloudflare to us, while the hop a visitor sees is
# secured by Cloudflare's own public certificate. So this certificate is correct
# only in a topology where every request arrives through Cloudflare — which is
# what `10-origin-lock.sh` already enforces at the Cloud Armor layer, and what
# turning the orange cloud on enforces at DNS.
#
# **The ordering rule that follows from that, and it is not cosmetic:** the DNS
# record for leonaqt.com must be PROXIED (orange cloud) at the same moment it is
# pointed at this load balancer. Pointed here unproxied, every visitor's browser
# is handed a certificate signed by an authority it has never heard of and the
# site is a full-page TLS warning — a worse outage than the one this replaces,
# because it fails closed in the browser rather than in a script. 90-verify.sh
# checks the certificate's issuer for exactly this reason.
#
# ## Usage
#
#   ./31-origin-certificate.sh --cert <origin.pem> --key <origin.key> [--dry-run]
#
# --dry-run runs every check against the files and touches nothing in Google
# Cloud, which is the way to confirm a downloaded pair is the right pair before
# it is anywhere near production.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

CERT_NAME=majorana-web-origin-cert

cert_file=""; key_file=""; dry_run=no
while [ $# -gt 0 ]; do
  case "$1" in
    --cert) cert_file="${2:-}"; shift 2 ;;
    --key)  key_file="${2:-}";  shift 2 ;;
    --dry-run) dry_run=yes; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$cert_file" ] && [ -n "$key_file" ] || {
  echo "usage: $0 --cert <origin.pem> --key <origin.key> [--dry-run]" >&2; exit 2; }
[ -r "$cert_file" ] || { echo "cannot read certificate file: $cert_file" >&2; exit 2; }
[ -r "$key_file" ]  || { echo "cannot read private key file: $key_file" >&2; exit 2; }

# ---------------------------------------------------------------------------
# Checks, before anything is uploaded.
#
# Each of these has a failure that is silent rather than loud if it is not
# checked here: a mismatched key is rejected by Google with a message about
# neither file, a missing SAN serves a warning only to the visitors who use the
# name that is missing, and an expiry is invisible until the day it happens.
# ---------------------------------------------------------------------------
step "the certificate is what it claims to be"

subject=$(openssl x509 -in "$cert_file" -noout -issuer 2>/dev/null) || {
  echo "  ! ${cert_file} is not a readable PEM certificate" >&2; exit 1; }
case "$(printf '%s' "$subject" | tr '[:upper:]' '[:lower:]')" in
  *cloudflare*origin*) echo "   issued by Cloudflare's Origin CA" ;;
  *) echo "  ! this is not a Cloudflare Origin Certificate:" >&2
     echo "  !   ${subject}" >&2
     echo "  ! A publicly-trusted certificate belongs in 30-certificate.sh's path," >&2
     echo "  ! and a certificate from anywhere else has not been thought about." >&2
     exit 1 ;;
esac

# `openssl x509 -checkend` exits non-zero when the certificate expires within the
# given number of seconds. 30 days, because an Origin Certificate is issued for
# up to 15 years and one arriving with a month left is a sign the wrong file was
# downloaded, not a certificate nearing the end of an ordinary life.
if ! openssl x509 -in "$cert_file" -noout -checkend 2592000 >/dev/null 2>&1; then
  echo "  ! expires within 30 days (or has expired): $(openssl x509 -in "$cert_file" -noout -enddate)" >&2
  exit 1
fi
echo "   valid until $(openssl x509 -in "$cert_file" -noout -enddate | cut -d= -f2)"

step "it covers every name the load balancer serves"
sans=$(openssl x509 -in "$cert_file" -noout -ext subjectAltName 2>/dev/null \
  | tr ',' '\n' | sed -n 's/.*DNS://p' | tr -d ' ')
[ -n "$sans" ] || { echo "  ! the certificate carries no subjectAltName" >&2; exit 1; }
missing=""
for domain in $DOMAINS; do
  covered=no
  while read -r san; do
    [ -n "$san" ] || continue
    # A wildcard covers exactly one label: *.leonaqt.com matches www.leonaqt.com
    # and not leonaqt.com itself. Cloudflare's default Origin Certificate asks
    # for both, which is why this has to check them separately rather than
    # assuming the wildcard is enough.
    case "$san" in
      "$domain") covered=yes ;;
      '*.'*) [ "${domain#*.}" = "${san#\*.}" ] && [ "${domain%%.*}" != "$domain" ] && covered=yes ;;
    esac
  done <<EOF
$sans
EOF
  if [ "$covered" = yes ]; then echo "   ${domain}"; else missing="${missing} ${domain}"; fi
done
[ -z "$missing" ] || {
  echo "  ! the certificate does not cover:${missing}" >&2
  echo "  ! it carries: $(printf '%s' "$sans" | tr '\n' ' ')" >&2
  echo "  ! Re-issue it in Cloudflare with both leonaqt.com and *.leonaqt.com." >&2
  exit 1; }

step "the private key belongs to this certificate"
# Comparing public keys rather than RSA moduli: an Origin Certificate can be
# issued with an ECC key, and `openssl rsa -modulus` simply fails on one, which
# would read as "mismatch" for a perfectly good pair.
cert_pub=$(openssl x509 -in "$cert_file" -noout -pubkey 2>/dev/null | openssl md5)
key_pub=$(openssl pkey -in "$key_file" -pubout 2>/dev/null | openssl md5) || {
  echo "  ! ${key_file} is not a readable private key" >&2; exit 1; }
[ "$cert_pub" = "$key_pub" ] || {
  echo "  ! the key does not match the certificate — they are from different issuances" >&2
  exit 1; }
echo "   they match"

if [ "$dry_run" = yes ]; then
  echo
  echo "--dry-run: every check passed and nothing in Google Cloud was touched."
  exit 0
fi

# ---------------------------------------------------------------------------
# Upload, and point the map at it.
# ---------------------------------------------------------------------------
step "self-managed certificate ${CERT_NAME}"
if exists certificate-manager certificates describe "$CERT_NAME" --location=global; then
  have "$CERT_NAME"
  echo "   (to replace it with a re-issued pair, delete it first — a certificate's"
  echo "    contents are immutable, so an update is a delete and a create)"
else
  g certificate-manager certificates create "$CERT_NAME" \
    --certificate-file="$cert_file" --private-key-file="$key_file" --location=global >/dev/null
  made "$CERT_NAME"
fi

step "certificate map ${CERT_MAP_NAME}"
if exists certificate-manager maps describe "$CERT_MAP_NAME" --location=global; then
  have "$CERT_MAP_NAME"
else
  g certificate-manager maps create "$CERT_MAP_NAME" --location=global >/dev/null
  made "$CERT_MAP_NAME"
fi

# The map entries are what the HTTPS proxy actually consults, per hostname. If
# 30-certificate.sh ran first they already exist and point at the managed
# certificate, so this has to UPDATE them rather than skip them — a create-only
# guard here would leave the load balancer serving a certificate that is still
# PROVISIONING and report success.
step "map entries point at the origin certificate"
for domain in $DOMAINS; do
  entry="majorana-web-entry-$(printf '%s' "$domain" | tr '.' '-')"
  if exists certificate-manager maps entries describe "$entry" --map="$CERT_MAP_NAME" --location=global; then
    g certificate-manager maps entries update "$entry" --map="$CERT_MAP_NAME" \
      --certificates="$CERT_NAME" --location=global >/dev/null
    echo "   updated ${entry} -> ${CERT_NAME}"
  else
    g certificate-manager maps entries create "$entry" --map="$CERT_MAP_NAME" \
      --certificates="$CERT_NAME" --hostname="$domain" --location=global >/dev/null
    made "$entry"
  fi
done

cat <<TXT

------------------------------------------------------------------
Next: ./40-serve.sh, then the DNS records — PROXIED, orange cloud.

The certificate on this load balancer is trusted by Cloudflare and by
nothing else. Pointing leonaqt.com here without the orange cloud on
shows every visitor a certificate warning. ./90-verify.sh checks the
issuer and the proxy state, and refuses if they disagree.
------------------------------------------------------------------
TXT
