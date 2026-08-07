#!/usr/bin/env bash
# The two sandbox release-gate boxes in 05-security.md §2, against the REAL provider.
#
#   ./scripts/run-sandbox-egress-gate.sh
#
# Credentials come from the same places production reads them, so the run cannot
# demonstrate a boundary that production does not have:
#   - VERCEL_TOKEN                  <- GCP Secret Manager, project majorana-core
#   - VERCEL_PROJECT_ID / TEAM_ID   <- plain env on the majorana-worker service
#
# The token is piped straight from `gcloud` into the child process environment and
# is never echoed, written to a file, or passed on a command line.
#
# Costs real sandbox time (six microVMs, a few seconds each). Not in CI: the suite
# is skipif-gated so `py` collects and lint-checks it and skips the execution.
set -euo pipefail

PROJECT="${GCP_PROJECT:-majorana-core}"
REGION="${CLOUD_RUN_REGION:-us-west1}"
WORKER="${WORKER_SERVICE:-majorana-worker}"
SUITE="packages/py/sandbox/tests/test_sandbox_egress_live.py"

cd "$(dirname "$0")/.."

command -v gcloud >/dev/null || { echo "gcloud is required (canary log query + token)" >&2; exit 2; }

echo "== reading the provider identity off ${WORKER} =="
# Read the IDs from the running service rather than hardcoding them here: a gate
# run against a project the worker no longer uses proves nothing about production.
worker_env_var() {
  # `.filter().extract()` renders a single-element list, so strip the brackets
  # and quotes rather than trusting the scalar projection to flatten it.
  gcloud run services describe "$WORKER" --region="$REGION" --project="$PROJECT" \
    --format="value(spec.template.spec.containers[0].env.filter(\"name:$1\").extract(value))" \
    2>/dev/null | tr -d "[]' " | head -1
}

VERCEL_PROJECT_ID="$(worker_env_var VERCEL_PROJECT_ID)"
VERCEL_TEAM_ID="$(worker_env_var VERCEL_TEAM_ID)"

if [ -z "$VERCEL_PROJECT_ID" ] || [ -z "$VERCEL_TEAM_ID" ]; then
  echo "could not read VERCEL_PROJECT_ID / VERCEL_TEAM_ID off ${WORKER}." >&2
  echo "They are plain env on the service (docs/runbooks/deploys.md)." >&2
  exit 2
fi
echo "   project=${VERCEL_PROJECT_ID}  team=${VERCEL_TEAM_ID}"

echo "== running the live gate =="
# shellcheck disable=SC2097,SC2098
VERCEL_TOKEN="$(gcloud secrets versions access latest --secret=VERCEL_TOKEN --project="$PROJECT")" \
VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID" \
VERCEL_TEAM_ID="$VERCEL_TEAM_ID" \
  uv run --package majorana-sandbox pytest "$SUITE" -v --no-header "$@"

echo
echo "PASSED. Record the run in docs/gates/ — a gate with no artifact is a claim."
