#!/usr/bin/env bash
#
# Which container images a live Cloud Run service would still need, and whether
# the registry cleanup policy would delete one of them.
#
# ## The hole this closes
#
# 10-artifact-cleanup.sh argued that only a rollback is at risk, because "a
# running Cloud Run revision has its image; deleting the image does not stop it."
# That is true of a revision with an instance running. It is false of a service
# that scales to zero, and this project has one: `majorana-api-vqe-test` serves
# 100% of its traffic from revision -00003-ttr, has no minimum instance count,
# and has not been redeployed since 2026-07-28. Its image is 51 days old, so the
# policy's "delete anything older than 30 days" reaches it while its "keep the
# newest 40" does not, there being 729 newer API images. Nothing is running, so
# nothing holds the image. The next request to that service would cold-start a
# revision whose image no longer exists.
#
# The failure is quiet in the way that matters: the service keeps reporting a
# healthy serving revision, the registry reports a successful cleanup, and the
# two only meet when somebody makes a request.
#
# An Artifact Registry cleanup policy cannot be told "except the ones in use" —
# it reasons about age, count and tags, and knows nothing about Cloud Run. So the
# check has to sit outside it, which is what this is.
#
#   ./05-in-use-images.sh            # list what is in use, and how old each is
#   ./05-in-use-images.sh --check    # exit 1 if the policy would delete one
#
# 10-artifact-cleanup.sh --enforce runs the --check form first and refuses if it
# fails.
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

CHECK=0
for a in "$@"; do [ "$a" = "--check" ] && CHECK=1; done

# The thresholds are read from the policy that is actually APPLIED to the
# repository, not from a copy in this repo. 10-artifact-cleanup.sh builds its
# policy into a temporary file and applies it, so there is no file on disk to
# read, and a restated pair of numbers here is a pair that drifts silently the
# first time somebody tunes the other script.
# An explicitly-set KEEP_DAYS wins over the live policy. That is not a test
# hook: "would a 60-day window clear this?" is the question an operator actually
# asks when this refuses, and answering it by editing the live policy first is
# the wrong order.
KEEP_DAYS_OVERRIDE="${KEEP_DAYS:-}"
KEEP_COUNT=""; KEEP_DAYS=""
live=$(api "https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/repositories/majorana" 2>/dev/null || true)
if [ -n "$live" ]; then
  read -r KEEP_COUNT KEEP_DAYS DRYRUN <<EOF
$(printf '%s' "$live" | python3 -c '
import json,sys,re
d=json.load(sys.stdin)
pol=d.get("cleanupPolicies") or {}
count=days=0
for rule in pol.values():
    cond=rule.get("mostRecentVersions") or {}
    if "keepCount" in cond: count=max(count,int(cond["keepCount"]))
    c=rule.get("condition") or {}
    # Artifact Registry returns these as a protobuf Duration in SECONDS
    # ("2592000s"), even though the policy was written as "30d" and gcloud
    # accepts "30d". Reading the leading digits gives 2592000 DAYS, a threshold
    # nothing can ever fall outside, so the check passes everything.
    for field in ("newerThan","olderThan"):
        raw=str(c.get(field) or "")
        m=re.match(r"(\d+)([sdhm]?)", raw)
        if not m: continue
        n=int(m.group(1)); unit=m.group(2) or "s"
        days=max(days, n//86400 if unit=="s" else n if unit=="d" else n//24 if unit=="h" else n//1440)
print(count or 40, days or 30, "dry-run" if d.get("cleanupPolicyDryRun") else "ENFORCING")
')
EOF
fi
[ -n "$KEEP_COUNT" ] || { KEEP_COUNT=40; KEEP_DAYS=30; DRYRUN="unknown"; }
echo "live policy: ${DRYRUN:-unknown}"
if [ -n "$KEEP_DAYS_OVERRIDE" ]; then
  KEEP_DAYS="$KEEP_DAYS_OVERRIDE"
  echo "KEEP_DAYS overridden to ${KEEP_DAYS} — this is a what-if, not the applied policy"
fi
echo "policy thresholds: keep newest ${KEEP_COUNT} per package, keep anything under ${KEEP_DAYS} days old"

# ---------------------------------------------------------------------------
# What is in use.
#
# "In use" is wider than "serving": a revision with 0% traffic that is
# latestReady is what the next deploy rolls back to, and a tagged revision is one
# somebody made addressable on purpose. All three are kept.
# ---------------------------------------------------------------------------
step "images a live revision still needs"
services=$(g run services list --region="$REGION" --format='value(metadata.name)')
[ -n "$services" ] || { echo "  ! no Cloud Run services found — refusing to conclude nothing is in use" >&2; exit 1; }

inuse=$(mktemp); trap 'rm -f "$inuse"' EXIT
for svc in $services; do
  revs=$(g run services describe "$svc" --region="$REGION" \
    --format='value[separator=" "](status.traffic[].revisionName, status.latestReadyRevisionName)' 2>/dev/null \
    | tr ' ;' '\n\n' | sed '/^$/d' | sort -u)
  for rev in $revs; do
    img=$(g run revisions describe "$rev" --region="$REGION" \
      --format='value(spec.containers[0].image)' 2>/dev/null || true)
    [ -n "$img" ] || continue
    created=$(g run revisions describe "$rev" --region="$REGION" \
      --format='value(metadata.creationTimestamp)' 2>/dev/null || true)
    printf '%s\t%s\t%s\t%s\n' "$svc" "$rev" "$img" "$created" >> "$inuse"
  done
done

# Age is the IMAGE's, not the revision's. A revision created today can run an
# image built months ago — which is exactly the case that bites, so reading the
# revision's own timestamp here would report the wrong number and pass.
fail=0
while IFS=$'\t' read -r svc rev img created; do
  digest="${img##*@}"
  repo="${img%@*}"
  # `gcloud artifacts docker images describe` prints an image_summary that
  # carries no timestamp of any kind, so reading a time field off it returns
  # EMPTY for an image that is present and healthy — indistinguishable, to the
  # caller, from an image that has been deleted. The first version of this
  # reported all six live images as "already gone". The version resource is the
  # one that carries createTime, and a 404 from it is a real absence.
  pkg="${repo##*/}"
  ver=$(api "https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/repositories/majorana/packages/${pkg}/versions/${digest}" 2>/dev/null || true)
  if [ -z "$ver" ]; then
    printf '  %-26s %-34s %s\n' "$svc" "${digest:0:19}" "NOT IN THE REGISTRY — a live revision needs an image that is already gone"
    fail=1; continue
  fi
  uploaded=$(printf '%s' "$ver" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("createTime",""))')
  age_days=$(python3 - "$uploaded" <<'PY'
import sys,datetime
raw=sys.argv[1].strip().replace("Z","+00:00")
try: t=datetime.datetime.fromisoformat(raw)
except ValueError: print(-1); raise SystemExit
print((datetime.datetime.now(datetime.timezone.utc)-t).days)
PY
)
  if [ "$age_days" -lt 0 ]; then
    printf '  %-26s %-34s %s\n' "$svc" "${digest:0:19}" "could not read an upload time"
    fail=1; continue
  fi
  if [ "$age_days" -gt "$KEEP_DAYS" ]; then
    printf '  %-26s %-34s %s\n' "$svc" "${digest:0:19}" "${age_days}d old — OUTSIDE the ${KEEP_DAYS}d keep window"
    echo "        revision ${rev}, image ${repo##*/}"
    fail=1
  else
    printf '  %-26s %-34s %s\n' "$svc" "${digest:0:19}" "${age_days}d old — within the keep window"
  fi
done < "$inuse"

# A digest outside the age window survives only if it is among the newest
# KEEP_COUNT of its package, and that is a question about the whole repository
# rather than about this image. Rather than paginate the registry to answer it,
# this refuses on the age window alone: the only way to be wrong is to refuse a
# cleanup that would in fact have been safe, which costs a day and some disk.
echo
if [ "$fail" = 0 ]; then
  echo "every image a live revision needs is inside the keep window"
  exit 0
fi

cat <<'TXT'
An image a LIVE revision still needs falls outside the cleanup policy's keep
window. Enforcing the policy could delete it, and the service would fail on its
next cold start rather than immediately, because a running instance holds its
own image and a scaled-to-zero service holds nothing.

Two ways out, neither of them widening the policy:
  - redeploy that service so its serving revision runs a current image, or
  - delete the service, if it is dead. `majorana-api-vqe-test` is the known
    case: it answers to anyone, points at a collaborator's Vercel preview and a
    database secret that no longer exists, and measured zero billable instance
    time in the last seven days. Its creator confirms first — it is not ours.
TXT
[ "$CHECK" = 1 ] && exit 1
exit 0
