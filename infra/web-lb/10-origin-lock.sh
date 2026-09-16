#!/usr/bin/env bash
#
# Cloud Armor policy: only Cloudflare's edge may reach the load balancer.
#
# ## Why this and not a rate limit
#
# ai-ops 141 ruled Cloudflare in front for DNS and CDN with no WAF rules, and
# ai-ops 318 put the rate limit and bot rules at Cloudflare after the
# 15 September outage. So the rules live at the edge. What the edge cannot do is
# stop somebody who has found the origin's address from going straight to it and
# skipping every one of them — Cloudflare is not in that request's path at all.
# This closes that, and it is the whole job.
#
# ## The list is fetched, not pasted
#
# Cloudflare publishes its ranges at api.cloudflare.com/client/v4/ips and they
# change. A pasted copy is correct on the day it is pasted and silently refuses
# real visitors the day a range is added — which looks like an outage with no
# cause, because nothing in this project changed. Re-run this script to refresh
# them; it rewrites the rules in place.
#
# A Cloud Armor rule takes at most 10 source ranges, so the ranges are chunked
# across numbered rules. IPv4 and IPv6 are both included: Cloudflare connects to
# an origin over either.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

step "Cloudflare edge ranges"
ranges=$( { curl -fsS https://api.cloudflare.com/client/v4/ips \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("\n".join(d["ipv4_cidrs"]+d["ipv6_cidrs"]))'; } )
count=$(printf '%s\n' "$ranges" | grep -c .)
# A truncated or empty fetch would produce a policy that refuses everyone. The
# published list has been 20-odd entries for years; anything under 10 is a broken
# read, not a shrunken list.
[ "$count" -ge 10 ] || { echo "only ${count} ranges fetched — refusing to build a lock from that" >&2; exit 1; }
echo "   ${count} ranges"

step "security policy ${ARMOR_NAME}"
if exists compute security-policies describe "$ARMOR_NAME"; then
  have "$ARMOR_NAME"
else
  g compute security-policies create "$ARMOR_NAME" \
    --description "Only Cloudflare's edge may reach majorana-web (ai-ops 141, 318)" >/dev/null
  made "$ARMOR_NAME"
fi

step "allow rules"
priority=1000
printf '%s\n' "$ranges" | paste -sd, - | tr ',' '\n' | paste -d, - - - - - - - - - - 2>/dev/null \
  | sed 's/,*$//' | while read -r chunk; do
  [ -n "$chunk" ] || continue
  if exists compute security-policies rules describe "$priority" --security-policy "$ARMOR_NAME"; then
    g compute security-policies rules update "$priority" --security-policy "$ARMOR_NAME" \
      --src-ip-ranges "$chunk" --action allow >/dev/null
    echo "   updated rule ${priority}"
  else
    g compute security-policies rules create "$priority" --security-policy "$ARMOR_NAME" \
      --description "Cloudflare edge" --src-ip-ranges "$chunk" --action allow >/dev/null
    echo "   created rule ${priority}"
  fi
  priority=$((priority + 1))
done

step "default rule denies"
# Priority 2147483647 is the policy's built-in catch-all; updating it is what
# turns the allow rules above into a lock rather than a set of exceptions.
g compute security-policies rules update 2147483647 --security-policy "$ARMOR_NAME" \
  --action "deny-403" >/dev/null
echo "   default: deny-403"
