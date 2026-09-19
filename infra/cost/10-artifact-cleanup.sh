#!/usr/bin/env bash
#
# Stop the container registry growing without bound.
#
# ## The measurement
#
# Read 2026-09-16: the `majorana` repository holds 88.2 GB across 732 images -
# 728 of them the API, 4 the web app - and has NO cleanup policy. 47 new images
# arrived in the seven days before that reading, about 8 GB. At $0.10/GB/month
# past the first half gigabyte that is ~$8.80/month today and roughly a dollar
# more every month, for build output nothing will ever pull again.
#
# ## Why a policy and not a delete loop
#
# Artifact Registry evaluates Keep rules before Delete rules, so "keep the most
# recent N" cannot be overruled by "delete older than 30 days" - the newest N
# survive whatever their age. That ordering is the whole safety argument, and a
# hand-rolled loop would have to reimplement it correctly on every run.
#
# ## What is actually at risk
#
# A rollback, and one case this paragraph originally missed. A running Cloud Run
# revision has its image, so deleting the image does not stop it; what breaks is
# STARTING a revision whose image is gone. A rollback does that. So does an
# ordinary first request to a service that has scaled to zero, because nothing is
# running and nothing holds the image - and `majorana-api-vqe-test` is exactly
# that: it serves 100% of its traffic from a revision whose image is 51 days old,
# well outside this policy's keep window. The category "only a rollback" was the
# right intuition for a warm service and wrong for a cold one, which is why
# 05-in-use-images.sh now reads the live services rather than reasoning about
# them, and why --enforce below runs it first.
#
#   ./10-artifact-cleanup.sh              # set the policy in DRY RUN (deletes nothing)
#   ./10-artifact-cleanup.sh --enforce    # let it actually delete
#
# --enforce refuses unless ./05-in-use-images.sh --check passes.
#
# Dry run is not a formality here. Artifact Registry logs what the policy WOULD
# remove, so a day in dry run turns "it should free most of 88 GB" into a number
# read off the service. Check it before enforcing:
#
#   gcloud artifacts docker images list us-west1-docker.pkg.dev/majorana-core/majorana \
#     --format='value(package)' | wc -l    # before, and again after
#
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

KEEP_COUNT="${KEEP_COUNT:-40}"
KEEP_DAYS="${KEEP_DAYS:-30}"

POLICY=$(mktemp)
STATE_JSON=$(mktemp)
trap 'rm -f "$POLICY" "$STATE_JSON"' EXIT
cat > "$POLICY" <<JSON
[
  {
    "name": "keep-recent",
    "action": {"type": "Keep"},
    "mostRecentVersions": {"keepCount": ${KEEP_COUNT}}
  },
  {
    "name": "keep-anything-recent",
    "action": {"type": "Keep"},
    "condition": {"newerThan": "${KEEP_DAYS}d"}
  },
  {
    "name": "delete-the-rest",
    "action": {"type": "Delete"},
    "condition": {"olderThan": "${KEEP_DAYS}d"}
  }
]
JSON
python3 -c "import json,sys; json.load(open('$POLICY')); print('   policy parses')"

# Reads the repository JSON and prints size + policy names. A `python3 -c`
# one-liner cannot carry both the shell's quoting and an f-string's own quotes
# without one of them winning; a script file has no such fight.
repo_state() {
  api "https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/repositories/${REPO}" \
    > "$STATE_JSON"
  python3 ./_repo_state.py "$STATE_JSON"
}
step "repository before"
repo_state

# The gate, before the policy stops being a dry run. It reads what the live
# services are actually running rather than reasoning about what they ought to
# be, because the thing that goes wrong here is a service nobody has thought
# about in seven weeks.
if [ "$ENFORCE" = 1 ]; then
  step "no live revision needs an image this policy would delete"
  if ! "$(dirname "$0")/05-in-use-images.sh" --check; then
    echo >&2
    echo "refusing to enforce: see above. Nothing was changed." >&2
    exit 1
  fi
fi

step "applying policy (keep newest ${KEEP_COUNT}, keep anything under ${KEEP_DAYS}d, delete the rest)"
if [ "$ENFORCE" = 1 ]; then
  would "set the policy in ENFORCING mode"
  g artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" \
    --policy="$POLICY" --no-dry-run
else
  would "set the policy in DRY RUN - Artifact Registry will log what it would delete and delete nothing"
  g artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" \
    --policy="$POLICY" --dry-run
fi

step "repository after"
repo_state
note "size does not change immediately - the policy runs on Artifact Registry's own schedule, roughly daily."
