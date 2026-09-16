#!/usr/bin/env bash
#
# Read back what is actually in Google Cloud and compare it with what the other
# scripts were supposed to create. Safe to run at any time; changes nothing.
#
# The origin lock is checked against Cloudflare's LIVE published list rather than
# against a copy, because the failure mode is a range Cloudflare added after the
# policy was written: the policy is internally consistent, every rule is present,
# and some fraction of real visitors get a 403 from an origin that looks healthy.
# Comparing the policy with itself cannot see that.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

fail=0
note() { printf '  %-6s %s\n' "$1" "$2"; [ "$1" = "FAIL" ] && fail=1; return 0; }

echo "== origin lock vs Cloudflare's published ranges"
g compute security-policies describe "$ARMOR_NAME" --format=json > /tmp/.armor.$$ 2>/dev/null || {
  note FAIL "security policy ${ARMOR_NAME} is absent"; }
if [ -s /tmp/.armor.$$ ]; then
  python3 - /tmp/.armor.$$ <<'PY'
import json,sys,urllib.request
raw=json.load(open(sys.argv[1])); d=raw[0] if isinstance(raw,list) else raw
allow=[r for r in d["rules"] if r["action"]=="allow"]
inpol=set(x for r in allow for x in r["match"]["config"]["srcIpRanges"])
default=[r for r in d["rules"] if r["priority"]==2147483647]
live=json.load(urllib.request.urlopen("https://api.cloudflare.com/client/v4/ips"))["result"]
want=set(live["ipv4_cidrs"]+live["ipv6_cidrs"])
missing, extra = want-inpol, inpol-want
print(f'  {"OK  " if not missing else "FAIL"}   {len(inpol)} allowed ranges; Cloudflare publishes {len(want)}')
if missing: print("  FAIL   ranges Cloudflare added that this policy refuses:", ", ".join(sorted(missing)))
if extra:   print("  WARN   ranges allowed that Cloudflare no longer publishes:", ", ".join(sorted(extra)))
act = default[0]["action"] if default else "<absent>"
print(f'  {"OK  " if act.startswith("deny") else "FAIL"}   default rule: {act}')
raise SystemExit(1 if (missing or not act.startswith("deny")) else 0)
PY
  [ $? -eq 0 ] || fail=1
fi
rm -f /tmp/.armor.$$

echo "== load balancer"
for r in "compute addresses describe ${IP_NAME} --global" \
         "compute network-endpoint-groups describe ${NEG_NAME} --region ${REGION}" \
         "compute backend-services describe ${BACKEND_NAME} --global" \
         "compute url-maps describe ${URLMAP_NAME}" \
         "compute url-maps describe ${REDIRECT_URLMAP_NAME}"; do
  # shellcheck disable=SC2086
  if exists $r; then note OK "${r%% describe*} ${r#* describe }"; else note FAIL "missing: $r"; fi
done

echo "== the backend carries the origin lock"
attached=$(g compute backend-services describe "$BACKEND_NAME" --global --format='value(securityPolicy)' 2>/dev/null || true)
case "$attached" in *"$ARMOR_NAME") note OK "security policy attached";; *) note FAIL "backend has no origin lock (${attached:-none})";; esac

echo "== Cloud CDN is off (the CDN is Cloudflare — see README.md)"
cdn=$(g compute backend-services describe "$BACKEND_NAME" --global --format='value(enableCDN)' 2>/dev/null || true)
case "$cdn" in True|true) note FAIL "Cloud CDN is enabled; that is a second cache in front of Cloudflare's";; *) note OK "Cloud CDN off";; esac

echo "== certificate"
state=$(g certificate-manager certificates describe majorana-web-cert --location=global --format='value(managed.state)' 2>/dev/null || true)
case "$state" in
  ACTIVE) note OK "certificate ACTIVE";;
  "")     note WARN "certificate not created yet (./30-certificate.sh)";;
  *)      note WARN "certificate ${state} — the DNS records from ./30-certificate.sh may not be in place";;
esac

echo "== serving"
if exists compute forwarding-rules describe majorana-web-fr-443 --global; then
  note OK "forwarding rule on :443"
  IP=$(g compute addresses describe "$IP_NAME" --global --format='value(address)')
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --resolve "leonaqt.com:443:${IP}" https://leonaqt.com/ || echo 000)
  # A 403 here is the origin lock doing its job: this machine is not Cloudflare.
  case "$code" in 403) note OK  "load balancer answers, origin lock refuses a non-Cloudflare caller (403)";;
                  200) note WARN "load balancer answered 200 to a direct caller — the origin lock is not refusing";;
                  *)   note FAIL "load balancer returned ${code}";; esac
else
  note WARN "not serving yet (./40-serve.sh, after the certificate is ACTIVE)"
fi

# ---------------------------------------------------------------------------
# The one setting that has to move at the same moment the load balancer does.
#
# WEB_XFF_TRUSTED_HOPS says how many x-forwarded-for entries Google appends to
# the right of the address that connected. On a bare Cloud Run URL that is 0;
# behind the load balancer it is 1, because the load balancer appends the peer
# and then itself. Getting it wrong does not error — too low meters visitors by a
# value the caller wrote, too high meters everyone as one bucket.
#
# infra/fleet.env says to change it "in the same commit that creates the load
# balancer". A sentence in a file is not a checker, and this is precisely the
# shape of rule that gets read, agreed with, and then not done — so the fact that
# forwarding rules now exist is checked against the number the deploy actually
# ships.
# ---------------------------------------------------------------------------
echo "== the forwarding-hop count matches the topology"
fleet="$(dirname "$0")/../fleet.env"
hops=$(grep -E '^WEB_XFF_TRUSTED_HOPS=[0-9]+$' "$fleet" 2>/dev/null | cut -d= -f2)
serving_via_lb=no
exists compute forwarding-rules describe majorana-web-fr-443 --global && serving_via_lb=yes
live=$(g run services describe "$SERVICE" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].env.filter("name:LEONA_XFF_TRUSTED_HOPS").extract("value"))' 2>/dev/null | tr -d "[]'" )
if [ -z "$hops" ]; then
  note FAIL "WEB_XFF_TRUSTED_HOPS is missing from ${fleet} or is not a plain integer"
elif [ "$serving_via_lb" = yes ] && [ "$hops" != "1" ]; then
  note FAIL "the load balancer is serving but WEB_XFF_TRUSTED_HOPS is ${hops} — it must be 1, or the rate limiter meters a value the caller writes"
elif [ "$serving_via_lb" = no ] && [ "$hops" != "0" ]; then
  note FAIL "no forwarding rule exists but WEB_XFF_TRUSTED_HOPS is ${hops} — it must be 0 until the load balancer is in front, or every visitor shares one bucket"
else
  note OK "WEB_XFF_TRUSTED_HOPS=${hops} matches the topology (load balancer serving: ${serving_via_lb})"
fi
if [ -n "$live" ] && [ "$live" != "$hops" ]; then
  note FAIL "the running service has LEONA_XFF_TRUSTED_HOPS=${live} but fleet.env says ${hops} — the deploy has not caught up"
elif [ -n "$live" ]; then
  note OK "the running service agrees: LEONA_XFF_TRUSTED_HOPS=${live}"
fi

echo
[ "$fail" -eq 0 ] && echo "all checks passed" || { echo "FAILURES above"; exit 1; }
