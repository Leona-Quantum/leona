#!/usr/bin/env bash
#
# Remove Cloud Run revisions nobody can reach.
#
# ## Why this is not only about money
#
# The ceiling is per PROJECT, not per service, and it is worth getting that
# right because the per-service reading makes the problem look three times
# further away than it is. Read from this project's own quota service on
# 2026-09-16 (`cloudquotas.googleapis.com`, run.googleapis.com):
#
#     ActiveRevisionsPerProject = 4000
#
# and the four services hold 1452 of it - api 722, worker 717, vqe-test 7,
# web 6. Both busy services gain a revision per deploy and this project deploys
# on every push to `dev`, about 100 a week each, so the project reaches 4000 in
# roughly three months. What happens then is that DEPLOYS START FAILING. An
# idle revision bills nothing, so nothing about the bill would ever have warned
# us. That is the real reason this exists; the registry bytes those revisions
# pin are a side benefit.
#
# ## What is never deleted
#
#   * any revision serving traffic, read from the service's own traffic list -
#     not inferred from the name, not assumed to be the newest
#   * the newest KEEP revisions of each service, whatever their age
#
# Deleting a revision is not reversible: a new deploy makes a new revision with
# a new name, so a rollback target that has been reaped is gone. KEEP is set
# wide (50) because the ceiling is 1000 and the thing being defended against is
# a slow drift towards it, not the last few days of history.
#
#   ./20-revision-reaper.sh              # list what would go
#   ./20-revision-reaper.sh --enforce    # actually delete
#
set -euo pipefail
cd "$(dirname "$0")" && . ./common.sh

KEEP="${KEEP:-50}"

for SVC in $(g run services list --region="$REGION" --format='value(metadata.name)'); do
  step "$SVC"
  api "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SVC}" \
    > "/tmp/.svc.$$" || { note "could not read the service; skipping"; continue; }
  api "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SVC}/revisions?pageSize=1000" \
    > "/tmp/.revs.$$" || { note "could not list revisions; skipping"; continue; }

  # The list of what to delete is computed in one place and printed in full.
  # A reaper that decides per-item inside a loop is a reaper whose decision
  # nobody can read before it runs.
  python3 ./_reap_plan.py "/tmp/.svc.$$" "/tmp/.revs.$$" "$KEEP" > "/tmp/.plan.$$"
  head -1 "/tmp/.plan.$$"
  DOOMED=$(tail -n +2 "/tmp/.plan.$$")

  if [ -z "$DOOMED" ]; then
    note "nothing to reap"
  elif [ "$ENFORCE" = 1 ]; then
    printf '%s\n' "$DOOMED" | while read -r r; do
      printf '   deleting %s\n' "$r"
      g run revisions delete "$r" --region="$REGION" --quiet
    done
  else
    printf '%s\n' "$DOOMED" | head -5 | sed 's/^/   would delete: /'
    note "... $(printf '%s\n' "$DOOMED" | grep -c .) in total. Re-run with --enforce."
  fi
  rm -f "/tmp/.svc.$$" "/tmp/.revs.$$" "/tmp/.plan.$$"
done
