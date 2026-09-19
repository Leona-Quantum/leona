#!/usr/bin/env bash
#
# Drive `require_servable_certificate` through every state it can meet, with no
# Google Cloud behind it.
#
# ## Why this exists
#
# That function is the gate between "a load balancer nobody reaches" and "a
# public website". It has four outcomes and three of them are refusals, so in
# ordinary use it is only ever seen doing the one thing that is not a refusal —
# and a guard nobody has watched go red has not been shown to be a guard. One of
# its branches was written precisely because an earlier version compared an empty
# string with "ACTIVE" and would have refused forever against a certificate that
# was in place and fine. That bug is invisible to any test that only runs the
# happy path.
#
# `serving_certificate` and `g` are replaced with stubs, so this touches nothing,
# needs no credentials, and runs in well under a second.
set -uo pipefail
cd "$(dirname "$0")"

# shellcheck disable=SC1091
. ./common.sh
set +e   # common.sh sets -e; a test harness has to survive its own failures

pass=0; fail=0
check() { # <name> <expected-rc> <expected-substring-or-emptystring>
  local name="$1" want_rc="$2" want="$3" out rc
  out=$(require_servable_certificate 2>&1); rc=$?
  if [ "$rc" != "$want_rc" ]; then
    printf 'FAIL  %s: exit %s, wanted %s\n      %s\n' "$name" "$rc" "$want_rc" "$out"; fail=$((fail+1)); return
  fi
  if [ -n "$want" ] && ! printf '%s' "$out" | grep -qF "$want"; then
    printf 'FAIL  %s: output did not mention %s\n      %s\n' "$name" "$want" "$out"; fail=$((fail+1)); return
  fi
  printf 'ok    %s\n' "$name"; pass=$((pass+1))
}

# --- the stubs -------------------------------------------------------------
STUB_CERT="majorana-web-cert SELF_MANAGED"
STUB_POLICY="$ARMOR_NAME"
serving_certificate() { echo "$STUB_CERT"; }
g() { # only `compute backend-services describe` is consulted by the gate
  case "$*" in *"backend-services describe"*) echo "$STUB_POLICY" ;; *) return 0 ;; esac
}

# --- the four states -------------------------------------------------------
STUB_CERT="majorana-web-cert ACTIVE"
check "a Google-managed certificate at ACTIVE serves" 0 "ACTIVE (Google-managed)"

STUB_CERT="majorana-web-origin-cert SELF_MANAGED"; STUB_POLICY="$ARMOR_NAME"
check "a Cloudflare Origin certificate with the origin lock serves" 0 "Cloudflare Origin"

# The case this gate exists for: an Origin certificate is trusted by Cloudflare
# and nothing else, so without the lock the load balancer would be publicly
# reachable holding a certificate no browser accepts.
STUB_CERT="majorana-web-origin-cert SELF_MANAGED"; STUB_POLICY=""
check "an Origin certificate WITHOUT the origin lock refuses" 1 "no origin lock"

STUB_CERT="majorana-web-origin-cert SELF_MANAGED"; STUB_POLICY="some-other-policy"
check "an Origin certificate behind the WRONG policy refuses" 1 "no origin lock"

STUB_CERT="majorana-web-cert PROVISIONING"
check "a certificate still PROVISIONING refuses" 1 "not servable"

STUB_CERT="majorana-web-cert FAILED"
check "a certificate that FAILED refuses" 1 "not servable"

STUB_CERT="none ABSENT"
check "no certificate at all refuses" 1 "not servable"

# The regression the SELF_MANAGED branch was written for: a self-managed
# certificate reports an EMPTY managed.state, which an `!= ACTIVE` comparison
# reads as a failure. If somebody rewrites the gate that way, this is the line
# that goes red — the two cases above cannot tell the difference on their own,
# because both refuse.
STUB_CERT="majorana-web-origin-cert SELF_MANAGED"; STUB_POLICY="$ARMOR_NAME"
check "SELF_MANAGED is not treated as 'not ACTIVE'" 0 "origin lock attached"

echo
printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
