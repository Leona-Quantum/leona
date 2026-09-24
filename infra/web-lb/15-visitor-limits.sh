#!/usr/bin/env bash
#
# Per-visitor rate limits at the origin, counted by the visitor's real address.
#
#   ./15-visitor-limits.sh            # write the rules in PREVIEW (log only)
#   ENFORCE=1 ./15-visitor-limits.sh  # the same rules, enforced
#
# ## Why these exist (2026-09-24)
#
# Until this script, nothing at the origin counted per visitor. Cloudflare's
# "Atlas crawl limit" counts per IP but only on /repository*, and the one
# limit Google enforced was Cloud Run's instance ceiling — a single counter
# shared by every visitor, which on 2026-09-24 refused the home page to
# everybody because one crawler was asking for the map. See
# ai-ops/desk/leona/plans/incidents/2026-09-24-gcp-web-429.md.
#
# ## Which address is counted, and why it can be believed here
#
# The load balancer's peer is always a Cloudflare edge (the origin lock refuses
# anything else), so keying on the peer would put a whole Cloudflare data
# centre's visitors in one bucket. The visitor's address is in
# `cf-connecting-ip`, which Cloudflare strips and rewrites on every request it
# proxies — but which anybody can write when they reach the load balancer
# directly. So these rules match ONLY Cloudflare's source ranges (the same
# ranges as the origin lock's allow rules, read from the policy itself so the
# two can never drift), and only then key on the header. A request from
# anywhere else never matches them and falls through to the lock's default
# deny. A header-less request from Cloudflare cannot happen; if one did, Cloud
# Armor puts every header-less request in one shared bucket (its documented
# fallback for a missing HTTP-HEADER key), which fails towards refusing, not
# towards letting through.
#
# ## Why a throttle rule cannot carry a path condition here
#
# A throttle's conforming action is `allow`, and `allow` ends evaluation. So a
# throttle whose match is a path expression would ADMIT a non-Cloudflare caller
# that matched the path, and punch a hole in the origin lock for that path.
# Cloudflare's 22 ranges cannot be written into one rule expression either, and
# `origin.asn == 13335` is wider than the published ranges (it includes WARP's
# egress, 104.28.0.0/16, which is not an edge). So the path-specific shedding
# lives where it can be exact: the Atlas has its own service
# (25-atlas-bulkhead.sh), and Cloudflare holds the edge rules.
#
# ## The number
#
# THRESHOLD requests per INTERVAL seconds per visitor address, across all paths
# that reach the origin (Cloudflare serves cached pages and static chunks
# without asking). 1200/60 s is 20 a second, sustained for a minute, from one
# address — roughly ten times one person exploring the map as fast as they can
# click (measured, see the incident note §5), so a classroom behind one NAT
# stays under it, and a single-address flood does not. It is the backstop for
# one address; a crawler spread across many is Cloudflare's to challenge.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

THRESHOLD="${THRESHOLD:-1200}"
INTERVAL="${INTERVAL:-60}"
FIRST_PRIORITY=900
mode="--preview"; label="PREVIEW (log only)"
[ "${ENFORCE:-0}" = "1" ] && { mode="--no-preview"; label="ENFORCED"; }

step "the origin lock's Cloudflare ranges, read from ${ARMOR_NAME}"
chunks=$(g compute security-policies describe "$ARMOR_NAME" --format=json | python3 -c '
import json,sys
d=json.load(sys.stdin); d=d[0] if isinstance(d,list) else d
rules=sorted((r for r in d["rules"] if r["action"]=="allow" and 1000<=r["priority"]<1100), key=lambda r:r["priority"])
for r in rules: print(",".join(r["match"]["config"]["srcIpRanges"]))')
n=$(printf '%s\n' "$chunks" | grep -c . || true)
# Same floor as 10-origin-lock.sh: Cloudflare publishes 20-odd ranges, three
# chunks of up to ten. Fewer than two chunks means the read broke, and a
# throttle set built from a broken read would leave most of Cloudflare's edge
# unthrottled rather than refused, which is quiet in exactly the wrong way.
[ "$n" -ge 2 ] || { echo "only ${n} allow chunks read from ${ARMOR_NAME}; run ./10-origin-lock.sh first" >&2; exit 1; }
echo "   ${n} chunks"

step "per-visitor throttle, ${THRESHOLD}/${INTERVAL}s keyed on cf-connecting-ip — ${label}"
priority=$FIRST_PRIORITY
while read -r chunk; do
  [ -n "$chunk" ] || continue
  common=(--security-policy "$ARMOR_NAME" --src-ip-ranges "$chunk"
          --action throttle --conform-action allow --exceed-action deny-429
          --rate-limit-threshold-count "$THRESHOLD" --rate-limit-threshold-interval-sec "$INTERVAL"
          --enforce-on-key HTTP-HEADER --enforce-on-key-name cf-connecting-ip
          --description "Per-visitor limit via Cloudflare (2026-09-24 incident); 15-visitor-limits.sh" $mode)
  if exists compute security-policies rules describe "$priority" --security-policy "$ARMOR_NAME"; then
    g compute security-policies rules update "$priority" "${common[@]}" >/dev/null
    echo "   updated rule ${priority}"
  else
    g compute security-policies rules create "$priority" "${common[@]}" >/dev/null
    echo "   created rule ${priority}"
  fi
  priority=$((priority + 1))
done <<EOF
$chunks
EOF

step "no stale throttle rules above ${priority}"
# If Cloudflare's list shrinks by a chunk, a leftover rule would keep ADMITTING
# ranges the lock no longer allows (a throttle's conforming action is allow).
for p in $(seq "$priority" $((FIRST_PRIORITY + 20))); do
  if exists compute security-policies rules describe "$p" --security-policy "$ARMOR_NAME"; then
    g compute security-policies rules delete "$p" --security-policy "$ARMOR_NAME" --quiet >/dev/null
    echo "   removed stale rule ${p}"
  fi
done
echo "   done"

cat <<TXT

Read what the rules decided (preview decisions are logged, not applied):
  gcloud logging read 'resource.type="http_load_balancer" AND
    (jsonPayload.previewSecurityPolicy.priority>=900 OR jsonPayload.enforcedSecurityPolicy.priority>=900)
    AND (jsonPayload.previewSecurityPolicy.priority<1000 OR jsonPayload.enforcedSecurityPolicy.priority<1000)' \\
    --project ${PROJECT} --freshness=1h --limit 20 \\
    --format='value(timestamp,jsonPayload.previewSecurityPolicy.outcome,jsonPayload.enforcedSecurityPolicy.outcome,jsonPayload.enforcedSecurityPolicy.rateLimitAction.key,jsonPayload.previewSecurityPolicy.rateLimitAction.key)'
TXT
