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
read -r cert_name cert_state <<EOF
$(serving_certificate)
EOF
case "$cert_state" in
  ACTIVE)       note OK   "certificate ${cert_name} ACTIVE (Google-managed)";;
  SELF_MANAGED) note OK   "certificate ${cert_name} in place (Cloudflare Origin, ai-ops 325)";;
  ABSENT)       note WARN "no certificate attached to the map yet (./30-certificate.sh or ./31-origin-certificate.sh)";;
  *)            note WARN "certificate ${cert_name} is ${cert_state} — not servable";;
esac

echo "== serving"
if exists compute forwarding-rules describe majorana-web-fr-443 --global; then
  note OK "forwarding rule on :443"
  IP=$(g compute addresses describe "$IP_NAME" --global --format='value(address)')

  # What the load balancer PRESENTS, read from the handshake rather than from the
  # Certificate Manager resource. The two can disagree — a map entry updated
  # while the proxy still serves the previous certificate — and the one a visitor
  # meets is this one, so this is the reading that counts.
  presented=$(openssl s_client -connect "${IP}:443" -servername leonaqt.com </dev/null 2>/dev/null \
    | openssl x509 -noout -issuer 2>/dev/null || true)
  presented_lc=$(printf '%s' "$presented" | tr '[:upper:]' '[:lower:]')
  is_origin=no
  case "$presented_lc" in *cloudflare*origin*) is_origin=yes;; esac

  # An Origin Certificate is trusted by Cloudflare and by nothing else, so the
  # honest probe from this machine has to skip verification — and then assert the
  # issuer separately, which is a stronger check than the trust store would have
  # made: it says WHICH certificate, not merely that some public CA vouched for
  # one.
  insecure=""; [ "$is_origin" = yes ] && insecure="-k"
  # shellcheck disable=SC2086
  code=$(curl -sS $insecure -o /dev/null -w '%{http_code}' --max-time 20 \
    --resolve "leonaqt.com:443:${IP}" https://leonaqt.com/ || echo 000)
  # A 403 here is the origin lock doing its job: this machine is not Cloudflare.
  case "$code" in 403) note OK  "load balancer answers, origin lock refuses a non-Cloudflare caller (403)";;
                  200) note WARN "load balancer answered 200 to a direct caller — the origin lock is not refusing";;
                  *)   note FAIL "load balancer returned ${code}";; esac

  if [ "$cert_state" = SELF_MANAGED ] && [ "$is_origin" != yes ]; then
    note FAIL "the map says Cloudflare Origin but the handshake presents: ${presented:-<no certificate>}"
  elif [ "$cert_state" = ACTIVE ] && [ "$is_origin" = yes ]; then
    note FAIL "the map says Google-managed but the handshake presents a Cloudflare Origin certificate"
  elif [ -n "$presented" ]; then
    note OK "presents ${presented#issuer=}"
  fi

  # ---------------------------------------------------------------------------
  # The failure this whole section exists to catch (ai-ops 325).
  #
  # An Origin Certificate is correct only where every request arrives through
  # Cloudflare. If leonaqt.com is pointed at this load balancer with the orange
  # cloud OFF, the address a visitor resolves is Google's, their browser is
  # handed a certificate signed by an authority it has never heard of, and the
  # site is a full-page TLS warning for everyone at once. Nothing on our side
  # errors, because our side is working exactly as configured.
  #
  # Read from DNS rather than from Cloudflare's API: what a visitor resolves is
  # the question, and a proxied name answers as a Cloudflare address, never as
  # the origin's.
  # ---------------------------------------------------------------------------
  if [ "$is_origin" = yes ]; then
    echo "== leonaqt.com is proxied, which an Origin Certificate requires"
    resolved=$(dig +short leonaqt.com A 2>/dev/null | grep -E '^[0-9]' | head -3 | tr '\n' ' ')
    if [ -z "$resolved" ]; then
      note WARN "leonaqt.com does not resolve to an A record from here"
    elif printf '%s' "$resolved" | grep -q "$IP"; then
      note FAIL "leonaqt.com resolves straight to the load balancer (${resolved}) while it serves an Origin Certificate — every visitor gets a certificate warning. Turn the orange cloud ON for @ and www."
    else
      note OK "leonaqt.com resolves to ${resolved}(not the origin), so it is proxied or still on Vercel"
    fi
  fi
else
  note WARN "not serving yet (./40-serve.sh, after the certificate is ACTIVE)"
fi

# ---------------------------------------------------------------------------
# Three things that are each fine alone and dangerous in a pair.
#
#   public + reachable directly   the whole site on a run.app URL, with no
#                                 Cloudflare, no rate limit and no origin lock.
#                                 40-serve.sh orders its two commands to avoid
#                                 this; deploy-web.yml re-asserts the ingress on
#                                 every deploy; this reads what is actually there.
#   public + the default identity every Cloud Run service can ask the metadata
#                                 server for its account's token, and the default
#                                 compute account holds roles/editor. On Vercel
#                                 the website held no cloud credential at all.
#   a public twin                 majorana-web-verify exists to be probed by CI
#                                 with an identity token. Public, it is the first
#                                 line of this list again under another name.
# ---------------------------------------------------------------------------
echo "== public only through the load balancer, and as nobody in particular"
is_public() { # <service>
  g run services get-iam-policy "$1" --region "$REGION" --format=json 2>/dev/null | python3 -c 'import json,sys
try: b=json.load(sys.stdin).get("bindings",[])
except Exception: b=[]
m={x for i in b if i.get("role")=="roles/run.invoker" for x in i.get("members",[])}
print("yes" if m & {"allUsers","allAuthenticatedUsers"} else "no")'
}
# Both web services since 2026-09-24 (25-atlas-bulkhead.sh): each is a whole
# copy of the site, so each must hold the same two properties.
images=""
for svc in $WEB_SERVICES; do
  svc_json=$(g run services describe "$svc" --region "$REGION" --format=json 2>/dev/null || true)
  if [ -z "$svc_json" ]; then
    if [ "$svc" = "$ATLAS_SERVICE" ]; then note FAIL "${svc} does not exist — ./25-atlas-bulkhead.sh"; else note FAIL "${svc} does not exist"; fi
    continue
  fi
  read -r ingress runs_as image <<EOF2
$(printf '%s' "$svc_json" | python3 -c 'import json,sys
d=json.load(sys.stdin); c=d["spec"]["template"]["spec"]
print(d["metadata"]["annotations"].get("run.googleapis.com/ingress","-"), c.get("serviceAccountName","-") or "-", c["containers"][0].get("image","-"))')
EOF2
  images="${images}${image}"$'\n'
  web_public=$(is_public "$svc")
  if [ -z "$ingress" ] || [ "$ingress" = "-" ]; then
    note FAIL "could not read ${svc}'s ingress setting"
  elif [ "$web_public" = yes ] && [ "$ingress" != "internal-and-cloud-load-balancing" ]; then
    note FAIL "${svc} is public with ingress '${ingress}' — it is reachable around Cloudflare"
  else
    note OK "${svc}: ingress ${ingress}; public: ${web_public}"
  fi
  case "$runs_as" in
    majorana-web-runtime@*) note OK "${svc} runs as ${runs_as} (no project roles — ./05-runtime-identity.sh checks that)";;
    *) if [ "$web_public" = yes ]; then
         note FAIL "${svc} is public and runs as ${runs_as:-the default compute account}, which holds roles/editor"
       else
         note WARN "${svc} runs as ${runs_as:-the default compute account}; the next deploy-web run moves it to majorana-web-runtime"
       fi;;
  esac
done
# A page rendered by one service asks the other for its JavaScript chunks by
# content hash; two images means chunks that 404. deploy-web.yml shifts both
# back to back, so this is only ever true for the length of two API calls.
if [ "$(printf '%s' "$images" | sort -u | grep -c .)" -gt 1 ]; then
  note FAIL "the web services are on different images: $(printf '%s' "$images" | sed 's#.*/##' | tr '\n' ' ')"
elif [ -n "$images" ]; then
  note OK "both web services on one image ($(printf '%s' "$images" | head -1 | sed 's#.*/##'))"
fi
if exists run services describe majorana-web-verify --region "$REGION"; then
  case "$(is_public majorana-web-verify)" in
    no) note OK "the smoke-test twin is private";;
    *)  note FAIL "majorana-web-verify is PUBLIC — it serves the site with nothing in front of it";;
  esac
else
  note WARN "no smoke-test twin yet (./07-verify-twin.sh); deploy-web.yml needs it"
fi

echo "== the Atlas bulkhead (25-atlas-bulkhead.sh)"
for r in "compute network-endpoint-groups describe ${ATLAS_NEG_NAME} --region ${REGION}" \
         "compute backend-services describe ${ATLAS_BACKEND_NAME} --global"; do
  if exists $r; then note OK "${r%% describe*} ${r#* describe }"; else note FAIL "missing: $r"; fi
done
attached=$(g compute backend-services describe "$ATLAS_BACKEND_NAME" --global --format='value(securityPolicy)' 2>/dev/null || true)
case "$attached" in *"$ARMOR_NAME") note OK "${ATLAS_BACKEND_NAME} carries the origin lock";;
  *) note FAIL "${ATLAS_BACKEND_NAME} has no origin lock (${attached:-none}) — it would serve anyone who found the address";; esac
for b in "$BACKEND_NAME" "$ATLAS_BACKEND_NAME"; do
  logging=$(g compute backend-services describe "$b" --global --format='value(logConfig.enable)' 2>/dev/null || true)
  case "$logging" in True|true) note OK "${b}: request logging on";;
    *) note FAIL "${b}: request logging off — Cloud Armor's decisions and the 2026-09-24 kind of incident leave no record";; esac
done
g compute url-maps describe "$URLMAP_NAME" --format=json > /tmp/.urlmap.$$ 2>/dev/null || true
if python3 - /tmp/.urlmap.$$ "$ATLAS_BACKEND_NAME" "$BACKEND_NAME" $ATLAS_PATHS <<'PY'
import json,sys
path,atlas,site,*want=sys.argv[1:]
try: d=json.load(open(path))
except Exception: print("  FAIL   could not read the url map"); raise SystemExit(1)
routed={}
for pm in d.get("pathMatchers",[]):
    for rule in pm.get("pathRules",[]):
        for p in rule.get("paths",[]): routed[p]=rule.get("service","").rsplit("/",1)[-1]
bad=[p for p in want if routed.get(p)!=atlas]
default=d.get("defaultService","").rsplit("/",1)[-1]
hosts=[h for hr in d.get("hostRules",[]) for h in hr.get("hosts",[])]
ok=True
if bad: print("  FAIL   not routed to the Atlas backend:", " ".join(bad)); ok=False
else: print(f"  OK     {len(want)} Atlas paths routed to {atlas}")
if default!=site: print(f"  FAIL   default service is {default}, not {site}"); ok=False
if want and "*" not in hosts: print("  FAIL   the Atlas rule applies to hosts", hosts, "not every host"); ok=False
raise SystemExit(0 if ok else 1)
PY
then :; else fail=1; fi
rm -f /tmp/.urlmap.$$

echo "== per-visitor limits (15-visitor-limits.sh)"
g compute security-policies describe "$ARMOR_NAME" --format=json > /tmp/.armor2.$$ 2>/dev/null || true
if python3 - /tmp/.armor2.$$ <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1])); d=d[0] if isinstance(d,list) else d
except Exception: print("  FAIL   could not read the policy"); raise SystemExit(1)
allow=set(x for r in d["rules"] if r["action"]=="allow" for x in r["match"]["config"]["srcIpRanges"])
thr=[r for r in d["rules"] if r["action"]=="throttle"]
if not thr: print("  WARN   no per-visitor throttle rules — nothing at the origin counts by visitor"); raise SystemExit(0)
ranges=set(x for r in thr for x in r["match"]["config"]["srcIpRanges"])
ok=True
# A throttle's conforming action is allow, so a range here that the lock does
# not allow is a hole in the lock, not a stricter rule.
extra=ranges-allow
if extra: print("  FAIL   throttle rules admit ranges the origin lock does not:", ", ".join(sorted(extra))); ok=False
if allow-ranges: print("  WARN   Cloudflare ranges with no per-visitor limit:", ", ".join(sorted(allow-ranges)))
for r in thr:
    o=r.get("rateLimitOptions",{}); key=o.get("enforceOnKey"); name=o.get("enforceOnKeyName","")
    if key!="HTTP_HEADER" or name.lower()!="cf-connecting-ip":
        print(f"  FAIL   rule {r['priority']} keys on {key} {name} — behind Cloudflare that is one bucket per data centre, not per visitor"); ok=False
th=o.get("rateLimitThreshold",{})
mode="PREVIEW (log only)" if all(r.get("preview") for r in thr) else ("ENFORCED" if not any(r.get("preview") for r in thr) else "MIXED")
if mode=="MIXED": print("  FAIL   some throttle rules are in preview and some are not"); ok=False
elif ok: print(f"  OK     {len(thr)} rules, {th.get('count')}/{th.get('intervalSec')}s per cf-connecting-ip, {mode}")
raise SystemExit(0 if ok else 1)
PY
then :; else fail=1; fi
rm -f /tmp/.armor2.$$

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
# Relative to HERE, not to "$0": line 12 already changed into this directory, so
# resolving "$0" again doubles a relative path (`infra/web-lb/90-verify.sh` run
# from the repo root looked for infra/web-lb/infra/web-lb/../fleet.env). grep
# then exited 2 under `set -e` with its stderr discarded, and the script died
# here silently — after printing every earlier OK and before "all checks
# passed". Found on the post-cutover read-back, 2026-09-20.
fleet="../fleet.env"
[ -r "$fleet" ] || note FAIL "cannot read ${fleet} from $(pwd)"
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
